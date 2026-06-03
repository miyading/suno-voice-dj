import { createVisualizer } from "./visualizer.js";
import { createVoiceAgent } from "./voice.js";
import { DEFAULT_PLAYLIST } from "./default-playlist.js";

const $ = (id) => document.getElementById(id);
const audioEl = $("audio-element");

let viewMode = "curated";
let trendingPlaylist = [];
let trendingMeta = null;
let displayPlaylist = [...DEFAULT_PLAYLIST];
let currentIndex = -1;

const visualizer = createVisualizer({
  canvasHost: document.body,
  vinylImg: "./assets/suno_vinyl.png",
  onTrackSelect: (track, index) => showTrack(track, index, true),
});

function showTrack(track, index, tryPlay = false) {
  currentIndex = index;
  if (tryPlay) visualizer.highlightIndex(index);
  $("track-title").textContent = track.title;
  $("track-artist").textContent = track.artist;
  const metaParts = [];
  if (track.genre && track.genre !== "other") metaParts.push(track.genre);
  if (track.play_count) metaParts.push(`${formatPlays(track.play_count)} plays`);
  if (viewMode === "curated" && !track.play_count) metaParts.push("SunoRecSys picks");
  $("track-meta").textContent = metaParts.join(" · ");

  if (!tryPlay) {
    visualizer.setVinylSpinning(false);
    return;
  }

  if (track.audio) {
    audioEl.pause();
    audioEl.src = track.audio;
    audioEl.load();
    audioEl
      .play()
      .then(() => {
        visualizer.setVinylSpinning(true);
        $("btn-play").textContent = "PAUSE";
      })
      .catch(() => {
        visualizer.setVinylSpinning(false);
        $("btn-play").textContent = "PLAY";
      });
    return;
  }

  if (track.audio_url) {
    audioEl.pause();
    audioEl.src = track.audio_url;
    audioEl.load();
    audioEl
      .play()
      .then(() => {
        visualizer.setVinylSpinning(true);
        $("btn-play").textContent = "PAUSE";
      })
      .catch(() => {
        visualizer.setVinylSpinning(false);
        $("btn-play").textContent = "OPEN ON SUNO";
      });
    return;
  }

  const url = track.suno_url || track.link;
  if (url) window.open(url, "_blank");
}

function isPlaying() {
  return Boolean(audioEl.src) && !audioEl.paused;
}

async function controlPlayback(action) {
  const act = (action || "pause").toLowerCase();
  const track = displayPlaylist[currentIndex];
  const title = track?.title ?? null;

  if (act === "pause" || act === "stop") {
    if (!audioEl.src || audioEl.paused) {
      visualizer.setVinylSpinning(false);
      $("btn-play").textContent = "PLAY";
      return { ok: true, state: "paused", track: title, message: "Already paused" };
    }
    audioEl.pause();
    visualizer.setVinylSpinning(false);
    $("btn-play").textContent = "PLAY";
    return { ok: true, state: "paused", track: title };
  }

  if (act === "play" || act === "resume") {
    if (currentIndex < 0 || !track) {
      return { ok: false, message: "No track selected. Ask me to play a song first." };
    }
    if (!audioEl.src) {
      showTrack(track, currentIndex, true);
      return { ok: true, state: isPlaying() ? "playing" : "paused", track: title };
    }
    try {
      await audioEl.play();
      visualizer.highlightIndex(currentIndex);
      visualizer.setVinylSpinning(true);
      $("btn-play").textContent = "PAUSE";
      return { ok: true, state: "playing", track: title };
    } catch {
      visualizer.setVinylSpinning(false);
      $("btn-play").textContent = "PLAY";
      return { ok: false, state: "paused", track: title, message: "Could not resume playback" };
    }
  }

  if (act === "toggle") {
    return controlPlayback(isPlaying() ? "pause" : "play");
  }

  return { ok: false, message: `Unknown action: ${action}` };
}

