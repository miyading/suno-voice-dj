const RATE = 24000;
const TURN_BASELINE = {
  vad_threshold: 0.5,
  min_silence: 1400,
  max_silence: 4000,
  interrupt_response: true,
};

const VOICE_TOOLS = [
  {
    type: "function",
    name: "get_weekly_trending",
    description:
      "Get the hottest tracks from Suno's official Trending Text to Song playlist this week. Use when the user asks what is trending, popular, or wants weekly picks.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many tracks, 1-10. Default 5." },
      },
    },
  },
  {
    type: "function",
    name: "recommend_songs",
    description:
      "Recommend songs from this week's Suno trending playlist filtered by genre or mood. Use when the user wants suggestions like chill R&B, hype EDM, country, emo, etc.",
    parameters: {
      type: "object",
      properties: {
        genre: { type: "string", description: "Genre or style, e.g. r&b, edm, country, rock, pop" },
        mood: { type: "string", description: "Mood, e.g. chill, upbeat, emotional, angry, romantic" },
        count: { type: "integer", description: "Number of picks, default 3, max 8" },
      },
    },
  },
  {
    type: "function",
    name: "select_track",
    description:
      "Find and highlight a track in the visualizer by title or artist. Use when the user says play a song or names a specific track.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Part of song title or artist name" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "control_playback",
    description:
      "Pause, resume, or toggle music playback. Use when the user says pause, stop, hold on, quiet the music, keep playing, resume, or unpause. Prefer this over telling them to click buttons.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["pause", "play", "resume", "toggle"],
          description: "pause or stop to halt audio; play or resume to continue; toggle to switch.",
        },
      },
      required: ["action"],
    },
  },
];

const workletUrl = URL.createObjectURL(
  new Blob(
    [
      `class P extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (ch) {
            const buf = new Int16Array(ch.length);
            for (let i = 0; i < ch.length; i++)
              buf[i] = Math.max(-32768, Math.min(32767, ch[i] * 32767));
            this.port.postMessage(buf.buffer, [buf.buffer]);
          }
          return true;
        }
      }
      registerProcessor("pcm", P);`,
    ],
    { type: "application/javascript" },
  ),
);

