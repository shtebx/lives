const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ВАЖНО: впиши сюда СВОЙ TikTok-ник (без @), с которого идёт эфир.
// Например: const TIKTOK_HOST_USERNAME = "mynick";
const TIKTOK_HOST_USERNAME = "ipad_flex";

// На Railway порт задаётся автоматически
const PORT = Number(process.env.PORT) || 3000;

if (TIKTOK_HOST_USERNAME === "your_tiktok_live_username") {
  console.error(
    "!!! TIKTOK_HOST_USERNAME не задан. Открой tiktokBridgeServer.js и впиши свой TikTok-ник в строку 6, потом сделай redeploy. !!!"
  );
}

const app = express();
const tiktokLive = new WebcastPushConnection(TIKTOK_HOST_USERNAME);

const queue = [];
const inQueue = new Set();

const state = {
  tiktokUser: TIKTOK_HOST_USERNAME,
  connected: false,
  roomId: null,
  lastError: null,
  totalChats: 0,
  totalQueued: 0,
  startedAt: new Date().toISOString(),
};

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
  console.log(`+ queued ${username} (queue size: ${queue.length})`);
}

function parseNickFromChat(text) {
  if (typeof text !== "string") return null;
  const firstWord = text.trim().split(/\s+/)[0];
  return normalizeUsername(firstWord);
}

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
  console.warn("TikTok disconnected, попробую переподключиться через 5 сек");
  setTimeout(connectTikTok, 5000);
});

tiktokLive.on("streamEnd", () => {
  state.connected = false;
  console.warn("TikTok stream ended");
});

function connectTikTok() {
  if (TIKTOK_HOST_USERNAME === "your_tiktok_live_username") {
    console.error("Не подключаюсь: TIKTOK_HOST_USERNAME не задан");
    return;
  }
  console.log(`Подключаюсь к TikTok @${TIKTOK_HOST_USERNAME}...`);
  tiktokLive
    .connect()
    .then((s) => {
      state.connected = true;
      state.roomId = s.roomId;
      state.lastError = null;
      console.log(`✓ Подключён к TikTok @${TIKTOK_HOST_USERNAME} roomId=${s.roomId}`);
    })
    .catch((err) => {
      state.connected = false;
      state.lastError = String(err && err.message ? err.message : err);
      console.error(`✗ TikTok connect failed: ${state.lastError}`);
      console.error("Возможные причины: эфир не идёт, ник указан неверно, временная блокировка TikTok. Повтор через 10 сек.");
      setTimeout(connectTikTok, 10000);
    });
}

connectTikTok();

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    info: "TikTok -> Roblox bridge",
    state,
    queueSize: queue.length,
  });
});

app.get("/status", (_req, res) => {
  res.json({ ...state, queueSize: queue.length, queuePreview: queue.slice(0, 10) });
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

app.listen(PORT, () => {
  console.log(`Bridge listening on port ${PORT}`);
});
