/* =========================================================================
 * 今天几点睡 —— 电脑AI决策
 * 根据当前需要决策的节点，返回一个动作对象交给 engine.act 执行。
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SleepAI = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function aiAct(state) {
    const d = state.decide;
    if (!d) return null;
    switch (d.kind) {
      case "revealLightsOut": return { type: "revealLightsOut" };
      case "roundStartSkill": return aiRoundStart(state, d.pid);
      case "stargaze": return aiStargaze(state, d);
      case "play": return aiPlay(state, d.pid);
      case "challenge": return aiChallenge(state, d);
      case "yanzhao": return { type: "useYanzhao" };
      case "reaction": return aiReaction(state, d);
      case "bellDraw": return { type: "drawBell" };
      case "giveCard": return aiGiveCard(state, d.pid);
      case "failSkill": return aiFailSkill(state, d);
      case "endSkill": return aiEndSkill(state, d);
      case "skillTarget": return aiSkillTarget(state, d.pid);
      case "softCandy": return aiSoftCandy(state, d.pid);
      case "preview": return { type: "confirmSeen" };
      default: return null;
    }
  }

  /* ---------- 轮次开始技能 ---------- */
  function aiRoundStart(state, pid) {
    const p = state.players[pid];
    const t = state.lightsOutBase == null ? null : state.lightsOutBase + state.lightsAdjust;
    const cards = p.hand.filter((c) => c.skill && ["tiqian", "yanchi", "xiaojin", "kuanghuan"].includes(c.skill));
    if (!cards.length) return { type: "passRoundStartSkill" };

    for (const card of cards) {
      const sk = card.skill;
      if (sk === "tiqian" && t != null && t > 0) {
        // 提前熄灯能让手里更早的牌变成“早睡”，且不影响当前时间点的早睡组
        const below = p.hand.filter((c) => c.value <= t - 1).length;
        const atT = p.hand.filter((c) => c.value === t).length;
        if (below > 0 && atT <= 1) return { type: "playRoundStart", cardId: card.id };
      } else if (sk === "yanchi" && t != null && t < 5) {
        // 自己几乎没有早睡牌 → 延迟熄灯对别人的伤害更大
        if (p.hand.filter((c) => c.value <= t).length <= 1) return { type: "playRoundStart", cardId: card.id };
      } else if (sk === "xiaojin") {
        // 激进型爱用宵禁坑熬夜的人，稳重型少用
        if (p.hand.length <= 9 && Math.random() < (p.xiaojin != null ? p.xiaojin : 0.5)) return { type: "playRoundStart", cardId: card.id };
      } else if (sk === "kuanghuan") {
        // 稳重/保守型爱用狂欢保命，激进型少用
        if (p.hand.length >= 8 && Math.random() < (p.kuanghuan != null ? p.kuanghuan : 0.5)) return { type: "playRoundStart", cardId: card.id };
      }
    }
    return { type: "passRoundStartSkill" };
  }

  /* ---------- 观星：选一张最好的牌 ---------- */
  function aiStargaze(state, d) {
    let best = null;
    let bestScore = -1;
    for (const c of d.top3) {
      let s = c.skill ? 50 : 0;
      s += 5 - c.value; // 越早越好
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return { type: "takeStargaze", cardId: best.id };
  }

  /* 这些技能保留在手里更有价值（质疑成功才用 / 轮次开始才用 / 软糖需留在手中），别扣置浪费 */
  const KEEP_SKILLS = ["zhuadao", "bujiao", "guanxing", "kafei", "runiunai", "tiqian", "yanchi", "xiaojin", "kuanghuan", "ruang"];

  /* ---------- 出牌 ---------- */
  function aiPlay(state, pid) {
    const p = state.players[pid];
    const T = state.lightsOutTime;
    const hand = p.hand;
    const hs = hand.length;

    // 出牌数量：手牌少冲获胜全出；否则按性格（激进多出、稳重少出）
    const target = hs <= 4 ? hs : Math.max(2, p.shed || 3);

    const normal = hand.filter((c) => !(c.skill && KEEP_SKILLS.includes(c.skill)));

    function bestGroup(cards) {
      const groups = {};
      for (const c of cards) (groups[c.value] = groups[c.value] || []).push(c);
      if (T == null) return null;
      let bestV = -1, bestN = 0;
      for (let v = 0; v <= T; v++) {
        if (groups[v] && groups[v].length > bestN) {
          bestN = groups[v].length;
          bestV = v;
        }
      }
      return bestV >= 0 ? groups[bestV] : null;
    }

    // 优先用普通牌早睡；没有的话再动用保留技能牌（总比唬人强）
    let group = bestGroup(normal);
    let usedKeep = false;
    if (!group) {
      group = bestGroup(hand);
      usedKeep = true;
    }

    if (group) {
      // 爱唬人的性格：明明能早睡，偏要打熬夜牌骗人（接近获胜时除外）
      if (hs > 4 && (p.bluff || 0) > 0 && Math.random() < p.bluff) {
        return bluffCards(state, p);
      }
      let pick = group;
      if (!usedKeep) {
        const normals = group.filter((c) => !(c.skill && KEEP_SKILLS.includes(c.skill)));
        pick = normals.length ? normals : group;
      }
      const n = Math.min(target, pick.length);
      return { type: "playCards", cardIds: pick.slice(0, n).map((c) => c.id) };
    }

    // 没有早睡牌 → 只能唬人：出 1~2 张最接近熄灯时间的牌（性格激进出2张、稳重出1张）
    const byVal = hand.slice().sort((a, b) => a.value - b.value);
    const src = byVal.filter((c) => !(c.skill && KEEP_SKILLS.includes(c.skill)));
    const pool = src.length ? src : byVal;
    const n = Math.min((p.bluff || 0) > 0.15 ? 2 : 1, pool.length);
    return { type: "playCards", cardIds: pool.slice(0, n).map((c) => c.id) };
  }

  /** 唬人：打出两张不同时间的牌（=熬夜），让人误以为在早睡 */
  function bluffCards(state, p) {
    const groups = {};
    for (const c of p.hand) (groups[c.value] = groups[c.value] || []).push(c);
    const vals = Object.keys(groups).map(Number).sort((a, b) => a - b);
    const pick = [];
    if (vals.length >= 2) {
      pick.push(groups[vals[0]][0]);
      pick.push(groups[vals[1]][0]);
    } else if (vals.length === 1) {
      pick.push(groups[vals[0]][0]);
    }
    return { type: "playCards", cardIds: pick.map((c) => c.id) };
  }

  /* ---------- 质疑 ---------- */
  function aiChallenge(state, d) {
    const p = state.players[d.pid];
    const owner = state.players[d.ownerPid];
    // 对方打出了最后的手牌（打完手牌已为0）→ 必定质疑
    if (owner && owner.alive && owner.hand.length === 0) return { type: "challenge" };
    // 自己手牌太多（接近淘汰）→ 绝不冒险质疑收牌
    if (p.hand.length >= 17) return { type: "passChallenge" };
    const prob = state.probEarlySleepFn ? state.probEarlySleepFn(d.pid, d.N) : 0.5;
    // 手牌偏多时更谨慎（质疑失败要收牌，容易把自己拖向淘汰）
    const handFactor = p.hand.length > 13 ? -0.06 : 0;
    if (prob < p.risk + handFactor) return { type: "challenge" };
    return { type: "passChallenge" };
  }

  /* ---------- 质疑成功后的反应牌（11点/凌晨1点）：打出即削减手牌，尽量用掉 ---------- */
  function aiReaction(state, d) {
    const p = state.players[d.pid];
    const order = ["zhuadao", "guanxing", "bujiao", "kafei", "runiunai"];
    for (const sk of order) {
      if (!d.allowed.includes(sk)) continue;
      const card = p.hand.find((c) => c.skill === sk);
      if (!card) continue;
      if (sk === "bujiao" && p.hand.length < 2) continue; // 该补觉了至少要留一张牌可给对方
      return { type: "playReaction", cardId: card.id };
    }
    return { type: "passReaction" };
  }

  /* ---------- 该补觉了：给对方一张最没用的牌（高价值的晚牌） ---------- */
  function aiGiveCard(state, pid) {
    const p = state.players[pid];
    const normals = p.hand.filter((c) => !c.skill);
    const src = normals.length ? normals : p.hand;
    const card = src.reduce((a, b) => (a.value >= b.value ? a : b));
    return { type: "giveCard", cardId: card.id };
  }

  /* ---------- 被质疑失败后的技能（瞌睡虫/午夜凶铃） ---------- */
  function aiFailSkill(state, d) {
    const pool = state.failSkills;
    for (const sk of ["keshui", "xiongling"]) {
      const card = pool.find((c) => c.skill === sk);
      if (card && (sk === "keshui" || Math.random() < 0.6)) {
        return { type: "useFailSkill", cardId: card.id };
      }
    }
    return { type: "passFailSkill" };
  }

  /* ---------- 结束阶段技能（未被质疑时） ---------- */
  function aiEndSkill(state, d) {
    const p = state.players[d.pid];
    const pool = state.endSkillPool;
    const bySkill = {};
    for (const c of pool.endSkills.concat(pool.ruang ? [pool.ruang] : [])) bySkill[c.skill] = c.id;

    let order = ["emeng", "qingxingmeng", "huilongjue", "ruang", "yuzhimeng", "taohuayuan"];
    // 手牌很少（接近获胜）→ 回笼觉优先，多一个回合冲向胜利
    if (p.hand.length <= 3 && bySkill.huilongjue) {
      order = ["huilongjue", ...order.filter((s) => s !== "huilongjue")];
    }
    for (const sk of order) {
      if (!bySkill[sk]) continue;
      if (sk === "taohuayuan") {
        const next = state.players[state.nextAliveFn ? state.nextAliveFn(p.id) : (p.id + 1) % state.players.length];
        if (next.hand.length >= p.hand.length) continue; // 只有换到更少手牌才换
      }
      if (sk === "ruang" && p.hand.length < 2) continue;
      return { type: "useEndSkill", cardId: bySkill[sk] };
    }
    return { type: "passEndSkill" };
  }

  /* ---------- 选目标（清醒梦/预知梦）：打手牌最少（最接近获胜）的人 ---------- */
  function aiSkillTarget(state, pid) {
    const p = state.players[pid];
    let best = null;
    for (const pl of state.players) {
      if (!pl.alive || pl.id === pid) continue;
      if (!best || pl.hand.length < best.hand.length) best = pl;
    }
    if (!best) return { type: "pickTarget", pid: pid };
    return { type: "pickTarget", pid: best.id };
  }

  /* ---------- 褪黑素软糖：再弃一张最没用的牌 ---------- */
  function aiSoftCandy(state, pid) {
    const p = state.players[pid];
    const normals = p.hand.filter((c) => !c.skill);
    const src = normals.length ? normals : p.hand;
    const card = src.reduce((a, b) => (a.value >= b.value ? a : b));
    return { type: "pickSoftCandyCard", cardId: card.id };
  }

  return { aiAct };
});
