const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

// Твой TikTok-ник (без @), с чьего идёт трансляция — поменяй на свой:
const TIKTOK_HOST_USERNAME = "ipad_flex";
// В чате просто пишут Roblox-ник (без !join)
// На Railway порт задаётся автоматически
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

function parseNickFromChat(text) {
  if (typeof text !== "string") return null;
  const firstWord = text.trim().split(/\s+/)[0];
  return normalizeUsername(firstWord);
}

tiktokLive.on("chat", (data) => {
  const username = parseNickFromChat(data.comment);
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
