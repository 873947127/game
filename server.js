/* =========================================================================
 * 今天几点睡 —— 联机服务器
 * 用 Node.js + WebSocket 跑游戏引擎，管理房间，给每个玩家只发他该看的信息
 * 运行：npm install && npm start  （或在 Render/Koyeb 上部署）
 * ========================================================================= */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const engine = require("./engine.js");
const ai = require("./ai.js");

const PORT = process.env.PORT || 3000;

/* ---------------- 静态文件服务 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".MP3": "audio/mpeg",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(__dirname, urlPath);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
});

const wss = new WebSocketServer({ server });
const rooms = {};

function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do { code = ""; for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]; } while (rooms[code]);
  return code;
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function broadcastViews(room) {
  const state = room.state;
  if (!state) return;
  for (const [enginePid, ws] of Object.entries(room.engineToWs)) {
    if (!ws || ws.readyState !== 1) continue;
    send(ws, { type: "view", view: buildView(state, Number(enginePid)) });
  }
}
function broadcastRoom(room) {
  const names = room.clients.map((c) => c.name);
  for (const c of room.clients) {
    if (c.ws.readyState !== 1) continue;
    send(c.ws, { type: "room", id: room.id, maxPlayers: room.maxPlayers, names, youIndex: room.clients.indexOf(c) });
  }
}

function cardMini(c) { return { id: c.id, value: c.value, skill: c.skill }; }
function buildView(state, viewerId) {
  const isDecider = state.decide && state.decide.pid === viewerId;
  const players = state.players.map((p) => ({ id: p.id, name: p.name, isAI: p.isAI, alive: p.alive, handCount: p.hand.length, playedCount: p.playedCards.length }));
  const view = {
    type: "view", yourId: viewerId, round: state.round, deckCount: state.deck.length, discardCount: state.discard.length,
    players, currentPlayerId: state.turn ? state.turn.pid : null,
    lightsOutTime: state.lightsOutTime, curfew: state.curfew, rave: state.rave,
    tableCount: state.table.cards.length,
    currentPlay: state.currentPlay.cards.length ? { ownerId: state.currentPlay.ownerId, count: state.currentPlay.cards.length } : null,
    lastReveal: state.lastReveal ? { isEarly: state.lastReveal.isEarly, ownerName: state.lastReveal.ownerName, challengerName: state.lastReveal.challengerName, cards: state.lastReveal.cards.map(cardMini) } : null,
    log: state.log.slice(-40),
    winner: state.winner != null ? { name: state.players[state.winner].name } : null,
    sfx: state.sfx.slice(),
  };
  // 每位玩家始终能看到自己的手牌（无论是否轮到自己），避免非回合时“手牌为空”
  view.yourHand = state.players[viewerId].hand.map(cardMini);
  if (isDecider) {
    const d = state.decide;
    view.decide = { kind: d.kind, pid: d.pid };
    if (d.N != null) view.decide.N = d.N;
    if (d.ownerPid != null) view.decide.ownerPid = d.ownerPid;
    if (d.kind === "stargaze") view.decide.top3 = state.stargazeHold.map(cardMini);
    if (d.kind === "preview") { view.decide.preview = d.cards.map(cardMini); view.decide.targetPid = d.targetPid; }
    if (d.kind === "endSkill" || d.kind === "failSkill") {
      view.decide.allowed = d.allowed;
      view.decide.skillInfo = d.allowed.map((id) => {
        const c = state.currentPlay.cards.find((x) => x.id === id) || state.players[viewerId].hand.find((x) => x.id === id) || (state.failSkills || []).find((x) => x.id === id);
        return c ? { id: c.id, skill: c.skill, value: c.value } : { id, skill: null, value: -1 };
      }).filter((x) => x.skill);
    }
    if (d.kind === "reaction") view.decide.allowed = d.allowed;
  }
  return view;
}

function advance(room) {
  const state = room.state;
  if (!state) return;
  if (state.winner != null) { broadcastViews(room); return; }
  const d = state.decide;
  if (!d || d.kind === "gameover") return;
  const ws = room.engineToWs[d.pid];
  if (ws && ws.readyState === 1) broadcastViews(room);
  else { engine.act(state, ai.aiAct(state)); advance(room); }
}

function startRoom(room) {
  room.status = "playing";
  const humans = room.clients;
  const aiCount = Math.max(0, room.maxPlayers - humans.length);
  const config = {
    players: humans.map((h) => ({ name: h.name, isAI: false })).concat(
      Array.from({ length: aiCount }, (_, i) => ({ name: "电脑" + (i + 1), isAI: true }))
    ),
  };
  room.state = engine.newGame(config);
  room.engineToWs = {};
  humans.forEach((h, i) => { room.engineToWs[i] = h.ws; });
  advance(room);
}

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch (e) { return; }
    switch (data.type) {
      case "create": {
        const room = {
          id: genCode(), status: "waiting",
          maxPlayers: Math.max(2, Math.min(6, data.maxPlayers || 4)),
          clients: [{ name: (data.name || "玩家").slice(0, 6), ws }],
        };
        rooms[room.id] = room;
        send(ws, { type: "room", id: room.id, maxPlayers: room.maxPlayers, names: [room.clients[0].name], youIndex: 0 });
        break;
      }
      case "join": {
        const room = rooms[(data.id || "").toUpperCase()];
        if (!room) { send(ws, { type: "error", message: "房间不存在或已结束" }); return; }
        if (room.status !== "waiting") { send(ws, { type: "error", message: "游戏已开始，无法加入" }); return; }
        if (room.clients.length >= room.maxPlayers) { send(ws, { type: "error", message: "房间已满" }); return; }
        room.clients.push({ name: (data.name || "玩家").slice(0, 6), ws });
        broadcastRoom(room);
        break;
      }
      case "start": {
        const room = Object.values(rooms).find((r) => r.clients.some((c) => c.ws === ws));
        if (!room || room.status !== "waiting") return;
        startRoom(room);
        break;
      }
      case "action": {
        const room = Object.values(rooms).find((r) => r.engineToWs && Object.values(r.engineToWs).includes(ws));
        if (!room || !room.state) return;
        const d = room.state.decide;
        if (!d || d.kind === "gameover") return;
        const pid = Object.keys(room.engineToWs).find((k) => room.engineToWs[k] === ws);
        if (pid == null || Number(pid) !== d.pid) return;
        engine.act(room.state, data.action);
        advance(room);
        break;
      }
      default: break;
    }
  });

  ws.on("close", () => {
    for (const room of Object.values(rooms)) {
      const idx = room.clients.findIndex((c) => c.ws === ws);
      if (idx >= 0) {
        room.clients.splice(idx, 1);
        if (room.status === "waiting") {
          if (room.clients.length === 0) delete rooms[room.id];
          else broadcastRoom(room);
        }
        continue;
      }
      if (room.engineToWs) {
        for (const [pid, cws] of Object.entries(room.engineToWs)) {
          if (cws === ws) { room.engineToWs[pid] = null; advance(room); break; }
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log("🌙 今天几点睡 联机服务器已启动：http://localhost:" + PORT + "/index.html");
});
