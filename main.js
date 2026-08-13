/* =========================================================================
 * 今天几点睡 —— 主控 / 界面逻辑
 * ========================================================================= */
(function () {
  "use strict";

  const engine = window.SleepGameEngine;
  const ai = window.SleepAI;

  let state = null;
  let config = null;           // 当前开局配置（用来重新开始）
  let humanIds = [];           // 真人玩家的 id 列表
  let selected = new Set();    // 出牌阶段选中的牌
  let clickMode = null;        // 'play' | 'give' | 'softcandy'
  let targetMode = false;      // 选择目标玩家
  let aiTimer = null;
  let prevHands = {};          // 各玩家上一次渲染的手牌 id（用于摸牌动画）
  let lastRevealRef = null;    // 上一次渲染过的翻牌记录（用于翻牌动画）
  let lastRound = 0;           // 用于轮次/回合过渡横幅
  let lastTurnPid = null;
  let turnJustChanged = false;
  let lastPromptText = null;
  let winAnnounced = false;    // 胜利音效只播一次
  let shownChallengePopup = null; // 已经展示过的质疑结果弹窗
  let shownEliminatePopup = null; // 已经展示过的淘汰弹窗
  let lastHoverAt = 0;            // 悬停音效防抖时间戳
  let lastLightsOutRef = "none"; // 记录上次渲染的熄灯时间牌（用于翻牌动画）

  /* ------------------------------ DOM ------------------------------ */
  const $ = (id) => document.getElementById(id);
  function attr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const roundPill = $("roundPill"), deckPill = $("deckPill"), discardPill = $("discardPill");
  const opponentsEl = $("opponents"), lightsOutEl = $("lightsOut"), modEl = $("roundModifiers");
  const fieldStackEl = $("fieldStack"), fieldCountEl = $("fieldCount"), currentPlayEl = $("currentPlay");
  const promptEl = $("prompt"), logEl = $("log");
  const turnBannerEl = $("turnBanner");
  const effectToastEl = $("effectToast");
  const playerBarEl = $("playerBar"), handEl = $("hand"), actionsEl = $("actions");
  const setupOverlay = $("setupOverlay"), rulesOverlay = $("rulesOverlay"), modalOverlay = $("modalOverlay");
  const modalTitle = $("modalTitle"), modalBody = $("modalBody"), modalActions = $("modalActions");

  /* ------------------------------ 设置界面 ------------------------------ */
  let seatCount = 4;
  let seats = []; // {name, isAI}

  function buildSeats(n) {
    const prev = seats;
    seats = [];
    for (let i = 0; i < n; i++) {
      const old = prev[i];
      seats.push({
        name: old ? old.name : (i === 0 ? "你" : "电脑" + (i + 1)),
        isAI: old ? old.isAI : i !== 0,
      });
    }
  }

  function renderSetup() {
    buildSeats(seatCount);
    $("playerCount").textContent = seatCount;
    const list = $("seatList");
    list.innerHTML = "";
    seats.forEach((seat, i) => {
      const row = document.createElement("div");
      row.className = "seat";
      row.innerHTML = `
        <span class="seat-no">${i + 1}号</span>
        <input type="text" maxlength="6" value="${seat.name.replace(/"/g, "&quot;")}" />
        <div class="seat-type">
          <button class="type-btn on-human" data-type="human">👤 真人</button>
          <button class="type-btn" data-type="ai">🤖 电脑</button>
        </div>`;
      const input = row.querySelector("input");
      const humanBtn = row.querySelector('[data-type="human"]');
      const aiBtn = row.querySelector('[data-type="ai"]');
      input.addEventListener("input", () => (seat.name = input.value.trim() || "玩家" + (i + 1)));
      function applyType(isAI) {
        seat.isAI = isAI;
        humanBtn.className = "type-btn " + (isAI ? "" : "on-human");
        aiBtn.className = "type-btn " + (isAI ? "on-ai" : "");
      }
      humanBtn.addEventListener("click", () => applyType(false));
      aiBtn.addEventListener("click", () => applyType(true));
      applyType(seat.isAI);
      list.appendChild(row);
    });
  }

  $("minusBtn").addEventListener("click", () => {
    if (seatCount > 2) { seatCount--; renderSetup(); }
  });
  $("plusBtn").addEventListener("click", () => {
    if (seatCount < 6) { seatCount++; renderSetup(); }
  });

  $("startGameBtn").addEventListener("click", () => {
    if (!seats.some((s) => !s.isAI)) {
      alert("至少需要 1 名真人玩家哦！");
      return;
    }
    config = seats.map((s) => ({ name: s.name, isAI: s.isAI }));
    setupOverlay.classList.add("hidden");
    if (window.SFX) window.SFX.unlock(); // 解锁音效
    // 玩家点击了“开始游戏”（浏览器认可的交互），可自动开启背景音乐
    if (window.BGM && musicUserChoice !== "off") {
      window.BGM.start();
      musicUserChoice = "on";
    }
    updateMusicUI();
    startGame(config);
  });

  /* ------------------------------ 背景音乐控制 ------------------------------ */
  let musicUserChoice = null; // null=未选择；'on'=要音乐；'off'=不要音乐
  const musicBtn = $("musicBtn");
  const volSlider = $("volSlider");

  function updateMusicUI() {
    if (!window.BGM) {
      musicBtn.textContent = "🎵 音乐";
      return;
    }
    musicBtn.textContent = window.BGM.isOn() ? "🔊 音乐" : "🔇 音乐";
  }

  musicBtn.addEventListener("click", () => {
    if (!window.BGM) return;
    window.BGM.toggle();
    musicUserChoice = window.BGM.isOn() ? "on" : "off";
    updateMusicUI();
  });

  volSlider.addEventListener("input", () => {
    if (window.BGM) window.BGM.setVolume(volSlider.value / 100);
    if (window.SFX) window.SFX.setVolume(volSlider.value / 100);
  });
  updateMusicUI();

  // 任意按钮点击都播放清脆的按键音（事件委托）
  if (document && document.addEventListener) {
    document.addEventListener("click", (e) => {
      if (window.SFX && e.target && e.target.closest && e.target.closest("button")) {
        window.SFX.unlock();
        window.SFX.play("click");
      }
    });
  }

  $("newGameBtn").addEventListener("click", () => {
    stopAI();
    setupOverlay.classList.remove("hidden");
    renderSetup();
  });

  /* ------------------------------ 单机/联机 模式切换 ------------------------------ */
  function switchMode(online) {
    $("singleArea").classList.toggle("hidden", online);
    $("onlineArea").classList.toggle("hidden", !online);
    $("modeSingleBtn").classList.toggle("on-human", !online);
    $("modeOnlineBtn").classList.toggle("on-human", online);
  }
  $("modeSingleBtn").addEventListener("click", () => switchMode(false));
  $("modeOnlineBtn").addEventListener("click", () => switchMode(true));

  // 去联机对战（服务器版页面）
  $("toNetBtn").addEventListener("click", () => {
    if (window.location.protocol === "file:") {
      alert("服务器版需要先部署服务器（详见《部署说明.txt》），然后在服务器网址上打开。");
    } else {
      window.location.href = "net.html";
    }
  });

  // 去直连版（无需服务器，P2P）
  $("toP2pBtn").addEventListener("click", () => {
    window.location.href = "p2p.html";
  });

  $("rulesBtn").addEventListener("click", () => {
    $("rulesOverlay").classList.remove("hidden");
  });
  $("closeRulesBtn").addEventListener("click", () => {
    $("rulesOverlay").classList.add("hidden");
  });
  // 点规则弹窗的暗色背景也可以关闭
  $("rulesOverlay").addEventListener("click", (e) => {
    if (e.target === $("rulesOverlay")) $("rulesOverlay").classList.add("hidden");
  });

  // 熄灯时间牌：轮到真人翻开时，点击牌背即可翻开
  lightsOutEl.addEventListener("click", () => {
    if (state && state.decide && state.decide.kind === "revealLightsOut" && humanIds.includes(state.decide.pid)) {
      applyAction({ type: "revealLightsOut" });
    }
  });

  /* ------------------------------ 开局 ------------------------------ */
  function startGame(cfg) {
    stopAI();
    state = engine.newGame({ players: cfg });
    humanIds = cfg.map((p, i) => (p.isAI ? null : i)).filter((i) => i != null);
    selected.clear();
    clickMode = null;
    targetMode = false;
    prevHands = {};
    lastRevealRef = null;
    lastRound = 0;
    lastTurnPid = null;
    turnJustChanged = false;
    lastPromptText = null;
    winAnnounced = false;
    shownChallengePopup = null;
    shownEliminatePopup = null;
    lastLightsOutRef = "none";
    pump();
  }

  function stopAI() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  }

  /* ------------------------------ 主循环 ------------------------------ */
  function pump() {
    stopAI();
    if (!state) return;
    if (state.winner != null) {
      if (!winAnnounced) {
        winAnnounced = true;
        if (window.SFX) window.SFX.play("win");
      }
      render();
      showGameOver();
      return;
    }
    const d = state.decide;
    render();
    // 质疑结果弹窗：玩家参与时弹出（需点“知道了”继续）；电脑互搏不弹（看场上翻牌即可）
    const cp = state.challengePopup;
    if (cp && cp !== shownChallengePopup) {
      shownChallengePopup = cp;
      const humanInvolved = humanIds.includes(cp.challengerId) || humanIds.includes(cp.ownerId);
      if (humanInvolved) {
        showChallengePopup(cp);
        return; // 暂停，等玩家确认
      }
    }
    // 淘汰弹窗：任何玩家被淘汰都弹出说明（需点“知道了”继续）
    const ep = state.eliminatePopup;
    if (ep && ep !== shownEliminatePopup) {
      shownEliminatePopup = ep;
      showEliminatePopup(ep);
      return;
    }
    if (!d || d.kind === "gameover") return;

    const player = state.players[d.pid];
    if (player.isAI) {
      const fast = window.__aiDelay != null;
      let delay;
      if (fast) {
        delay = window.__aiDelay;
      } else {
        // 刚切换回合/轮次时多停顿一下，让过渡横幅能被看清
        delay = turnJustChanged ? 1000 + Math.random() * 500 : 620 + Math.random() * 480;
      }
      turnJustChanged = false;
      aiTimer = setTimeout(() => {
        const action = ai.aiAct(state);
        engine.act(state, action);
        selected.clear();
        clickMode = null;
        targetMode = false;
        pump(); // pump 内部统一渲染一次
      }, delay);
    } else {
      renderHumanControls(d);
    }
  }

  function applyAction(action) {
    stopAI();
    engine.act(state, action);
    selected.clear();
    clickMode = null;
    targetMode = false;
    pump(); // pump 内部统一渲染一次
  }

  /* ------------------------------ 渲染 ------------------------------ */
  function render() {
    if (!state) return;
    showTransitions();
    renderTop();
    renderOpponents();
    renderTable();
    renderReveal();
    renderLog();
    renderPlayerArea();
    playPendingSfx();
  }

  /** 播放引擎记录的音效事件 */
  function playPendingSfx() {
    if (!window.SFX || !state || !state.sfx || !state.sfx.length) return;
    const list = state.sfx.slice();
    state.sfx.length = 0;
    for (const ev of list) {
      if (ev && typeof ev === "object" && ev.name === "roundStartEffect") {
        showToast(ev.text); // 轮次开始技能的效果提示
        continue;
      }
      if (ev && typeof ev === "object" && ev.name === "draw" && ev.count > 0) {
        // 每获得 1 张牌播放 1 次摸牌音效，与依次落入的动画同步
        for (let i = 0; i < ev.count; i++) {
          setTimeout(() => { if (window.SFX) window.SFX.play("draw"); }, i * 180);
        }
      } else {
        window.SFX.play(ev);
      }
    }
  }

  /** 检测轮次/回合切换，弹出过渡横幅 */
  function showTransitions() {
    if (state.round !== lastRound) {
      lastRound = state.round;
      if (state.turn) lastTurnPid = state.turn.pid;
      turnJustChanged = true;
      showBanner("🌙 第 " + state.round + " 轮");
    } else if (state.turn && state.turn.pid !== lastTurnPid) {
      lastTurnPid = state.turn.pid;
      turnJustChanged = true;
      const p = state.players[lastTurnPid];
      showBanner(p.isAI ? "🤖 " + p.name + " 的回合" : "🌟 你的回合");
    }
  }

  function showBanner(text) {
    turnBannerEl.textContent = text;
    turnBannerEl.classList.remove("show");
    void turnBannerEl.offsetWidth;
    turnBannerEl.classList.add("show");
  }

  /** 技能效果提示（自动消失） */
  function showToast(text) {
    effectToastEl.textContent = text;
    effectToastEl.classList.remove("show");
    void effectToastEl.offsetWidth;
    effectToastEl.classList.add("show");
  }

  /** 淘汰弹窗：说明总手牌数和获得来源 */
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
    ok.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      pump();
    });
    modalActions.appendChild(ok);
    modalOverlay.classList.remove("hidden");
  }

  /** 设置提示文字，文字变化时播放阶段过渡动画 */
  function setPrompt(text) {
    if (promptEl.textContent !== text) {
      promptEl.textContent = text;
      if (text) {
        promptEl.classList.remove("phase-change");
        void promptEl.offsetWidth;
        promptEl.classList.add("phase-change");
      }
    }
  }

  function renderTop() {
    roundPill.textContent = "第 " + state.round + " 轮";
    deckPill.textContent = "牌堆 " + state.deck.length;
    discardPill.textContent = "弃牌 " + state.discard.length;
  }

  function activePlayer() {
    const d = state.decide;
    if (!d || d.pid == null) return null;
    return state.players[d.pid];
  }

  function bottomPlayer() {
    const d = state.decide;
    if (d && d.pid != null && !state.players[d.pid].isAI) return state.players[d.pid];
    if (humanIds.length) return state.players[humanIds[0]];
    return state.players[0];
  }

  function renderOpponents() {
    const bp = bottomPlayer();
    opponentsEl.innerHTML = "";
    for (const p of state.players) {
      if (p.id === bp.id) continue;
      const el = document.createElement("div");
      el.className = "opponent" + (p.alive ? "" : " dead");
      const d = state.decide;
      if (d && d.pid === p.id) el.classList.add("active");
      if (targetMode && p.alive) {
        el.classList.add("clickable");
        el.addEventListener("click", () => applyAction({ type: "pickTarget", pid: p.id }));
      }
      const badges = [];
      if (d && d.pid === p.id) badges.push('<span class="badge turn">▶ 进行中</span>');
      if (!p.alive) badges.push('<span class="badge dead">💀 淘汰</span>');
      el.innerHTML = `
        <div class="opp-name">${p.name}${p.isAI ? " 🤖" : " 👤"}</div>
        <div class="opp-count">手牌 ${p.hand.length} 张 · 扣牌 ${(p.playedCards || []).length}</div>
        <div class="back-pile">${renderMiniBacks(p.hand.length)}</div>
        <div class="opp-badges">${badges.join("")}</div>`;
      opponentsEl.appendChild(el);
    }
  }

  function renderMiniBacks(n) {
    if (n <= 0) return "";
    const k = Math.min(n, 12);
    let html = "";
    for (let i = 0; i < k; i++) html += '<div class="mini-back"></div>';
    return html;
  }

  /** 时间卡牌图案：SVG 时钟，红色时针 + 黑色分针（分针固定指向12） */
  function timeIconSvg(value) {
    const hour = (value + 9) % 12; // 对应钟面小时
    const ang = (hour * 30 * Math.PI) / 180; // 时针角度（0 = 指向12）
    const Lh = 5, Lm = 7.2;
    const hx = 12 + Lh * Math.sin(ang), hy = 12 - Lh * Math.cos(ang);
    const mx = 12 + Lm * Math.sin(0), my = 12 - Lm * Math.cos(0); // 分针指向12
    return `<svg viewBox="0 0 24 24" width="1.3em" height="1.3em" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="#ffffff" stroke="currentColor" stroke-width="1.2"/>
      <line x1="12" y1="12" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="#e84c3d" stroke-width="1.8" stroke-linecap="round"/>
      <line x1="12" y1="12" x2="${mx.toFixed(1)}" y2="${my.toFixed(1)}" stroke="#1a1a1a" stroke-width="1.1" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="0.9" fill="#1a1a1a"/>
    </svg>`;
  }

  /** 已亮出技能的正面迷你牌 */
  function miniFaceUp(c) {
    const label = engine.TIME_SHORT[c.value] + (c.skill ? "·" + engine.SKILLS[c.skill].name : "");
    return `<div class="mini-face${c.skill ? " is-skill" : ""}" title="${attr(label)}" style="--accent:${engine.TIME_COLORS[c.value]}">${timeIconSvg(c.value)}<br>${engine.TIME_SHORT[c.value]}</div>`;
  }

  /** 熄灯时间牌：未翻开时显示牌背（真人可点按），翻开时播放翻牌动画 */
  function renderLightsOut() {
    const isRevealPhase = state.decide && state.decide.kind === "revealLightsOut";
    const humanTurn = isRevealPhase && humanIds.includes(state.decide.pid);
    const card = state.lightsOutCard;

    if (card === lastLightsOutRef) {
      // 状态没变就不重建，避免动画重复播放
      return;
    }
    lastLightsOutRef = card;

    if (card == null) {
      // 还没翻开：牌背
      lightsOutEl.className = "lights-out back" + (humanTurn ? " clickable" : "");
      lightsOutEl.innerHTML = `<div class="moon-icon">🌙</div><div class="time">?</div>` +
        (humanTurn ? `<div class="reveal-hint">👆 点击翻开熄灯时间</div>` : "");
    } else {
      // 已翻开：牌面 + 翻牌动画
      const t = state.lightsOutTime != null ? state.lightsOutTime : card.value;
      lightsOutEl.className = "lights-out flipped";
      lightsOutEl.innerHTML = `<div class="moon-icon">${timeIconSvg(t)}</div><div class="time">${engine.TIME_NAMES[t]}</div>`;
    }
  }

  function renderTable() {
    renderLightsOut();
    let mods = [];
    if (state.curfew && state.rave) mods.push("宵禁×2 与 狂欢÷2 相互抵消");
    else {
      if (state.curfew) mods.push("宵禁命令（惩罚×2）");
      if (state.rave) mods.push("狂欢派对（惩罚÷2）");
    }
    modEl.textContent = mods.join(" · ");

    // 场上的牌（累计）：已亮出的技能牌正面朝上，其余扣置
    const revealedCards = state.table.cards.filter((c) => c.revealed);
    const hiddenCount = state.table.cards.length - revealedCards.length;
    fieldStackEl.innerHTML = revealedCards.map(miniFaceUp).join("") + renderMiniBacks(hiddenCount);
    fieldCountEl.textContent = state.table.cards.length + " 张";
    if (state.table.cards.length === 0) fieldCountEl.textContent = "空";

    // 刚扣下的牌
    const cp = state.currentPlay;
    if (cp.cards.length) {
      const owner = state.players[cp.ownerId];
      currentPlayEl.className = "current-play has-cards";
      currentPlayEl.innerHTML = `
        <div class="cp-label">${owner.name} 扣下</div>
        <div class="cp-time">× ${cp.cards.length}</div>
        <div class="cp-label">（扣置，未知）</div>`;
    } else {
      currentPlayEl.className = "current-play";
      currentPlayEl.innerHTML = `<div class="cp-label">等待出牌…</div>`;
    }
  }

  function cardFace(c) {
    const descAttr = c.skill ? ` data-desc="${attr(engine.SKILLS[c.skill].desc)}"` : "";
    return `<div class="reveal-card${c.skill ? " skill" : ""}"${descAttr} style="--accent:${engine.TIME_COLORS[c.value]}">
      <div class="cicon">${timeIconSvg(c.value)}</div>
      <div class="t">${engine.TIME_SHORT[c.value]}</div>
      ${c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : ""}
    </div>`;
  }

  /** 质疑翻牌结果：亮出被质疑的牌，全场可见 */
  function renderReveal() {
    const rv = state.lastReveal;
    const box = $("revealBox");
    if (!rv || !rv.cards || !rv.cards.length) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    if (rv !== lastRevealRef) {
      lastRevealRef = rv;
      box.classList.remove("pop");
      void box.offsetWidth; // 强制重排，重新播放动画
      box.classList.add("pop");
    }
    box.innerHTML = `
      <div class="reveal-title ${rv.isEarly ? "early" : "late"}">
        🔍 ${rv.challengerName} 质疑 ${rv.ownerName} —— ${rv.isEarly ? "确实是「早睡」✅" : "其实是「熬夜」😈"}
      </div>
      <div class="reveal-cards">${rv.cards.map(cardFace).join("")}</div>`;
  }

  function renderLog() {
    logEl.innerHTML = "";
    const lines = state.log.slice(-40);
    for (const line of lines) {
      const div = document.createElement("div");
      if (line.indexOf("翻开") >= 0 || line.indexOf("质疑") >= 0) div.className = "reveal";
      div.textContent = line;
      logEl.appendChild(div);
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  /** 根据当前决策类型，确定手牌的操作模式 */
  function clickModeFor(d) {
    if (!d) return null;
    switch (d.kind) {
      case "play": return "play";
      case "giveCard": return "give";
      case "softCandy": return "softcandy";
      default: return null;
    }
  }

  function renderPlayerArea() {
    const bp = bottomPlayer();
    const isMyTurn = state.decide && state.decide.pid === bp.id && !bp.isAI;
    const myTurn = isMyTurn;
    // 先确定操作模式，再画手牌（否则牌会被画成不可点击的灰暗状态）
    clickMode = myTurn ? clickModeFor(state.decide) : null;
    playerBarEl.innerHTML = `
      <span class="name">${bp.name} ${myTurn ? "👈 你的回合" : ""}</span>
      <span class="info">手牌 ${bp.hand.length} 张${myTurn ? " · 熄灯时间：" + (state.lightsOutTime == null ? "无" : engine.TIME_NAMES[state.lightsOutTime]) : ""}</span>`;

    // 手牌
    handEl.innerHTML = "";
    if (myTurn && clickMode) handEl.classList.remove("empty-hint");
    const prevSet = prevHands[bp.id] || new Set();
    const cards = bp.hand.slice().sort((a, b) => a.value - b.value || (a.skill ? -1 : 1) - (b.skill ? -1 : 1));
    if (cards.length === 0) {
      handEl.classList.add("empty-hint");
      handEl.textContent = "手牌为空";
    } else {
      handEl.classList.remove("empty-hint");
      let newIdx = 0;
      for (const c of cards) {
        const el = document.createElement("div");
        el.className = "hand-card" + (c.skill ? " skill" : "");
        // 鼠标悬停手牌：播放一次悬停音效（防抖，避免频繁重绘重复触发）
        el.addEventListener("mouseenter", () => {
          if (window.SFX) {
            const nowT = Date.now();
            if (nowT - lastHoverAt > 150) {
              lastHoverAt = nowT;
              window.SFX.play("hover");
            }
          }
        });
        if (!prevSet.has(c.id)) {
          el.classList.add("just-drawn");
          el.style.animationDelay = newIdx * 180 + "ms"; // 依次落入，不要同时掉下来
          newIdx++;
        }
        if (selected.has(c.id)) el.classList.add("selected");
        if (myTurn && clickMode === "play") {
          el.addEventListener("click", () => toggleSelect(c.id));
        } else if (myTurn && clickMode === "give") {
          el.addEventListener("click", () => applyAction({ type: "giveCard", cardId: c.id }));
        } else if (myTurn && clickMode === "softcandy") {
          el.addEventListener("click", () => applyAction({ type: "pickSoftCandyCard", cardId: c.id }));
        } else {
          el.classList.add("dim");
        }
        el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div>` +
          `<div class="t">${engine.TIME_SHORT[c.value]}</div>` +
          (c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : "");
        el.style.setProperty("--accent", engine.TIME_COLORS[c.value]);
        el.setAttribute("data-id", c.id);
        if (c.skill) el.setAttribute("data-desc", attr(engine.SKILLS[c.skill].desc)); // 悬停显示技能详情
        handEl.appendChild(el);
      }
    }
    prevHands[bp.id] = new Set(bp.hand.map((c) => c.id));

    // 操作区
    if (myTurn) {
      renderHumanControls(state.decide);
    } else {
      actionsEl.innerHTML = "";
      const active = activePlayer();
      if (active) setPrompt("🤖 " + active.name + "（电脑）正在思考…");
    }
  }

  function toggleSelect(id) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    if (window.SFX) window.SFX.play("select"); // 选中/取消都播一次选中音效
    renderPlayerArea();
  }

  /* ------------------------------ 提示文案 ------------------------------ */
  function promptText(d) {
    const p = state.players[d.pid];
    switch (d.kind) {
      case "revealLightsOut": {
        const isHuman = humanIds.includes(d.pid);
        return isHuman
          ? `🌙 轮到你翻开今晚的熄灯时间了！点击中间那张牌。`
          : `🌙 ${p.name} 正在翻开今晚的熄灯时间…`;
      }
      case "roundStartSkill":
        return `🌙 轮次准备阶段：可以打出「提前熄灯 / 延迟熄灯 / 宵禁命令 / 狂欢派对」（可多张），然后才开始正式出牌。`;
      case "stargaze": return "";
      case "play": {
        const t = state.lightsOutTime == null ? "（无）" : engine.TIME_NAMES[state.lightsOutTime];
        return `🎴 ${p.name} 出牌阶段：选择要扣着打出的牌（至少1张）。本轮熄灯时间：${t}`;
      }
      case "challenge": {
        const owner = state.players[d.ownerPid];
        const isLast = owner.hand.length === 0;
        return `🔍 ${p.name} 质疑阶段：${owner.name} 刚扣下了 ${d.N} 张牌。` +
          (isLast ? `⚠️ 他打出了所有手牌！如果不质疑，他就要赢了！` : `要质疑他吗？`);
      }
      case "yanzhao":
        return `😷 ${p.name}：你被抓到熬夜了！要亮出【蒸汽眼罩】少摸2张吗？`;
      case "reaction":
        return `⚡ ${p.name} 质疑成功！可打出反应技能牌（额外惩罚对方），或跳过。`;
      case "giveCard":
        return `💤 ${p.name} 打出【该补觉了】：选一张你的手牌交给对方。`;
      case "failSkill":
        return `😴 ${p.name} 质疑失败但成功脱身！可发动【瞌睡虫 / 午夜凶铃】，或跳过。`;
      case "endSkill":
        return `🌅 ${p.name} 结束阶段：可发动技能牌（未被质疑），或跳过。`;
      case "skillTarget":
        return `🎯 ${p.name}：选择一名玩家作为目标。`;
      case "softCandy":
        return `🍬 ${p.name} 发动【褪黑素软糖】：再选一张手牌一起弃掉。`;
      default: return "";
    }
  }

  /* ------------------------------ 玩家操作区 ------------------------------ */
  function renderHumanControls(d) {
    actionsEl.innerHTML = "";
    const p = state.players[d.pid];
    const hint = document.createElement("span");
    hint.className = "hint-inline";
    setPrompt(promptText(d));
    // 对方打完最后手牌时，质疑提示用红色强调“该质疑了”
    if (d.kind === "challenge" && state.players[d.ownerPid].hand.length === 0) {
      promptEl.classList.add("warn");
    } else {
      promptEl.classList.remove("warn");
    }

    switch (d.kind) {
      case "roundStartSkill": {
        clickMode = null;
        const skills = p.hand.filter((c) => ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(c.skill));
        for (const c of skills) {
          const b = document.createElement("button");
          b.className = "btn-skill";
          b.innerHTML = `${engine.SKILLS[c.skill].name} <small>${engine.SKILLS[c.skill].desc}</small>`;
          b.addEventListener("click", () => applyAction({ type: "playRoundStart", cardId: c.id }));
          actionsEl.appendChild(b);
        }
        const pass = document.createElement("button");
        pass.className = "btn-ghost";
        pass.textContent = "继续，不出技能牌";
        pass.addEventListener("click", () => applyAction({ type: "passRoundStartSkill" }));
        actionsEl.appendChild(pass);
        break;
      }

      case "play": {
        clickMode = "play";
        const confirmBtn = document.createElement("button");
        confirmBtn.className = "btn-primary";
        confirmBtn.textContent = "✅ 确认出牌（" + selected.size + "）";
        confirmBtn.disabled = selected.size === 0;
        confirmBtn.style.opacity = selected.size === 0 ? 0.5 : 1;
        confirmBtn.addEventListener("click", () => {
          if (!selected.size) return;
          applyAction({ type: "playCards", cardIds: Array.from(selected) });
        });
        actionsEl.appendChild(confirmBtn);
        const cancel = document.createElement("button");
        cancel.className = "btn-ghost";
        cancel.textContent = "清空选择";
        cancel.addEventListener("click", () => { selected.clear(); renderPlayerArea(); });
        actionsEl.appendChild(cancel);
        // 即时显示当前选中牌的牌型（早睡 / 熬夜）
        const typeEl = document.createElement("div");
        const selCards = p.hand.filter((c) => selected.has(c.id));
        if (selCards.length === 0) {
          typeEl.className = "play-type idle";
          typeEl.textContent = "👆 请选择至少 1 张牌";
        } else if (engine.computeEarly(selCards, state.lightsOutTime)) {
          typeEl.className = "play-type early";
          typeEl.textContent = "🌙 当前牌型：早睡 ✅（质疑你的人会吃亏）";
        } else {
          typeEl.className = "play-type late";
          typeEl.textContent = "😈 当前牌型：熬夜 ⚠️（被质疑会受罚，要小心）";
        }
        actionsEl.appendChild(typeEl);
        hint.textContent = "点选手牌（可多选），然后点【确认出牌】";
        actionsEl.appendChild(hint);
        break;
      }

      case "challenge": {
        clickMode = null;
        const yes = document.createElement("button");
        yes.className = "btn-danger";
        yes.textContent = "🔍 质疑他！";
        yes.addEventListener("click", () => applyAction({ type: "challenge" }));
        actionsEl.appendChild(yes);
        const no = document.createElement("button");
        no.className = "btn-ghost";
        no.textContent = "🙈 相信他（不质疑）";
        no.addEventListener("click", () => applyAction({ type: "passChallenge" }));
        actionsEl.appendChild(no);
        break;
      }

      case "yanzhao": {
        clickMode = null;
        const yes = document.createElement("button");
        yes.className = "btn-skill";
        yes.innerHTML = "😷 使用蒸汽眼罩 <small>本次惩罚少摸2张</small>";
        yes.addEventListener("click", () => applyAction({ type: "useYanzhao" }));
        actionsEl.appendChild(yes);
        const no = document.createElement("button");
        no.className = "btn-ghost";
        no.textContent = "不使用";
        no.addEventListener("click", () => applyAction({ type: "skipYanzhao" }));
        actionsEl.appendChild(no);
        break;
      }

      case "reaction": {
        clickMode = null;
        for (const sk of d.allowed) {
          const card = p.hand.find((c) => c.skill === sk);
          if (!card) continue;
          const b = document.createElement("button");
          b.className = "btn-skill";
          b.innerHTML = `${engine.SKILLS[sk].name} <small>${engine.SKILLS[sk].desc}</small>`;
          b.addEventListener("click", () => applyAction({ type: "playReaction", cardId: card.id }));
          actionsEl.appendChild(b);
        }
        const pass = document.createElement("button");
        pass.className = "btn-ghost";
        pass.textContent = "跳过";
        pass.addEventListener("click", () => applyAction({ type: "passReaction" }));
        actionsEl.appendChild(pass);
        break;
      }

      case "giveCard": {
        clickMode = "give";
        hint.textContent = "点击下方一张手牌交给对方";
        actionsEl.appendChild(hint);
        break;
      }

      case "failSkill": {
        clickMode = null;
        for (const card of state.failSkills) {
          const b = document.createElement("button");
          b.className = "btn-skill";
          b.innerHTML = `${engine.SKILLS[card.skill].name} <small>${engine.SKILLS[card.skill].desc}</small>`;
          b.addEventListener("click", () => applyAction({ type: "useFailSkill", cardId: card.id }));
          actionsEl.appendChild(b);
        }
        const pass = document.createElement("button");
        pass.className = "btn-ghost";
        pass.textContent = "跳过";
        pass.addEventListener("click", () => applyAction({ type: "passFailSkill" }));
        actionsEl.appendChild(pass);
        break;
      }

      case "endSkill": {
        clickMode = null;
        for (const id of d.allowed) {
          const card = state.endSkillPool.endSkills.find((c) => c.id === id) ||
                       (state.endSkillPool.ruang && state.endSkillPool.ruang.id === id ? state.endSkillPool.ruang : null);
          if (!card) continue;
          const b = document.createElement("button");
          b.className = "btn-skill";
          b.innerHTML = `${engine.SKILLS[card.skill].name} <small>${engine.SKILLS[card.skill].desc}</small>`;
          b.addEventListener("click", () => applyAction({ type: "useEndSkill", cardId: card.id }));
          actionsEl.appendChild(b);
        }
        const pass = document.createElement("button");
        pass.className = "btn-ghost";
        pass.textContent = "跳过";
        pass.addEventListener("click", () => applyAction({ type: "passEndSkill" }));
        actionsEl.appendChild(pass);
        break;
      }

      case "skillTarget": {
        clickMode = null;
        targetMode = true;
        hint.textContent = "点击上方要选的目标玩家";
        actionsEl.appendChild(hint);
        renderOpponents();
        break;
      }

      case "softCandy": {
        clickMode = "softcandy";
        hint.textContent = "点击一张手牌，与【褪黑素软糖】一起弃掉";
        actionsEl.appendChild(hint);
        break;
      }

      case "stargaze": {
        clickMode = null;
        showStargazeModal(d);
        break;
      }

      case "preview": {
        clickMode = null;
        showPreviewModal(d);
        break;
      }

      default:
        break;
    }
  }

  /* ------------------------------ 弹窗 ------------------------------ */
  function showStargazeModal(d) {
    modalTitle.textContent = "🔭 观星";
    modalBody.innerHTML = '<p class="subtitle">牌堆顶的 ' + d.top3.length + ' 张牌，选择获得其中 1 张：</p><div class="pick-cards"></div>';
    const box = modalBody.querySelector(".pick-cards");
    for (const c of d.top3) {
      const el = document.createElement("div");
      el.className = "hand-card pick-hover" + (c.skill ? " skill" : "");
      el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div>` +
        `<div class="t">${engine.TIME_SHORT[c.value]}</div>` +
        (c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : "");
      el.style.setProperty("--accent", engine.TIME_COLORS[c.value]);
      if (c.skill) el.setAttribute("data-desc", attr(engine.SKILLS[c.skill].desc));
      el.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
        applyAction({ type: "takeStargaze", cardId: c.id });
      });
      box.appendChild(el);
    }
    modalActions.innerHTML = "";
    modalOverlay.classList.remove("hidden");
  }

  function showPreviewModal(d) {
    const target = state.players[d.targetPid];
    modalTitle.textContent = "🔮 预知梦";
    modalBody.innerHTML = `<p class="subtitle">查看 ${target.name} 的手牌（最多5张）：</p><div class="pick-cards"></div>`;
    const box = modalBody.querySelector(".pick-cards");
    for (const c of d.cards) {
      const el = document.createElement("div");
      el.className = "hand-card pick-hover" + (c.skill ? " skill" : "");
      el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div>` +
        `<div class="t">${engine.TIME_SHORT[c.value]}</div>` +
        (c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : "");
      el.style.setProperty("--accent", engine.TIME_COLORS[c.value]);
      if (c.skill) el.setAttribute("data-desc", attr(engine.SKILLS[c.skill].desc));
      box.appendChild(el);
    }
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "看完了，确认";
    ok.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      applyAction({ type: "confirmSeen" });
    });
    modalActions.appendChild(ok);
    modalOverlay.classList.remove("hidden");
  }

  /** 质疑结果弹窗文案（从玩家视角描述） */
  function challengePopupText(cp) {
    const X = cp.drawCount;
    const humanChallenger = humanIds.includes(cp.challengerId);
    if (humanChallenger) {
      return cp.isEarly
        ? "😅 你的质疑失败了！你要拿回对方的所有牌，并再摸 " + X + " 张牌！"
        : "🎉 你的质疑成功了！对方要拿回所有牌，并再摸 " + X + " 张牌！";
    }
    // 玩家被质疑
    return cp.isEarly
      ? "✅ " + cp.challengerName + " 质疑了你！但他的质疑失败了，他要拿回你的所有牌，并再摸 " + X + " 张牌！"
      : "😈 " + cp.challengerName + " 质疑了你！他的质疑成功了，你要拿回所有牌，并再摸 " + X + " 张牌！";
  }

  function showChallengePopup(cp) {
    modalTitle.textContent = "🔍 质疑结果";
    modalBody.innerHTML = `<div class="victory" style="font-size:1.05rem;line-height:1.9">${challengePopupText(cp)}</div>`;
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "知道了";
    ok.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      pump();
    });
    modalActions.appendChild(ok);
    modalOverlay.classList.remove("hidden");
  }

  function showGameOver() {
    const w = state.players[state.winner];
    modalTitle.textContent = "🏆 游戏结束";
    modalBody.innerHTML = `
      <div class="victory">
        <span class="big-emoji">🎉</span>
        ${w.name} 第一个睡着了，赢得胜利！<br>
        <span style="font-size:0.85rem;color:var(--muted)">用了 ${state.round} 轮</span>
      </div>`;
    modalActions.innerHTML = "";
    const again = document.createElement("button");
    again.className = "btn-primary";
    again.textContent = "再来一局";
    again.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      startGame(config);
    });
    modalActions.appendChild(again);
    const change = document.createElement("button");
    change.className = "btn-ghost";
    change.textContent = "重新设置";
    change.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      setupOverlay.classList.remove("hidden");
      renderSetup();
    });
    modalActions.appendChild(change);
    modalOverlay.classList.remove("hidden");
  }

  /* ------------------------------ 规则弹窗内容 ------------------------------ */
  function buildRulesBody() {
    // 技能卡按时间点分组，使用完整原句
    const byValue = {};
    for (const sk of Object.values(engine.SKILLS)) {
      (byValue[sk.value] = byValue[sk.value] || []).push(sk);
    }
    let skillsHtml = "";
    for (let v = 0; v < 6; v++) {
      const list = byValue[v] || [];
      skillsHtml += `<h3>🕐 ${engine.TIME_NAMES[v]}的${list.length}张技能卡</h3><ul>` +
        list.map((sk) => `<li><b>${sk.name}</b>：${attr(sk.desc)}</li>`).join("") +
        `</ul>`;
    }
    $("rulesOverlay").querySelector(".rules-body").innerHTML = `
    <h3>🌙 游戏背景</h3>
    <p>「今天几点睡」是一款以传统唬牌游戏规则为基础、融入了夜间元素和技能设定的卡牌游戏。游戏情境设定在夜晚，每位玩家都要为今晚的入睡时间斗智斗勇——是乖乖早睡，还是偷偷熬夜？一边要伪装自己，一边还要抓出那些谎称早睡、其实在熬夜的家伙。全程充满心理博弈，让你切身体会熬夜时那种既紧张又刺激的感觉。</p>
    <h3>🎯 目标</h3>
    <ul>
      <li>最先清空手牌（0张）的玩家获胜。</li>
      <li>手牌达到 21 张以上 → 直接淘汰。</li>
    </ul>
    <h3>🂠 卡牌</h3>
    <ul>
      <li>共120张，6种时间点各20张（晚9→晚10→晚11→晚12→凌晨1→凌晨2）。</li>
      <li>每种时间点有3张技能卡，共18张技能卡。</li>
    </ul>
    <h3>🔁 每轮流程</h3>
    <ul>
      <li>首位玩家翻开牌堆顶1张作为【熄灯时间】（每轮轮换先手）。</li>
      <li>然后按顺序每人一个回合：开始→摸牌→出牌→质疑→结束。</li>
      <li>最后一名玩家回合结束后，场上牌进弃牌堆，开始新一轮。</li>
    </ul>
    <h3>😴 早睡 / 熬夜</h3>
    <ul>
      <li>扣着打出的牌<b>全是同一种时间</b>且<b>不晚于熄灯时间</b> → 早睡。</li>
      <li>打出的牌<b>≥2种时间</b>或有牌<b>晚于熄灯时间</b> → 熬夜（唬人！）。</li>
      <li>下家可质疑：若是早睡则质疑失败（质疑者收牌+摸等量），若是熬夜则质疑成功（出牌者收牌+摸等量）。</li>
    </ul>
    <h3>✨ 全部技能（把鼠标悬停到手牌或场上的技能牌上也能看介绍）</h3>
    ${skillsHtml}
    <h3>💡 提示</h3>
    <ul>
      <li>“未被质疑”的技能在结束阶段亮出发动；“质疑成功/失败”的技能在翻牌时发动。</li>
      <li>抽牌堆不够时，弃牌堆自动洗回。</li>
    </ul>`;
  }

  /* ------------------------------ 启动 ------------------------------ */
  buildRulesBody();
  // 刚进入游戏，先展示规则介绍，看完再点“我知道了”进入设置
  $("rulesOverlay").classList.remove("hidden");
  renderSetup();

  // 测试/调试钩子（对游戏无影响）
  window.__sleepGame = { state: () => state, applyAction };
})();
