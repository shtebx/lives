const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

const TIKTOK_HOST_USERNAME = "ipad_flex";
const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_DELAY_MS = 5000;

const app = express();
let latestEvent = null;
let spawnCounter = 0; // сколько раз забрали через /dequeue

// Лидерборд — { username: count }
const leaderboard = {};

const state = {
  tiktokUser: TIKTOK_HOST_USERNAME,
  connected: false,
  roomId: null,
  lastError: null,
  reconnectAttempts: 0,
  totalChats: 0,
  totalEvents: 0,
  startedAt: new Date().toISOString(),
  lastTryAt: null,
  lastOkAt: null,
  lastEventAt: null,
};

let tiktokLive = null;
let reconnectTimer = null;

function findNicksInText(text) {
  if (typeof text !== "string") return [];
  const matches = text.match(/[A-Za-z][A-Za-z0-9_]{2,19}/g);
  if (!matches) return [];
  const seen = new Set();
  const out = [];
  for (const m of matches) {
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
}

function getTop5() {
  return Object.entries(leaderboard)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([username, count]) => ({ username, count }));
}

function setLatestEvent(username) {
  // Обновляем лидерборд
  leaderboard[username] = (leaderboard[username] || 0) + 1;

  latestEvent = { username, ts: Date.now() };
  state.totalEvents += 1;
  state.lastEventAt = new Date(latestEvent.ts).toISOString();
  console.log(`+ latest: ${username} (total mentions: ${leaderboard[username]})`);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectTikTok(); }, RECONNECT_DELAY_MS);
}

function connectTikTok() {
  state.reconnectAttempts += 1;
  state.lastTryAt = new Date().toISOString();
  try {
    if (tiktokLive) {
      try { tiktokLive.removeAllListeners(); tiktokLive.disconnect(); } catch (_) {}
    }
    tiktokLive = new WebcastPushConnection(TIKTOK_HOST_USERNAME);
    tiktokLive.on("chat", (data) => {
      state.totalChats += 1;
      const author = data.uniqueId || data.nickname || "?";
      const nicks = findNicksInText(data.comment);
      if (nicks.length === 0) return;
      let best = nicks[0];
      for (const n of nicks) { if (n.length > best.length) best = n; }
      console.log(`[chat] ${author}: ${data.comment}  =>  ${best}`);
      setLatestEvent(best);
    });
    tiktokLive.on("disconnected", () => { state.connected = false; scheduleReconnect(); });
    tiktokLive.on("streamEnd", () => { state.connected = false; scheduleReconnect(); });
    tiktokLive.connect()
      .then((s) => {
        state.connected = true;
        state.roomId = s.roomId;
        state.lastError = null;
        state.lastOkAt = new Date().toISOString();
        console.log(`OK TikTok connected roomId=${s.roomId}`);
      })
      .catch((err) => {
        state.connected = false;
        state.lastError = String(err?.message ?? err);
        scheduleReconnect();
      });
  } catch (err) {
    state.connected = false;
    state.lastError = String(err);
    scheduleReconnect();
  }
}

connectTikTok();

app.get("/", (_req, res) => res.json({ ok: true, state, latest: latestEvent }));
app.get("/status", (_req, res) => res.json({ ...state, latest: latestEvent }));
app.get("/leaderboard", (_req, res) => res.json({ top: getTop5() }));
app.get("/reconnect", (_req, res) => { connectTikTok(); res.json({ ok: true }); });

app.get("/dequeue", (_req, res) => {
  const item = latestEvent;
  latestEvent = null;

  if (!item) {
    return res.json({ items: [], mode: "realtime", leaderboard: getTop5() });
  }

  spawnCounter += 1;
  const isVip = (spawnCounter % 10 === 0);

  let vipUsername = item.username;
  if (isVip) {
    // Рандом из топ-5
    const top5 = getTop5();
    if (top5.length > 0) {
      vipUsername = top5[Math.floor(Math.random() * top5.length)].username;
    }
    console.log(`🌟 VIP SPAWN #${spawnCounter}: ${vipUsername}`);
  }

  res.json({
    items: [{ username: isVip ? vipUsername : item.username, isVip }],
    mode: "realtime",
    leaderboard: getTop5(),
    spawnCounter,
  });
});

app.listen(PORT, () => console.log(`Bridge listening on ${PORT}`));
