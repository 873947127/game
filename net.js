/* =========================================================================
 * 今天几点睡 —— 联机客户端（服务器版）
 * 连接服务器、创建/加入房间、根据服务器发来的视图渲染游戏、发送操作
 * ========================================================================= */
(function () {
  "use strict";

  const engine = window.SleepGameEngine;
  const TIME_NAMES = engine.TIME_NAMES;
  const TIME_SHORT = engine.TIME_SHORT;
  const TIME_COLORS = engine.TIME_COLORS;
  const SKILLS = engine.SKILLS;

  let ws = null;
  let view = null;
  let roomInfo = null;
  let connected = false;
  let selected = new Set();
  let clickMode = null;
  let targetMode = false;
  let prevHandIds = new Set();
  let lastRevealRef = null;
  let lastHoverAt = 0;
  let mpCount = 4;

  const $ = (id) => document.getElementById(id);
  const roundPill = $("roundPill"), deckPill = $("deckPill"), discardPill = $("discardPill");
  const opponentsEl = $("opponents"), lightsOutEl = $("lightsOut"), modEl = $("roundModifiers");
  const currentPlayEl = $("currentPlay");
  const promptEl = $("prompt"), logEl = $("log");
  const playerBarEl = $("playerBar"), handEl = $("hand"), actionsEl = $("actions");

  // 手牌「灯随光标走」发光：只保留 BorderGlow 里“发光随鼠标位置”这一核心，光标坐标写入 CSS 变量
  if (handEl) {
    handEl.addEventListener("pointermove", (e) => {
      const card = e.target.closest(".hand-card");
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", ((e.clientX - r.left) / r.width * 100).toFixed(1) + "%");
      card.style.setProperty("--my", ((e.clientY - r.top) / r.height * 100).toFixed(1) + "%");
      card.style.setProperty("--glow", "1");
    });
    handEl.addEventListener("pointerout", (e) => {
      const card = e.target.closest(".hand-card");
      if (!card) return;
      if (e.relatedTarget && card.contains(e.relatedTarget)) return; // 还在同一张牌内部
      card.style.setProperty("--glow", "0");
    });
  }
  const roomOverlay = $("roomOverlay"), lobbyInfo = $("lobbyInfo");
  const modalOverlay = $("modalOverlay"), modalTitle = $("modalTitle"), modalBody = $("modalBody"), modalActions = $("modalActions");
  const effectToastEl = $("effectToast"), rulesOverlay = $("rulesOverlay");

  function attr(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  function act(action) { send({ type: "action", action }); }
  function myId() { return view ? view.yourId : null; }
  function myPlayer() { return view ? view.players[view.yourId] : null; }

  function timeIconSvg(value) {
    const hour = (value + 9) % 12;
    const ang = (hour * 30 * Math.PI) / 180;
    const hx = 12 + 5 * Math.sin(ang), hy = 12 - 5 * Math.cos(ang);
    const mx = 12 + 7.4 * Math.sin(0), my = 12 - 7.4 * Math.cos(0);
    // 12 个整点刻度：3/6/9/12 为主刻度，其余为细刻度
    let ticks = "";
    for (let i = 0; i < 12; i++) {
      const a = (i * 30 * Math.PI) / 180;
      const major = i % 3 === 0;
      const r1 = major ? 7.4 : 8.0, r2 = 9.0;
      const x1 = (12 + r1 * Math.sin(a)).toFixed(1), y1 = (12 - r1 * Math.cos(a)).toFixed(1);
      const x2 = (12 + r2 * Math.sin(a)).toFixed(1), y2 = (12 - r2 * Math.cos(a)).toFixed(1);
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${major ? 0.8 : 0.5}" stroke-linecap="round" opacity="${major ? 0.9 : 0.45}"/>`;
    }
    return `<svg viewBox="0 0 24 24" width="1.3em" height="1.3em" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.1"/>
      ${ticks}
      <line x1="12" y1="12" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <line x1="12" y1="12" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="1.0" fill="currentColor"/>
    </svg>`;
  }
  function miniBacks(n) { if (n <= 0) return ""; let h = ""; for (let i = 0; i < Math.min(n, 12); i++) h += '<div class="mini-back"></div>'; return h; }
  function cpBacks(n) { if (n <= 0) return ""; let h = ""; for (let i = 0; i < Math.min(n, 12); i++) h += '<div class="cp-card back"><svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill="#cdd6ff"/><path d="M17.7 5.3l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5Z" fill="#ffe9a8"/></svg></div>'; return h; }
  function cardFace(c, i) {
    const delay = i != null ? ` animation-delay:${i * 100}ms;` : "";
    return `<div class="cp-card face flip" style="--accent:${TIME_COLORS[c.value]};${delay}">
      <div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>
      ${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}</div>`;
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host);
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch (err) { return; }
      if (msg.type === "room") { roomInfo = msg; connected = true; renderLobby(); roomOverlay.classList.remove("hidden"); }
      else if (msg.type === "view") { view = msg.view; roomOverlay.classList.add("hidden"); playViewSfx(view); render(); if (view.winner) showWinner(view.winner); if (view.challengePopup && view.challengePopup !== lastShownChallenge && !isModalDecide()) { lastShownChallenge = view.challengePopup; setTimeout(() => showChallengePopup(view.challengePopup), 1000); } if (view.passChallengePopup && view.passChallengePopup !== lastShownPass && !isModalDecide()) { lastShownPass = view.passChallengePopup; showPassChallengePopup(view.passChallengePopup); } if (view.eliminatePopup && view.eliminatePopup !== lastShownEliminate) { lastShownEliminate = view.eliminatePopup; showEliminatePopup(view.eliminatePopup); } }
      else if (msg.type === "error") alert(msg.message);
    };
    ws.onclose = () => { if (connected) { alert("与服务器断开连接"); location.reload(); } };
  }

  function showToast(text) {
    effectToastEl.textContent = text;
    effectToastEl.classList.remove("show");
    void effectToastEl.offsetWidth;
    effectToastEl.classList.add("show");
  }
  // 是否需要模态操作的决定（观星/预知梦等会弹专用面板）——此时不弹通知弹窗，避免互相覆盖卡死
  function isModalDecide() {
    if (!view || !view.decide) return false;
    return view.decide.kind === "stargaze" || view.decide.kind === "preview";
  }
  // 质疑结果弹窗：记录已展示过的引用，避免同一结果重复弹
  let lastShownChallenge = null;
  function playPopupSfx() {
    if (!window.SFX) return;
    window.SFX.unlock();
    window.SFX.play("popup");
  }

  function showChallengePopup(cp) {
    const me = myId();
    const X = cp.drawCount;
    // 只弹“与你有关”的质疑：你质疑别人，或别人质疑你。其他玩家互质疑/电脑互质疑不弹窗。
    const involvesMe = cp.challengerId === me || cp.ownerId === me;
    if (!involvesMe) return;
    let text;
    if (cp.challengerId === me) {
      text = cp.isEarly
        ? "😅 你的质疑失败了！你要拿回对方的所有牌，并再摸 " + X + " 张牌！"
        : "🎉 你的质疑成功了！对方要拿回所有牌，并再摸 " + X + " 张牌！";
    } else {
      text = cp.isEarly
        ? "✅ " + cp.challengerName + " 质疑了你！但他的质疑失败了，他要拿回你的所有牌，并再摸 " + X + " 张牌！"
        : "😈 " + cp.challengerName + " 质疑了你！他的质疑成功了，你要拿回所有牌，并再摸 " + X + " 张牌！";
    }
    modalTitle.textContent = "🔍 质疑结果";
    modalBody.innerHTML = `<div class="victory" style="font-size:1.05rem;line-height:1.9">${text}</div>`;
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "知道了";
    ok.addEventListener("click", () => { modalOverlay.classList.add("hidden"); });
    modalActions.appendChild(ok);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }
  // 下家未质疑弹窗：只给“打出牌的人”显示提示
  let lastShownPass = null;
  function showPassChallengePopup(pc) {
    const me = myId();
    // 只给被打出者本人弹窗，其他人不弹
    if (pc.ownerId !== me) return;
    const text = pc.isEarly
      ? "😌 " + pc.passerName + " 没有质疑你，相信了你打出的 " + pc.N + " 张牌！"
      : "😈 " + pc.passerName + " 没有质疑你！你成功隐瞒了 " + pc.N + " 张牌（其实是熬夜）。";
    modalTitle.textContent = "🙈 未被质疑";
    modalBody.innerHTML = `<div class="victory" style="font-size:1.05rem;line-height:1.9">${text}</div>`;
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "知道了";
    ok.addEventListener("click", () => { modalOverlay.classList.add("hidden"); });
    modalActions.appendChild(ok);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }
  // 淘汰弹窗：任何玩家因手牌过多被淘汰，所有玩家都弹提示
  let lastShownEliminate = null;
  function showEliminatePopup(ep) {
    modalTitle.textContent = "💀 淘汰出局";
    modalBody.innerHTML = `
      <div class="victory" style="font-size:1.05rem;line-height:1.9">
        ${ep.name} 的手牌达到了 <b>${ep.count} 张</b>，被淘汰出局！<br>
        <span style="font-size:0.85rem;color:var(--muted)">原因：最近一次获得手牌是“${ep.reason}”</span>
      </div>`;
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "知道了";
    ok.addEventListener("click", () => { modalOverlay.classList.add("hidden"); });
    modalActions.appendChild(ok);
    modalOverlay.classList.remove("hidden");
  }
  function playViewSfx(v) {
    if (!window.SFX || !v.sfx) return;
    for (const ev of v.sfx) {
      if (ev && typeof ev === "object" && ev.name === "roundStartEffect") showToast(ev.text);
      else if (ev && typeof ev === "object" && ev.name === "skillEffect") showToast(ev.text);
      else if (ev && typeof ev === "object" && ev.name === "draw" && ev.count > 0) { for (let i = 0; i < ev.count; i++) setTimeout(() => window.SFX.play("draw"), i * 180); }
      else window.SFX.play(ev);
    }
  }
  function showWinner(w) {
    modalTitle.textContent = "🏆 游戏结束";
    modalBody.innerHTML = `<div class="victory"><span class="big-emoji">🎉</span>${w.name} 第一个睡着了，赢得胜利！</div>`;
    modalActions.innerHTML = "";
    const again = document.createElement("button");
    again.className = "btn-primary";
    again.textContent = "再来一局";
    again.addEventListener("click", () => { modalOverlay.classList.add("hidden"); location.reload(); });
    modalActions.appendChild(again);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  function renderLobby() {
    if (!roomInfo) return;
    lobbyInfo.textContent = "房间码：" + roomInfo.id + " ｜ 已加入：" + roomInfo.names.join("、") + "（" + roomInfo.names.length + "/" + roomInfo.maxPlayers + "）";
    $("startNetBtn").classList.toggle("hidden", roomInfo.youIndex !== 0);
  }
  $("mpMinus").addEventListener("click", () => { mpCount = Math.max(2, mpCount - 1); $("mpCount").textContent = mpCount; });
  $("mpPlus").addEventListener("click", () => { mpCount = Math.min(6, mpCount + 1); $("mpCount").textContent = mpCount; });
  $("createRoomBtn").addEventListener("click", () => send({ type: "create", name: $("myName").value, maxPlayers: mpCount }));
  $("joinRoomBtn").addEventListener("click", () => send({ type: "join", id: $("joinCode").value, name: $("myName").value }));
  $("startNetBtn").addEventListener("click", () => send({ type: "start" }));

  function render() {
    if (!view) return;
    renderTop(); renderOpponents(); renderLightsOut(); renderTable(); renderLog(); renderPlayerArea();
  }
  function renderTop() {
    roundPill.textContent = "第 " + view.round + " 轮";
    deckPill.textContent = "抽牌堆 " + view.deckCount;
    discardPill.textContent = "弃牌堆 " + view.discardCount;
  }
  function isMyTurn() { return view.decide && view.decide.pid === myId(); }
  function renderOpponents() {
    opponentsEl.innerHTML = "";
    for (const p of view.players) {
      if (p.id === myId()) continue;
      const el = document.createElement("div");
      el.className = "opponent" + (p.alive ? "" : " dead");
      if (view.currentPlayerId === p.id) el.classList.add("active");
      if (targetMode && p.alive) {
        el.classList.add("clickable");
        el.addEventListener("click", () => { targetMode = false; act({ type: "pickTarget", pid: p.id }); });
      }
      el.innerHTML = `
        <div class="opp-name">${p.name}${p.isAI ? " 🤖" : " 👤"}</div>
        <div class="opp-count">手牌 ${p.handCount} 张 · 扣牌 ${p.playedCount}</div>
        <div class="back-pile">${miniBacks(p.handCount)}</div>
        <div class="opp-badges">${p.alive ? "" : '<span class="badge dead">💀 淘汰</span>'}${view.currentPlayerId === p.id ? '<span class="badge turn">▶ 进行中</span>' : ""}</div>`;
      opponentsEl.appendChild(el);
    }
  }
  function renderLightsOut() {
    const t = view.lightsOutTime;
    if (view.decide && view.decide.kind === "revealLightsOut") {
      lightsOutEl.className = "lights-out back clickable";
      lightsOutEl.innerHTML = `<div class="moon-icon">🌙</div><div class="time">?</div><div class="reveal-hint">👆 点击翻开</div>`;
      return;
    }
    lightsOutEl.className = "lights-out" + (t == null ? " empty" : " flipped");
    lightsOutEl.innerHTML = t == null
      ? `<div class="moon-icon">🌑</div><div class="time">暂无</div>`
      : `<div class="moon-icon">${timeIconSvg(t)}</div><div class="time">${TIME_NAMES[t]}</div>`;
  }
  lightsOutEl.addEventListener("click", () => {
    if (view && view.decide && view.decide.kind === "revealLightsOut" && view.decide.pid === myId()) act({ type: "revealLightsOut" });
  });
  function renderTable() {
    let mods = [];
    if (view.curfew && view.rave) mods.push("宵禁×2 与 狂欢÷2 相互抵消");
    else { if (view.curfew) mods.push("宵禁命令（惩罚×2）"); if (view.rave) mods.push("狂欢派对（惩罚÷2）"); }
    modEl.textContent = mods.join(" · ");
    if (view.currentPlay) {
      const owner = view.players[view.currentPlay.ownerId];
      currentPlayEl.className = "current-play has-cards";
      currentPlayEl.innerHTML = `<div class="cp-label">${owner ? owner.name : "?"} 扣下 ${view.currentPlay.count} 张</div><div class="cp-cards">${cpBacks(view.currentPlay.count)}</div><div class="cp-label">（扣置，未知）</div>`;
    } else {
      const rv = view.lastReveal;
      if (rv && rv.cards && rv.cards.length) {
        const sig = rv.challengerName + "|" + rv.ownerName + "|" + rv.isEarly + "|" + rv.cards.map((c) => c.id).join(",");
        if (sig !== lastRevealRef) {
          lastRevealRef = sig;
          currentPlayEl.className = "current-play has-cards revealed";
          currentPlayEl.innerHTML = `<div class="cp-label">🔍 已翻开：${rv.isEarly ? "确实是「早睡」✅" : "其实是「熬夜」😈"}</div><div class="cp-cards">${rv.cards.map((c, i) => cardFace(c, i)).join("")}</div>`;
        }
      } else { currentPlayEl.className = "current-play"; currentPlayEl.innerHTML = `<div class="cp-label">等待出牌…</div>`; }
    }
  }
  function renderLog() {
    logEl.innerHTML = "";
    for (const line of view.log) { const div = document.createElement("div"); if (line.indexOf("翻开") >= 0 || line.indexOf("质疑") >= 0) div.className = "reveal"; div.textContent = line; logEl.appendChild(div); }
    logEl.scrollTop = logEl.scrollHeight;
  }
  function clickModeFor(d) {
    if (!d) return null;
    switch (d.kind) { case "play": return "play"; case "giveCard": return "give"; case "softCandy": return "softcandy"; default: return null; }
  }
  // 可“点击原卡牌直接发动”的技能（轮次开始技能 / 反应技能）：cardId -> action
  function skillCardActions(d) {
    const map = {};
    if (!d) return map;
    const hand = view.yourHand || [];
    if (d.kind === "roundStartSkill") {
      for (const c of hand) if (c.skill && ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(c.skill)) map[c.id] = { type: "playRoundStart", cardId: c.id };
    } else if (d.kind === "reaction") {
      for (const c of hand) if (c.skill && (d.allowed || []).includes(c.skill)) map[c.id] = { type: "playReaction", cardId: c.id };
    }
    return map;
  }
  function renderPlayerArea() {
    const hand = view.yourHand || [];
    const me = myPlayer();
    clickMode = isMyTurn() ? clickModeFor(view.decide) : null;
    const skillMap = isMyTurn() ? skillCardActions(view.decide) : {};
    playerBarEl.innerHTML = `<span class="name">${me ? me.name : "你"} ${isMyTurn() ? "👈 你的回合" : ""}</span>
      <span class="info">手牌 ${hand.length} 张 · 扣牌 ${me ? me.playedCount : 0}</span>`;
    handEl.innerHTML = "";
    const cards = hand.slice().sort((a, b) => a.value - b.value);
    if (!cards.length) { handEl.classList.add("empty-hint"); handEl.textContent = "手牌为空"; }
    else {
      handEl.classList.remove("empty-hint");
      let newIdx = 0;
      for (const c of cards) {
        const el = document.createElement("div");
        el.className = "hand-card" + (c.skill ? " skill" : "");
        if (!prevHandIds.has(c.id)) { el.classList.add("just-drawn"); el.style.animationDelay = newIdx * 180 + "ms"; newIdx++; }
        if (selected.has(c.id)) el.classList.add("selected");
        el.addEventListener("mouseenter", () => { if (window.SFX) { const nowT = Date.now(); if (nowT - lastHoverAt > 150) { lastHoverAt = nowT; window.SFX.play("hover"); } } });
        if (isMyTurn() && clickMode === "play") el.addEventListener("click", () => toggleSelect(c.id));
        else if (isMyTurn() && clickMode === "give") el.addEventListener("click", () => act({ type: "giveCard", cardId: c.id }));
        else if (isMyTurn() && clickMode === "softcandy" && c.id !== (view.decide && view.decide.cardId)) el.addEventListener("click", () => act({ type: "pickSoftCandyCard", cardId: c.id }));
        else if (isMyTurn() && skillMap[c.id]) { el.classList.add("playable"); el.addEventListener("click", () => act(skillMap[c.id])); }
        else el.classList.add("dim");
        el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}<i class="card-glow" aria-hidden="true"></i>`;
        el.style.setProperty("--accent", TIME_COLORS[c.value]);
        if (c.skill) el.setAttribute("data-desc", attr(SKILLS[c.skill].desc));
        handEl.appendChild(el);
      }
    }
    prevHandIds = new Set(hand.map((c) => c.id));
    promptEl.textContent = promptText();
    if (isMyTurn()) renderActions(view.decide);
    else actionsEl.innerHTML = "";
  }
  function toggleSelect(id) { if (selected.has(id)) selected.delete(id); else selected.add(id); if (window.SFX) window.SFX.play("select"); renderPlayerArea(); }
  function promptText() {
    if (!view.decide) {
      const cur = view.currentPlayerId != null ? view.players[view.currentPlayerId] : null;
      if (view.currentKind === "revealLightsOut") return cur ? "🌙 等待 " + cur.name + " 翻开熄灯时间中…" : "🌙 等待翻开熄灯时间中…";
      if (view.currentKind === "roundStartSkill") return "🌙 等待玩家使用技能中…"; // 不暴露是谁，避免泄露手牌信息
      return cur ? "⏳ " + cur.name + " 思考中…" : "等待开始…";
    }
    switch (view.decide.kind) {
      case "revealLightsOut": return "🌙 轮到你翻开今晚的熄灯时间了！点击熄灯时间区的“问号牌”吧。";
      case "roundStartSkill": return "🌙 轮次准备阶段：可打出提前/延迟熄灯、宵禁/狂欢，或直接继续。";
      case "play": return `🎴 你的出牌阶段：选择要扣着打出的牌（至少1张）。熄灯时间：${view.lightsOutTime == null ? "（无）" : TIME_NAMES[view.lightsOutTime]}`;
      case "challenge": { const owner = view.players[view.decide.ownerPid]; return `🔍 你的质疑阶段：${owner.name} 刚扣下了 ${view.decide.N} 张牌。` + (owner.handCount === 0 ? "⚠️ 他打出了所有手牌！" : "要质疑吗？"); }
      case "yanzhao": return "😷 你被抓到熬夜了！要亮出【蒸汽眼罩】少摸2张吗？";
      case "reaction": return "⚡ 你质疑成功！可打出反应技能牌，或跳过。";
      case "giveCard": return "💤 打出【该补觉了】：选一张你的手牌交给对方。";
      case "failSkill": return "😴 你质疑失败但成功脱身！可发动【瞌睡虫/午夜凶铃】或跳过。";
      case "bellDraw": return "🔔 你被【午夜凶铃】纠缠：点击屏幕每次摸1张，直到摸到晚上12点或手牌达到20张。";
      case "endSkill": return "🌅 你的结束阶段：可发动技能牌（未被质疑）或跳过。";
      case "skillTarget": return "🎯 选择一名玩家作为目标。";
      case "softCandy": return "🍬 发动【褪黑素软糖】：再选一张手牌一起弃掉。";
      case "preview": return "🔮 预知梦：查看对方手牌。";
      default: return "";
    }
  }
  function addBtn(text, cls, onClick) { const b = document.createElement("button"); b.className = cls; b.textContent = text; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
  function addSkillBtn(skill, onClick) { const b = document.createElement("button"); b.className = "btn-skill"; b.innerHTML = `${SKILLS[skill].name}（点击发动） <small>${SKILLS[skill].desc}</small>`; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
  function renderActions(d) {
    actionsEl.innerHTML = "";
    clickMode = null; targetMode = false;
    const hand = view.yourHand || [];
    switch (d.kind) {
      case "revealLightsOut": addBtn("翻开熄灯时间", "btn-primary", () => act({ type: "revealLightsOut" })); break;
      case "roundStartSkill": { for (const c of hand.filter((x) => x.skill && ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(x.skill))) addSkillBtn(c.skill, () => act({ type: "playRoundStart", cardId: c.id })); addBtn("继续，不出技能牌", "btn-ghost", () => act({ type: "passRoundStartSkill" })); break; }
      case "play": {
        clickMode = "play";
        const confirm = document.createElement("button");
        confirm.className = "btn-primary";
        confirm.textContent = "✅ 确认出牌（" + selected.size + "）";
        confirm.style.opacity = selected.size ? 1 : 0.5;
        confirm.addEventListener("click", () => { if (!selected.size) return; const ids = Array.from(selected); selected.clear(); act({ type: "playCards", cardIds: ids }); });
        actionsEl.appendChild(confirm);
        addBtn("清空选择", "btn-ghost", () => { selected.clear(); renderPlayerArea(); });
        const typeEl = document.createElement("div");
        const selCards = hand.filter((c) => selected.has(c.id));
        if (!selCards.length) { typeEl.className = "play-type idle"; typeEl.textContent = "👆 请选择至少 1 张牌"; }
        else if (engine.computeEarly(selCards, view.lightsOutTime)) { typeEl.className = "play-type early"; typeEl.textContent = "🌙 当前牌型：早睡 ✅"; }
        else { typeEl.className = "play-type late"; typeEl.textContent = "😈 当前牌型：熬夜 ⚠️（被质疑会受罚）"; }
        actionsEl.appendChild(typeEl);
        break;
      }
      case "challenge": addBtn("🔍 质疑他！", "btn-danger", () => act({ type: "challenge" })); addBtn("🙈 相信他（不质疑）", "btn-ghost", () => act({ type: "passChallenge" })); break;
      case "yanzhao": addBtn("😷 使用蒸汽眼罩", "btn-skill", () => act({ type: "useYanzhao" })); addBtn("不使用", "btn-ghost", () => act({ type: "skipYanzhao" })); break;
      case "reaction": for (const sk of d.allowed) { const c = hand.find((x) => x.skill === sk); if (c) addSkillBtn(sk, () => act({ type: "playReaction", cardId: c.id })); } addBtn("跳过", "btn-ghost", () => act({ type: "passReaction" })); break;
      case "giveCard": clickMode = "give"; break;
      case "failSkill": for (const info of d.skillInfo || []) if (info.skill) addSkillBtn(info.skill, () => act({ type: "useFailSkill", cardId: info.id })); addBtn("跳过", "btn-ghost", () => act({ type: "passFailSkill" })); break;
      case "bellDraw": addBtn("🔔 点击摸1张", "btn-primary", () => act({ type: "drawBell" })); break;
      case "endSkill": for (const info of d.skillInfo || []) if (info.skill) addSkillBtn(info.skill, () => act({ type: "useEndSkill", cardId: info.id })); addBtn("跳过", "btn-ghost", () => act({ type: "passEndSkill" })); break;
      case "skillTarget": targetMode = true; renderOpponents(); break;
      case "softCandy": clickMode = "softcandy"; break;
      case "stargaze": showStargaze(d); break;
      case "preview": showPreview(d); break;
      default: break;
    }
  }
  function showStargaze(d) {
    modalTitle.textContent = "🔭 观星";
    modalBody.innerHTML = '<p class="subtitle">牌堆顶的 ' + d.top3.length + ' 张牌，选择获得其中 1 张：</p><div class="pick-cards"></div>';
    const box = modalBody.querySelector(".pick-cards");
    for (const c of d.top3) { const el = document.createElement("div"); el.className = "hand-card pick-hover" + (c.skill ? " skill" : ""); el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}`; el.style.setProperty("--accent", TIME_COLORS[c.value]); el.addEventListener("click", () => { modalOverlay.classList.add("hidden"); act({ type: "takeStargaze", cardId: c.id }); }); box.appendChild(el); }
    modalActions.innerHTML = "";
    modalOverlay.classList.remove("hidden");
  }
  function showPreview(d) {
    modalTitle.textContent = "🔮 预知梦";
    modalBody.innerHTML = '<div class="pick-cards"></div>';
    const box = modalBody.querySelector(".pick-cards");
    for (const c of d.preview) { const el = document.createElement("div"); el.className = "hand-card pick-hover" + (c.skill ? " skill" : ""); el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}`; el.style.setProperty("--accent", TIME_COLORS[c.value]); box.appendChild(el); }
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "看完了，确认";
    ok.addEventListener("click", () => { modalOverlay.classList.add("hidden"); act({ type: "confirmSeen" }); });
    modalActions.appendChild(ok);
    modalOverlay.classList.remove("hidden");
  }

  function buildRules() {
    const byValue = {};
    for (const sk of Object.values(SKILLS)) (byValue[sk.value] = byValue[sk.value] || []).push(sk);
    let skillsHtml = "";
    for (let v = 0; v < 6; v++) skillsHtml += `<h3>🕐 ${TIME_NAMES[v]}</h3><ul>` + (byValue[v] || []).map((s) => `<li><b>${s.name}</b>：${attr(s.desc)}</li>`).join("") + "</ul>";
    $("rulesOverlay").querySelector(".rules-body").innerHTML = `<h3>🌙 游戏背景</h3><p>「今天几点睡」是一款多人卡牌游戏。情境设定在夜晚，每位玩家都要为今晚的入睡时间斗智斗勇——是乖乖早睡，还是偷偷熬夜？一边要伪装自己，一边还要抓出那些谎称早睡、其实在熬夜的家伙。全程充满心理博弈，让你切身体会熬夜时那种既紧张又刺激的感觉。</p><h3>🎯 目标</h3><ul><li>最先清空手牌的玩家获胜。</li><li>手牌达到 21 张及以上会直接淘汰。</li></ul><h3>🂠 卡牌</h3><ul><li>共120张，6种时间点各20张（晚9→晚10→晚11→晚12→凌晨1→凌晨2）。</li><li>每种时间点有3张技能卡，共18张技能卡。</li></ul><h3>🔁 每轮流程</h3><ul><li>首位玩家翻开牌堆顶1张作为【熄灯时间】（每轮轮换）。</li><li>然后按顺序每人一个回合：开始→摸牌→出牌→质疑→结束。</li><li>最后一名玩家回合结束后，场上的牌放入弃牌堆，开始新一轮。</li></ul><h3>😴 早睡 / 熬夜</h3><ul><li>扣着打出的牌<b>全是同一种时间</b>且<b>不晚于熄灯时间</b> → 早睡。</li><li>打出的牌<b>≥2种时间</b>或有牌<b>晚于熄灯时间</b> → 熬夜。</li><li>下家可质疑：若是早睡则质疑失败（质疑者收牌+摸等量的牌），若是熬夜则质疑成功（出牌者收牌+摸等量的牌）。</li></ul><h3>✨ 全部技能</h3>${skillsHtml}`;
  }
  $("rulesBtn").addEventListener("click", () => rulesOverlay.classList.remove("hidden"));
  $("closeRulesBtn").addEventListener("click", () => rulesOverlay.classList.add("hidden"));
  const musicBtn = $("musicBtn");
  const volSlider = $("volSlider");
  function updateMusicUI() { if (window.BGM) musicBtn.textContent = window.BGM.isOn() ? "🔊 音乐" : "🔇 音乐"; }
  musicBtn.addEventListener("click", () => { if (window.BGM) { window.BGM.toggle(); updateMusicUI(); } });
  function applyVolumeFromSlider() {
    const value = Number(volSlider.value) / 100;
    if (window.SFX) {
      window.SFX.unlock();
      window.SFX.setVolume(value);
    }
    if (window.BGM) {
      window.BGM.start();
      window.BGM.setVolume(value);
      updateMusicUI();
    }
  }
  volSlider.addEventListener("pointerdown", () => {
    if (window.SFX) window.SFX.unlock();
    if (window.BGM) {
      window.BGM.start();
      updateMusicUI();
    }
  });
  volSlider.addEventListener("input", applyVolumeFromSlider);
  volSlider.addEventListener("change", applyVolumeFromSlider);
  volSlider.addEventListener("pointerup", applyVolumeFromSlider);
  volSlider.addEventListener("touchend", applyVolumeFromSlider, { passive: true });
  updateMusicUI();
  if (document.addEventListener) {
    document.addEventListener("click", (e) => { if (window.SFX && e.target && e.target.closest && e.target.closest("button")) { window.SFX.unlock(); window.SFX.play("click"); } });
  }

  buildRules();
  connect();
})();
