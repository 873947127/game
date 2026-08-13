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
  const fieldStackEl = $("fieldStack"), fieldCountEl = $("fieldCount"), currentPlayEl = $("currentPlay");
  const promptEl = $("prompt"), logEl = $("log");
  const playerBarEl = $("playerBar"), handEl = $("hand"), actionsEl = $("actions");
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
    const mx = 12 + 7.2 * Math.sin(0), my = 12 - 7.2 * Math.cos(0);
    return `<svg viewBox="0 0 24 24" width="1.3em" height="1.3em" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#ffffff" stroke="currentColor" stroke-width="1.2"/>
      <line x1="12" y1="12" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#e84c3d" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="12" y1="12" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#1a1a1a" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="0.9" fill="#1a1a1a"/>
    </svg>`;
  }
  function miniBacks(n) { if (n <= 0) return ""; let h = ""; for (let i = 0; i < Math.min(n, 12); i++) h += '<div class="mini-back"></div>'; return h; }
  function cardFace(c) {
    const da = c.skill ? ` data-desc="${attr(SKILLS[c.skill].desc)}"` : "";
    return `<div class="reveal-card${c.skill ? " skill" : ""}"${da} style="--accent:${TIME_COLORS[c.value]}">
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
      else if (msg.type === "view") { view = msg.view; roomOverlay.classList.add("hidden"); playViewSfx(view); render(); if (view.winner) showWinner(view.winner); }
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
  function playViewSfx(v) {
    if (!window.SFX || !v.sfx) return;
    for (const ev of v.sfx) {
      if (ev && typeof ev === "object" && ev.name === "roundStartEffect") showToast(ev.text);
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
    renderTop(); renderOpponents(); renderLightsOut(); renderTable(); renderReveal(); renderLog(); renderPlayerArea();
  }
  function renderTop() {
    roundPill.textContent = "第 " + view.round + " 轮";
    deckPill.textContent = "牌堆 " + view.deckCount;
    discardPill.textContent = "弃牌 " + view.discardCount;
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
    fieldStackEl.innerHTML = miniBacks(view.tableCount);
    fieldCountEl.textContent = view.tableCount ? view.tableCount + " 张" : "空";
    if (view.currentPlay) {
      const owner = view.players[view.currentPlay.ownerId];
      currentPlayEl.className = "current-play has-cards";
      currentPlayEl.innerHTML = `<div class="cp-label">${owner ? owner.name : "?"} 扣下</div><div class="cp-time">× ${view.currentPlay.count}</div><div class="cp-label">（扣置，未知）</div>`;
    } else { currentPlayEl.className = "current-play"; currentPlayEl.innerHTML = `<div class="cp-label">等待出牌…</div>`; }
  }
  function renderReveal() {
    const rv = view.lastReveal;
    const box = $("revealBox");
    if (!rv || !rv.cards || !rv.cards.length) { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    if (rv !== lastRevealRef) { lastRevealRef = rv; box.classList.remove("pop"); void box.offsetWidth; box.classList.add("pop"); }
    box.innerHTML = `<div class="reveal-title ${rv.isEarly ? "early" : "late"}">🔍 ${rv.challengerName} 质疑 ${rv.ownerName} —— ${rv.isEarly ? "确实是「早睡」✅" : "其实是「熬夜」😈"}</div>
      <div class="reveal-cards">${rv.cards.map(cardFace).join("")}</div>`;
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
  function renderPlayerArea() {
    const hand = view.yourHand || [];
    const me = myPlayer();
    clickMode = isMyTurn() ? clickModeFor(view.decide) : null;
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
        else if (isMyTurn() && clickMode === "softcandy") el.addEventListener("click", () => act({ type: "pickSoftCandyCard", cardId: c.id }));
        else el.classList.add("dim");
        el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}`;
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
    if (!view.decide) { const cur = view.currentPlayerId != null ? view.players[view.currentPlayerId] : null; return cur ? "⏳ " + cur.name + " 行动中…" : "等待开始…"; }
    switch (view.decide.kind) {
      case "revealLightsOut": return "🌙 轮到你翻开今晚的熄灯时间！点击中间那张牌。";
      case "roundStartSkill": return "🌙 轮次准备阶段：可打出提前/延迟熄灯、宵禁/狂欢，或直接继续。";
      case "play": return `🎴 你的出牌阶段：选择要扣着打出的牌（至少1张）。熄灯时间：${view.lightsOutTime == null ? "（无）" : TIME_NAMES[view.lightsOutTime]}`;
      case "challenge": { const owner = view.players[view.decide.ownerPid]; return `🔍 你的质疑阶段：${owner.name} 刚扣下了 ${view.decide.N} 张牌。` + (owner.handCount === 0 ? "⚠️ 他打出了所有手牌！" : "要质疑吗？"); }
      case "yanzhao": return "😷 你被抓到熬夜了！要亮出【蒸汽眼罩】少摸2张吗？";
      case "reaction": return "⚡ 你质疑成功！可打出反应技能牌，或跳过。";
      case "giveCard": return "💤 打出【该补觉了】：选一张你的手牌交给对方。";
      case "failSkill": return "😴 你质疑失败但成功脱身！可发动【瞌睡虫/午夜凶铃】或跳过。";
      case "endSkill": return "🌅 你的结束阶段：可发动技能牌（未被质疑）或跳过。";
      case "skillTarget": return "🎯 选择一名玩家作为目标。";
      case "softCandy": return "🍬 发动【褪黑素软糖】：再选一张手牌一起弃掉。";
      case "preview": return "🔮 预知梦：查看对方手牌。";
      default: return "";
    }
  }
  function addBtn(text, cls, onClick) { const b = document.createElement("button"); b.className = cls; b.textContent = text; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
  function addSkillBtn(skill, onClick) { const b = document.createElement("button"); b.className = "btn-skill"; b.innerHTML = `${SKILLS[skill].name} <small>${SKILLS[skill].desc}</small>`; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
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
    $("rulesOverlay").querySelector(".rules-body").innerHTML = `<h3>🌙 游戏背景</h3><p>「今天几点睡」是一款以传统唬牌规则为基础、融入夜间元素和技能设定的卡牌游戏。</p><h3>🎯 目标</h3><ul><li>最先清空手牌（0张）的玩家获胜；手牌≥21直接淘汰。</li></ul><h3>✨ 全部技能</h3>${skillsHtml}`;
  }
  $("rulesBtn").addEventListener("click", () => rulesOverlay.classList.remove("hidden"));
  $("closeRulesBtn").addEventListener("click", () => rulesOverlay.classList.add("hidden"));
  const musicBtn = $("musicBtn");
  const volSlider = $("volSlider");
  function updateMusicUI() { if (window.BGM) musicBtn.textContent = window.BGM.isOn() ? "🔊 音乐" : "🔇 音乐"; }
  musicBtn.addEventListener("click", () => { if (window.BGM) { window.BGM.toggle(); updateMusicUI(); } });
  volSlider.addEventListener("input", () => { if (window.BGM) window.BGM.setVolume(volSlider.value / 100); if (window.SFX) window.SFX.setVolume(volSlider.value / 100); });
  updateMusicUI();
  if (document.addEventListener) {
    document.addEventListener("click", (e) => { if (window.SFX && e.target && e.target.closest && e.target.closest("button")) { window.SFX.unlock(); window.SFX.play("click"); } });
  }

  buildRules();
  connect();
})();
