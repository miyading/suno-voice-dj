import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  fetchTrendingPlaylist,
  recommendFromTrending,
  findTrack,
  summarizeForVoice,
} from "./lib/suno.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    has_api_key: Boolean(process.env.ASSEMBLYAI_API_KEY),
  });
});

app.get("/api/voice-token", async (_req, res) => {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "ASSEMBLYAI_API_KEY is not set" });
  }

  const url = new URL("https://agents.assemblyai.com/v1/token");
  url.searchParams.set("expires_in_seconds", "300");
  url.searchParams.set("max_session_duration_seconds", "3600");

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const { token } = await response.json();
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/weekly-trending", async (req, res) => {
  try {
    const playlist = await fetchTrendingPlaylist(req.query.refresh === "1");
    const limit = Math.min(parseInt(req.query.limit, 10) || 19, 30);
    res.json({
      ...playlist,
      tracks: playlist.tracks.slice(0, limit),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/recommend", async (req, res) => {
  try {
    const playlist = await fetchTrendingPlaylist();
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 5, 1), 10);
    const picks = recommendFromTrending(playlist.tracks, {
      genre: req.query.genre || "",
      mood: req.query.mood || "",
      count,
    });
    res.json({
      source: playlist.name,
      playlist_url: playlist.suno_playlist_url,
      recommendations: picks,
      summary: summarizeForVoice(picks, count),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/tool", async (req, res) => {
  const { name, arguments: args = {} } = req.body || {};
  try {
    const playlist = await fetchTrendingPlaylist();
    const tracks = playlist.tracks;

    if (name === "get_weekly_trending") {
      const limit = Math.min(Math.max(args.limit || 5, 1), 10);
      const top = [...tracks]
        .sort((a, b) => b.play_count - a.play_count)
        .slice(0, limit);
      return res.json({
        playlist: playlist.name,
        picks: summarizeForVoice(top, limit),
      });
    }

    if (name === "recommend_songs") {
      const count = Math.min(Math.max(args.count || 3, 1), 8);
      const picks = recommendFromTrending(tracks, {
        genre: args.genre || "",
        mood: args.mood || "",
        count,
      });
      return res.json({
        genre: args.genre || null,
        mood: args.mood || null,
        picks: summarizeForVoice(picks, count),
      });
    }

    if (name === "select_track") {
      const match = findTrack(tracks, args.query);
      if (!match) {
        return res.json({ found: false, message: `No track matching "${args.query}"` });
      }
      return res.json({
        found: true,
        track: summarizeForVoice([match], 1)[0],
      });
    }

    res.status(400).json({ error: `Unknown tool: ${name}` });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Suno Voice DJ listening on port ${PORT}`);
});
