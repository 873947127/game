/* =========================================================================
 * 今天几点睡 —— 直连版（P2P，无需服务器）
 * 一个玩家当主机（浏览器里跑游戏），朋友通过 WebRTC + 连接码直接连他
 * ========================================================================= */
(function () {
  "use strict";

  const engine = window.SleepGameEngine;
  const TIME_NAMES = engine.TIME_NAMES;
  const TIME_SHORT = engine.TIME_SHORT;
  const TIME_COLORS = engine.TIME_COLORS;
  const SKILLS = engine.SKILLS;

  const RTC_CONFIG = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  /* ================== 编码/解码 连接码 ================== */
  function encode(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  }
  function decode(str) {
    return JSON.parse(decodeURIComponent(escape(atob(str.replace(/\s+/g, "")))));
  }
  function waitForIce(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") resolve();
      });
      setTimeout(resolve, 4000);
    });
  }

  /* ================== DOM ================== */
  const $ = (id) => document.getElementById(id);
  const roundPill = $("roundPill"), deckPill = $("deckPill"), discardPill = $("discardPill");
  const opponentsEl = $("opponents"), lightsOutEl = $("lightsOut"), modEl = $("roundModifiers");
  const fieldStackEl = $("fieldStack"), fieldCountEl = $("fieldCount"), currentPlayEl = $("currentPlay");
  const promptEl = $("prompt"), logEl = $("log");
  const playerBarEl = $("playerBar"), handEl = $("hand"), actionsEl = $("actions");
  const overlay = $("p2pOverlay");
  const modalOverlay = $("modalOverlay"), modalTitle = $("modalTitle"), modalBody = $("modalBody"), modalActions = $("modalActions");
  const effectToastEl = $("effectToast"), rulesOverlay = $("rulesOverlay");

  function attr(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function playPopupSfx() {
    if (!window.SFX) return;
    window.SFX.unlock();
    window.SFX.play("popup");
  }

  function showToast(text) {
    effectToastEl.textContent = text;
    effectToastEl.classList.remove("show");
    void effectToastEl.offsetWidth;
    effectToastEl.classList.add("show");
  }

  /* ================== 时钟图标 ================== */
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

  /* ================== 渲染（从视图） ================== */
  let view = null;
  let sendAction = null; // 由模式注入
  let selected = new Set();
  let clickMode = null;
  let targetMode = false;
  let prevHandIds = new Set();
  let lastRevealRef = null;
  let lastHoverAt = 0;

  function myId() { return view ? view.yourId : null; }
  function isMyTurn() { return view.decide && view.decide.pid === myId(); }
  function render() {
    if (!view) return;
    renderTop();
    renderOpponents();
    renderLightsOut();
    renderTable();
    renderReveal();
    renderLog();
    renderPlayerArea();
  }
  function renderTop() {
    roundPill.textContent = "第 " + view.round + " 轮";
    deckPill.textContent = "牌堆 " + view.deckCount;
    discardPill.textContent = "弃牌 " + view.discardCount;
  }
  function renderOpponents() {
    opponentsEl.innerHTML = "";
    for (const p of view.players) {
      if (p.id === myId()) continue;
      const el = document.createElement("div");
      el.className = "opponent" + (p.alive ? "" : " dead");
      if (view.currentPlayerId === p.id) el.classList.add("active");
      if (targetMode && p.alive) {
        el.classList.add("clickable");
        el.addEventListener("click", () => { targetMode = false; sendAction({ type: "pickTarget", pid: p.id }); });
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
    if (view && view.decide && view.decide.kind === "revealLightsOut" && view.decide.pid === myId()) {
      sendAction({ type: "revealLightsOut" });
    }
  });
  function renderTable() {
    let mods = [];
    if (view.curfew && view.rave) mods.push("宵禁×2 与 狂欢÷2 相互抵消");
    else {
      if (view.curfew) mods.push("宵禁命令（惩罚×2）");
      if (view.rave) mods.push("狂欢派对（惩罚÷2）");
    }
    modEl.textContent = mods.join(" · ");
    fieldStackEl.innerHTML = miniBacks(view.tableCount);
    fieldCountEl.textContent = view.tableCount ? view.tableCount + " 张" : "空";
    if (view.currentPlay) {
      const owner = view.players[view.currentPlay.ownerId];
      currentPlayEl.className = "current-play has-cards";
      currentPlayEl.innerHTML = `<div class="cp-label">${owner ? owner.name : "?"} 扣下</div><div class="cp-time">× ${view.currentPlay.count}</div><div class="cp-label">（扣置，未知）</div>`;
    } else {
      currentPlayEl.className = "current-play";
      currentPlayEl.innerHTML = `<div class="cp-label">等待出牌…</div>`;
    }
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
    for (const line of view.log) {
      const div = document.createElement("div");
      if (line.indexOf("翻开") >= 0 || line.indexOf("质疑") >= 0) div.className = "reveal";
      div.textContent = line;
      logEl.appendChild(div);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }
  function promptText() {
    if (!view.decide) {
      const cur = view.currentPlayerId != null ? view.players[view.currentPlayerId] : null;
      if (view.currentKind === "revealLightsOut") return cur ? "🌙 等待 " + cur.name + " 翻开熄灯时间中…" : "🌙 等待翻开熄灯时间中…";
      if (view.currentKind === "roundStartSkill") return "🌙 等待玩家使用技能中…"; // 不暴露是谁，避免泄露手牌信息
      return cur ? "⏳ " + cur.name + " 思考中…" : "等待开始…";
    }
    switch (view.decide.kind) {
      case "revealLightsOut": return "🌙 轮到你翻开今晚的熄灯时间！点击中间那张牌。";
      case "roundStartSkill": return "🌙 轮次准备阶段：可打出提前/延迟熄灯、宵禁/狂欢，或直接继续。";
      case "play": return `🎴 你的出牌阶段：选择要扣着打出的牌（至少1张）。熄灯时间：${view.lightsOutTime == null ? "（无）" : TIME_NAMES[view.lightsOutTime]}`;
      case "challenge": {
        const owner = view.players[view.decide.ownerPid];
        return `🔍 你的质疑阶段：${owner.name} 刚扣下了 ${view.decide.N} 张牌。` + (owner.handCount === 0 ? "⚠️ 他打出了所有手牌！" : "要质疑吗？");
      }
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
  function clickModeFor(d) {
    if (!d) return null;
    switch (d.kind) {
      case "play": return "play";
      case "giveCard": return "give";
      case "softCandy": return "softcandy";
      default: return null;
    }
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
    const me = view.players[view.yourId];
    // 先确定操作模式，再画手牌（否则牌会被画成不可点击的灰暗状态）
    clickMode = isMyTurn() ? clickModeFor(view.decide) : null;
    const skillMap = isMyTurn() ? skillCardActions(view.decide) : {};
    playerBarEl.innerHTML = `<span class="name">${me ? me.name : "你"} ${isMyTurn() ? "👈 你的回合" : ""}</span>
      <span class="info">手牌 ${hand.length} 张 · 扣牌 ${me ? me.playedCount : 0}</span>`;
    handEl.innerHTML = "";
    const cards = hand.slice().sort((a, b) => a.value - b.value);
    if (!cards.length) {
      handEl.classList.add("empty-hint");
      handEl.textContent = "手牌为空";
    } else {
      handEl.classList.remove("empty-hint");
      let newIdx = 0;
      for (const c of cards) {
        const el = document.createElement("div");
        el.className = "hand-card" + (c.skill ? " skill" : "");
        if (!prevHandIds.has(c.id)) { el.classList.add("just-drawn"); el.style.animationDelay = newIdx * 180 + "ms"; newIdx++; }
        if (selected.has(c.id)) el.classList.add("selected");
        el.addEventListener("mouseenter", () => {
          if (window.SFX) { const nowT = Date.now(); if (nowT - lastHoverAt > 150) { lastHoverAt = nowT; window.SFX.play("hover"); } }
        });
        if (isMyTurn() && clickMode === "play") el.addEventListener("click", () => toggleSelect(c.id));
        else if (isMyTurn() && clickMode === "give") el.addEventListener("click", () => sendAction({ type: "giveCard", cardId: c.id }));
        else if (isMyTurn() && clickMode === "softcandy" && c.id !== (view.decide && view.decide.cardId)) el.addEventListener("click", () => sendAction({ type: "pickSoftCandyCard", cardId: c.id }));
        else if (isMyTurn() && skillMap[c.id]) { el.classList.add("playable"); el.addEventListener("click", () => sendAction(skillMap[c.id])); }
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
  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    if (window.SFX) window.SFX.play("select");
    renderPlayerArea();
  }
  function addBtn(text, cls, onClick) { const b = document.createElement("button"); b.className = cls; b.textContent = text; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
  function addSkillBtn(skill, onClick) { const b = document.createElement("button"); b.className = "btn-skill"; b.innerHTML = `${SKILLS[skill].name}（点击发动） <small>${SKILLS[skill].desc}</small>`; b.addEventListener("click", onClick); actionsEl.appendChild(b); }
  function renderActions(d) {
    actionsEl.innerHTML = "";
    clickMode = null;
    targetMode = false;
    const hand = view.yourHand || [];
    switch (d.kind) {
      case "revealLightsOut": addBtn("翻开熄灯时间", "btn-primary", () => sendAction({ type: "revealLightsOut" })); break;
      case "roundStartSkill": {
        for (const c of hand.filter((x) => x.skill && ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(x.skill))) addSkillBtn(c.skill, () => sendAction({ type: "playRoundStart", cardId: c.id }));
        addBtn("继续，不出技能牌", "btn-ghost", () => sendAction({ type: "passRoundStartSkill" }));
        break;
      }
      case "play": {
        clickMode = "play";
        const confirm = document.createElement("button");
        confirm.className = "btn-primary";
        confirm.textContent = "✅ 确认出牌（" + selected.size + "）";
        confirm.style.opacity = selected.size ? 1 : 0.5;
        confirm.addEventListener("click", () => { if (!selected.size) return; const ids = Array.from(selected); selected.clear(); sendAction({ type: "playCards", cardIds: ids }); });
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
      case "challenge": addBtn("🔍 质疑他！", "btn-danger", () => sendAction({ type: "challenge" })); addBtn("🙈 相信他（不质疑）", "btn-ghost", () => sendAction({ type: "passChallenge" })); break;
      case "yanzhao": addBtn("😷 使用蒸汽眼罩", "btn-skill", () => sendAction({ type: "useYanzhao" })); addBtn("不使用", "btn-ghost", () => sendAction({ type: "skipYanzhao" })); break;
      case "reaction": for (const sk of d.allowed) { const c = hand.find((x) => x.skill === sk); if (c) addSkillBtn(sk, () => sendAction({ type: "playReaction", cardId: c.id })); } addBtn("跳过", "btn-ghost", () => sendAction({ type: "passReaction" })); break;
      case "giveCard": clickMode = "give"; break;
      case "failSkill": for (const info of d.skillInfo || []) if (info.skill) addSkillBtn(info.skill, () => sendAction({ type: "useFailSkill", cardId: info.id })); addBtn("跳过", "btn-ghost", () => sendAction({ type: "passFailSkill" })); break;
      case "endSkill": for (const info of d.skillInfo || []) if (info.skill) addSkillBtn(info.skill, () => sendAction({ type: "useEndSkill", cardId: info.id })); addBtn("跳过", "btn-ghost", () => sendAction({ type: "passEndSkill" })); break;
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
    for (const c of d.top3) {
      const el = document.createElement("div");
      el.className = "hand-card pick-hover" + (c.skill ? " skill" : "");
      el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}`;
      el.style.setProperty("--accent", TIME_COLORS[c.value]);
      el.addEventListener("click", () => { modalOverlay.classList.add("hidden"); sendAction({ type: "takeStargaze", cardId: c.id }); });
      box.appendChild(el);
    }
    modalActions.innerHTML = "";
    modalOverlay.classList.remove("hidden");
  }
  function showPreview(d) {
    modalTitle.textContent = "🔮 预知梦";
    modalBody.innerHTML = '<div class="pick-cards"></div>';
    const box = modalBody.querySelector(".pick-cards");
    for (const c of d.preview) {
      const el = document.createElement("div");
      el.className = "hand-card pick-hover" + (c.skill ? " skill" : "");
      el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div><div class="t">${TIME_SHORT[c.value]}</div>${c.skill ? `<div class="s">${SKILLS[c.skill].name}</div>` : ""}`;
      el.style.setProperty("--accent", TIME_COLORS[c.value]);
      box.appendChild(el);
    }
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "看完了，确认";
    ok.addEventListener("click", () => { modalOverlay.classList.add("hidden"); sendAction({ type: "confirmSeen" }); });
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
  // 质疑结果弹窗：记录已展示过的引用，避免同一结果重复弹
  let lastShownChallenge = null;
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

  /* ================== 视图构建（主机用，信息隔离） ================== */
  function cardMini(c) { return { id: c.id, value: c.value, skill: c.skill }; }
  function buildView(state, viewerId) {
    const isDecider = state.decide && state.decide.pid === viewerId;
    const players = state.players.map((p) => ({ id: p.id, name: p.name, isAI: p.isAI, alive: p.alive, handCount: p.hand.length, playedCount: p.playedCards.length }));
    const v = {
      yourId: viewerId, round: state.round, deckCount: state.deck.length, discardCount: state.discard.length,
      players, currentPlayerId: state.decide && state.decide.kind !== "roundStartSkill" && state.decide.pid != null ? state.decide.pid : (state.turn ? state.turn.pid : null),
      currentKind: state.decide ? state.decide.kind : null,
      lightsOutTime: state.lightsOutTime, curfew: state.curfew, rave: state.rave,
      tableCount: state.table.cards.length,
      currentPlay: state.currentPlay.cards.length ? { ownerId: state.currentPlay.ownerId, count: state.currentPlay.cards.length } : null,
      lastReveal: state.lastReveal ? { isEarly: state.lastReveal.isEarly, ownerName: state.lastReveal.ownerName, challengerName: state.lastReveal.challengerName, cards: state.lastReveal.cards.map(cardMini) } : null,
      log: state.log.slice(-40),
      winner: state.winner != null ? { name: state.players[state.winner].name } : null,
      sfx: state.sfx.slice(),
      challengePopup: state.challengePopup ? {
        challengerId: state.challengePopup.challengerId,
        ownerId: state.challengePopup.ownerId,
        challengerName: state.challengePopup.challengerName,
        ownerName: state.challengePopup.ownerName,
        isEarly: state.challengePopup.isEarly,
        N: state.challengePopup.N,
        drawCount: state.challengePopup.drawCount || 0,
      } : null,
      passChallengePopup: state.passChallengePopup ? {
        ownerId: state.passChallengePopup.ownerId,
        ownerName: state.passChallengePopup.ownerName,
        passerId: state.passChallengePopup.passerId,
        passerName: state.passChallengePopup.passerName,
        N: state.passChallengePopup.N,
        isEarly: state.passChallengePopup.isEarly,
      } : null,
      eliminatePopup: state.eliminatePopup ? { name: state.eliminatePopup.name, count: state.eliminatePopup.count, reason: state.eliminatePopup.reason } : null,
    };
    // 每位玩家始终能看到自己的手牌（无论是否轮到自己），避免非回合时“手牌为空”
    v.yourHand = state.players[viewerId].hand.map(cardMini);
    if (isDecider) {
      const d = state.decide;
      v.decide = { kind: d.kind, pid: d.pid };
      if (d.N != null) v.decide.N = d.N;
      if (d.ownerPid != null) v.decide.ownerPid = d.ownerPid;
      if (d.kind === "stargaze") v.decide.top3 = state.stargazeHold.map(cardMini);
      if (d.kind === "preview") { v.decide.preview = d.cards.map(cardMini); v.decide.targetPid = d.targetPid; }
      if (d.kind === "softCandy") v.decide.cardId = d.cardId;
      if (d.kind === "endSkill" || d.kind === "failSkill") {
        v.decide.allowed = d.allowed;
        v.decide.skillInfo = d.allowed.map((id) => {
          const c = state.currentPlay.cards.find((x) => x.id === id) || state.players[viewerId].hand.find((x) => x.id === id) || (state.failSkills || []).find((x) => x.id === id);
          return c ? { id: c.id, skill: c.skill, value: c.value } : { id, skill: null, value: -1 };
        }).filter((x) => x.skill);
      }
      if (d.kind === "reaction") v.decide.allowed = d.allowed;
    }
    return v;
  }

  /* ================== 应用视图（主机本地 / 客户端） ================== */
  function applyView(v) {
    view = v;
    overlay.classList.add("hidden");
    playViewSfx(v);
    render();
    if (v.winner) showWinner(v.winner);
    if (v.challengePopup && v.challengePopup !== lastShownChallenge && !isModalDecide()) {
      lastShownChallenge = v.challengePopup;
      showChallengePopup(v.challengePopup);
    }
    if (v.passChallengePopup && v.passChallengePopup !== lastShownPass && !isModalDecide()) {
      lastShownPass = v.passChallengePopup;
      showPassChallengePopup(v.passChallengePopup);
    }
    if (v.eliminatePopup && v.eliminatePopup !== lastShownEliminate) {
      lastShownEliminate = v.eliminatePopup;
      showEliminatePopup(v.eliminatePopup);
    }
  }
  // 是否需要模态操作的决定（观星/预知梦等会弹专用面板）——此时不弹通知弹窗，避免互相覆盖卡死
  function isModalDecide() {
    if (!view || !view.decide) return false;
    return view.decide.kind === "stargaze" || view.decide.kind === "preview";
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

  /* ================== 主机：跑游戏（同服务器逻辑） ================== */
  let host = null;
  let myName = "玩家";
  let total = 4;

  function hostStart() {
    const peers = host.peers.filter((p) => p.connected);
    const humans = [{ name: myName, isAI: false }].concat(peers.map((p) => ({ name: p.name, isAI: false })));
    const aiCount = Math.max(0, total - humans.length);
    const config = { players: humans.concat(Array.from({ length: aiCount }, (_, i) => ({ name: "电脑" + (i + 1), isAI: true }))) };
    host.state = engine.newGame(config);
    host.engineToPeer = {};
    peers.forEach((p, i) => { host.engineToPeer[i + 1] = p.dc; });
    sendAction = (action) => hostHandleAction(0, action);
    overlay.classList.add("hidden");
    hostAdvance();
  }

  function clearHostAiTimer() {
    if (host && host.aiTimer) { clearTimeout(host.aiTimer); host.aiTimer = null; }
  }

  function hostAdvance() {
    const state = host.state;
    if (!state) return;
    if (state.winner != null) { clearHostAiTimer(); hostBroadcast(); return; }
    const d = state.decide;
    if (!d || d.kind === "gameover") return;
    const dc = host.engineToPeer[d.pid];
    if (d.pid === 0 || (dc && dc.readyState === "open")) {
      clearHostAiTimer();
      hostBroadcast();
    } else if (!host.aiTimer) {
      // 人机思考约 2 秒再行动，避免联机时瞬间连续出牌（与单机一致）
      // 先把当前状态推给真人，让真人立刻看到自己的操作结果 + “电脑思考中”，而不是卡在上一帧
      hostBroadcast();
      host.aiTimer = setTimeout(() => {
        host.aiTimer = null;
        const st = host.state;
        if (!st || st.winner != null) return;
        engine.act(st, window.SleepAI.aiAct(st));
        hostAdvance();
      }, 2000 + Math.random() * 600);
    }
  }

  function hostBroadcast() {
    const state = host.state;
    // 先构建主机自己的视图（保留音效，否则清空后就听不到自己的声音了）
    const hostView = buildView(state, 0);
    const views = {};
    for (const [pid, dc] of Object.entries(host.engineToPeer)) {
      if (dc && dc.readyState === "open") views[pid] = buildView(state, Number(pid));
    }
    for (const [pid, v] of Object.entries(views)) {
      host.engineToPeer[pid].send(JSON.stringify({ type: "view", view: v }));
    }
    state.sfx.length = 0; // 音效事件已随各视图分发
    state.challengePopup = null; // 质疑结果已随各视图分发，清空避免重复弹窗
    state.passChallengePopup = null; // 未质疑结果已随各视图分发，清空避免重复弹窗
    state.eliminatePopup = null; // 淘汰结果已随各视图分发，清空避免重复弹窗
    applyView(hostView);
  }

  function hostHandleAction(seat, action) {
    const state = host.state;
    if (!state) return;
    const d = state.decide;
    if (!d || d.kind === "gameover") return;
    if (d.pid !== seat) return;
    engine.act(state, action);
    hostAdvance();
  }

  /* 主机：生成座位连接码 */
  function hostCreateSeatCode() {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const dc = pc.createDataChannel("game");
    const peer = { name: "?", dc, pc, connected: false, box: null };
    host.peers.push(peer);
    dc.onopen = () => {
      peer.connected = true;
      if (peer.box) markSeatConnected(peer.box);
      updateHostStatus();
    };
    dc.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.type === "hello") { peer.name = m.name; updateHostStatus(); }
      else if (m.type === "action") { hostHandleAction(host.peers.indexOf(peer) + 1, m.action); }
    };
    dc.onclose = () => { peer.connected = false; updateHostStatus(); };
    const candidates = [];
    pc.onicecandidate = (e) => { if (e.candidate) candidates.push(e.candidate.toJSON()); };
    pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => waitForIce(pc)).then(() => {
      const code = encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type, candidates });
      addSeatCodeBox(code, peer);
      updateHostStatus();
    }).catch((e) => alert("生成连接码失败：" + e.message));
  }

  function hostApplyAnswer(peer, code) {
    if (peer.connected) { alert("该座位已连接，无需重复连接"); return; }
    if (peer.pc.signalingState !== "have-local-offer") {
      alert("连接状态异常（" + peer.pc.signalingState + "）。可能已连接，或请重新生成一个座位码试试。");
      return;
    }
    let obj;
    try { obj = decode(code); } catch (e) { alert("回答码无效"); return; }
    if (obj.type !== "answer") {
      alert("这不是回答码（类型是 " + obj.type + "），请检查是否粘贴了朋友的「回答码」而不是连接码。");
      return;
    }
    peer.pc.setRemoteDescription(new RTCSessionDescription({ sdp: obj.sdp, type: obj.type }))
      .then(() => {
        for (const c of obj.candidates || []) peer.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        updateHostStatus();
      })
      .catch((e) => alert("连接失败：" + e.message + "（请检查回答码是否完整、是否粘贴给对应座位）"));
  }

  function addSeatCodeBox(code, peer) {
    const box = document.createElement("div");
    box.style.background = "rgba(20,26,58,.6)";
    box.style.border = "1px solid rgba(154,163,199,.25)";
    box.style.borderRadius = "12px";
    box.style.padding = "10px";
    box.innerHTML = `
      <div style="font-size:.8rem;color:var(--muted)">📨 发给一位朋友的「座位连接码」（<button class="btn-ghost" style="padding:2px 8px">复制</button>）</div>
      <textarea readonly rows="3" style="width:100%;background:rgba(10,14,32,.7);border:1px solid rgba(154,163,199,.3);border-radius:10px;color:var(--moon);padding:8px;font-size:11px;resize:none">${attr(code)}</textarea>
      <div style="font-size:.8rem;color:var(--muted);margin-top:6px">朋友把他的「回答码」发回来，粘这里：</div>
      <div style="display:flex;gap:6px;margin-top:4px">
        <input type="text" placeholder="粘贴回答码" style="flex:1;background:rgba(10,14,32,.7);border:1px solid rgba(154,163,199,.3);border-radius:10px;color:var(--text);padding:6px 8px;font-size:11px" />
        <button class="btn-primary" style="padding:6px 14px">连接</button>
      </div>`;
    box.querySelector("button").addEventListener("click", () => {
      const ta = box.querySelector("textarea");
      ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      box.querySelector("button").textContent = "已复制 ✓";
    });
    const connBtn = box.querySelector(".btn-primary");
    const ansInput = box.querySelector("input");
    connBtn.addEventListener("click", () => hostApplyAnswer(peer, ansInput.value));
    peer.box = box;
    $("seatCodes").appendChild(box);
  }

  function markSeatConnected(box) {
    box.style.borderColor = "rgba(52,211,153,.6)";
    const btn = box.querySelector(".btn-primary");
    if (btn) { btn.disabled = true; btn.textContent = "✅ 已连接"; }
    const inp = box.querySelector("input");
    if (inp) inp.disabled = true;
  }

  function updateHostStatus() {
    if (!host) return;
    const conn = host.peers.filter((p) => p.connected).length;
    $("hostStatus").textContent = "已连接 " + conn + " / " + (total - 1) + " 个朋友" +
      (host.peers.filter((p) => p.connected).map((p) => "｜" + p.name).join("") || "");
    $("startP2pBtn").classList.toggle("hidden", conn < Math.min(total - 1, host.peers.length));
    if (conn >= total - 1) $("startP2pBtn").classList.remove("hidden");
  }

  /* ================== 客户端：连接主机 ================== */
  let client = null; // { pc, dc }
  function clientConnect(offerCode) {
    if (client && client.pc) { alert("你已经尝试过连接了，请耐心等待主机确认"); return; }
    let obj;
    try { obj = decode(offerCode); } catch (e) { alert("连接码无效"); return; }
    if (obj.type !== "offer") { alert("这不是连接码（类型是 " + obj.type + "），请粘贴主机发给你的「座位连接码」。"); return; }
    const pc = new RTCPeerConnection(RTC_CONFIG);
    client = { pc, dc: null };
    const candidates = [];
    pc.onicecandidate = (e) => { if (e.candidate) candidates.push(e.candidate.toJSON()); };
    pc.ondatachannel = (e) => {
      const dc = e.channel;
      client.dc = dc;
      dc.onopen = () => { dc.send(JSON.stringify({ type: "hello", name: myName })); $("clientStatus").textContent = "✅ 已连接主机，等待游戏开始…"; };
      dc.onmessage = (e2) => {
        let m;
        try { m = JSON.parse(e2.data); } catch (err) { return; }
        if (m.type === "view") applyView(m.view);
      };
    };
    pc.setRemoteDescription(new RTCSessionDescription({ sdp: obj.sdp, type: obj.type }))
      .then(() => {
        for (const c of obj.candidates || []) pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        return pc.createAnswer();
      })
      .then((ans) => pc.setLocalDescription(ans))
      .then(() => waitForIce(pc))
      .then(() => {
        const answerCode = encode({ sdp: pc.localDescription.sdp, type: pc.localDescription.type, candidates });
        $("clientAnswer").value = answerCode;
        $("clientAnswerArea").classList.remove("hidden");
        $("clientStatus").textContent = "🎯 把下面的「回答码」复制发给主机，等主机连接后即可开始";
      })
      .catch((e) => alert("连接失败：" + e.message));
    sendAction = (action) => {
      if (client && client.dc && client.dc.readyState === "open") client.dc.send(JSON.stringify({ type: "action", action }));
    };
  }

  /* ================== 模式切换 UI ================== */
  $("hostBtn").addEventListener("click", () => {
    myName = $("myName").value || "玩家";
    host = { peers: [], state: null, engineToPeer: {} };
    $("hostArea").classList.remove("hidden");
    $("clientArea").classList.add("hidden");
  });
  $("clientBtn").addEventListener("click", () => {
    myName = $("myName").value || "玩家";
    $("clientArea").classList.remove("hidden");
    $("hostArea").classList.add("hidden");
  });
  $("pMinus").addEventListener("click", () => { total = Math.max(2, total - 1); $("pCount").textContent = total; });
  $("pPlus").addEventListener("click", () => { total = Math.min(6, total + 1); $("pCount").textContent = total; });
  $("genCodeBtn").addEventListener("click", () => hostCreateSeatCode());
  $("startP2pBtn").addEventListener("click", () => hostStart());
  $("clientApplyBtn").addEventListener("click", () => clientConnect($("clientCode").value));
  $("copyAnswerBtn").addEventListener("click", () => {
    const ta = $("clientAnswer");
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    $("copyAnswerBtn").textContent = "已复制 ✓";
  });

  /* ================== 音乐 / 规则 ================== */
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
    document.addEventListener("click", (e) => {
      if (window.SFX && e.target && e.target.closest && e.target.closest("button")) { window.SFX.unlock(); window.SFX.play("click"); }
    });
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

  // 测试钩子（不影响游戏）
  window.__p2pTest = { buildView, hostStart, hostHandleAction, hostAdvance, getState: () => (host ? host.state : null), __setHost: (h) => { host = h; }, __setTotal: (n) => { total = n; }, __setName: (n) => { myName = n; } };

  buildRules();
})();

