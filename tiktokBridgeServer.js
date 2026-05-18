const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");

const TIKTOK_HOST_USERNAME = "ipad_flex";
const PORT = Number(process.env.PORT) || 3000;
const RECONNECT_DELAY_MS = 5000;

const app = express();

// Только САМЫЙ свежий коммент. Новый перезаписывает старый.
let latestEvent = null;

const state = {
  tiktokUser: TIKTOK_HOST_USERNAME,
  connected: false,
  roomId: null,
  lastError: null,
  reconnectAttempts: 0,
  totalChats: 0,
  totalGifts: 0,
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
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
}

function setLatestEvent(entry) {
  entry.ts = Date.now();
  latestEvent = entry;
  state.totalEvents += 1;
  state.lastEventAt = new Date(entry.ts).toISOString();
  console.log(`+ latest ${entry.type}: ${entry.username}`);
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
      const nicks = findNicksInText(data.comment);

      if (nicks.length === 0) {
        console.log(`[chat] ${author}: ${data.comment}  (no valid nick)`);
        return;
      }

      let best = nicks[0];
      for (const n of nicks) {
        if (n.length > best.length) best = n;
      }

      console.log(`[chat] ${author}: ${data.comment}  =>  ${best}`);
      setLatestEvent({ username: best, type: "chat" });
    });

    tiktokLive.on("gift", (data) => {
      if (data.giftType === 1 && !data.repeatEnd) return;

      const author = data.uniqueId || data.nickname || "unknown";
      const giftName = data.giftName || (data.giftId ? `gift_${data.giftId}` : "Gift");
      const diamonds = data.diamondCount || data.extendedGiftInfo?.diamondCount || 1;
      const repeatCount = data.repeatCount || 1;

      console.log(`[GIFT] ${author} sent ${giftName} x${repeatCount}`);

      const nicks = findNicksInText(author);
      const username = nicks.length > 0 ? nicks[0] : author;

      setLatestEvent({
        username,
        type: "gift",
        giftName,
        diamonds,
        repeatCount,
      });
      state.totalGifts += 1;
    });

    tiktokLive.on("disconnected", () => {
      state.connected = false;
      scheduleReconnect();
    });

    tiktokLive.on("streamEnd", () => {
      state.connected = false;
      scheduleReconnect();
    });

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
        state.lastError = String(err && err.message ? err.message : err);
        scheduleReconnect();
      });
  } catch (err) {
    state.connected = false;
    state.lastError = String(err);
    scheduleReconnect();
  }
}

connectTikTok();

app.get("/", (_req, res) =>
  res.json({ ok: true, info: "TikTok -> Roblox bridge (realtime latest only)", state, latest: latestEvent })
);

app.get("/status", (_req, res) =>
  res.json({ ...state, latest: latestEvent })
);

app.get("/reconnect", (_req, res) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connectTikTok();
  res.json({ ok: true });
});

// Отдаём только самый свежий коммент и сразу очищаем
app.get("/dequeue", (_req, res) => {
  const item = latestEvent;
  latestEvent = null;

  if (item) {
    res.json({ items: [item], mode: "realtime" });
  } else {
    res.json({ items: [], mode: "realtime" });
  }
});

app.listen(PORT, () => console.log(`Bridge listening on ${PORT} (realtime latest only)`));
