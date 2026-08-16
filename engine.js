/* =========================================================================
 * 今天几点睡 —— 核心规则引擎
 * 纯逻辑、不含任何界面代码，可在浏览器或 Node 中运行。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SleepGameEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ------------------------------ 基础定义 ------------------------------ */
  const TIME_NAMES = ["晚上9点", "晚上10点", "晚上11点", "晚上12点", "凌晨1点", "凌晨2点"];
  const TIME_SHORT = ["晚9", "晚10", "晚11", "晚12", "凌晨1", "凌晨2"];
  // 每个时间点的图案（时钟）与主题色，用于界面区分
  const TIME_ICONS = ["🕘", "🕙", "🕚", "🕛", "🕐", "🕑"];
  const TIME_COLORS = ["#7fd4ff", "#6fb3ff", "#8a8bff", "#a978ff", "#c66bff", "#ff7ac0"];

  // AI 性格模型：风险(质疑阈值，越高越爱质疑)、唬人概率、出牌量、宵禁/狂欢倾向
  const PERSONALITIES = [
    { key: "aggressive",   name: "激进", risk: 0.48, bluff: 0.22, shed: 4, xiaojin: 0.9, kuanghuan: 0.3 },
    { key: "steady",       name: "稳重", risk: 0.28, bluff: 0.05, shed: 3, xiaojin: 0.3, kuanghuan: 0.7 },
    { key: "cunning",      name: "狡诈", risk: 0.35, bluff: 0.15, shed: 3, xiaojin: 0.6, kuanghuan: 0.5 },
    { key: "conservative", name: "保守", risk: 0.22, bluff: 0,    shed: 3, xiaojin: 0.2, kuanghuan: 0.8 },
  ];

  const SKILLS = {
    huilongjue:  { id: "huilongjue",  name: "回笼觉",     value: 0, trigger: "endPhase", desc: "若你本回合扣置打出了这张牌，且未被质疑，则你可以在结束阶段亮出这张牌，然后获得一个新的不含摸牌阶段的回合。" },
    taohuayuan:  { id: "taohuayuan",  name: "梦中桃花源", value: 0, trigger: "endPhase", desc: "若你本回合扣置打出了包含这张牌在内的3张及以上的牌，且未被质疑，则你可以在结束阶段与下家互换手牌。" },
    ruang:       { id: "ruang",       name: "褪黑素软糖", value: 0, trigger: "endPhase", desc: "若你本回合扣置打出其它手牌后未被质疑，则你可以在结束阶段打出包含这张牌在内的任意2张牌。这张牌在本体被打出的时候不会触发。" },
    qingxingmeng:{ id: "qingxingmeng",name: "清醒梦",     value: 1, trigger: "endPhase", desc: "若你本回合扣置打出了这张牌，且未被质疑，则你可以在结束阶段亮出这张牌，然后令一名玩家摸3张牌。" },
    emeng:       { id: "emeng",       name: "噩梦",       value: 1, trigger: "endPhase", desc: "若你本回合扣置打出了这张牌，且未被质疑，则你可以在结束阶段亮出这张牌，然后令除你以外的所有玩家各摸1张牌。" },
    yuzhimeng:   { id: "yuzhimeng",   name: "预知梦",     value: 1, trigger: "endPhase", desc: "若你本回合扣置打出了这张牌，且未被质疑，则你可以在结束阶段亮出这张牌，然后观看任意一名玩家至多5张手牌。" },
    zhuadao:     { id: "zhuadao",     name: "抓到你熬夜了", value: 2, trigger: "reaction", desc: "当你质疑上家成功时，可以直接将这张牌从手牌中打出，使其额外摸2张牌。" },
    bujiao:      { id: "bujiao",      name: "该补觉了",   value: 2, trigger: "reaction", desc: "当你质疑上家成功时，可以直接将这张牌从手牌中打出，然后交给其任意1张手牌。" },
    guanxing:    { id: "guanxing",    name: "观星",       value: 2, trigger: "reaction", desc: "当你质疑上家成功时，可直接将这张牌从手牌中打出，使你在下一个自己的摸牌阶段中的行动变为：观看抽牌堆顶的3张牌，获得其中1张，然后将剩下的牌以任意顺序放回抽牌堆顶端。" },
    yanzhao:     { id: "yanzhao",     name: "蒸汽眼罩",   value: 3, trigger: "challengedSuccess", desc: "若你本回合扣置打出了这张牌，且被质疑成功，则你本次从抽牌堆摸牌时可以少摸2张牌。" },
    keshui:      { id: "keshui",      name: "瞌睡虫",     value: 3, trigger: "challengedFail", desc: "若你本回合扣置打出了这张牌，且被质疑失败，则你可以令下家跳过其下一个回合的出牌阶段。" },
    xiongling:   { id: "xiongling",   name: "午夜凶铃",   value: 3, trigger: "challengedFail", desc: "若你本回合扣置打出了这张牌，且被质疑失败，则你可以令下家的下一个回合的摸牌阶段行动变为：从牌堆顶摸牌，每次点击屏幕摸1张，直到摸到“晚上12点”或手牌达到20张上限为止。（需展示摸到的“晚上12点”或达到20张）" },
    kafei:       { id: "kafei",       name: "咖啡",       value: 4, trigger: "reaction", desc: "当你质疑上家成功时，可以直接将这张牌从手牌中打出，使你跳过下一个自己回合中的摸牌阶段。" },
    runiunai:    { id: "runiunai",    name: "热牛奶",     value: 4, trigger: "reaction", desc: "当你质疑上家成功时，可以直接将这张牌从手牌中打出，使你下一个回合中的“熄灯时间”推迟1小时。" },
    tiqian:      { id: "tiqian",      name: "提前熄灯",   value: 4, trigger: "roundStart", desc: "可在轮次开始阶段确定“熄灯时间”后直接打出本卡牌，使本轮次的“熄灯时间”提前1小时。（无法早于晚上9点）" },
    yanchi:      { id: "yanchi",      name: "延迟熄灯",   value: 5, trigger: "roundStart", desc: "可在轮次开始阶段确定“熄灯时间”后直接打出本卡牌，使本轮次的“熄灯时间”推迟1小时。" },
    xiaojin:     { id: "xiaojin",     name: "宵禁命令",   value: 5, trigger: "roundStart", desc: "可在轮次开始阶段直接打出本卡牌，使本轮内“熬夜”的摸牌惩罚翻倍。" },
    kuanghuan:   { id: "kuanghuan",   name: "狂欢派对",   value: 5, trigger: "roundStart", desc: "可在轮次开始阶段直接打出本卡牌，使本轮内“熬夜”的摸牌惩罚减半。（向上取整）" },
  };

  const SKILLS_BY_VALUE = [
    ["huilongjue", "taohuayuan", "ruang"],
    ["qingxingmeng", "emeng", "yuzhimeng"],
    ["zhuadao", "bujiao", "guanxing"],
    ["yanzhao", "keshui", "xiongling"],
    ["kafei", "runiunai", "tiqian"],
    ["yanchi", "xiaojin", "kuanghuan"],
  ];

  const REACTION_SKILLS = ["zhuadao", "bujiao", "guanxing", "kafei", "runiunai"];
  const ROUND_START_SKILLS = ["tiqian", "yanchi", "xiaojin", "kuanghuan"];
  const END_PHASE_SKILLS = ["huilongjue", "taohuayuan", "ruang", "qingxingmeng", "emeng", "yuzhimeng"];

  const TOTAL_CARDS = 120;
  const PER_VALUE = 20;
  const MAX_ROUNDS = 100;
  const MAX_ACTIONS = 20000;

  /* ------------------------------ 工具函数 ------------------------------ */
  let _uid = 0;
  function uid() {
    _uid += 1;
    return "c" + _uid + "_" + Math.random().toString(36).slice(2, 8);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function buildDeck(rnd) {
    const deck = [];
    for (let v = 0; v < 6; v++) {
      for (let i = 0; i < PER_VALUE - 3; i++) deck.push({ id: uid(), value: v, skill: null });
      for (const sk of SKILLS_BY_VALUE[v]) deck.push({ id: uid(), value: v, skill: sk });
    }
    return shuffle(deck, rnd);
  }

  function choose(n, k) {
    if (k < 0 || n < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
    return r;
  }

  /* ------------------------------ 建局 ------------------------------ */
  /**
   * config: { players: [{name, isAI}], seed?:number }
   */
  function newGame(config) {
    const seed = config.seed == null ? Math.floor(Math.random() * 1e9) : config.seed;
    const rnd = mulberry32(seed);
    const deck = buildDeck(rnd);
    const players = config.players.slice(0, 6).map((p, i) => {
      // AI 随机分配性格，同一性格内也有小幅差异
      let base = null;
      if (p.isAI) {
        base = PERSONALITIES[Math.floor(rnd() * PERSONALITIES.length)];
      }
      return {
        id: i,
        name: p.name || "玩家" + (i + 1),
        isAI: !!p.isAI,
        hand: deck.splice(0, 5),
        alive: true,
        pe: { skipDraw: false, stargaze: false, bell: false, skipPlay: false },
        hotMilk: 0,
        risk: base ? Math.max(0.1, Math.min(0.62, base.risk + (rnd() - 0.5) * 0.06)) : 0.3,
        bluff: base ? base.bluff : 0,
        shed: base ? base.shed : 3,
        xiaojin: base ? base.xiaojin : 0.5,
        kuanghuan: base ? base.kuanghuan : 0.5,
        seenCards: [],
        playedCards: [], // 本回合扣置在场上、属于这名玩家的牌（未被质疑收回）
        lastGain: "开局发牌", // 最近一次获得手牌的来源（用于淘汰弹窗说明）
        // 本局统计（供结算页回顾展示）
        challengeMade: 0, challengeWon: 0, challengeLost: 0, challengedTimes: 0,
        eliminatedRound: null, // 被淘汰时的轮数；null = 未淘汰
      };
    });
    const state = {
      rnd,
      deck,
      discard: [],
      players,
      order: players.map((p) => p.id),
      round: 0,
      revealIdx: Math.floor(rnd() * players.length), // 翻熄灯时间的人，每轮轮换
      playStartIdx: 0, // 出牌顺序的固定起点（一直绕圈，不随轮次变化）
      turn: null,
      decide: null,
      lightsOutBase: null,
      lightsOutCard: null,
      lightsOutTime: null,
      lightsAdjust: 0,
      curfew: false,
      rave: false,
      table: { cards: [] },
      currentPlay: { cards: [], ownerId: null, isEarly: false }, // 当前玩家刚打出的那组牌
      pendingPenalty: 0,
      pendingChallenger: null,
      failSkills: [],
      endSkillPool: { endSkills: [], ruang: null },
      stargazeHold: [],
      huilongjuePending: false,
      roundSkillQueue: [],
      roundSkillIdx: 0,
      lastReveal: null, // 最近一次质疑翻牌的信息（供界面展示）
      challengePopup: null, // 质疑结算的完整结果（供界面弹窗）
      passChallengePopup: null, // 下家未质疑（相信）的信息（供界面弹窗）
      eliminatePopup: null, // 玩家被淘汰的信息（供界面弹窗）
      _challengeCtx: null, // 质疑结算的中间数据
      winner: null,
      actionCount: 0,
      log: [],
      sfx: [], // 最近发生的音效事件（供界面播放）
    };
    // 供 AI 决策使用的便捷函数（绑定到本局 state）
    state.probEarlySleepFn = function (challengerId, N) {
      return probEarlySleep(state, challengerId, N);
    };
    state.nextAliveFn = function (pid) {
      return nextAlive(state, pid);
    };

    state.log.push("牌已洗好，每人发5张手牌。");
    sfxPush(state, { name: "draw", count: 5 }); // 初始 5 张手牌按张数触发摸牌音效
    startRound(state);
    return state;
  }

  /* ------------------------------ 常用查询 ------------------------------ */
  function playerById(state, id) {
    return state.players[id];
  }

  function alivePlayers(state) {
    return state.players.filter((p) => p.alive);
  }

  function nextAlive(state, pid) {
    const idx = state.order.indexOf(pid);
    for (let s = 1; s <= state.order.length; s++) {
      const p = state.players[state.order[(idx + s) % state.order.length]];
      if (p.alive) return p.id;
    }
    return pid;
  }

  function prevAlive(state, pid) {
    const idx = state.order.indexOf(pid);
    for (let s = 1; s <= state.order.length; s++) {
      const p = state.players[state.order[(idx + state.order.length - s) % state.order.length]];
      if (p.alive) return p.id;
    }
    return pid;
  }

  function cardLabel(c) {
    return TIME_NAMES[c.value] + (c.skill ? "·" + SKILLS[c.skill].name : "");
  }

  /** 记录一个音效事件（供界面播放，最多保留最近 8 条） */
  function sfxPush(state, name) {
    if (state.sfx.length < 8) state.sfx.push(name);
  }
  /** 技能发动效果提示（供界面弹 toast） */
  function skillToast(state, owner, skillId, effectText) {
    const sk = SKILLS[skillId];
    sfxPush(state, { name: "skillEffect", text: owner + " 发动【" + sk.name + "】：" + effectText });
  }

  function computeEarly(cards, lightsOutTime) {
    if (lightsOutTime == null) return false;
    const vals = new Set(cards.map((c) => c.value));
    if (vals.size !== 1) return false;
    return vals.values().next().value <= lightsOutTime;
  }

  /* ------------------------------ 抽牌 / 弃牌 ------------------------------ */
  function drawFromDeck(state, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (state.deck.length === 0) {
        if (state.discard.length === 0) break;
        state.deck = shuffle(state.discard, state.rnd);
        state.discard = [];
        state.log.push("抽牌堆用尽，弃牌堆重新洗入抽牌堆。");
      }
      out.push(state.deck.pop());
    }
    if (out.length) sfxPush(state, { name: "draw", count: out.length }); // 每获得1张播放1次摸牌音效
    return out;
  }

  function doDraw1(state, p) {
    const drawn = drawFromDeck(state, 1);
    if (drawn.length) {
      p.hand.push(...drawn);
      p.lastGain = "摸牌阶段抽牌";
    }
    afterHandChanged(state);
  }

  /* ------------------------------ 胜负 / 淘汰 检查 ------------------------------ */
  function afterHandChanged(state) {
    for (const p of state.players) {
      if (!p.alive) continue;
      if (p.hand.length >= 21) {
        p.alive = false;
        p.eliminatedRound = state.round; // 本局统计：被淘汰时的轮数
        state.discard.push(...p.hand);
        state.log.push("💀 " + p.name + " 手牌达到 " + p.hand.length + " 张，被淘汰出局！");
        state.eliminatePopup = { name: p.name, count: p.hand.length, reason: p.lastGain || "摸牌" };
        sfxPush(state, "eliminate");
        p.hand = [];
      }
    }
    const alive = alivePlayers(state);
    if (alive.length === 1) {
      state.winner = alive[0].id;
      return;
    }
    // 回合外手牌为 0 → 立即获胜
    const turnPid = state.turn ? state.turn.pid : null;
    for (const p of alive) {
      if (p.id !== turnPid && p.hand.length === 0) {
        state.winner = p.id;
        return;
      }
    }
  }

  /** 每个处理动作后统一调用：若已分出胜负则终止；若当前回合玩家被淘汰则结束其回合 */
  function finishHandlers(state) {
    if (state.winner != null) {
      state.decide = { kind: "gameover" };
      return true;
    }
    const t = state.turn;
    if (t && !playerById(state, t.pid).alive) {
      endTurn(state);
      return true;
    }
    return false;
  }

  /* ------------------------------ 轮次 ------------------------------ */
  /** 从指定座位起，找第一个存活的玩家 */
  function firstAliveFrom(state, startIdx) {
    const n = state.order.length;
    for (let i = 0; i < n; i++) {
      const pid = state.order[(startIdx + i) % n];
      if (playerById(state, pid).alive) return pid;
    }
    return state.order[startIdx % n];
  }

  function startRound(state) {
    state.round += 1;
    state.revealIdx = (state.revealIdx + 1) % state.order.length; // 翻灯人每轮轮换
    state.curfew = false;
    state.rave = false;
    state.lightsAdjust = 0;
    state.table = { cards: [] };
    state.currentPlay = { cards: [], ownerId: null, isEarly: false };
    state.lightsOutCard = null;
    state.lightsOutBase = null;
    state.lightsOutTime = null;
    // 注意：这里不能清空 lastReveal。若本轮的质疑正好结束了这一轮（质疑者是谁下家=末位玩家），
    // endRound -> startRound 会在这里被同步调用，此时界面还没机会渲染翻牌动画。
    // lastReveal 改在 doPlayCards（下一轮首次出牌）时清空，让翻牌动画有机会播完。

    // 翻熄灯时间的人：每轮轮换（从轮换到的座位起找第一个存活的）
    const revealer = firstAliveFrom(state, state.revealIdx);
    // 出牌顺序的固定起点：从开局定的座位一直绕圈，不随轮次变化
    const firstPid = firstAliveFrom(state, state.playStartIdx);
    state.firstPlayerPid = firstPid;
    state.revealerPid = revealer;

    state.log.push("―――――― 第 " + state.round + " 轮 ――――――");
    // 由轮到的玩家翻开熄灯时间（真人点按 / 电脑自动，界面配合动画）
    state.decide = { kind: "revealLightsOut", pid: revealer };
  }

  function doRevealLightsOut(state) {
    const revealer = state.revealerPid;
    const card = drawFromDeck(state, 1)[0] || null;
    state.lightsOutCard = card;
    state.lightsOutBase = card ? card.value : null;
    recomputeLightsOut(state); // 翻开后立即亮出卡面，技能阶段可再改
    const label = card ? TIME_NAMES[card.value] : "（牌堆已空，本轮无熄灯时间）";
    state.log.push("🌙 " + playerById(state, revealer).name + " 翻开牌堆顶，熄灯时间：" + label);

    // 轮次开始技能阶段：从翻灯人开始按座位顺序（有此类技能的玩家决定是否打出，没有的自动跳过）
    state.roundSkillQueue = [];
    const startIdx = state.order.indexOf(revealer);
    for (let i = 0; i < state.order.length; i++) {
      const pid = state.order[(startIdx + i) % state.order.length];
      if (playerById(state, pid).alive) state.roundSkillQueue.push(pid);
    }
    state.roundSkillIdx = 0;
    setNextRoundSkillDecider(state);
  }

  /** 根据「熄灯底牌 + 提前/延迟调整」实时重算熄灯时间并写回（翻开后即可显示，技能阶段再改动也即时生效） */
  function recomputeLightsOut(state) {
    let t = state.lightsOutBase == null ? null : state.lightsOutBase + state.lightsAdjust;
    if (t != null) t = Math.max(0, Math.min(5, t));
    state.lightsOutTime = t;
  }
  function finalizeLightsOut(state) {
    recomputeLightsOut(state);
    const t = state.lightsOutTime;
    state.log.push("💡 本轮熄灯时间定为：" + (t == null ? "（无）" : TIME_NAMES[t]) +
      (state.curfew ? "，宵禁命令生效（熬夜惩罚翻倍）" : "") +
      (state.rave ? "，狂欢派对生效（熬夜惩罚减半）" : ""));
    beginTurn(state, state.firstPlayerPid);
  }

  function hasRoundStartSkill(state, pid) {
    return state.players[pid].hand.some((c) => c.skill && ROUND_START_SKILLS.includes(c.skill));
  }

  /** 推进到下一个“该决定轮次开始技能”的玩家；没有此类技能的玩家自动跳过 */
  function setNextRoundSkillDecider(state) {
    while (state.roundSkillIdx < state.roundSkillQueue.length) {
      const pid = state.roundSkillQueue[state.roundSkillIdx];
      if (hasRoundStartSkill(state, pid)) {
        state.decide = { kind: "roundStartSkill", pid };
        return;
      }
      state.roundSkillIdx += 1;
    }
    finalizeLightsOut(state);
  }

  function playRoundStartSkill(state, cardId) {
    const pid = state.decide.pid;
    const p = playerById(state, pid);
    const card = p.hand.find((c) => c.id === cardId);
    if (!card || !ROUND_START_SKILLS.includes(card.skill)) return;
    p.hand = p.hand.filter((c) => c.id !== cardId);
    state.discard.push(card);
    state.lastReveal = { cards: [card], isEarly: null, ownerName: p.name, challengerName: null, skill: card.skill };
    const sk = card.skill;
    if (sk === "tiqian") {
      state.lightsAdjust -= 1;
      recomputeLightsOut(state);
      state.log.push(p.name + " 打出【提前熄灯】，熄灯时间提前1小时。");
      sfxPush(state, { name: "roundStartEffect", text: p.name + " 打出【提前熄灯】：本轮熄灯时间提前1小时" });
    } else if (sk === "yanchi") {
      state.lightsAdjust += 1;
      recomputeLightsOut(state);
      state.log.push(p.name + " 打出【延迟熄灯】，熄灯时间推迟1小时。");
      sfxPush(state, { name: "roundStartEffect", text: p.name + " 打出【延迟熄灯】：本轮熄灯时间推迟1小时" });
    } else if (sk === "xiaojin") {
      state.curfew = true;
      state.log.push(p.name + " 打出【宵禁命令】，本轮“熬夜”摸牌惩罚翻倍！");
      sfxPush(state, { name: "roundStartEffect", text: p.name + " 打出【宵禁命令】：本轮“熬夜”摸牌惩罚翻倍" });
    } else if (sk === "kuanghuan") {
      state.rave = true;
      state.log.push(p.name + " 打出【狂欢派对】，本轮“熬夜”摸牌惩罚减半！");
      sfxPush(state, { name: "roundStartEffect", text: p.name + " 打出【狂欢派对】：本轮“熬夜”摸牌惩罚减半" });
    }
    sfxPush(state, "skill");
    afterHandChanged(state);
    if (state.winner != null) return;
    // 若还有轮次开始技能，可继续打；否则自动进入下一位
    if (hasRoundStartSkill(state, pid)) {
      state.decide = { kind: "roundStartSkill", pid };
    } else {
      nextRoundSkillDecider(state);
    }
  }

  function nextRoundSkillDecider(state) {
    state.roundSkillIdx += 1;
    setNextRoundSkillDecider(state);
  }

  /* ------------------------------ 回合流程 ------------------------------ */
  function beginTurn(state, pid, opts) {
    state.turn = { pid, noDraw: !!(opts && opts.noDraw), phase: "draw" };
    state.pendingPenalty = 0;
    state.pendingChallenger = null;
    state.failSkills = [];
    state.endSkillPool = { endSkills: [], ruang: null };
    state.huilongjuePending = false;
    state._challengeCtx = null;
    const p = playerById(state, pid);
    state.log.push("―― " + p.name + " 的回合 ――");
    if (p.alive && p.hand.length === 0) {
      // 理论不会发生，防卡死兜底
      state.winner = pid;
      state.decide = { kind: "gameover" };
      return;
    }
    advanceTurnPhase(state);
  }

  function advanceTurnPhase(state) {
    if (state.winner != null) return;
    const t = state.turn;
    const p = playerById(state, t.pid);
    if (!p.alive) {
      endTurn(state);
      return;
    }

    if (t.phase === "draw") {
      if (t.noDraw) {
        t.noDraw = false;
        state.log.push(p.name + " 因为【回笼觉】获得新回合，本回合不摸牌。");
        t.phase = "play";
        return advanceTurnPhase(state);
      }
      if (p.pe.skipDraw) {
        p.pe.skipDraw = false;
        state.log.push("☕ " + p.name + " 咖啡劲头十足，跳过摸牌阶段。");
        t.phase = "play";
        return advanceTurnPhase(state);
      }
      if (p.pe.bell) {
        p.pe.bell = false;
        doBellDraw(state, p);
        if (state.winner != null) return;
        return;
      }
      if (p.pe.stargaze) {
        p.pe.stargaze = false;
        doStargaze(state, p);
        return;
      }
      doDraw1(state, p);
      if (state.winner != null) return;
      t.phase = "play";
      return advanceTurnPhase(state);
    }

    if (t.phase === "play") {
      if (p.pe.skipPlay) {
        p.pe.skipPlay = false;
        state.log.push("😴 " + p.name + " 被瞌睡虫缠住，跳过出牌阶段。");
        t.phase = "end";
        return advanceTurnPhase(state);
      }
      state.decide = { kind: "play", pid: t.pid };
      return;
    }

    if (t.phase === "end") {
      endTurn(state);
      return;
    }
  }

  function doBellDraw(state, p) {
    state.log.push("🔔 " + p.name + " 被【午夜凶铃】纠缠，点击屏幕开始摸牌：每次摸1张，直到摸到晚上12点或手牌达到20张。");
    state.decide = { kind: "bellDraw", pid: p.id };
  }

  function doBellDrawStep(state, p) {
    const card = drawFromDeck(state, 1)[0];
    if (!card) {
      state.log.push("🔔 " + p.name + " 摸遍牌堆也没找到晚上12点，摸牌结束。");
      if (state.turn) {
        state.turn.phase = "play";
        advanceTurnPhase(state);
      }
      return;
    }
    p.hand.push(card);
    p.lastGain = "被【午夜凶铃】纠缠连续摸牌";
    const reachedTwelve = card.value === 3;
    const reachedLimit = p.hand.length >= 20;
    if (reachedTwelve) {
      state.log.push("🔔 " + p.name + " 被【午夜凶铃】纠缠，摸到晚上12点：" + cardLabel(card) + "，停止摸牌。");
      afterHandChanged(state);
      if (state.winner != null) return;
      state.turn.phase = "play";
      advanceTurnPhase(state);
      return;
    }
    if (reachedLimit) {
      state.log.push("🔔 " + p.name + " 被【午夜凶铃】纠缠，手牌达到上限20张，停止摸牌。");
      afterHandChanged(state);
      if (state.winner != null) return;
      state.turn.phase = "play";
      advanceTurnPhase(state);
      return;
    }
    state.log.push("🔔 " + p.name + " 被【午夜凶铃】纠缠，点击屏幕再摸1张……");
    state.decide = { kind: "bellDraw", pid: p.id };
    afterHandChanged(state);
  }

  function doStargaze(state, p) {
    const top = [];
    for (let i = 0; i < 3; i++) {
      const c = drawFromDeck(state, 1)[0];
      if (c) top.push(c);
    }
    if (top.length === 0) {
      state.log.push(p.name + " 想要【观星】，但牌堆已空。");
      state.turn.phase = "play";
      return advanceTurnPhase(state);
    }
    state.stargazeHold = top;
    state.log.push("🔭 " + p.name + " 使用了【观星】，看到牌堆顶 " + top.length + " 张牌，选择其中1张。");
    state.decide = { kind: "stargaze", pid: p.id, top3: top };
  }

  function doTakeStargaze(state, cardId) {
    const p = playerById(state, state.decide.pid);
    const idx = state.stargazeHold.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const chosen = state.stargazeHold.splice(idx, 1)[0];
    p.hand.push(chosen);
    p.lastGain = "【观星】获得";
    // 其余牌按原顺序放回牌堆顶
    while (state.stargazeHold.length) state.deck.push(state.stargazeHold.pop());
    state.log.push(p.name + " 从观星中获得了 " + cardLabel(chosen));
    afterHandChanged(state);
    if (state.winner != null) return;
    state.turn.phase = "play";
    advanceTurnPhase(state);
  }

  /* ------------------------------ 出牌阶段 ------------------------------ */
  function doPlayCards(state, cardIds) {
    const t = state.turn;
    const p = playerById(state, t.pid);
    if (!cardIds || cardIds.length === 0) return;
    const cards = cardIds
      .map((id) => p.hand.find((c) => c.id === id))
      .filter(Boolean);
    if (cards.length !== cardIds.length) return; // 有牌不在手牌中，忽略
    for (const c of cards) p.hand = p.hand.filter((h) => h.id !== c.id);
    // 当前这组牌 + 累加到场地中央（一轮结束才清空）
    // 热牛奶：只影响打出者自己的这次出牌（熄灯时间 +1），用完即清零
    let personalT = state.lightsOutTime;
    if (p.hotMilk > 0) {
      personalT = personalT == null ? null : Math.min(5, personalT + p.hotMilk);
      p.hotMilk = 0;
    }
    state.currentPlay = {
      cards,
      ownerId: t.pid,
      isEarly: computeEarly(cards, personalT),
    };
    // 新一轮首次出牌时，上一轮的翻牌结果已展示完毕，这里清空供下次质疑翻牌使用
    state.lastReveal = null;
    state.table.cards.push(...cards);
    p.playedCards.push(...cards);
    state.log.push("🂠 " + p.name + " 扣置打出 " + cards.length + " 张牌。");
    sfxPush(state, "playCards");
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    t.phase = "challenge";
    const challenger = nextAlive(state, t.pid);
    state.decide = { kind: "challenge", pid: challenger, N: cards.length, ownerPid: t.pid };
  }

  /* ------------------------------ 质疑阶段 ------------------------------ */
  function doPassChallenge(state) {
    const challenger = playerById(state, state.decide.pid);
    const owner = playerById(state, state.turn.pid);
    state.log.push(challenger.name + " 选择不质疑，相信了 " + owner.name + "。");
    // 下家未质疑：给打出者本人弹窗提示（界面只给 ownerId 对应玩家显示）
    state.passChallengePopup = {
      ownerId: owner.id,
      ownerName: owner.name,
      passerId: challenger.id,
      passerName: challenger.name,
      N: state.currentPlay.cards.length,
      isEarly: state.currentPlay.isEarly,
    };
    const played = state.currentPlay.cards;
    // 桃花源需要本回合扣置打出包含它的 3 张及以上才可触发
    const endSkills = played.filter((c) =>
      c.skill && END_PHASE_SKILLS.includes(c.skill) && c.skill !== "ruang" &&
      (c.skill !== "taohuayuan" || played.length >= 3)
    );
    const ruangCards = owner.hand.filter((c) => c.skill === "ruang");
    // 软糖触发条件：本回合扣置打出过“其它手牌”（非软糖本体）且未被质疑
    const ruang = ruangCards.length && played.some((c) => c.skill !== "ruang") ? ruangCards[0] : null;
    state.endSkillPool = { endSkills, ruang };
    const allowed = endSkills.map((c) => c.id).concat(ruang ? [ruang.id] : []);
    if (allowed.length) {
      state.decide = { kind: "endSkill", pid: owner.id, allowed };
    } else {
      endTurn(state);
    }
  }

  function doChallenge(state) {
    const challenger = playerById(state, state.decide.pid);
    const owner = playerById(state, state.turn.pid);
    const cards = state.currentPlay.cards;
    const N = cards.length;
    // 本局统计：发起质疑 / 被质疑次数
    challenger.challengeMade += 1;
    owner.challengedTimes += 1;
    // 出牌时已按该玩家的个人熄灯时间（含热牛奶）判定了早睡/熬夜，质疑沿用同一结果
    const isEarly = state.currentPlay.isEarly;
    const labels = cards.map(cardLabel).join("，");
    state.pendingChallenger = challenger.id;
    sfxPush(state, "reveal");
    // 把这组牌从场地中央的牌堆里移除（牌随后进某人的手）
    const playIds = new Set(cards.map((c) => c.id));
    state.table.cards = state.table.cards.filter((c) => !playIds.has(c.id));
    owner.playedCards = owner.playedCards.filter((c) => !playIds.has(c.id));
    state.currentPlay = { cards: [], ownerId: null, isEarly: false };

    if (isEarly) {
      // 早睡 → 质疑失败：质疑者拿起出牌 + 再摸等量
      sfxPush(state, "challengeFail");
      state.lastReveal = { cards, isEarly: true, ownerName: owner.name, challengerName: challenger.name };
      state.log.push("🔍 " + challenger.name + " 质疑 " + owner.name + "！翻开：" + labels + " —— 确实是“早睡”，质疑失败！");
      challenger.challengeLost += 1;
      challenger.hand.push(...cards);
      challenger.lastGain = "质疑失败，拿起对方的牌";
      sfxPush(state, { name: "draw", count: cards.length }); // 质疑失败拿起的牌也按张数触发
      const drawn = drawFromDeck(state, N);
      challenger.hand.push(...drawn);
      state.log.push(challenger.name + " 拿起这 " + N + " 张牌，并从牌堆再摸 " + drawn.length + " 张。");
      state._challengeCtx = {
        challengerId: challenger.id, ownerId: owner.id,
        challengerName: challenger.name, ownerName: owner.name,
        isEarly: true, N,
        drawerId: challenger.id, drawerName: challenger.name,
        drawCount: drawn.length,
      };
      afterHandChanged(state);
      if (finishHandlers(state)) return;
      // 出牌者被质疑失败，可发动 瞌睡虫 / 午夜凶铃
      state.failSkills = cards.filter((c) => c.skill === "keshui" || c.skill === "xiongling");
      if (state.failSkills.length) {
        state.decide = { kind: "failSkill", pid: owner.id, allowed: state.failSkills.map((c) => c.id) };
      } else {
        finishChallengeResolution(state);
      }
    } else {
      // 熬夜 → 质疑成功：出牌者拿回牌 + 惩罚摸牌
      sfxPush(state, "challengeSuccess");
      state.lastReveal = { cards, isEarly: false, ownerName: owner.name, challengerName: challenger.name };
      state.log.push("🔍 " + challenger.name + " 质疑 " + owner.name + "！翻开：" + labels + " —— 果然是“熬夜”，质疑成功！");
      challenger.challengeWon += 1;
      owner.hand.push(...cards);
      owner.lastGain = "熬夜被抓，拿回自己的牌";
      sfxPush(state, { name: "draw", count: cards.length }); // 质疑成功拿回的牌也按张数触发
      let penalty = N;
      if (state.rave) penalty = Math.ceil(penalty / 2);
      if (state.curfew) penalty *= 2;
      state.pendingPenalty = penalty;
      state._challengeCtx = {
        challengerId: challenger.id, ownerId: owner.id,
        challengerName: challenger.name, ownerName: owner.name,
        isEarly: false, N,
        drawerId: owner.id, drawerName: owner.name,
        drawCount: 0, // 最终摸牌数在结算时更新
      };
      afterHandChanged(state);
      if (finishHandlers(state)) return;
      const hasYanzhao = cards.some((c) => c.skill === "yanzhao");
      if (hasYanzhao) {
        state.decide = { kind: "yanzhao", pid: owner.id };
      } else {
        startReactions(state, challenger);
      }
    }
  }

  function startReactions(state, challenger) {
    const allowed = REACTION_SKILLS.filter((sk) => challenger.hand.some((c) => c.skill === sk));
    if (allowed.length) {
      state.decide = { kind: "reaction", pid: challenger.id, allowed };
    } else {
      finalizeSuccessPenalty(state);
    }
  }

  function doUseYanzhao(state) {
    const owner = playerById(state, state.turn.pid);
    const card = owner.hand.find((c) => c.skill === "yanzhao");
    if (!card) {
      // 防御：找不到眼罩牌就不减免，直接继续
      startReactions(state, playerById(state, state.pendingChallenger));
      return;
    }
    owner.hand = owner.hand.filter((c) => c.id !== card.id);
    state.discard.push(card);
    state.lastReveal = { cards: [card], isEarly: null, ownerName: owner.name, challengerName: null, skill: card.skill };
    state.pendingPenalty = Math.max(0, state.pendingPenalty - 2);
    state.log.push("😷 " + owner.name + " 亮出【蒸汽眼罩】，本次惩罚摸牌少摸2张。");
    skillToast(state, owner.name, "yanzhao", "本次惩罚摸牌少摸2张");
    sfxPush(state, "skill");
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    startReactions(state, playerById(state, state.pendingChallenger));
  }

  function doSkipYanzhao(state) {
    startReactions(state, playerById(state, state.pendingChallenger));
  }

  function doPlayReaction(state, cardId) {
    const challenger = playerById(state, state.decide.pid);
    const card = challenger.hand.find((c) => c.id === cardId);
    if (!card || !REACTION_SKILLS.includes(card.skill)) {
      // 防御：找不到就跳过反应牌
      startReactions(state, challenger);
      return;
    }
    challenger.hand = challenger.hand.filter((c) => c.id !== cardId);
    state.discard.push(card);
    state.lastReveal = { cards: [card], isEarly: null, ownerName: challenger.name, challengerName: null, skill: card.skill };
    state.log.push("⚡ " + challenger.name + " 打出【" + SKILLS[card.skill].name + "】！");
    switch (card.skill) {
      case "zhuadao":
        state.pendingPenalty += 2;
        state.log.push(playerById(state, state.turn.pid).name + " 被【抓到你熬夜了】，额外再摸2张牌。");
        skillToast(state, challenger.name, "zhuadao", playerById(state, state.turn.pid).name + " 被额外罚摸2张牌");
        break;
      case "bujiao":
        state.decide = { kind: "giveCard", pid: challenger.id };
        skillToast(state, challenger.name, "bujiao", "需交给对方 1 张手牌");
        return; // 需要选择交给对方的牌
      case "guanxing":
        challenger.pe.stargaze = true;
        state.log.push(challenger.name + " 下个摸牌阶段将发动【观星】。");
        skillToast(state, challenger.name, "guanxing", "下个摸牌阶段改为「观星」");
        break;
      case "kafei":
        challenger.pe.skipDraw = true;
        state.log.push(challenger.name + " 下个回合将跳过摸牌阶段（咖啡）。");
        skillToast(state, challenger.name, "kafei", "下个回合将跳过摸牌阶段");
        break;
      case "runiunai":
        challenger.hotMilk += 1;
        state.log.push(challenger.name + " 下个回合所在轮的熄灯时间将推迟1小时（热牛奶）。");
        skillToast(state, challenger.name, "runiunai", "下回合所在轮的熄灯时间推迟1小时");
        break;
    }
    sfxPush(state, "skill");
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    startReactions(state, challenger);
  }

  function doGiveCard(state, cardId) {
    const challenger = playerById(state, state.decide.pid);
    const card = challenger.hand.find((c) => c.id === cardId);
    if (!card) {
      // 防御：找不到就跳过
      startReactions(state, challenger);
      return;
    }
    challenger.hand = challenger.hand.filter((c) => c.id !== cardId);
    const owner = playerById(state, state.turn.pid);
    owner.hand.push(card);
    owner.lastGain = "被【该补觉了】塞牌";
    sfxPush(state, { name: "draw", count: 1 }); // 交给对方的1张牌也触发摸牌音效
    state.log.push("😴 " + challenger.name + " 用【该补觉了】交给了 " + owner.name + " 1张手牌。");
    skillToast(state, challenger.name, "bujiao", "给了 " + owner.name + " 1 张手牌");
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    startReactions(state, challenger);
  }

  function finalizeSuccessPenalty(state) {
    const owner = playerById(state, state.turn.pid);
    const n = state.pendingPenalty;
    const drawn = drawFromDeck(state, n);
    owner.hand.push(...drawn);
    owner.lastGain = "熬夜被抓，罚摸牌";
    state.log.push(owner.name + " 拿回扣置的牌，并从牌堆再摸 " + drawn.length + " 张。");
    if (state._challengeCtx) state._challengeCtx.drawCount = drawn.length;
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    finishChallengeResolution(state);
  }

  function doUseFailSkill(state, cardId) {
    const owner = playerById(state, state.turn.pid);
    const card = state.failSkills.find((c) => c.id === cardId);
    if (!card) {
      // 防御：找不到就结束回合
      endTurn(state);
      return;
    }
    state.failSkills = state.failSkills.filter((c) => c.id !== cardId);
    const nextp = playerById(state, nextAlive(state, owner.id));
    if (card.skill === "keshui") {
      nextp.pe.skipPlay = true;
      state.log.push("😴 " + owner.name + " 发动【瞌睡虫】！" + nextp.name + " 下回合将跳过出牌阶段。");
      skillToast(state, owner.name, "keshui", nextp.name + " 下回合将跳过出牌阶段");
    } else if (card.skill === "xiongling") {
      nextp.pe.bell = true;
      state.log.push("🔔 " + owner.name + " 发动【午夜凶铃】！" + nextp.name + " 下回合将在点击屏幕后每次摸1张，直到摸到晚12或手牌达到20张上限。");
      skillToast(state, owner.name, "xiongling", nextp.name + " 下回合每次点击摸1张，直到摸到晚12或20张上限");
    }
    sfxPush(state, "skill");
    if (state.failSkills.length) {
      state.decide = { kind: "failSkill", pid: owner.id, allowed: state.failSkills.map((c) => c.id) };
    } else {
      finishChallengeResolution(state);
    }
  }

  function doPassFailSkill(state) {
    finishChallengeResolution(state);
  }

  /* ------------------------------ 结束阶段（未被质疑时） ------------------------------ */
  function doUseEndSkill(state, cardId) {
    const owner = playerById(state, state.turn.pid);
    const pool = state.endSkillPool;
    const tableCard = state.currentPlay.cards.find((c) => c.id === cardId);
    const handCard = owner.hand.find((c) => c.id === cardId && c.skill === "ruang");
    const card = tableCard || handCard;
    if (!card) {
      // 防御：找不到这张技能牌就跳过，避免卡死
      continueEndSkills(state, { id: cardId, skill: "yuzhimeng" });
      return;
    }
    const skill = card.skill;
    sfxPush(state, "skill");

    if (skill === "huilongjue") {
      revealSkillCard(state, cardId);
      state.log.push("🌅 " + owner.name + " 亮出【回笼觉】，获得一个不含摸牌阶段的新回合！");
      skillToast(state, owner.name, "huilongjue", "获得一个不含摸牌阶段的新回合");
      state.huilongjuePending = true;
      endTurn(state);
      return;
    }
    if (skill === "taohuayuan") {
      revealSkillCard(state, cardId);
      const nextp = playerById(state, nextAlive(state, owner.id));
      const tmp = owner.hand;
      owner.hand = nextp.hand;
      nextp.hand = tmp;
      state.log.push("🌸 " + owner.name + " 亮出【梦中桃花源】，与 " + nextp.name + " 交换了全部手牌！");
      skillToast(state, owner.name, "taohuayuan", "与 " + nextp.name + " 交换了全部手牌");
      afterHandChanged(state);
      if (finishHandlers(state)) return;
    } else if (skill === "ruang") {
      state.decide = { kind: "softCandy", pid: owner.id, cardId };
      return;
    } else if (skill === "qingxingmeng" || skill === "yuzhimeng") {
      state.decide = { kind: "skillTarget", pid: owner.id, skill, cardId };
      return;
    } else if (skill === "emeng") {
      revealSkillCard(state, cardId);
      let count = 0;
      for (const pl of alivePlayers(state)) {
        if (pl.id === owner.id) continue;
        const d = drawFromDeck(state, 1);
        if (d.length) {
          pl.hand.push(...d);
          pl.lastGain = "被【噩梦】塞牌";
          count++;
        }
      }
      state.log.push("🌌 " + owner.name + " 亮出【噩梦】，其他 " + count + " 名玩家各摸1张牌。");
      skillToast(state, owner.name, "emeng", "其他 " + count + " 名玩家各摸1张牌");
      afterHandChanged(state);
      if (finishHandlers(state)) return;
    }

    continueEndSkills(state, card);
  }

  /** 亮出发动技能：把扣在桌上的技能牌翻面亮出（保留在场上，回合结束时再和其它牌一起弃掉） */
  function revealSkillCard(state, cardId) {
    const cur = state.currentPlay && state.currentPlay.cards;
    const card = (cur && cur.find((c) => c.id === cardId)) || state.table.cards.find((c) => c.id === cardId);
    if (!card) return;
    card.revealed = true;
    const owner = state.currentPlay && state.currentPlay.ownerId != null ? playerById(state, state.currentPlay.ownerId) : null;
    state.lastReveal = {
      cards: [card],
      isEarly: null,
      ownerName: owner ? owner.name : "",
      challengerName: null,
      skill: card.skill,
    };
  }

  function continueEndSkills(state, usedCard) {
    const pool = state.endSkillPool;
    pool.endSkills = pool.endSkills.filter((c) => c.id !== usedCard.id);
    if (usedCard.skill === "ruang") pool.ruang = null;
    const allowed = pool.endSkills.map((c) => c.id).concat(pool.ruang ? [pool.ruang.id] : []);
    if (allowed.length) {
      state.decide = { kind: "endSkill", pid: state.turn.pid, allowed };
    } else {
      endTurn(state);
    }
  }

  function doPickTarget(state, targetPid) {
    const owner = playerById(state, state.turn.pid);
    const skill = state.decide.skill;
    const cardId = state.decide.cardId;
    revealSkillCard(state, cardId);
    const target = playerById(state, targetPid);
    if (skill === "qingxingmeng") {
      const d = drawFromDeck(state, 3);
      target.hand.push(...d);
      target.lastGain = "被【清醒梦】塞牌";
      state.log.push("💤 " + owner.name + " 亮出【清醒梦】！" + target.name + " 摸3张牌。");
      skillToast(state, owner.name, "qingxingmeng", target.name + " 摸3张牌");
      afterHandChanged(state);
      if (finishHandlers(state)) return;
    } else if (skill === "yuzhimeng") {
      const shown = target.hand.slice(0, 5);
      const seenSet = new Set(owner.seenCards.map((c) => c.id));
      const fresh = shown.filter((c) => !seenSet.has(c.id));
      owner.seenCards = owner.seenCards.concat(fresh);
      state.log.push("🔮 " + owner.name + " 亮出【预知梦】，查看了 " + target.name + " 的 " + shown.length + " 张手牌。");
      skillToast(state, owner.name, "yuzhimeng", "查看了 " + target.name + " 的 " + shown.length + " 张手牌");
      state.decide = { kind: "preview", pid: owner.id, targetPid, cards: shown, cardId };
      return;
    }
    continueEndSkills(state, { id: cardId, skill });
  }

  function doPickSoftCandy(state, extraCardId) {
    const cardId = state.decide.cardId;
    if (extraCardId === cardId) return; // 点了软糖原卡牌本身：忽略，保持等待选择（不结束技能）
    const owner = playerById(state, state.turn.pid);
    const extra = owner.hand.find((c) => c.id === extraCardId && c.id !== cardId);
    const ruang = owner.hand.find((c) => c.id === cardId);
    if (!ruang || !extra) {
      // 防御：找不到就跳过软糖
      continueEndSkills(state, { id: cardId, skill: "ruang" });
      return;
    }
    const cardIds = new Set([cardId, extraCardId]);
    owner.hand = owner.hand.filter((c) => !cardIds.has(c.id));
    state.discard.push(ruang, extra);
    state.lastReveal = { cards: [ruang, extra], isEarly: null, ownerName: owner.name, challengerName: null, skill: "ruang" };
    state.log.push("🍬 " + owner.name + " 发动【褪黑素软糖】，弃掉" + cardLabel(ruang) + " 和 " + cardLabel(extra) + "。");
    skillToast(state, owner.name, "ruang", "弃掉 2 张手牌");
    afterHandChanged(state);
    if (finishHandlers(state)) return;
    continueEndSkills(state, { id: cardId, skill: "ruang" });
  }

  /* ------------------------------ 回合结束 ------------------------------ */
  /** 质疑结算完成后：把结果存进 challengePopup（供界面弹窗），再结束回合 */
  function finishChallengeResolution(state) {
    const ctx = state._challengeCtx;
    state._challengeCtx = null;
    if (ctx) {
      state.challengePopup = {
        challengerId: ctx.challengerId,
        ownerId: ctx.ownerId,
        challengerName: ctx.challengerName,
        ownerName: ctx.ownerName,
        isEarly: ctx.isEarly,
        N: ctx.N,
        drawerId: ctx.drawerId,
        drawerName: ctx.drawerName,
        drawCount: ctx.drawCount || 0,
      };
    }
    endTurn(state);
  }

  function endTurn(state) {
    if (state.winner != null) return;
    const t = state.turn;
    if (!t) return;
    const owner = playerById(state, t.pid);

    // 未被质疑的扣置牌：在出牌者回合结束时即进入弃牌堆，清空扣置区域
    const played = state.currentPlay && state.currentPlay.cards;
    if (played && played.length) {
      const ids = new Set(played.map((c) => c.id));
      state.discard.push(...played);
      state.table.cards = state.table.cards.filter((c) => !ids.has(c.id));
      owner.playedCards = owner.playedCards.filter((c) => !ids.has(c.id));
      state.currentPlay = { cards: [], ownerId: null, isEarly: false };
    }

    // 回合结束阶段手牌为 0 → 获胜
    if (owner.alive && owner.hand.length === 0) {
      state.winner = owner.id;
      state.decide = { kind: "gameover" };
      state.log.push("🏆 " + owner.name + " 的手牌清空，第一个睡着了……获胜！");
      return;
    }

    // 回笼觉：额外回合
    if (state.huilongjuePending) {
      state.huilongjuePending = false;
      beginTurn(state, t.pid, { noDraw: true });
      return;
    }

    // 本轮是否结束
    const firstPid = state.firstPlayerPid;
    const lastPid = prevAlive(state, firstPid);
    if (t.pid === lastPid) {
      endRound(state);
    } else {
      beginTurn(state, nextAlive(state, t.pid));
    }
  }

  function endRound(state) {
    if (state.table.cards.length) {
      state.discard.push(...state.table.cards);
    }
    if (state.lightsOutCard) {
      state.discard.push(state.lightsOutCard);
    }
    state.table = { cards: [] };
    state.currentPlay = { cards: [], ownerId: null, isEarly: false };
    state.lightsOutCard = null;
    for (const p of state.players) p.playedCards = [];
    state.log.push("本轮结束，熄灯时间移入弃牌堆。");

    if (state.round >= MAX_ROUNDS) {
      // 兜底：轮数过多时手牌最少者胜
      let best = null;
      for (const p of alivePlayers(state)) {
        if (!best || p.hand.length < best.hand.length) best = p;
      }
      state.winner = best.id;
      state.decide = { kind: "gameover" };
      state.log.push("🏆 轮数已达上限，手牌最少的 " + best.name + " 获胜（兜底规则）。");
      return;
    }
    startRound(state);
  }

  /* ------------------------------ 概率估算（AI 质疑用） ------------------------------ */
  function probEarlySleep(state, challengerId, N) {
    const T = state.lightsOutTime;
    if (T == null || N <= 0) return 0;
    const ch = playerById(state, challengerId);
    // 出牌者当前手牌 + 已打出的N张 = 出牌前的手牌数（可见的）
    const owner = state.turn && state.turn.pid != null ? playerById(state, state.turn.pid) : null;
    const h = owner && owner.alive ? Math.min(20, owner.hand.length + N) : 5;
    const known = {};
    const add = (v) => {
      known[v] = (known[v] || 0) + 1;
    };
    if (state.lightsOutCard) add(state.lightsOutCard.value);
    for (const c of ch.hand) add(c.value);
    for (const c of ch.seenCards || []) add(c.value);
    const knownTotal = Object.keys(known).reduce((a, k) => a + known[k], 0);
    const U = TOTAL_CARDS - knownTotal;
    let p = 0;
    for (let v = 0; v <= T; v++) {
      const cv = PER_VALUE - (known[v] || 0);
      if (cv < N) continue;
      // P(出牌者出牌前手里有 ≥N 张 value v 的牌)——玩家会故意凑同时间的牌组
      const maxK = Math.min(h, cv);
      for (let k = N; k <= maxK; k++) {
        p += (choose(cv, k) * choose(U - cv, h - k)) / choose(U, h);
      }
    }
    return Math.max(0, Math.min(1, p * 0.6)); // 0.6 = 怀疑系数，稍压低对“早睡”的信任
  }

  /* ------------------------------ 对外接口 ------------------------------ */
  function act(state, action) {
    if (!action) return state;
    if (state.winner != null) {
      state.decide = { kind: "gameover" };
      return state;
    }
    state.actionCount += 1;
    if (state.actionCount > MAX_ACTIONS) {
      // 极端兜底：动作过多直接结束
      let best = null;
      for (const p of alivePlayers(state)) {
        if (!best || p.hand.length < best.hand.length) best = p;
      }
      state.winner = best.id;
      state.decide = { kind: "gameover" };
      return state;
    }
    const d = state.decide;
    if (!d || d.kind === "gameover") return state;

    // 进入新的动作处理：清掉上一次质疑翻牌（翻牌动画已在上一轮渲染中播放完），
    // 避免“翻开的牌”一直停留在桌面直到下次出牌。
    state.lastReveal = null;

    switch (d.kind) {
      case "revealLightsOut":
        if (action.type === "revealLightsOut") doRevealLightsOut(state);
        break;
      case "roundStartSkill":
        if (action.type === "playRoundStart") playRoundStartSkill(state, action.cardId);
        else if (action.type === "passRoundStartSkill") nextRoundSkillDecider(state);
        break;
      case "stargaze":
        if (action.type === "takeStargaze") doTakeStargaze(state, action.cardId);
        break;
      case "play":
        if (action.type === "playCards") doPlayCards(state, action.cardIds || []);
        break;
      case "challenge":
        if (action.type === "challenge") doChallenge(state);
        else if (action.type === "passChallenge") doPassChallenge(state);
        break;
      case "yanzhao":
        if (action.type === "useYanzhao") doUseYanzhao(state);
        else if (action.type === "skipYanzhao") doSkipYanzhao(state);
        break;
      case "reaction":
        if (action.type === "playReaction") doPlayReaction(state, action.cardId);
        else if (action.type === "passReaction") finalizeSuccessPenalty(state);
        break;
      case "bellDraw":
        if (action.type === "drawBell") doBellDrawStep(state, playerById(state, d.pid));
        break;
      case "giveCard":
        if (action.type === "giveCard") doGiveCard(state, action.cardId);
        break;
      case "failSkill":
        if (action.type === "useFailSkill") doUseFailSkill(state, action.cardId);
        else if (action.type === "passFailSkill") doPassFailSkill(state);
        break;
      case "endSkill":
        if (action.type === "useEndSkill") doUseEndSkill(state, action.cardId);
        else if (action.type === "passEndSkill") endTurn(state);
        break;
      case "skillTarget":
        if (action.type === "pickTarget") doPickTarget(state, action.pid);
        break;
      case "softCandy":
        if (action.type === "pickSoftCandyCard") doPickSoftCandy(state, action.cardId);
        break;
      case "preview":
        if (action.type === "confirmSeen") {
          const owner = playerById(state, d.pid);
          state.log.push("🔮 " + owner.name + " 确认看完了对方的牌。");
          continueEndSkills(state, { id: d.cardId, skill: "yuzhimeng" });
        }
        break;
      default:
        break;
    }
    return state;
  }

  return {
    newGame,
    act,
    TIME_NAMES,
    TIME_SHORT,
    TIME_ICONS,
    TIME_COLORS,
    SKILLS,
    playerById,
    alivePlayers,
    nextAlive,
    prevAlive,
    computeEarly,
    probEarlySleep,
    cardLabel,
    TOTAL_CARDS,
  };
});