export function createVoiceAgent({
  onStatus,
  onTranscript,
  onToolResult,
  onPlaybackControl,
  keyterms = [],
}) {
  let ws, ctx, mic, ready = false, waitingForAnswer = false;
  let nextStartTime = 0;
  const liveSources = new Set();

  function setTurnDetection(td) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "session.update", session: { input: { turn_detection: td } } }));
    }
  }

  function flushPlayback() {
    for (const s of liveSources) {
      try { s.onended = null; s.stop(0); s.disconnect(); } catch {}
    }
    liveSources.clear();
    if (ctx) nextStartTime = ctx.currentTime;
  }

  function playReplyAudio(b64) {
    const raw = atob(b64);
    const pcm = new Int16Array(raw.length / 2);
    for (let i = 0; i < pcm.length; i++)
      pcm[i] = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, nextStartTime);
    src.start(startAt);
    src.onended = () => liveSources.delete(src);
    liveSources.add(src);
    nextStartTime = startAt + buf.duration;
  }

  function parseToolCall(m) {
    const args =
      typeof m.arguments === "string"
        ? (() => {
            try {
              return JSON.parse(m.arguments);
            } catch {
              return {};
            }
          })()
        : m.arguments ?? {};
    return {
      name: m.name ?? m.function?.name ?? m.function_name ?? "",
      arguments: args,
      call_id: m.call_id,
    };
  }

  async function runTool(call) {
    const toolName = call.name;
    const args = call.arguments ?? {};

    if (toolName === "control_playback") {
      flushPlayback();
      const action = args.action ?? args.command ?? "pause";
      const data =
        (await onPlaybackControl?.(action)) ?? {
          ok: false,
          message: "Playback control unavailable",
        };
      data.action = action;
      onToolResult?.(toolName, data);
      return data;
    }

    const res = await fetch("/api/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: call.name, arguments: call.arguments || {} }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Tool failed");
    onToolResult?.(call.name, data);
    return data;
  }

  async function start({ keyterms: extraKeyterms = [] } = {}) {
    onStatus("Connecting…");
    waitingForAnswer = false;
    const terms = [...keyterms, ...extraKeyterms].filter(Boolean).slice(0, 50);

    let health;
    try {
      health = await fetch("/api/health");
    } catch {
      throw new Error(
        "Cannot reach the local server. Run npm start in the VoiceAgent folder, then open http://localhost:3000/",
      );
    }
    if (!health.ok) {
      throw new Error("Local server is not responding. Run npm start and reload.");
    }
    const healthData = await health.json();
    if (!healthData.has_api_key) {
      throw new Error("ASSEMBLYAI_API_KEY is missing. Add it to your .env file.");
    }

    const tokenRes = await fetch("/api/voice-token");
    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      throw new Error(err.error || "Failed to get voice token — check your AssemblyAI API key");
    }
    const { token } = await tokenRes.json();
    if (!token) throw new Error("Voice token was empty — check your AssemblyAI API key");

    ctx = new AudioContext({ sampleRate: RATE });
    await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    nextStartTime = ctx.currentTime;

    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
    });

    const source = ctx.createMediaStreamSource(mic);
    const worklet = new AudioWorkletNode(ctx, "pcm");

    const url = new URL("wss://agents.assemblyai.com/v1/ws");
    url.searchParams.set("token", token);
    ws = new WebSocket(url);
    ready = false;

    let connectDone = null;
    const connectPromise = new Promise((resolve, reject) => {
      connectDone = { resolve, reject };
    });
    const connectTimeout = setTimeout(() => {
      if (!ready && connectDone) {
        connectDone.reject(new Error("Voice connection timed out"));
        connectDone = null;
        onStatus("Connection timed out", "err");
        stop({ resetStatus: false });
      }
    }, 20000);

    worklet.port.onmessage = ({ data }) => {
      if (!ready || ws.readyState !== 1) return;
      const b = new Uint8Array(data);
      let s = "";
      for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
      ws.send(JSON.stringify({ type: "input.audio", audio: btoa(s) }));
    };
    source.connect(worklet).connect(ctx.destination);

    const systemPrompt = `You are Suno DJ, a voice music curator for Suno creators.
The screen starts on the SunoRecSys Discover Weekly demo art. When someone asks what is trending, hot this week, or wants the viral Suno playlist, call get_weekly_trending so the visuals switch to live Suno covers.
When they want a vibe or genre, call recommend_songs with genre and mood.
When they name a song to hear, call select_track with their words.
When they say pause, stop, hold on, or resume, you must call control_playback before saying music stopped or paused. Never claim playback changed without calling the tool.
Keep every spoken reply to one or two short sentences. No markdown, bullets, or exclamation marks.
After tool results, name one or two specific tracks and why they fit. Round big play counts.
Never invent songs not in tool results.`;

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            system_prompt: systemPrompt,
            greeting:
              "Hey, I'm your Suno DJ. You're looking at the Discover Weekly visualizer. Ask what's trending this week and I'll pull up Suno's live playlist, or tell me a mood for a pick.",
            output: { type: "audio", voice: "ivy" },
            input: {
              turn_detection: TURN_BASELINE,
              keyterms: terms,
            },
            tools: VOICE_TOOLS,
          },
        }),
      );

    ws.onmessage = async ({ data }) => {
      const m = JSON.parse(data);
      switch (m.type) {
        case "input.speech.started":
          flushPlayback();
          break;
        case "session.ready":
          ready = true;
          clearTimeout(connectTimeout);
          connectDone?.resolve();
          connectDone = null;
          onStatus("Listening", "ok");
          break;
        case "reply.audio":
          playReplyAudio(m.data);
          break;
        case "reply.done":
          if (m.status === "interrupted") flushPlayback();
          break;
        case "transcript.user":
          onTranscript?.("user", m.text);
          if (waitingForAnswer) {
            waitingForAnswer = false;
            setTurnDetection(TURN_BASELINE);
          }
          break;
        case "transcript.agent":
          onTranscript?.("agent", m.text);
          if (/\?\s*$/.test(m.text || "")) {
            waitingForAnswer = true;
            setTurnDetection({ ...TURN_BASELINE, min_silence: 2200, max_silence: 6000 });
          }
          break;
        case "tool.call": {
          try {
            const parsed = parseToolCall(m);
            const result = await runTool(parsed);
            ws.send(
              JSON.stringify({
                type: "tool.result",
                call_id: m.call_id,
                result: JSON.stringify(result),
              }),
            );
          } catch (err) {
            ws.send(
              JSON.stringify({
                type: "tool.result",
                call_id: m.call_id,
                result: JSON.stringify({ error: err.message }),
              }),
            );
          }
          break;
        }
        case "session.error": {
          const msg = m.message || m.code || "session error";
          clearTimeout(connectTimeout);
          connectDone?.reject(new Error(msg));
          connectDone = null;
          onStatus(`Error: ${msg}`, "err");
          break;
        }
        case "error": {
          const msg = m.message || "unknown";
          clearTimeout(connectTimeout);
          connectDone?.reject(new Error(msg));
          connectDone = null;
          onStatus(`Error: ${msg}`, "err");
          break;
        }
      }
    };

    ws.onclose = (ev) => {
      clearTimeout(connectTimeout);
      const failedEarly = !ready && connectDone;
      if (failedEarly) {
        const hint =
          ev.code === 1008
            ? "Unauthorized — refresh and try again (check AssemblyAI API key)"
            : `WebSocket closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ""})`;
        connectDone.reject(new Error(hint));
        connectDone = null;
        onStatus(hint, "err");
        stop({ resetStatus: false });
      } else {
        if (ready) onStatus("Disconnected");
        stop({ resetStatus: false });
      }
    };
    ws.onerror = () => {
      if (!ready) onStatus("WebSocket error — check server and network", "err");
    };

    await connectPromise;
  }

  function stop({ resetStatus = true } = {}) {
    flushPlayback();
    ws?.close();
    mic?.getTracks().forEach((t) => t.stop());
    ctx?.close();
    ws = ctx = mic = null;
    ready = false;
    if (resetStatus) onStatus("Ready — say what's trending to switch orbs");
  }

  function isConnected() {
    return ws?.readyState === WebSocket.OPEN && ready;
  }

  return { start, stop, isConnected, flushAgentAudio: flushPlayback };
}
