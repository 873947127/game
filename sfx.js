/* =========================================================================
 * 今天几点睡 —— 游戏音效（Web Audio 实时合成）
 * Apple 风格：圆润、清透，像气泡“咕嘟”和水滴“叮咚”
 * ========================================================================= */
(function (root) {
  "use strict";

  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let volume = 0.6;
  let drawAudio = null;
  let playAudio = null;
  let hoverAudio = null;
  let selectAudio = null;

  // 摸牌/出牌/悬停/选中 使用外置 MP3（单文件版会注入 base64 data URI，多文件版读取同目录文件）
  const DRAW_SRC = root.__DRAW_SRC != null ? root.__DRAW_SRC : "draw.mp3";
  const PLAY_SRC = root.__PLAY_SRC != null ? root.__PLAY_SRC : "play.mp3";
  const HOVER_SRC = root.__HOVER_SRC != null ? root.__HOVER_SRC : "hover.mp3";
  const SELECT_SRC = root.__SELECT_SRC != null ? root.__SELECT_SRC : "select.mp3";

  function getAudio(src) {
    if (typeof Audio === "undefined") return null;
    try {
      const a = new Audio(src);
      a.preload = "auto";
      return a;
    } catch (e) {
      return null;
    }
  }

  function playMp3(el) {
    if (!el) return;
    el.currentTime = 0;
    const p = el.play();
    if (p && p.catch) p.catch(function () {});
  }

  function ensure() {
    if (ctx) return true;
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    return true;
  }

  function unlock() {
    if (!ensure()) return false;
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  function getNoise() {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function now() {
    return ctx.currentTime + 0.01;
  }

  /** 圆润的气泡：正弦 + 短促平滑起音 + 指数衰减 + 低通，像“咕嘟” */
  function blub(freq, t, dur, amp, endFreq) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 3200;
    osc.connect(g);
    g.connect(f);
    f.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** 清澈的水滴：高音正弦 + 轻微下滑 + 快速圆润衰减，像“叮咚” */
  function plink(freq, t, dur, amp) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.linearRampToValueAtTime(freq * 0.985, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 4800;
    osc.connect(g);
    g.connect(f);
    f.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  /** 轻柔的水声（滤波噪声） */
  function water(t, dur, amp) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoise();
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(2200, t);
    f.frequency.linearRampToValueAtTime(800, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  /** 温暖明亮的拨弦音（类似竖琴）：三角波 + 明亮泛音，快速起音长衰减 */
  function pluck(freq, t, dur, amp) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = freq;
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = freq * 2.0;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(amp * 0.35, t + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.7);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 3500;
    osc.connect(g);
    g.connect(f);
    osc2.connect(g2);
    g2.connect(f);
    f.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    osc2.start(t);
    osc2.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    // 按钮：圆润的小气泡“啵”
    click() { blub(520, now(), 0.09, 0.09, 250); },
    // 质疑翻牌：气泡缓缓上升（上扫）
    reveal() { blub(300, now(), 0.38, 0.1, 950); },
    // 质疑成功：两滴清澈上扬的水滴
    challengeSuccess() { plink(1046, now(), 0.16, 0.1); plink(1568, now() + 0.1, 0.2, 0.09); },
    // 质疑失败：两下沉闷下滑的气泡
    challengeFail() { blub(400, now(), 0.2, 0.08, 210); blub(290, now() + 0.13, 0.24, 0.07, 150); },
    // 技能发动：一串水珠轻响
    skill() { [1046, 1318, 1568].forEach((f, i) => plink(f, now() + i * 0.07, 0.2, 0.07)); },
    // 淘汰：低沉的气泡沉入水底
    eliminate() { blub(270, now(), 0.4, 0.09, 110); },
    // 获胜：上扬的水滴琶音
    win() { [783, 1046, 1318, 1568].forEach((f, i) => plink(f, now() + i * 0.11, 0.35, 0.1)); },
    // 换手牌：水波一荡 + 一声气泡
    swap() { water(now(), 0.16, 0.06); blub(500, now() + 0.03, 0.12, 0.05, 290); },
  };

  function play(name) {
    if (name === "draw") {
      if (!drawAudio) drawAudio = getAudio(DRAW_SRC);
      if (drawAudio) { playMp3(drawAudio); return; }
    }
    if (name === "playCards") {
      if (!playAudio) playAudio = getAudio(PLAY_SRC);
      if (playAudio) { playMp3(playAudio); return; }
    }
    if (name === "hover") {
      if (!hoverAudio) hoverAudio = getAudio(HOVER_SRC);
      if (hoverAudio) { playMp3(hoverAudio); return; }
    }
    if (name === "select") {
      if (!selectAudio) selectAudio = getAudio(SELECT_SRC);
      if (selectAudio) { playMp3(selectAudio); return; }
    }
    if (!ensure()) return;
    if (ctx.state === "suspended") ctx.resume();
    const fn = SOUNDS[name];
    if (fn) fn();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (ctx && master) master.gain.value = volume;
  }

  root.SFX = { play, unlock, setVolume };
})(typeof self !== "undefined" ? self : this);
