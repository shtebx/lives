const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

// На Railway задай переменную TIKTOK_HOST_USERNAME (ник без @).
const TIKTOK_HOST_USERNAME =
  process.env.TIKTOK_HOST_USERNAME || "your_tiktok_live_username";
// Люди должны писать в чат: !join RobloxNick
const JOIN_PREFIX = process.env.JOIN_PREFIX || "!join";
// Railway передаёт свой порт через PORT
const PORT = Number(process.env.PORT) || 3000;

const app = express();
const tiktokLive = new WebcastPushConnection(TIKTOK_HOST_USERNAME);

const queue = [];
const inQueue = new Set();
const recentlySent = new Map();

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
  console.log(`+ queued ${username}`);
}

function parseJoinMessage(text) {
  if (typeof text !== "string") return null;
  const msg = text.trim();
  if (!msg.toLowerCase().startsWith(JOIN_PREFIX)) return null;

  const parts = msg.split(/\s+/);
  if (parts.length < 2) return null;
  return normalizeUsername(parts[1]);
}

tiktokLive.on("chat", (data) => {
  const username = parseJoinMessage(data.comment);
  if (!username) return;
  enqueue(username);
});

tiktokLive
  .connect()
  .then((state) => {
    console.log(`Connected to roomId ${state.roomId}`);
  })
  .catch((err) => {
    console.error("TikTok connect failed:", err);
  });

app.get("/dequeue", (req, res) => {
  const rawLimit = Number(req.query.limit || 20);
  const limit = Math.max(1, Math.min(100, Number.isFinite(rawLimit) ? rawLimit : 20));

  const usernames = [];
  while (usernames.length < limit && queue.length > 0) {
    const name = queue.shift();
    inQueue.delete(name);
    usernames.push(name);
    recentlySent.set(name, Date.now());
  }

  res.json({ usernames });
});

app.listen(PORT, () => {
  console.log(`Bridge server listening: http://127.0.0.1:${PORT}`);
});
