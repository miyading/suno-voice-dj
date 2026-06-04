# Suno Voice DJ

Talk to a voice DJ and explore Suno music in a 3D **Discover Weekly**-style visualizer.

**Try it now:** [https://suno-voice-dj.onrender.com/](https://suno-voice-dj.onrender.com/)

Built with [AssemblyAI Voice Agent API](https://www.assemblyai.com/docs/voice-agents/voice-agent-api) and Suno’s official [Trending: Text to Song](https://suno.com/playlist/f0a5e841-ef31-408c-ac49-08a1cefe5e5e) playlist.

---

## How to use

1. Open **[suno-voice-dj.onrender.com](https://suno-voice-dj.onrender.com/)** in Chrome or Edge (HTTPS is required for the microphone).
2. Wait for the cover-art orbs to load around the vinyl.
3. Click **Talk to DJ** and allow microphone access.
4. Speak naturally — you do not need exact commands.

**First visit on the free host?** The site may take up to ~30 seconds to wake up if it has been idle. Refresh once if needed.

---

## What you can do

| You say | What happens |
|--------|----------------|
| “What’s trending on Suno this week?” | Switches the orbs to **live Suno trending** covers and the DJ names hot tracks. |
| “Something chill and R&B” (or any mood/genre) | Picks matching songs from this week’s trending list. |
| “Play the second biggest hit on platform” (or any title/artist) | Moves that album to the **center** and starts preview playback when available. |
| “Pause” / “Stop” | Stops in-app music and the spinning vinyl. |
| “Resume” / “Keep playing” | Continues the current track. |

You can also **click an orb** to select a track, or use **Play** / **Open on Suno** at the bottom.

---

## On screen

- **Start view** — Original SunoRecSys demo album art orbiting the record.
- **Trending view** — After you ask what’s hot, orbs show real covers from Suno’s viral text-to-song playlist.
- **Now playing** — The selected cover animates to the center and spins with the vinyl while audio plays.

---

## Tips

- Use **headphones or speakers** at a normal volume; the browser uses echo cancellation so the DJ does not hear itself.
- If preview audio does not play in the browser, use **Open on Suno** for the full track on [suno.com](https://suno.com).
- The **Play / Pause** button still works if you prefer clicking over voice.

---

## Run locally (optional)

For developers hosting their own copy:

```bash
cp .env.example .env   # add ASSEMBLYAI_API_KEY
npm install
npm start
```

Open **http://localhost:3000/**

---

## For developers

See `render.yaml` for deployment. The server mints short-lived voice tokens so your AssemblyAI key never ships to the browser.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/health` | Health check |
| `GET /api/weekly-trending` | Suno trending playlist (cached) |
| `GET /api/recommend` | Genre/mood filtered picks |
| `GET /api/voice-token` | Browser voice session token |
