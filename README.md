# Suno Voice DJ

Voice-controlled music curator for Suno, powered by AssemblyAI Voice Agent API and Suno's official [Trending: Text to Song](https://suno.com/playlist/f0a5e841-ef31-408c-ac49-08a1cefe5e5e) playlist.

## Setup

```bash
cp .env.example .env   # add ASSEMBLYAI_API_KEY
npm install
npm start
```

Open **http://localhost:3000/**

## Deploy on Render

1. Push this repo to GitHub (do not commit `.env`).
2. In [Render](https://dashboard.render.com/) → **New** → **Blueprint**, connect the repo, and apply `render.yaml`.
   - Or **New Web Service** → Node, build `npm install`, start `npm start`, health check `/api/health`.
3. Add environment variable **`ASSEMBLYAI_API_KEY`** (your AssemblyAI key) in the service **Environment** tab.
4. Deploy. Open the `https://your-app.onrender.com` URL (HTTPS is required for the microphone).

Free tier services spin down after inactivity; the first load may take ~30s to wake up.

## Usage

- **Orbs** — start on original SunoRecSys cover art; switch to live Suno trending covers when you ask the DJ what's trending.
- **Talk to DJ** — voice agent with tools:
  - `get_weekly_trending` — top plays from the official playlist
  - `recommend_songs` — filter by genre/mood (tag matching + popularity)
  - `select_track` — play/highlight a song by name
- **Play** — stream preview from Suno CDN when allowed; otherwise open on Suno.

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/weekly-trending` | Full trending playlist (cached 5 min) |
| `GET /api/recommend?genre=&mood=&count=` | Filtered picks |
| `POST /api/tool` | Voice tool backend |
| `GET /api/voice-token` | Short-lived AssemblyAI token |
