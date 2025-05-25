// src/index.ts
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fetch from "node-fetch";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

import type {
  SpotifyUser,
  SpotifyPlaylist,
  SpotifyPlaylistsResponse,
  SpotifyTokenResponse,
} from "./types/spotify";

dotenv.config();

const prisma = new PrismaClient();

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
    origin: [CLIENT_VERCEL_URL, CLIENT_URL],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser(COOKIE_SECRET));

function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

/* ------------------------- AUTH -------------------------- */

app.get("/api/auth/login", (_req, res) => {
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

app.get("/api/auth/callback", async (req, res) => {
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

app.get("/api/auth/refresh", async (req, res) => {
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

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("refresh_token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.sendStatus(204);
});

/* ------------------------- PLAYLIST -------------------------- */

app.post("/api/playlist/create", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No token" });

  const token = auth.replace("Bearer ", "");

  try {
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = (await userRes.json()) as SpotifyUser;

    let record = await prisma.userPlaylist.findUnique({
      where: { userId: user.id },
    });

    if (record) {
      return res.json({ playlist_id: record.playlistId });
    }

    const createRes = await fetch(
      `https://api.spotify.com/v1/users/${user.id}/playlists`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "SoundHaven",
          description: "Playlist automatically generated by SoundHaven",
          public: false,
        }),
      }
    );

    const playlist = (await createRes.json()) as SpotifyPlaylist;
    
        // Añadir imagen a la playlist
/*     const imagePath = path.join(__dirname, "assets", "playlist-cover.jpg");
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");

    await fetch(`https://api.spotify.com/v1/playlists/${playlist.id}/images`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/jpeg",
      },
      body: base64Image,
    }); */

    await prisma.userPlaylist.create({
      data: {
        userId: user.id,
        playlistId: playlist.id,
      },
    });

    res.json({ playlist_id: playlist.id });
    
  } catch (err) {
    console.error("❌ Error creando playlist:", err);
    res.status(500).json({ error: "Error creando playlist" });
  }
});

app.post("/api/playlist/add", async (req, res) => {
  const auth = req.headers.authorization;
  const { uri } = req.body;

  if (!auth || !uri) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const token = auth.replace("Bearer ", "");

  try {
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = (await userRes.json()) as SpotifyUser;

    const record = await prisma.userPlaylist.findUnique({
      where: { userId: user.id },
    });

    if (!record) {
      return res.status(404).json({ error: "Playlist no encontrada" });
    }

    const addRes = await fetch(
      `https://api.spotify.com/v1/playlists/${record.playlistId}/tracks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: [uri] }),
      }
    );

    if (!addRes.ok) {
      const data = await addRes.json();
      throw new Error(data.error?.message || "Error al añadir canción");
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Error al añadir canción:", err);
    res.status(500).json({ error: "Error al añadir canción" });
  }
});


app.get("/api/playlist/exists", async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Falta token" });

  const token = auth.replace("Bearer ", "");

  try {
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = (await userRes.json()) as SpotifyUser;

    // Verificamos si ya existe en la base de datos
    const record = await prisma.userPlaylist.findUnique({
      where: { userId: user.id },
    });

if (record) {
  // Verificamos si sigue existiendo en Spotify
  const checkRes = await fetch(`https://api.spotify.com/v1/playlists/${record.playlistId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (checkRes.status === 200) {
    return res.json({ exists: true }); // existe en Spotify
  } else {
    // La ha borrado → también la borramos de la DB
    await prisma.userPlaylist.delete({
      where: { userId: user.id },
    });
  }
}


    // Si no está en la base de datos, comprobamos en Spotify por si la creó manualmente
    let nextUrl: string | null = "https://api.spotify.com/v1/me/playlists?limit=50";

    let exists = false;

    while (nextUrl && !exists) {
      const playlistRes = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data: SpotifyPlaylistsResponse = await playlistRes.json();

      exists = data.items.some(p => p.name === "SoundHaven");

      if (exists) {
        // Guardamos en DB si no estaba
        const playlist = data.items.find(p => p.name === "SoundHaven");
        if (playlist) {
          await prisma.userPlaylist.create({
            data: {
              userId: user.id,
              playlistId: playlist.id,
            },
          });
        }
        break;
      }

      nextUrl = data.next;
    }

    res.json({ exists });
  } catch (err) {
    console.error("❌ Error comprobando playlist:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


/* ------------------------- DISCOVERIES -------------------------- */

app.post("/api/discovery", async (req, res) => {
  const { userId, cardTitle, trackUri, added } = req.body;

  if (!userId || !cardTitle || !trackUri) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  try {
    const exists = await prisma.discoveryLog.findFirst({
      where: {
        userId,
        trackUri,
      },
    });

    if (exists) {
      return res.status(200).json({ message: "Ya registrado", id: exists.id });
    }

    const log = await prisma.discoveryLog.create({
      data: {
        userId,
        cardTitle,
        trackUri,
        added: added ?? false,
      },
    });

    res.json(log);
  } catch (err) {
    console.error("Error creando DiscoveryLog:", err);
    res.status(500).json({ error: "Error interno al registrar" });
  }
});


app.post("/api/discovery/mark-as-added", async (req, res) => {
  const { userId, trackUri } = req.body;

  if (!userId || !trackUri) {
    return res.status(400).json({ error: "Faltan datos obligatorios" });
  }

  try {
    const existing = await prisma.discoveryLog.findFirst({
      where: {
        userId,
        trackUri,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "No se encontró el DiscoveryLog" });
    }

    // Solo actualizamos si aún no estaba marcado
    if (!existing.added) {
      const updated = await prisma.discoveryLog.update({
        where: { id: existing.id },
        data: { added: true },
      });
      return res.json(updated);
    }

    return res.status(200).json({ message: "Ya estaba marcado como añadido" });
  } catch (err) {
    console.error("❌ Error al actualizar DiscoveryLog:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


app.get("/api/discovery/all", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  try {
    const logs = await prisma.discoveryLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    res.json(logs);
  } catch (err) {
    console.error("Error obteniendo discovery logs:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


app.get("/api/me", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token faltante" });

  try {
    const userRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await userRes.json();

    if (!data.id) return res.status(500).json({ error: "No se pudo obtener userId" });

    res.json({
      userId: data.id,
      avatarUrl: data.images?.[0]?.url ?? null,
      displayName: data.display_name ?? null,
    });
  } catch (err) {
    console.error("❌ Error al obtener perfil de Spotify:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


/* ------------------------- CARDS -------------------------- */

app.get("/api/cards", async (req, res) => {
  try {
    const cards = await prisma.card.findMany(); // ejemplo
    res.json(cards);
  } catch (error) {
    console.error("❌ Error en /api/cards:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

app.get("/api/cards/daily", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  // 00:00 UTC de hoy y de mañana
  const today   = new Date();
  const start   = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const end     = new Date(start); end.setUTCDate(end.getUTCDate() + 1);

  try {
    /** 1) ¿Ya hay cartas asignadas para hoy? */
    let daily = await prisma.dailyCard.findMany({
      where: {
        userId,
        date: { gte: start, lt: end },
      },
      include: { card: true },
    });

    /** 2) Si no existen, las generamos */
    if (daily.length === 0) {
      // Cartas que el usuario ya descubrió alguna vez
      const discovered = await prisma.discoveryLog.findMany({
        where: { userId },
        select: { trackUri: true },
      });
      const seenUris = discovered.map(d => d.trackUri);

      // Baraja disponible
      const pool = await prisma.card.findMany({
        where: { uri: { notIn: seenUris } },
      });

      // Si el pool es < 3, permitimos repetir (opcional)
      const candidates = pool.length >= 3 ? pool : await prisma.card.findMany();

      // Elegimos 3 al azar
      const selected = candidates
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      await prisma.dailyCard.createMany({
        data: selected.map(c => ({
          userId,
          cardId: c.id,
          date: start,
        })),
      });

      daily = selected.map(card => ({ card } as any));
    }

    res.json(daily.map(d => d.card));
  } catch (err) {
    console.error("❌ /api/cards/daily:", err);
    res.status(500).json({ error: "Error interno" });
  }
});


app.post("/api/cards/seed", async (_req, res) => {
  try {
    const dummyCards = [
      {
        img: "/art/art1.png",
        title: "Farewell Transmission",
        artist: "Songs: Ohia",
        uri: "spotify:track:5Plx6OhvSukqCRdZ52wUXz",
        cover: "/art/magnoliaElectricCo.png",
        description: "A painting by Gustave Courbet",
      },
      {
        img: "/art/casca.jpg",
        title: "Archangel",
        artist: "Burial",
        uri: "spotify:track:6evpAJCR5GeeHDGgv3aXb3",
        cover: "/art/cover1.png",
        description: "From the movie Spirited Away",
      },
      {
        img: "/art/art3.png",
        title: "Pagan Poetry",
        artist: "Bj\u00f6rk",
        uri: "spotify:track:3Te7GWFEecCGPpkWVTjJ1h",
        cover: "/art/vespertine.png",
        description: "From the animated series Love, Death & Robots",
      },
      {
        img: "/art/bladeRunner.png",
        title: "Welcome to the Machine",
        artist: "Pink Floyd",
        uri: "spotify:track:5VWC7v2dC2K0SIIjT9WTLN",
        cover: "/art/wishYouWereHere.png",
        description: "From the movie Blade Runner",
      },
      {
        img: "/art/bloodborne.jpg",
        title: "De Profundis (Psalm 129)",
        artist: "Arvo Pärt",
        uri: "spotify:track:3L45cLjU7ts5FdQoJrZzQU",
        cover: "/art/DeProfundis.jpg",
        description: "From the videogame Bloodborne",
      },
            {
        img: "/art/goya1.jpg",
        title: "Black Refraction",
        artist: "Tim Hecker",
        uri: "spotify:track:4FTPWFrUzsZUYvIC1VSBxU",
        cover: "/art/virgins.png",
        description: "A painting by Francisco de Goya",
      },
      {
        img: "/art/francisBacon.png",
        title: "Guest House",
        artist: "Daughers",
        uri: "spotify:track:1rUxy9ClbnIh3MTsRe00ma",
        cover: "/art/daughters.png",
        description: "A painting by Francis Bacon",
      },
                  {
        img: "/art/silco.png",
        title: "Amethyst",
        artist: "Deafheaven",
        uri: "spotify:track:3zdMs3UPyhMUCmXOsbFzQ7",
        cover: "/art/lonelyPeopleWithPower.png",
        description: "From the animated series Arcane",
      },
      {
        img: "/art/theTrumpeter.png",
        title: "Homecoming",
        artist: "White Ward",
        uri: "spotify:track:63rCFnepqiq0tFKP6hrGsx",
        cover: "/art/homecoming.png",
        description: "A painting by Zdzisław Beksiński",
      },
            {
        img: "/art/bigfish.png",
        title: "Casimir Pulaski Day",
        artist: "Sufjan Stevens",
        uri: "spotify:track:53TIOhzNpRpl8xKdscSQSv",
        cover: "/art/illinoise.png",
        description: "From the movie Big Fish",
      },
            {
        img: "/art/deathnote1.jpg",
        title: "Crime of the Century",
        artist: "Supertramp",
        uri: "spotify:track:0uOUe1nR390nT5Sxvc5FH7",
        cover: "/art/crime.png",
        description: "From the anime Death Note",
      },
      
    ];


    for (const card of dummyCards) {
      await prisma.card.upsert({
        where: { uri: card.uri },
        update: {},
        create: card,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error al insertar cartas:", err);
    res.status(500).json({ error: "Error insertando cartas" });
  }
});


/* ------------------- DISCOVERY DE HOY ------------------- */
app.get("/api/discovery/today", async (req, res) => {
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: "Falta userId" });

  const now   = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end   = new Date(start); end.setUTCDate(end.getUTCDate() + 1);

  const log = await prisma.discoveryLog.findFirst({
    where: {
      userId,
      createdAt: { gte: start, lt: end },
    },
    orderBy: { createdAt: "asc" },
  });

  // 404 si hoy aún no eligió
  if (!log) return res.sendStatus(404);

  res.json(log);           // { id, userId, trackUri, ... }
});


app.listen(Number(PORT), () => {
  console.log(`🚀 Backend escuchando en http://localhost:${PORT}`);
});