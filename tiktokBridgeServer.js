const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ВПИШИ СВОЙ TIKTOK-НИК БЕЗ @
const TIKTOK_HOST_USERNAME = "crumbleekykii";

const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_DELAY_MS = 5000;

const app = express();

const queue = [];
const inQueue = new Set();

const state = {
  tiktokUser: TIKTOK_HOST_USERNAME,
  connected: false,
  roomId: null,
  lastError: null,
  reconnectAttempts: 0,
  totalChats: 0,
  totalQueued: 0,
  startedAt: new Date().toISOString(),
  lastTryAt: null,
  lastOkAt: null,
};

let tiktokLive = null;
let reconnectTimer = null;

function normalizeUsername(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(cleaned)) return null;
  return cleaned;
}

function enqueue(username) {
  if (inQueue.has(username)) return;
  queue.push(username);
  inQueue.add(username);
  state.totalQueued += 1;
  console.log(`+ queued ${username} (queue: ${queue.length})`);
}

function parseNickFromChat(text) {
  if (typeof text !== "string") return null;
  const firstWord = text.trim().split(/\s+/)[0];
  return normalizeUsername(firstWord);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectTikTok();
  }, RECONNECT_DELAY_MS);
}

function connectTikTok() {
  state.reconnectAttempts += 1;
  state.lastTryAt = new Date().toISOString();

  try {
    if (tiktokLive) {
      try {
        tiktokLive.removeAllListeners();
        tiktokLive.disconnect();
      } catch (_) {}
    }
    tiktokLive = new WebcastPushConnection(TIKTOK_HOST_USERNAME);

    tiktokLive.on("chat", (data) => {
      state.totalChats += 1;
      const author = data.uniqueId || data.nickname || "?";
      console.log(`[chat] ${author}: ${data.comment}`);
      const username = parseNickFromChat(data.comment);
      if (!username) return;
      enqueue(username);
    });

    tiktokLive.on("disconnected", () => {
      state.connected = false;
      console.warn("TikTok disconnected — reconnect in 5s");
      scheduleReconnect();
    });

    tiktokLive.on("streamEnd", () => {
      state.connected = false;
      console.warn("TikTok stream ended — reconnect in 5s");
      scheduleReconnect();
    });

    console.log(`Connecting TikTok @${TIKTOK_HOST_USERNAME} (try #${state.reconnectAttempts})...`);

    tiktokLive
      .connect()
      .then((s) => {
        state.connected = true;
        state.roomId = s.roomId;
        state.lastError = null;
        state.lastOkAt = new Date().toISOString();
        console.log(`OK TikTok connected roomId=${s.roomId}`);
      })
      .catch((err) => {
        state.connected = false;
        const msg = String(err && err.message ? err.message : err);
        state.lastError = msg;
        if (state.reconnectAttempts <= 3 || state.reconnectAttempts % 12 === 0) {
          console.error(`TikTok connect failed: ${msg}`);
        }
        scheduleReconnect();
      });
  } catch (err) {
    state.connected = false;
    state.lastError = String(err);
    console.error("connectTikTok crashed:", err);
    scheduleReconnect();
  }
}

connectTikTok();

app.get("/", (_req, res) =>
  res.json({ ok: true, info: "TikTok -> Roblox bridge", state, queueSize: queue.length })
);

app.get("/status", (_req, res) =>
  res.json({ ...state, queueSize: queue.length, queuePreview: queue.slice(0, 10) })
);

app.get("/reconnect", (_req, res) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connectTikTok();
  res.json({ ok: true, msg: "reconnect triggered" });
});

app.get("/dequeue", (req, res) => {
  const rawLimit = Number(req.query.limit || 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));
  const usernames = [];
  while (usernames.length < limit && queue.length > 0) {
    const name = queue.shift();
    inQueue.delete(name);
    usernames.push(name);
  }
  res.json({ usernames });
});

app.listen(PORT, () => console.log(`Bridge listening on ${PORT}`));
