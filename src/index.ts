// server/src/index.ts
import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import crypto from "crypto";

dotenv.config();

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REDIRECT_URI,
  CLIENT_URL,
  COOKIE_SECRET,
  PORT = "4000",
} = process.env;

if (
  !SPOTIFY_CLIENT_ID ||
  !SPOTIFY_CLIENT_SECRET ||
  !SPOTIFY_REDIRECT_URI ||
  !CLIENT_URL ||
  !COOKIE_SECRET
) {
  console.error("❌ Faltan vars de entorno en server/.env");
  process.exit(1);
}

const app = express();

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

// Utilidad para generar el state
function generateState(): string {
  return crypto.randomBytes(16).toString("hex");
}

// Healthcheck
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", time: Date.now() });
});

// 1️⃣ Login: redirige a Spotify
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

// 2️⃣ Callback: canjea code, guarda refresh_token y redirige con access_token
app.get("/api/auth/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as Record<string, string>;
  const storedState = req.cookies.spotify_state;
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
    const data: any = await tokenRes.json();
    if (data.error) {
      res.status(400).json(data);
      return;
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

// 3️⃣ Refresh: usa refresh_token de cookie
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
    const data: any = await tokenRes.json();
    if (data.error) {
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

// 4️⃣ Logout
app.post("/api/auth/logout", (_req: Request, res: Response) => {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.sendStatus(204);
});

// 5️⃣ Dummy cards endpoint (¡sin retorno implícito!)
const dummyCards = [
  {
    img: "/art/art1.png",
    title: "Spirits in the Night",
    artist: "Bruce Springsteen",
    uri: "spotify:track:3T4tUhGYeRNVUGevb0wThu",
  },
  {
    img: "/art/art2.jpg",
    title: "In a Sentimental Mood",
    artist: "Duke Ellington",
    uri: "spotify:track:7tWz5JrEl2l52t291Z76Uh",
  },
  {
    img: "/art/art3.png",
    title: "Neon Genesis",
    artist: "Tycho",
    uri: "spotify:track:4hLou4n0tJV6h4ck0MWX6z",
  },
];
app.get("/api/cards", (_req: Request, res: Response): void => {
  // Llamamos a res.json sin hacer return, para que el handler devuelva void
  res.json(dummyCards);
});

// Arrancamos el servidor
app.listen(Number(PORT), () => {
  console.log(`🚀 Backend escuchando en http://localhost:${PORT}`);
});
