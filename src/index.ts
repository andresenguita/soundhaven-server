// server/src/index.ts
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";

import type {
  SpotifyUser,
  SpotifyPlaylist,
  SpotifyPlaylistsResponse,
  SpotifyTokenResponse,
} from "./types/spotify";

dotenv.config();

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  CLIENT_URL,
  CLIENT_VERCEL_URL,
  COOKIE_SECRET,
  PORT = "4000",
} = process.env;

if (
  !SPOTIFY_CLIENT_ID ||
  !SPOTIFY_CLIENT_SECRET ||
  !SPOTIFY_REDIRECT_URI ||
  !CLIENT_URL ||
  !CLIENT_VERCEL_URL ||
  !COOKIE_SECRET
) {
  console.error("❌ Faltan vars de entorno en server/.env");
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: [CLIENT_VERCEL_URL,CLIENT_URL],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", time: Date.now() });
});

app.get("/api/auth/login", (_req: Request, res: Response) => {
  const state = generateState();
  res.cookie("spotify_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
  });
  const scopes = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "playlist-modify-public",
    "playlist-modify-private",
    "streaming",
  ].join(" ");
  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT_URI,
    scope: scopes,
    state,
    show_dialog: "true",
  });
  res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get("/api/auth/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string>;
  const storedState = req.cookies.spotify_state;

  if (error === "access_denied") {
    return res.redirect(`${CLIENT_URL}/login?error=access_denied`);
  }

  if (!state || state !== storedState) {
    res.status(400).send("State mismatch");
    return;
  }

  res.clearCookie("spotify_state");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: SPOTIFY_REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET,
  });

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await tokenRes.json()) as SpotifyTokenResponse;

    if (!tokenRes.ok || !data.access_token) {
      return res.redirect(`${CLIENT_URL}/login?error=invalid_code`);
    }

    res.cookie("refresh_token", data.refresh_token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${CLIENT_URL}/cards?access_token=${data.access_token}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error retrieving tokens");
  }
});

app.get("/api/auth/refresh", async (req: Request, res: Response) => {
  const refresh_token = req.cookies.refresh_token;
  if (!refresh_token) {
    res.sendStatus(401);
    return;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token,
    client_id: SPOTIFY_CLIENT_ID,
    client_secret: SPOTIFY_CLIENT_SECRET,
  });

  try {
    const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const data = (await tokenRes.json()) as SpotifyTokenResponse;

    if (!tokenRes.ok || !data.access_token) {
      res.status(400).json(data);
      return;
    }

    if (data.refresh_token) {
      res.cookie("refresh_token", data.refresh_token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
    }

    res.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error refreshing token");
  }
});

app.post("/api/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.sendStatus(204);
});

const dummyCards = [
  {
    img: "/art/art1.png",
    title: "Farewell Transmission",
    artist: "Songs: Ohia",
    cover: "/art/magnoliaElectricCo.png",
    uri: "spotify:track:5Plx6OhvSukqCRdZ52wUXz",
    description: "A painting by Gustave Courbet"
  },
  {
    img: "/art/art2.jpg",
    title: "Archangel",
    artist: "Burial",
    cover: "/art/cover1.png",
    uri: "spotify:track:6evpAJCR5GeeHDGgv3aXb3",
    description: "From the movie Spirited Away"
  },
  {
    img: "/art/art3.png",
    title: "Pagan Poetry",
    artist: "Björk",
    cover: "/art/vespertine.png",
    uri: "spotify:track:3Te7GWFEecCGPpkWVTjJ1h",
    description: "From the animated series Love, Death & Robots" 
  },
];

app.get("/api/cards", (_req: Request, res: Response): void => {
  res.json(dummyCards);
});

// ✔ Playlist reutilizable
const getOrCreatePlaylist = async (token: string): Promise<string> => {
  const userRes = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const userData = (await userRes.json()) as SpotifyUser;
  const userId = userData.id;

  let offset = 0;

  while (true) {
    const playlistsRes = await fetch(
      `https://api.spotify.com/v1/me/playlists?limit=50&offset=${offset}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const playlistsData = (await playlistsRes.json()) as SpotifyPlaylistsResponse;

    const match = playlistsData.items.find(
      (p) => p.name.toLowerCase() === "soundhaven"
    );

    if (match) return match.id;

    if (!playlistsData.next) break;
    offset += 50;
  }

  const createRes = await fetch(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "SoundHaven",
        description: "Playlist generada automáticamente por SoundHaven",
        public: false,
      }),
    }
  );
  const newPlaylist = (await createRes.json()) as SpotifyPlaylist;
  return newPlaylist.id;
};

app.post("/api/playlist/create", (req: Request, res: Response) => {
  (async () => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "No token" });

    const token = auth.replace("Bearer ", "");

    try {
      const playlistId = await getOrCreatePlaylist(token);
      res.json({ playlist_id: playlistId });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error creando la playlist" });
    }
  })();
});


app.post("/api/playlist/add", async (req: Request, res: Response) => {
  const auth = req.headers.authorization;
  const { uri } = req.body;

  if (!auth || !uri) {
    res.status(400).json({ error: "Faltan datos" });
    return;
  }

  const token = auth.replace("Bearer ", "");

  try {
    const playlistId = await getOrCreatePlaylist(token);

    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ uris: [uri] }),
    });

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al añadir canción" });
  }
});

app.listen(Number(PORT), () => {
  console.log(`🚀 Backend escuchando en http://localhost:${PORT}`);
});
