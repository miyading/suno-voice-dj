const SUNO_API = "https://studio-api-prod.suno.com";
export const TRENDING_PLAYLIST_ID = "f0a5e841-ef31-408c-ac49-08a1cefe5e5e";

const SUNO_HEADERS = {
  origin: "https://suno.com",
  referer: "https://suno.com/",
};

let cachedPlaylist = null;
let cacheTime = 0;
const CACHE_MS = 5 * 60 * 1000;

function inferGenre(tags) {
  const t = (tags || "").toLowerCase();
  const genres = [
    ["r&b", "r&b"], ["rnb", "r&b"], ["neo-soul", "r&b"],
    ["edm", "edm"], ["dance", "edm"], ["house", "edm"],
    ["country", "country"], ["americana", "country"],
    ["rock", "rock"], ["punk", "rock"], ["emo", "rock"],
    ["pop", "pop"], ["indie pop", "pop"],
    ["hip hop", "hip hop"], ["rap", "hip hop"], ["drill", "hip hop"],
    ["jazz", "jazz"], ["soul", "soul"],
    ["metal", "metal"], ["yacht rock", "rock"],
  ];
  for (const [needle, genre] of genres) {
    if (t.includes(needle)) return genre;
  }
  return "other";
}

export function normalizeClip(clip) {
  const meta = clip.metadata || {};
  const tags =
    typeof meta.tags === "string"
      ? meta.tags
      : Array.isArray(meta.tags)
        ? meta.tags.join(", ")
        : "";
  const id = clip.id;
  return {
    song_id: id,
    title: (clip.title || "").trim(),
    artist: clip.display_name || clip.handle || "Unknown",
    handle: clip.handle || "",
    tags,
    genre: inferGenre(tags),
    play_count: clip.play_count || 0,
    upvote_count: clip.upvote_count || 0,
    duration: meta.duration ?? null,
    audio_url: clip.audio_url || null,
    image_url: clip.image_large_url || clip.image_url || null,
    suno_url: `https://suno.com/song/${id}`,
    link: `https://suno.com/song/${id}`,
    img: clip.image_large_url || clip.image_url || null,
  };
}

export async function fetchTrendingPlaylist(force = false) {
  if (!force && cachedPlaylist && Date.now() - cacheTime < CACHE_MS) {
    return cachedPlaylist;
  }

  const res = await fetch(
    `${SUNO_API}/api/playlist/${TRENDING_PLAYLIST_ID}?page=1`,
    { headers: SUNO_HEADERS },
  );
  if (!res.ok) {
    throw new Error(`Suno playlist fetch failed: ${res.status}`);
  }

  const data = await res.json();
  const tracks = (data.playlist_clips || [])
    .map((row) => row.clip)
    .filter(Boolean)
    .map(normalizeClip);

  cachedPlaylist = {
    playlist_id: TRENDING_PLAYLIST_ID,
    name: data.name || "Trending: Text to Song",
    description:
      "Suno's official viral text-to-song trending playlist, updated by Suno.",
    suno_playlist_url: `https://suno.com/playlist/${TRENDING_PLAYLIST_ID}`,
    fetched_at: new Date().toISOString(),
    tracks,
  };
  cacheTime = Date.now();
  return cachedPlaylist;
}

function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s&]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function scoreTrack(track, { genre, mood }) {
  const blob = `${track.title} ${track.tags} ${track.genre}`.toLowerCase();
  let score = Math.log10((track.play_count || 0) + 10);

  for (const word of tokenize(genre)) {
    if (blob.includes(word)) score += 4;
  }
  for (const word of tokenize(mood)) {
    if (blob.includes(word)) score += 3;
  }
  if (genre && track.genre === genre.toLowerCase()) score += 2;
  return score;
}

export function recommendFromTrending(tracks, { genre, mood, count = 5, exclude_ids = [] }) {
  const exclude = new Set(exclude_ids);
  const pool = tracks.filter((t) => !exclude.has(t.song_id));
  const ranked = pool
    .map((t) => ({ ...t, score: scoreTrack(t, { genre, mood }) }))
    .sort((a, b) => b.score - a.score);

  if (!genre && !mood) {
    return ranked
      .sort((a, b) => b.play_count - a.play_count)
      .slice(0, count)
      .map(({ score, ...t }) => t);
  }

  return ranked.slice(0, count).map(({ score, ...t }) => t);
}

export function findTrack(tracks, query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) return null;
  return (
    tracks.find((t) => t.title.toLowerCase().includes(q)) ||
    tracks.find((t) => t.artist.toLowerCase().includes(q)) ||
    tracks.find((t) => (t.handle || "").toLowerCase().includes(q)) ||
    tracks.find((t) => tokenize(q).every((w) => `${t.title} ${t.tags}`.toLowerCase().includes(w)))
  );
}

export function summarizeForVoice(tracks, limit = 5) {
  return tracks.slice(0, limit).map((t, i) => ({
    rank: i + 1,
    title: t.title,
    artist: t.artist,
    genre: t.genre,
    plays: t.play_count,
    suno_url: t.suno_url,
    song_id: t.song_id,
  }));
}
