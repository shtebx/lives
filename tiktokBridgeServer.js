const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

// ВПИШИ СВОЙ TIKTOK-НИК БЕЗ @
const TIKTOK_HOST_USERNAME = "crumbleekykii";

const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_DELAY_MS = 5000;

const app = express();

// Очередь теперь хранит объекты: { username, type, giftName, diamonds }
const queue = [];
const inQueue = new Set();

const state = {
  tiktokUser: TIKTOK_HOST_USERNAME,
  connected: false,
  roomId: null,
  lastError: null,
  reconnectAttempts: 0,
  totalChats: 0,
  totalGifts: 0,
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

function findNicksInText(text) {
  if (typeof text !== "string") return [];
  const matches = text.match(/[A-Za-z][A-Za-z0-9_]{2,19}/g);
  if (!matches) return [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function enqueueChat(username) {
  const key = `chat:${username}`;
  if (inQueue.has(key)) return;
  queue.push({ username, type: "chat" });
  inQueue.add(key);
  state.totalQueued += 1;
  console.log(`+ queued [chat] ${username} (queue: ${queue.length})`);
}

function enqueueGift(username, giftName, diamonds, repeatCount) {
  // Подарки всегда добавляем (можно несколько раз)
  const entry = { 
    username, 
    type: "gift", 
    giftName: giftName || "Gift",
    diamonds: diamonds || 1,
    repeatCount: repeatCount || 1
  };
  queue.push(entry);
  state.totalQueued += 1;
  state.totalGifts += 1;
  console.log(`+ queued [GIFT] ${username} sent ${giftName} x${repeatCount} (${diamonds} diamonds) (queue: ${queue.length})`);
}

function parseNicksFromChat(text) {
  return findNicksInText(text);
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

    // Обработка сообщений чата
    tiktokLive.on("chat", (data) => {
      state.totalChats += 1;
      const author = data.uniqueId || data.nickname || "?";
      const nicks = parseNicksFromChat(data.comment);
      if (nicks.length > 0) {
        console.log(`[chat] ${author}: ${data.comment}  =>  [${nicks.join(", ")}]`);
        for (const n of nicks) enqueueChat(n);
      } else {
        console.log(`[chat] ${author}: ${data.comment}  (no valid nick)`);
      }
    });

    // Обработка подарков
    tiktokLive.on("gift", (data) => {
      const author = data.uniqueId || data.nickname || "unknown";
      const giftName = data.giftName || (data.giftId ? `gift_${data.giftId}` : "Gift");
      const diamonds = data.diamondCount || data.extendedGiftInfo?.diamondCount || 1;
      const repeatCount = data.repeatCount || 1;
      
      // repeatEnd означает, что стрик подарков закончился — отправляем итоговый
      if (data.giftType === 1 && !data.repeatEnd) {
        // Стриковый подарок, ещё не закончился — ждём
        return;
      }
      
      console.log(`[GIFT] ${author} sent ${giftName} x${repeatCount} (${diamonds} diamonds)`);
      
      // Ищем Roblox-ник в нике TikTok автора
      const nicks = findNicksInText(author);
      if (nicks.length > 0) {
        enqueueGift(nicks[0], giftName, diamonds, repeatCount);
      } else {
        // Если TikTok-ник не подходит, всё равно добавим — Roblox проверит
        enqueueGift(author, giftName, diamonds, repeatCount);
      }
    });

    // Лайки тоже можно ловить (опционально)
    tiktokLive.on("like", (data) => {
      // Раскомментируй, если хочешь реагировать на лайки:
      // const author = data.uniqueId || "?";
      // console.log(`[like] ${author} sent ${data.likeCount} likes`);
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
  const items = [];
  while (items.length < limit && queue.length > 0) {
    const item = queue.shift();
    if (item.type === "chat") {
      inQueue.delete(`chat:${item.username}`);
    }
    items.push(item);
  }
  res.json({ items });
});

app.listen(PORT, () => console.log(`Bridge listening on ${PORT}`));

