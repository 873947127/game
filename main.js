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
  let winAnnounced = false;    // 胜利音效只播一次
  let shownChallengePopup = null; // 已经展示过的质疑结果弹窗
  let shownPassChallengePopup = null; // 已经展示过的“下家未质疑”弹窗
  let shownEliminatePopup = null; // 已经展示过的淘汰弹窗
  let lastHoverAt = 0;            // 悬停音效防抖时间戳
  let lastLightsOutRef = "none"; // 记录上次渲染的熄灯时间牌（用于翻牌动画）
  let lastLightsOutTimeRef; // 记录上次渲染的熄灯时间值（技能改变时间时刷新卡面）
  let tutorialMode = false;
  let tutorialStep = 0;
  let tutorialAiBlocked = false;
  let tutorialTimer = null;
  let tutorialFinished = false; // 教程完成弹窗期间，阻止 pump 弹出”再来一局”结算

  function clearTutorialTimer() {
    if (tutorialTimer) {
      clearTimeout(tutorialTimer);
      tutorialTimer = null;
    }
  }

  function scheduleTutorialAi(step, fn, delayMs = 4000) {
    clearTutorialTimer();
    tutorialAiBlocked = true;
    setPrompt("🤖 电脑正在思考…");
    tutorialTimer = setTimeout(() => {
      tutorialTimer = null;
      if (!tutorialMode || tutorialStep !== step) {
        tutorialAiBlocked = false;
        return;
      }
      tutorialAiBlocked = false;
      fn();
    }, delayMs);
  }

  /* ------------------------------ DOM ------------------------------ */
  const $ = (id) => document.getElementById(id);
  function attr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const roundPill = $("roundPill"), deckPill = $("deckPill"), discardPill = $("discardPill");
  const opponentsEl = $("opponents"), lightsOutEl = $("lightsOut"), modEl = $("roundModifiers");
  const currentPlayEl = $("currentPlay");
  const promptEl = $("prompt"), logEl = $("log");
  const turnBannerEl = $("turnBanner");
  const effectToastEl = $("effectToast");
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
  const setupOverlay = $("setupOverlay"), rulesOverlay = $("rulesOverlay"), modalOverlay = $("modalOverlay");
  const modalTitle = $("modalTitle"), modalBody = $("modalBody"), modalActions = $("modalActions");
  const rulesTitle = $("rulesTitle"), rulesBody = $("rulesBody");

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

  function playPopupSfx() {
    if (!window.SFX) return;
    window.SFX.unlock();
    window.SFX.play("popup");
  }

  function showTutorialIntroModal() {
    tutorialMode = false;
    tutorialStep = 0;
    tutorialAiBlocked = false;
    tutorialFinished = false;
    clearTutorialTimer();
    config = null;
    if (document.getElementById("newGameBtn")) document.getElementById("newGameBtn").textContent = "↻ 重新开局";
    setupOverlay.classList.add("hidden");
    rulesOverlay.classList.add("hidden");
    modalTitle.textContent = "📘 新手教程";
    modalBody.innerHTML = `
      <div class="victory" style="font-size:1.05rem;line-height:1.9">
        第一次游玩，建议先体验新手教程。<br>
        <span style="font-size:0.85rem;color:var(--muted)">教程会带你完成 1V1 演示，学习熄灯时间、出牌、质疑和技能使用。</span>
      </div>`;
    modalActions.innerHTML = "";

    const yesBtn = document.createElement("button");
    yesBtn.className = "btn-primary";
    yesBtn.textContent = "✅ 是，进入教程";
    yesBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      startTutorialGame();
    });
    modalActions.appendChild(yesBtn);

    const noBtn = document.createElement("button");
    noBtn.className = "btn-ghost";
    noBtn.textContent = "否，直接开始";
    noBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      setupOverlay.classList.remove("hidden");
      renderSetup();
      showRulesPanel("rules");
    });
    modalActions.appendChild(noBtn);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  function startTutorialGame() {
    tutorialMode = true;
    tutorialStep = 0;
    tutorialAiBlocked = false;
    clearTutorialTimer();
    selected.clear();
    clickMode = null;
    targetMode = false;
    document.getElementById("newGameBtn").textContent = "🚪 退出教程";
    humanIds = [0];
    const tutPlayers = [
      { name: "你", isAI: false },
      { name: "电脑", isAI: true },
    ];
    state = engine.newGame({ players: tutPlayers, seed: 20240613 });
    state.round = 1;
    state.players[0].hand = [
      { id: "t-p0-9a", value: 0, skill: null },
      { id: "t-p0-9b", value: 0, skill: null },
      { id: "t-p0-10", value: 1, skill: null },
      { id: "t-p0-11a", value: 2, skill: null },
      { id: "t-p0-11b", value: 2, skill: null },
    ];
    state.players[1].hand = [
      { id: "t-p1-10a", value: 1, skill: null },
      { id: "t-p1-10b", value: 1, skill: null },
      { id: "t-p1-1a", value: 4, skill: null },
      { id: "t-p1-1b", value: 4, skill: null },
      { id: "t-p1-2", value: 5, skill: null },
    ];
    state.players[0].playedCards = [];
    state.players[1].playedCards = [];
    state.currentPlay = { cards: [], ownerId: 0, isEarly: false };
    state.table = { cards: [] };
    state.deck = [
      { id: "t-d-1", value: 0, skill: null },
      { id: "t-d-2", value: 2, skill: null },
      { id: "t-d-3", value: 3, skill: null },
      { id: "t-d-4", value: 3, skill: null },
      { id: "t-d-5", value: 5, skill: "yanchi" },
      { id: "t-d-6", value: 1, skill: null },
    ];
    state.discard = [];
    state.turn = { pid: 0, phase: "play" };
    state.decide = { kind: "revealLightsOut", pid: 0 };
    state.lightsOutCard = null;
    state.lightsOutTime = null;
    state.log = ["新手教程：1V1 演示开始。"];
    modalOverlay.classList.add("hidden");
    showTutorialMessage("📘 新手教程", "夜深了，我们来看看今天几点熄灯吧。<br>点击屏幕上的熄灯时间牌翻开。", "继续");
    render();
  }

  function showTutorialMessage(title, message, btnText, next) {
    modalTitle.textContent = title;
    modalBody.innerHTML = `<div class="victory" style="font-size:1.05rem;line-height:1.9">${message}</div>`;
    modalActions.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = btnText || "继续";
    btn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      selected.clear();
      clickMode = null;
      targetMode = false;
      if (typeof next === "function") next();
      if (tutorialMode && state) {
        if (state.decide && humanIds.includes(state.decide.pid)) {
          render();
          renderHumanControls(state.decide);
        } else if (state) {
          render();
        }
        pump();
      } else if (state) {
        render();
      }
    });
    modalActions.appendChild(btn);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  function handleTutorialAction(action) {
    if (!tutorialMode || !state) return;

    const player = state.players[0];

    if (tutorialStep === 0 && action.type === "revealLightsOut") {
      state.lightsOutCard = { id: "t-light-10", value: 1, skill: null };
      state.lightsOutTime = 1;
      state.turn = { pid: 0, phase: "play" };
      state.decide = { kind: "play", pid: 0 };
      tutorialStep = 1;
      showTutorialMessage(
        "🌙 熄灯时间",
        "今晚的熄灯时间是<strong>晚上10点</strong>。<br>10点有些太早了，我们试试熬夜吧！<br>打出2张11点试一下。",
        "继续",
        () => setPrompt("🎴 请选择两张 11 点牌，然后点击确认出牌。")
      );
      return;
    }

    if (tutorialStep === 1 && action.type === "playCards") {
      const ids = action.cardIds || [];
      const chosen = ids.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
      const values = chosen.map((c) => c.value);
      if (ids.length === 2 && values.every((v) => v === 2)) {
        player.hand = player.hand.filter((c) => !ids.includes(c.id));
        state.currentPlay = { cards: chosen, ownerId: 0, isEarly: false };
        state.table.cards = chosen.slice();
        state.turn = { pid: 0, phase: "challenge" };
        state.decide = { kind: "challenge", pid: 1, ownerPid: 0, N: 2 };
        tutorialStep = 2;
        scheduleTutorialAi(2, () => {
          engine.act(state, { type: "passChallenge" });
          showTutorialMessage(
            "😌 电脑选择不质疑",
            "太好了！我们熬夜没有被抓到。",
            "继续",
            () => {
              state.players[1].hand = [
                { id: "t-p1-10a", value: 1, skill: null },
                { id: "t-p1-10b", value: 1, skill: null },
                { id: "t-p1-1a", value: 4, skill: null },
                { id: "t-p1-1b", value: 4, skill: null },
                { id: "t-p1-2", value: 5, skill: null },
              ];
              state.currentPlay = { cards: [], ownerId: null, isEarly: false };
              state.turn = { pid: 1, phase: "play" };
              state.decide = { kind: "play", pid: 1 };
              tutorialStep = 3;
              scheduleTutorialAi(3, () => {
                state.currentPlay = { cards: [
                  { id: "t-p1-1a", value: 4, skill: null },
                  { id: "t-p1-1b", value: 4, skill: null },
                  { id: "t-p1-2", value: 5, skill: null },
                ], ownerId: 1, isEarly: false };
                state.table.cards = state.currentPlay.cards.slice();
                state.decide = { kind: "challenge", pid: 0, ownerPid: 1, N: 3 };
                state.turn = { pid: 1, phase: "challenge" };
                showTutorialMessage(
                  "🔍 质疑时机",
                  "他打出了三张牌，很大概率也在熬夜。<br>我们来质疑他！<br>点击“质疑他！”即可进行质疑。",
                  "继续",
                  () => {
                    setPrompt("🔍 请选择“质疑他！”来挑战电脑的这组牌。");
                    renderHumanControls(state.decide);
                  }
                );
              }, 4000);
            }
          );
        }, 4000);
        return;
      }
      setPrompt("⚠️ 这一步请按提示打出两张 11 点牌，再点击确认。 ");
      return;
    }

    if (tutorialStep === 3 && action.type === "challenge") {
      state.lastReveal = {
        isEarly: false,
        ownerName: "电脑",
        challengerName: "你",
        cards: [
          { id: "t-p1-1a", value: 4, skill: null },
          { id: "t-p1-1b", value: 4, skill: null },
          { id: "t-p1-2", value: 5, skill: null },
        ],
      };
      // 清空场上扣置的牌，让质疑翻牌动画能够触发（否则仍停留在“扣置卡背”状态）
      state.currentPlay = { cards: [], ownerId: null, isEarly: false };
      state.table.cards = [];
      state.players[1].hand = [
        { id: "t-p1-9a", value: 0, skill: null },
        { id: "t-p1-9b", value: 0, skill: null },
        { id: "t-p1-9c", value: 0, skill: null },
        { id: "t-p1-10a", value: 1, skill: null },
        { id: "t-p1-10b", value: 1, skill: null },
      ];
      state.players[0].hand = [
        { id: "t-p0-9a", value: 0, skill: null },
        { id: "t-p0-9b", value: 0, skill: null },
        { id: "t-p0-10", value: 1, skill: null },
      ];
      tutorialStep = 4;
      state.decide = null; // 翻牌动画期间不再显示“质疑/相信”按钮
      // 先让翻牌动画播完（约 1 秒），再弹说明弹窗，避免弹窗遮挡动画
      clearTutorialTimer();
      tutorialTimer = setTimeout(() => {
        tutorialTimer = null;
        showTutorialMessage(
          "✅ 质疑成功",
          "质疑成功！他要拿回自己打出的3张牌，并再摸3张牌。",
          "继续",
          () => {
          state.round = 2;
          state.lightsOutCard = null; // 电脑思考后再翻开
          state.lightsOutTime = null;
          state.turn = { pid: 0, phase: "play" };
          state.decide = { kind: "revealLightsOut", pid: 1 }; // 电脑翻熄灯时间
          state.players[0].hand = [
            { id: "t-p0-9a", value: 0, skill: null },
            { id: "t-p0-9b", value: 0, skill: null },
            { id: "t-p0-10", value: 1, skill: null },
          ];
          // 电脑思考 2 秒后翻开熄灯时间
          scheduleTutorialAi(4, () => {
            state.lightsOutCard = { id: "t-light-9", value: 0, skill: null };
            state.lightsOutTime = 0;
            tutorialAiBlocked = true; // 等待期间不响应 AI / 玩家操作
            render(); // 翻牌动画
            setPrompt("🤖 电脑翻出了熄灯时间…");
            // 翻开后等 1 秒再弹窗说明
            clearTutorialTimer();
            tutorialTimer = setTimeout(() => {
              tutorialTimer = null;
              showTutorialMessage(
                "🌙 第二轮",
                "这轮由他翻开熄灯时间，他翻开的时间是<strong>晚上9点</strong>。",
                "继续",
                () => {
                  // 玩家的回合开始：摸到【延迟熄灯】（摸牌动画由弹窗关闭后的 render 触发）
                  state.players[0].hand.push({ id: "t-p0-2", value: 5, skill: "yanchi" });
                  // 摸到后等 1 秒再提示技能牌
                  clearTutorialTimer();
                  tutorialTimer = setTimeout(() => {
                    tutorialTimer = null;
                    showTutorialMessage(
                      "✨ 摸到技能牌",
                      "哇！我们抽到了一张技能牌【延迟熄灯】。<br>它可以在轮次开始时改变熄灯时间。<br>我们可以在之后打出",
                      "继续",
                      () => {
                        showTutorialMessage(
                          "💡 小提示",
                          "这一轮的熄灯时间是<strong>晚上9点</strong>，我建议我们选择早睡。",
                          "继续",
                          () => {
                            state.decide = { kind: "play", pid: 0 };
                            state.turn = { pid: 0, phase: "play" };
                            tutorialAiBlocked = false;
                          }
                        );
                      }
                    );
                  }, 1000);
                }
              );
            }, 1000);
          }, 2000);
          }
        );
      }, 1000);
      return;
    }

    if (tutorialStep === 4 && action.type === "playCards") {
      const ids = action.cardIds || [];
      const chosen = ids.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
      const values = chosen.map((c) => c.value);
      if (ids.length === 2 && values.every((v) => v === 0)) {
        player.hand = player.hand.filter((c) => !ids.includes(c.id));
        state.currentPlay = { cards: chosen, ownerId: 0, isEarly: true };
        state.table.cards = chosen.slice();
        state.decide = { kind: "challenge", pid: 1, ownerPid: 0, N: 2 };
        state.turn = { pid: 0, phase: "challenge" };
        tutorialStep = 5;
        scheduleTutorialAi(5, () => {
          // 电脑质疑：记录翻牌结果并清空场上扣置的牌，触发质疑翻牌动画
          state.lastReveal = {
            isEarly: true,
            ownerName: "你",
            challengerName: "电脑",
            cards: chosen.slice(),
          };
          state.currentPlay = { cards: [], ownerId: null, isEarly: false };
          state.table.cards = [];
          state.round = 3;
          state.lightsOutCard = null;
          state.lightsOutBase = null;
          state.lightsOutTime = null;
          state.turn = { pid: 0, phase: "draw" };
          state.decide = null; // 翻牌动画期间不再显示按钮
          state.players[0].hand = [
            { id: "t-p0-2", value: 5, skill: "yanchi" },
            { id: "t-p0-10", value: 1, skill: null },
          ];
          render(); // 播放质疑翻牌动画
          // 等翻牌动画播完（约 1 秒）再弹说明弹窗，避免弹窗遮挡动画
          clearTutorialTimer();
          tutorialTimer = setTimeout(() => {
            tutorialTimer = null;
            state.decide = { kind: "revealLightsOut", pid: 0 }; // 翻牌动画结束后恢复下一阶段决策
            showTutorialMessage(
              "⚠️ 电脑质疑",
              "他选择质疑，质疑失败。<br>他要拿起我们打出的2张牌，并再摸2张牌。<br>他以为我们熬夜了呢，没想到我们乖乖睡觉啦！",
              "继续",
              () => {
                showTutorialMessage(
                  "🎯 第三轮",
                  "轮到我们看熄灯时间了。<br>点击屏幕上的熄灯时间牌翻开。"
                );
              }
            );
          }, 1000);
        }, 4000);
        return;
      }
      setPrompt("⚠️ 这里要打出两张 9 点牌，形成早睡。 ");
      return;
    }

    if (tutorialStep === 5 && action.type === "revealLightsOut") {
      state.lightsOutCard = { id: "t-light-9b", value: 0, skill: null };
      state.lightsOutBase = 0;
      state.lightsOutTime = null;
      tutorialAiBlocked = true; // 等待期间不响应操作
      // 让玩家看清翻开的熄灯时间，等 2 秒再弹窗说明
      clearTutorialTimer();
      tutorialTimer = setTimeout(() => {
        tutorialTimer = null;
        showTutorialMessage(
          "🎯 第三轮",
          "今晚9点熄灯，但我们手里没有9点，只能冒险熬夜。<br>不过我们有刚刚抽到的技能卡【延迟熄灯】<br>现在正是派上用场的时候了！",
          "继续",
          () => {
            state.decide = { kind: "roundStartSkill", pid: 0 };
            tutorialStep = 6;
            tutorialAiBlocked = false;
            renderHumanControls(state.decide);
          }
        );
      }, 2000);
      return;
    }

    if (tutorialStep === 6 && action.type === "playRoundStart") {
      const cardId = action.cardId;
      if (cardId) {
        state.players[0].hand = state.players[0].hand.filter((c) => c.id !== cardId);
      }
      state.lightsOutTime = 1;
      state.turn = { pid: 0, phase: "draw" };
      state.decide = { kind: "play", pid: 0 };
      tutorialStep = 7;
      showTutorialMessage(
        "✨ 技能生效",
        "太好了，现在熄灯时间变成了晚上10点。<br>我们已经胜券在握。",
        "继续",
        () => {
          state.players[0].hand = [
            { id: "t-p0-10", value: 1, skill: null },
            { id: "t-p0-10b", value: 1, skill: null },
          ];
          state.decide = { kind: "play", pid: 0 };
          renderHumanControls(state.decide);
        }
      );
      return;
    }

    if (tutorialStep === 7 && action.type === "playCards") {
      const ids = action.cardIds || [];
      const chosen = ids.map((id) => player.hand.find((c) => c.id === id)).filter(Boolean);
      const values = chosen.map((c) => c.value);
      if (ids.length === 2 && values.every((v) => v === 1)) {
        tutorialMode = false;
        tutorialStep = 0;
        state.winner = 0;
        tutorialFinished = true; // 阻止 pump 弹出“再来一局”结算
        if (window.SFX) window.SFX.play("win");
        showTutorialMessage(
          "🏆 教程完成",
          "恭喜您完成教程，接下来体验一下正式对局吧！",
          "开始对局",
          () => {
            tutorialFinished = false;
            stopAI();
            document.getElementById("newGameBtn").textContent = "↻ 重新开局";
            state = null;
            config = null;
            setupOverlay.classList.remove("hidden");
            renderSetup();
            showRulesPanel("rules");
          }
        );
      }
      return;
    }

    if (tutorialMode) {
      setPrompt("📘 新手教程：请按引导内容完成当前步骤。 ");
    }
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

  function applyVolumeFromSlider() {
    const value = Number(volSlider.value) / 100;
    if (window.SFX) {
      window.SFX.unlock();
      window.SFX.setVolume(value);
    }
    if (window.BGM) {
      if (musicUserChoice !== "off") {
        window.BGM.start();
      }
      window.BGM.setVolume(value);
      updateMusicUI();
    }
  }

  volSlider.addEventListener("pointerdown", () => {
    if (window.SFX) window.SFX.unlock();
    if (window.BGM && musicUserChoice !== "off") {
      window.BGM.start();
      updateMusicUI();
    }
  });
  volSlider.addEventListener("input", applyVolumeFromSlider);
  volSlider.addEventListener("change", applyVolumeFromSlider);
  volSlider.addEventListener("pointerup", applyVolumeFromSlider);
  volSlider.addEventListener("touchend", applyVolumeFromSlider, { passive: true });
  updateMusicUI();

  // 任意按钮点击都播放清脆的按键音（事件委托）
  if (document && document.addEventListener) {
    document.addEventListener("click", (e) => {
      if (window.SFX && e.target && e.target.closest && e.target.closest("button")) {
        // 月亮按钮有专属玉碎音效（moon.js 播放 moon.mp3），不再叠加通用按键音
        if (e.target.closest("#moonBtn")) return;
        window.SFX.unlock();
        window.SFX.play("click");
      }
    });
  }

  $("newGameBtn").addEventListener("click", () => {
    if (tutorialMode) {
      showExitTutorialConfirm();
      return;
    }
    if (state && state.winner == null) {
      showRestartConfirm();
      return;
    }
    stopAI();
    setupOverlay.classList.remove("hidden");
    renderSetup();
  });

  function showExitTutorialConfirm() {
    modalTitle.textContent = "🚪 确认退出教程";
    modalBody.innerHTML = `
      <div class="victory" style="font-size:1.05rem;line-height:1.9">
        你确定要退出新手教程吗？<br>
        <span style="font-size:0.85rem;color:var(--muted)">退出后，当前教程进度会丢失，并返回到开始界面。</span>
      </div>`;
    modalActions.innerHTML = "";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-primary";
    confirmBtn.textContent = "确认退出";
    confirmBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      exitTutorialToSetup();
    });
    modalActions.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-ghost";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
    });
    modalActions.appendChild(cancelBtn);

    modalOverlay.classList.remove("hidden");
  }

  function exitTutorialToSetup() {
    stopAI();
    clearTutorialTimer();
    tutorialMode = false;
    tutorialStep = 0;
    tutorialAiBlocked = false;
    state = null;
    config = null;
    selected.clear();
    clickMode = null;
    targetMode = false;
    humanIds = [];
    document.getElementById("newGameBtn").textContent = "↻ 重新开局";
    setupOverlay.classList.remove("hidden");
    renderSetup();
  }

  function showRestartConfirm() {
    modalTitle.textContent = "🔄 确认重开";
    modalBody.innerHTML = `
      <div class="victory" style="font-size:1.05rem;line-height:1.9">
        当前游戏还在进行中，是否确认提前结束并重开？<br>
        <span style="font-size:0.85rem;color:var(--muted)">确认后，会先结束当前局，再返回开局界面。</span>
      </div>`;
    modalActions.innerHTML = "";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-primary";
    confirmBtn.textContent = "确认重开";
    confirmBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      endCurrentGameAndRestart();
    });
    modalActions.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-ghost";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
    });
    modalActions.appendChild(cancelBtn);

    modalOverlay.classList.remove("hidden");
  }

  function endCurrentGameAndRestart() {
    stopAI();
    if (tutorialMode) {
      exitTutorialToSetup();
      return;
    }
    if (!state) {
      setupOverlay.classList.remove("hidden");
      renderSetup();
      return;
    }
    const winner = state.players.find((p) => p.alive) || state.players[0];
    state.winner = winner ? winner.id : 0;
    showGameOver();
  }

  /* ------------------------------ 单机/联机 模式切换 ------------------------------ */
  function switchMode(online) {
    $("singleArea").classList.toggle("hidden", online);
    $("onlineArea").classList.toggle("hidden", !online);
    // 元素不存在时跳过（防止 HTML/JS 缓存版本不一致时报错，导致按钮点了没反应）
    if ($("modeSingleBtn")) $("modeSingleBtn").classList.toggle("on-human", !online);
    if ($("modeOnlineBtn")) $("modeOnlineBtn").classList.toggle("on-human", online);
    if ($("modeTutorialBtn")) $("modeTutorialBtn").classList.remove("on-human"); // 教程是弹窗入口，不参与模式高亮
  }
  $("modeTutorialBtn").addEventListener("click", () => {
    showTutorialIntroModal();
  });
  $("modeSingleBtn").addEventListener("click", () => switchMode(false));
  $("modeOnlineBtn").addEventListener("click", () => switchMode(true));

  // 去服务器版（需部署，最稳定）
  $("toNetBtn").addEventListener("click", () => {
    if (window.location.protocol === "file:") {
      alert("服务器版需要先部署服务器，然后在服务器网址上打开。");
    } else {
      window.location.href = "net.html";
    }
  });

  // 去直连版（无需服务器，P2P）
  $("toP2pBtn").addEventListener("click", () => {
    window.location.href = "p2p.html";
  });

  $("rulesBtn").addEventListener("click", () => {
    showRulesPanel("rules");
  });
  $("skillBtn").addEventListener("click", () => {
    showRulesPanel("skills");
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
    clearTutorialTimer();
    if (!cfg || !Array.isArray(cfg)) {
      tutorialMode = false;
      tutorialStep = 0;
      state = null;
      setupOverlay.classList.remove("hidden");
      renderSetup();
      return;
    }
    state = engine.newGame({ players: cfg });
    humanIds = cfg.map((p, i) => (p.isAI ? null : i)).filter((i) => i != null);
    selected.clear();
    clickMode = null;
    targetMode = false;
    prevHands = {};
    lastRevealRef = null;
    lastRound = 0;
    lastTurnPid = null;
    winAnnounced = false;
    shownChallengePopup = null;
    shownPassChallengePopup = null;
    shownEliminatePopup = null;
    lastLightsOutRef = "none";
    lastLightsOutTimeRef = undefined;
    pump();
  }

  function stopAI() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  }

  /* ------------------------------ 主循环 ------------------------------ */
  function pump() {
    stopAI();
    if (!state) return;
    if (tutorialMode) {
      render();
      const d = state.decide;
      if (!d) return;
      if (tutorialAiBlocked) {
        setPrompt("🤖 电脑正在思考…");
        return;
      }
      const player = state.players[d.pid];
      if (humanIds.includes(d.pid)) {
        renderHumanControls(d);
        return;
      }
      if (player && player.isAI) {
        const fast = window.__aiDelay != null;
        let delay;
        if (fast) {
          delay = window.__aiDelay;
        } else {
          // 教程中电脑思考 4 秒，正式游戏保持 2 秒。
          delay = 4000 + Math.random() * 800;
        }
        setPrompt("🤖 电脑正在思考…");
        aiTimer = setTimeout(() => {
          const action = ai.aiAct(state);
          engine.act(state, action);
          selected.clear();
          clickMode = null;
          targetMode = false;
          pump();
        }, delay);
      }
      return;
    }
    if (state.winner != null) {
      if (tutorialFinished) {
        // 教程完成弹窗期间不弹“再来一局”结算
        render();
        return;
      }
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
    // 观星/预知梦等需要弹专用面板的决策进行中时，不弹通知弹窗，避免互相覆盖导致卡死
    const modalDecide = d && (d.kind === "stargaze" || d.kind === "preview");
    // 质疑结果弹窗：玩家参与时弹出（需点“知道了”继续）；电脑互搏不弹（看场上翻牌即可）
    const cp = state.challengePopup;
    if (cp && cp !== shownChallengePopup && !modalDecide) {
      shownChallengePopup = cp;
      const humanInvolved = humanIds.includes(cp.challengerId) || humanIds.includes(cp.ownerId);
      if (humanInvolved) {
        // 先让翻牌动画播完，再延迟约 1 秒弹窗
        setTimeout(() => showChallengePopup(cp), 1000);
        return; // 暂停，等玩家确认
      }
    }
    // 下家未质疑弹窗：只给“打出牌的人”显示提示（需点“知道了”继续）
    const ppc = state.passChallengePopup;
    if (ppc && ppc !== shownPassChallengePopup && !modalDecide) {
      shownPassChallengePopup = ppc;
      if (humanIds.includes(ppc.ownerId)) {
        showPassChallengePopup(ppc);
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
        // 正式游戏中电脑思考约 2 秒，教程中继续保留 4 秒。
        delay = tutorialMode ? 4000 + Math.random() * 800 : 2000 + Math.random() * 600;
      }
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
    if (tutorialMode) {
      if (window.SFX) {
        window.SFX.unlock();
        if (action.type === "revealLightsOut") window.SFX.play("reveal");
        else if (action.type === "playCards") window.SFX.play("playCards");
      }
      clearTutorialTimer();
      handleTutorialAction(action);
      selected.clear();
      clickMode = null;
      targetMode = false;
      pump();
      return;
    }
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
      if (ev && typeof ev === "object" && ev.name === "skillEffect") {
        showToast(ev.text); // 玩家发动技能的效果提示
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
      showBanner("🌙 第 " + state.round + " 轮");
    } else if (state.turn && state.turn.pid !== lastTurnPid) {
      lastTurnPid = state.turn.pid;
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
    deckPill.textContent = "抽牌堆 " + state.deck.length;
    discardPill.textContent = "弃牌堆 " + state.discard.length;
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

  /** 时间卡牌图案：SVG 时钟（霓虹线框 + 特有色指针，分针固定指向12） */
  function timeIconSvg(value) {
    const hour = (value + 9) % 12; // 对应钟面小时
    const ang = (hour * 30 * Math.PI) / 180; // 时针角度（0 = 指向12）
    const hx = 12 + 5 * Math.sin(ang), hy = 12 - 5 * Math.cos(ang);
    const mx = 12 + 7.4 * Math.sin(0), my = 12 - 7.4 * Math.cos(0); // 分针指向12
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
    const t = state.lightsOutTime != null ? state.lightsOutTime : (card ? card.value : null);

    if (card === lastLightsOutRef && t === lastLightsOutTimeRef) {
      // 牌和时间都没变就不重建，避免动画重复播放
      return;
    }
    lastLightsOutRef = card;
    lastLightsOutTimeRef = t;

    if (card == null) {
      // 还没翻开：牌背
      lightsOutEl.className = "lights-out back" + (humanTurn ? " clickable" : "");
      lightsOutEl.innerHTML = `<div class="moon-icon">🌙</div><div class="time">?</div>` +
        (humanTurn ? `<div class="reveal-hint">👆 点击翻开熄灯时间</div>` : "");
    } else {
      // 已翻开：牌面。若只是时间被技能改动，只更新内容、不重播翻牌动画
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

    // 刚扣下的牌：逐张显示扣置卡背；被质疑后在此处原地翻转亮出
    const cp = state.currentPlay;
    if (cp.cards.length) {
      const owner = state.players[cp.ownerId];
      currentPlayEl.className = "current-play has-cards";
      currentPlayEl.innerHTML = `
        <div class="cp-label">${owner.name} 扣下 ${cp.cards.length} 张</div>
        <div class="cp-cards">${cp.cards.map(cardBack).join("")}</div>
        <div class="cp-label">（扣置，未知）</div>`;
    } else {
      const rv = state.lastReveal;
      if (rv && rv.cards && rv.cards.length) {
        if (rv !== lastRevealRef) {
          lastRevealRef = rv;
          currentPlayEl.className = "current-play has-cards revealed";
          currentPlayEl.innerHTML = `
            <div class="cp-label">🔍 已翻开：${rv.isEarly ? "确实是「早睡」✅" : "其实是「熬夜」😈"}</div>
            <div class="cp-cards">${rv.cards.map((c, i) => cardFace(c, i)).join("")}</div>`;
          // 每张卡牌翻开时依次播放“选中”音效，与翻牌动画的错峰同步
          rv.cards.forEach((_, i) => {
            setTimeout(() => { if (window.SFX) window.SFX.play("select"); }, i * 100);
          });
        }
      } else {
        currentPlayEl.className = "current-play";
        currentPlayEl.innerHTML = `<div class="cp-label">等待出牌…</div>`;
      }
    }
  }

  /** 扣置卡背（逐张展示在“刚刚扣下的牌”区域） */
  function cardBack() {
    return `<div class="cp-card back"><svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" fill="#cdd6ff"/><path d="M17.7 5.3l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5Z" fill="#ffe9a8"/></svg></div>`;
  }

  function cardFace(c, i) {
    const delay = i != null ? ` animation-delay:${i * 100}ms;` : "";
    return `<div class="cp-card face flip" style="--accent:${engine.TIME_COLORS[c.value]};${delay}">
      <div class="cicon">${timeIconSvg(c.value)}</div>
      <div class="t">${engine.TIME_SHORT[c.value]}</div>
      ${c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : ""}
    </div>`;
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
  // 可“点击原卡牌直接发动”的技能（轮次开始技能 / 反应技能）：cardId -> action
  function skillCardActions(d, hand) {
    const map = {};
    if (!d) return map;
    if (d.kind === "roundStartSkill") {
      for (const c of hand) if (c.skill && ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(c.skill)) map[c.id] = { type: "playRoundStart", cardId: c.id };
    } else if (d.kind === "reaction") {
      for (const c of hand) if (c.skill && (d.allowed || []).includes(c.skill)) map[c.id] = { type: "playReaction", cardId: c.id };
    }
    return map;
  }

  function renderPlayerArea() {
    const bp = bottomPlayer();
    const isMyTurn = state.decide && state.decide.pid === bp.id && !bp.isAI;
    const myTurn = isMyTurn;
    // 先确定操作模式，再画手牌（否则牌会被画成不可点击的灰暗状态）
    clickMode = myTurn ? clickModeFor(state.decide) : null;
    const skillMap = myTurn ? skillCardActions(state.decide, bp.hand) : {};
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
        } else if (myTurn && clickMode === "softcandy" && c.id !== (state.decide && state.decide.cardId)) {
          el.addEventListener("click", () => applyAction({ type: "pickSoftCandyCard", cardId: c.id }));
        } else if (myTurn && skillMap[c.id]) {
          el.classList.add("playable");
          el.addEventListener("click", () => applyAction(skillMap[c.id]));
        } else {
          el.classList.add("dim");
        }
        el.innerHTML = `<div class="cicon">${timeIconSvg(c.value)}</div>` +
          `<div class="t">${engine.TIME_SHORT[c.value]}</div>` +
          (c.skill ? `<div class="s">${engine.SKILLS[c.skill].name}</div>` : "") +
          `<i class="card-glow" aria-hidden="true"></i>`;
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
          ? `🌙 轮到你翻开今晚的熄灯时间了！点击熄灯时间区的“问号牌”吧。`
          : `🌙 ${p.name} 正在翻开今晚的熄灯时间…`;
      }
      case "roundStartSkill": {
        if (tutorialMode && tutorialStep === 6 && p.id === 0) {
          return "🧠 请使用【延迟熄灯】把熄灯时间变成晚上10点。";
        }
        return "🌙 轮次准备阶段：等待玩家选择发动技能。";
      }
      case "stargaze": return "";
      case "play": {
        if (tutorialMode && tutorialStep === 1 && p.id === 0) {
          return "🎴 请打出 2 张晚上11点吧。";
        }
        if (tutorialMode && tutorialStep === 4 && p.id === 0) {
          return "🎴 请打出 2 张晚上9点吧。";
        }
        if (tutorialMode && tutorialStep === 7 && p.id === 0) {
          return "🎴 打出所有手牌吧。";
        }
        const t = state.lightsOutTime == null ? "（无）" : engine.TIME_NAMES[state.lightsOutTime];
        return `🎴 ${p.name} 出牌阶段：选择要扣置的牌（至少1张）。本轮熄灯时间：${t}`;
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
      case "bellDraw":
        return `🔔 ${p.name} 正在被【午夜凶铃】纠缠：点击屏幕每次摸1张，直到摸到晚上12点或手牌达到20张。`;
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
          b.innerHTML = `${engine.SKILLS[c.skill].name}（点击发动） <small>${engine.SKILLS[c.skill].desc}</small>`;
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
          b.innerHTML = `${engine.SKILLS[sk].name}（点击发动） <small>${engine.SKILLS[sk].desc}</small>`;
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
          b.innerHTML = `${engine.SKILLS[card.skill].name}（点击发动） <small>${engine.SKILLS[card.skill].desc}</small>`;
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

      case "bellDraw": {
        clickMode = null;
        const drawBtn = document.createElement("button");
        drawBtn.className = "btn-primary";
        drawBtn.textContent = "🔔 点击摸1张";
        drawBtn.addEventListener("click", () => applyAction({ type: "drawBell" }));
        actionsEl.appendChild(drawBtn);
        hint.textContent = "每次点击都摸1张，直到摸到晚上12点或手牌达到20张上限";
        actionsEl.appendChild(hint);
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
          b.innerHTML = `${engine.SKILLS[card.skill].name}（点击发动） <small>${engine.SKILLS[card.skill].desc}</small>`;
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
    playPopupSfx();
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
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  /** 下家未质疑弹窗：提示打出者“没被质疑” */
  function showPassChallengePopup(ppc) {
    const text = ppc.isEarly
      ? "😌 " + ppc.passerName + " 没有质疑你，相信了你打出的 " + ppc.N + " 张牌！"
      : "😈 " + ppc.passerName + " 没有质疑你！你成功隐瞒了 " + ppc.N + " 张牌。";
    modalTitle.textContent = "🙈 未被质疑";
    modalBody.innerHTML = `<div class="victory" style="font-size:1.05rem;line-height:1.9">${text}</div>`;
    modalActions.innerHTML = "";
    const ok = document.createElement("button");
    ok.className = "btn-primary";
    ok.textContent = "知道了";
    ok.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      pump();
    });
    modalActions.appendChild(ok);
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  function showGameOver() {
    const w = state && state.players && state.players[state.winner] ? state.players[state.winner] : null;
    modalTitle.textContent = "🏆 游戏结束";
    modalBody.innerHTML = `
      <div class="victory">
        <span class="big-emoji">🎉</span>
        ${w ? w.name : "本局"} 第一个睡着了，赢得胜利！<br>
        <span style="font-size:0.85rem;color:var(--muted)">用了 ${state ? state.round : 0} 轮</span>
      </div>`;
    modalActions.innerHTML = "";
    const again = document.createElement("button");
    again.className = "btn-primary";
    again.textContent = "再来一局";
    again.addEventListener("click", () => {
      modalOverlay.classList.add("hidden");
      if (tutorialMode) {
        tutorialMode = false;
        tutorialStep = 0;
        state = null;
        config = null;
        setupOverlay.classList.remove("hidden");
        renderSetup();
        return;
      }
      if (!config) {
        setupOverlay.classList.remove("hidden");
        renderSetup();
        return;
      }
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
    playPopupSfx();
    modalOverlay.classList.remove("hidden");
  }

  /* ------------------------------ 规则弹窗内容 ------------------------------ */
  function buildSkillListBody() {
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
    return `
      <h3>🧠 技能一览</h3>
      ${skillsHtml}
    `;
  }

  function buildRulesBody() {
    return `
    <h3>🌙 游戏背景</h3>
    <p>「今天几点睡」是一款多人卡牌游戏。情境设定在夜晚，每位玩家都要为今晚的入睡时间斗智斗勇——是乖乖早睡，还是偷偷熬夜？一边要伪装自己，一边还要抓出那些谎称早睡、其实在熬夜的家伙。全程充满心理博弈，让你切身体会熬夜时那种既紧张又刺激的感觉。</p>
    <h3>🎯 目标</h3>
    <ul>
      <li>最先清空手牌的玩家获胜。</li>
      <li>手牌达到 21 张及以上会直接淘汰。</li>
    </ul>
    <h3>🂠 卡牌</h3>
    <ul>
      <li>共120张，6种时间点各20张（晚9→晚10→晚11→晚12→凌晨1→凌晨2）。</li>
      <li>每种时间点有3张技能卡，共18张技能卡。</li>
    </ul>
    <h3>🔁 每轮流程</h3>
    <ul>
      <li>首位玩家翻开牌堆顶1张作为【熄灯时间】（每轮轮换）。</li>
      <li>然后按顺序每人一个回合：开始→摸牌→出牌→质疑→结束。</li>
      <li>最后一名玩家回合结束后，场上的牌放入弃牌堆，开始新一轮。</li>
    </ul>
    <h3>😴 早睡 / 熬夜</h3>
    <ul>
      <li>扣着打出的牌<b>全是同一种时间</b>且<b>不晚于熄灯时间</b> → 早睡。</li>
      <li>打出的牌<b>≥2种时间</b>或有牌<b>晚于熄灯时间</b> → 熬夜。</li>
      <li>下家可质疑：若是早睡则质疑失败（质疑者收牌+摸等量的牌），若是熬夜则质疑成功（出牌者收牌+摸等量的牌）。</li>
    </ul>
    `;
  }

  function showRulesPanel(kind) {
    if (kind === "skills") {
      rulesTitle.textContent = "🧠 技能一览";
      rulesBody.innerHTML = buildSkillListBody();
    } else {
      rulesTitle.textContent = "📜 玩法速览";
      rulesBody.innerHTML = buildRulesBody();
    }
    rulesOverlay.classList.remove("hidden");
  }

  /* ------------------------------ 启动 ------------------------------ */
  // 打开游戏先询问是否进行新手教程（选“是”进教程；选“否”则显示规则提示）
  renderSetup();
  showTutorialIntroModal();

  // 测试/调试钩子（对游戏无影响）
  window.__sleepGame = { state: () => state, applyAction };
})();
