/* =========================================================================
 * 今天几点睡 —— 背景音乐（多曲轮换播放，曲间交叉淡化）
 * 支持 1~N 首曲子：
 *   - 只有 1 首时：走原生 loop，行为与旧版一致；
 *   - 多首时：播完一首，临近曲尾自动交叉淡化到下一首，轮流循环。
 * 打包进单文件版时，用 window.__BGM_SRC（data URI）覆盖默认曲目列表（仅一首）。
 * ========================================================================= */
(function (root) {
  "use strict";

  // 默认曲目列表（按顺序轮换）。曲子文件放在同目录。bgm0=最初的曲子，bgm/bgm2=后来的替换与新增
  const DEFAULT_SRCS = ["bgm0.mp3", "bgm.mp3", "bgm2.mp3"];
  const SRC = (root.__BGM_SRC != null)
    ? [root.__BGM_SRC]        // 单文件版只注入一首 data URI
    : DEFAULT_SRCS;

  const MAX_LEVEL = 0.9;      // 实际播放音量 = 用户音量 × 0.9，避免过响/削波
  const FADE_IN = 1600;       // 启动淡入时长（ms）
  const FADE_OUT = 700;       // 停止淡出时长（ms）
  const XFADE = 2000;         // 曲间交叉淡化时长（ms）
  const FADE_STEPS = 20;      // 单次渐变的插值步数

  let players = [];           // 每个源一个 <audio>
  let active = -1;            // 当前正在播放的 player 下标
  let volume = 0.5;           // 用户主音量 0..1
  let playing = false;        // 是否处于播放中

  function level() {
    return volume * MAX_LEVEL;
  }

  function setVol(el, v) {
    el.volume = Math.max(0, Math.min(1, v));
  }

  /** 对单个 audio 元素做平滑渐变（每次调用独立计时，可多路并行做交叉淡化） */
  function fadeTo(el, target, duration, done) {
    if (el._fadeTimer) clearInterval(el._fadeTimer);
    const from = el.volume;
    const steps = FADE_STEPS;
    let i = 0;
    el._fadeTimer = setInterval(function () {
      i += 1;
      setVol(el, from + (target - from) * (i / steps));
      if (i >= steps) {
        clearInterval(el._fadeTimer);
        el._fadeTimer = null;
        if (done) done();
      }
    }, duration / steps);
  }

  function ensure() {
    if (players.length) return players;
    if (typeof Audio === "undefined") return players; // Node 等非浏览器环境
    players = SRC.map(function (src) {
      const a = new Audio(src);
      a.preload = "auto";
      // 单曲走原生 loop；多曲由 timeupdate 调度交叉淡化，不靠 ended 循环
      a.loop = SRC.length === 1;
      a.addEventListener("timeupdate", onTimeUpdate);
      a.addEventListener("ended", onEnded);
      try { a.load(); } catch (e) {}
      return a;
    });
    return players;
  }

  /** 交叉淡化：当前曲临近曲尾时，让下一首从头淡入，当前曲淡出 */
  function startCrossfade() {
    const cur = players[active];
    const nextIdx = (active + 1) % players.length;
    const next = players[nextIdx];
    try { next.currentTime = 0; } catch (e) {}
    setVol(next, 0);
    const p = next.play();
    if (p && p.then) p.then(function () {}).catch(function () {});
    fadeTo(next, level(), XFADE);
    fadeTo(cur, 0, XFADE, function () {
      try { cur.pause(); } catch (e) {}
    });
    active = nextIdx;
  }

  function onTimeUpdate() {
    if (!playing || active < 0 || players[active] !== this) return;
    const remain = (this.duration || 0) - this.currentTime;
    if (remain > 0 && remain <= XFADE / 1000) {
      startCrossfade();
    }
  }

  /** 兜底：交叉淡化没触发（后台标签页节流等），曲目自然播完时硬切到下一首 */
  function onEnded() {
    if (!playing || active < 0 || players[active] !== this) return;
    const nextIdx = (active + 1) % players.length;
    const next = players[nextIdx];
    try { next.currentTime = 0; } catch (e) {}
    setVol(next, 0);
    const p = next.play();
    if (p && p.then) p.then(function () {}).catch(function () {});
    fadeTo(next, level(), FADE_IN);
    active = nextIdx;
  }

  function start() {
    ensure();
    if (!players.length) return false;
    if (playing) return true;
    playing = true;
    active = 0;
    // 每次都从第一首开头播起，淡入
    const a = players[0];
    try { a.currentTime = 0; } catch (e) {}
    setVol(a, 0);
    const p = a.play();
    if (p && p.then) {
      p.then(function () { fadeTo(a, level(), FADE_IN); })
        .catch(function () { playing = false; });
    } else {
      fadeTo(a, level(), FADE_IN);
    }
    return true;
  }

  function stop() {
    if (!playing) return;
    playing = false;
    // 全部淡出并暂停，避免交叉淡化进行到一半时留下残留声音
    players.forEach(function (a) {
      fadeTo(a, 0, FADE_OUT, function () {
        try { a.pause(); } catch (e) {}
        try { a.currentTime = 0; } catch (e) {}
      });
    });
    active = -1;
  }

  function toggle() {
    if (playing) stop();
    else start();
    return playing;
  }

  /** 手动切歌：未播放时开始播放，播放中立即交叉淡化到下一首 */
  function next() {
    ensure();
    if (!players.length) return false;
    if (!playing) { start(); return true; }
    startCrossfade();
    return true;
  }

  function isOn() {
    return playing;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    players.forEach(function (a) {
      a.muted = false;
      if (volume <= 0) setVol(a, 0); // 主音量为 0 时直接归零
    });
    if (playing && active >= 0 && players[active]) {
      fadeTo(players[active], level(), 200);
    }
  }

  root.BGM = { toggle, start, stop, next, isOn, setVolume };
})(typeof self !== "undefined" ? self : this);
