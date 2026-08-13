/* =========================================================================
 * 今天几点睡 —— 背景音乐（播放外置 MP3 文件，循环）
 * 优先使用打包进单文件版的 window.__BGM_SRC（data URI），否则读取同目录的 mp3
 * ========================================================================= */
(function (root) {
  "use strict";

  let audio = null;
  let playing = false;
  let volume = 0.5;
  let fadeTimer = null;

  const SRC = root.__BGM_SRC != null
    ? root.__BGM_SRC
    : "bgm.mp3";

  function ensure() {
    if (audio) return true;
    if (typeof Audio === "undefined") return false; // Node 等非浏览器环境
    try {
      audio = new Audio(SRC);
      audio.loop = true; // 循环播放
      audio.preload = "auto";
    } catch (e) {
      return false;
    }
    return true;
  }

  function setVol(v) {
    if (audio) audio.volume = Math.max(0, Math.min(1, v));
  }

  /** 音量渐变（平滑淡入/淡出） */
  function fadeTo(target, duration, done) {
    if (fadeTimer) clearInterval(fadeTimer);
    if (!audio) {
      if (done) done();
      return;
    }
    const from = audio.volume;
    const steps = 20;
    let i = 0;
    fadeTimer = setInterval(function () {
      i += 1;
      setVol(from + (target - from) * (i / steps));
      if (i >= steps) {
        clearInterval(fadeTimer);
        fadeTimer = null;
        if (done) done();
      }
    }, duration / steps);
  }

  function start() {
    if (!ensure()) return false;
    if (playing) return true;
    setVol(0);
    const p = audio.play();
    playing = true;
    if (p && p.then) {
      p.then(function () { fadeTo(volume * 0.9, 1600); })
        .catch(function () { playing = false; });
    } else {
      fadeTo(volume * 0.9, 1600);
    }
    return true;
  }

  function stop() {
    if (!audio || !playing) return;
    playing = false;
    fadeTo(0, 700, function () {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }

  function toggle() {
    if (playing) stop();
    else start();
    return playing;
  }

  function isOn() {
    return playing;
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (playing) fadeTo(volume * 0.9, 200);
  }

  root.BGM = { toggle, start, stop, isOn, setVolume };
})(typeof self !== "undefined" ? self : this);