function formatPlays(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

function setLoading(show, msg = "") {
  const el = $("loading");
  el.style.display = show ? "flex" : "none";
  if (msg) el.querySelector(".load-msg").textContent = msg;
}

function setHeaderCurated() {
  $("playlist-name").textContent = "Discover Weekly";
  $("playlist-sub").textContent = "SunoRecSys visualizer · ask the DJ for this week's Suno trending";
  $("playlist-link").textContent = "Trending on Suno";
  $("playlist-link").href =
    "https://suno.com/playlist/f0a5e841-ef31-408c-ac49-08a1cefe5e5e";
}

function setHeaderTrending() {
  if (trendingMeta) {
    $("playlist-name").textContent = trendingMeta.name || "Trending This Week";
    $("playlist-sub").textContent = "Live from Suno · click an orb to preview";
    $("playlist-link").href = trendingMeta.suno_playlist_url;
    $("playlist-link").textContent = "View playlist on Suno";
  }
}

function showPlaylist(tracks, { loadingMsg, onDone } = {}) {
  displayPlaylist = tracks;
  if (loadingMsg) setLoading(true, loadingMsg);
  visualizer.setPlaylist(displayPlaylist, () => {
    setLoading(false);
    if (displayPlaylist[0]) showTrack(displayPlaylist[0], 0, false);
    onDone?.();
  });
}

function showCuratedView() {
  viewMode = "curated";
  setHeaderCurated();
  showPlaylist([...DEFAULT_PLAYLIST]);
}

async function ensureTrendingLoaded() {
  if (trendingPlaylist.length) return trendingPlaylist;
  const res = await fetch("/api/weekly-trending");
  if (!res.ok) throw new Error((await res.json()).error || "Failed to load trending");
  const data = await res.json();
  trendingPlaylist = data.tracks;
  trendingMeta = {
    name: data.name,
    suno_playlist_url: data.suno_playlist_url,
  };
  return trendingPlaylist;
}

function switchToTrendingView(tracks = null) {
  viewMode = "trending";
  setHeaderTrending();
  const list = tracks?.length ? tracks : trendingPlaylist;
  showPlaylist(list, { loadingMsg: "Loading trending covers…" });
}

async function prefetchTrending() {
  try {
    await ensureTrendingLoaded();
  } catch (e) {
    console.warn("Trending prefetch failed:", e);
  }
}

function applyRecommendationPicks(picks) {
  if (!picks?.length || !trendingPlaylist.length) return;
  const ids = new Set(picks.map((p) => p.song_id));
  const ordered = picks
    .map((p) => trendingPlaylist.find((t) => t.song_id === p.song_id))
    .filter(Boolean);
  if (!ordered.length) return;

  viewMode = "trending";
  setHeaderTrending();
  const list = ordered.length >= 3 ? ordered : trendingPlaylist;
  showPlaylist(list, { loadingMsg: "Updating your picks…" });
}

async function handleToolResult(name, data) {
  if (name === "get_weekly_trending") {
    try {
      await ensureTrendingLoaded();
      switchToTrendingView(trendingPlaylist);
    } catch (e) {
      console.error(e);
    }
    return;
  }

  if (name === "recommend_songs") {
    try {
      await ensureTrendingLoaded();
      applyRecommendationPicks(data.picks);
    } catch (e) {
      console.error(e);
    }
    return;
  }

  if (name === "select_track" && data.found && data.track) {
    if (!trendingPlaylist.length) await ensureTrendingLoaded().catch(() => {});
    const full = trendingPlaylist.find((t) => t.song_id === data.track.song_id);
    if (full) {
      if (viewMode !== "trending") switchToTrendingView(trendingPlaylist);
      const idx = visualizer.findIndexBySongId(data.track.song_id);
      if (idx >= 0) showTrack(displayPlaylist[idx], idx, true);
      else window.open(full.suno_url, "_blank");
      return;
    }
    const q = (data.track.title || "").toLowerCase();
    const curatedIdx = displayPlaylist.findIndex((t) => t.title.toLowerCase().includes(q));
    if (curatedIdx >= 0) showTrack(displayPlaylist[curatedIdx], curatedIdx, true);
    else if (data.track.suno_url) window.open(data.track.suno_url, "_blank");
  }
}

const keytermsForVoice = () => {
  const curated = DEFAULT_PLAYLIST.flatMap((t) => [t.title, t.artist]);
  const trending = trendingPlaylist.flatMap((t) => [t.title, t.artist, t.handle].filter(Boolean));
  return [...curated, ...trending].slice(0, 50);
};

audioEl.addEventListener("pause", () => {
  visualizer.setVinylSpinning(false);
  $("btn-play").textContent = "PLAY";
});
audioEl.addEventListener("play", () => {
  visualizer.setVinylSpinning(true);
  $("btn-play").textContent = "PAUSE";
});

const voice = createVoiceAgent({
  onPlaybackControl: controlPlayback,
  onStatus: (msg, cls) => {
    const dot = $("voice-status");
    dot.textContent = msg;
    dot.className = "voice-status" + (cls ? ` ${cls}` : "");
  },
  onTranscript: (who, text) => {
    const panel = $("transcript-lines");
    const line = document.createElement("div");
    line.className = `line ${who}`;
    line.textContent = text;
    panel.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
    while (panel.children.length > 40) panel.removeChild(panel.firstChild);
  },
  onToolResult: handleToolResult,
});

$("btn-voice").addEventListener("click", async () => {
  if (voice.isConnected()) {
    voice.stop();
    $("btn-voice").textContent = "Talk to DJ";
    $("btn-voice").classList.remove("on");
    return;
  }
  try {
    $("btn-voice").disabled = true;
    await prefetchTrending();
    await voice.start({ keyterms: keytermsForVoice() });
    $("btn-voice").textContent = "Stop";
    $("btn-voice").classList.add("on");
  } catch (e) {
    alert(e.message);
  } finally {
    $("btn-voice").disabled = false;
  }
});

$("btn-play").addEventListener("click", (e) => {
  e.stopPropagation();
  if (currentIndex < 0 && displayPlaylist[0]) {
    showTrack(displayPlaylist[0], 0, true);
    return;
  }
  const track = displayPlaylist[currentIndex];
  if (!track) return;
  if (!audioEl.paused && audioEl.src) {
    audioEl.pause();
    visualizer.setVinylSpinning(false);
    $("btn-play").textContent = "PLAY";
    return;
  }
  showTrack(track, currentIndex, true);
});

$("btn-open-suno").addEventListener("click", (e) => {
  e.stopPropagation();
  const track = displayPlaylist[currentIndex];
  const url = track?.suno_url || track?.link;
  if (url) window.open(url, "_blank");
});

setLoading(true, "Rendering SunoRecSys library…");
setHeaderCurated();
showPlaylist([...DEFAULT_PLAYLIST], {
  onDone: () => prefetchTrending(),
});
