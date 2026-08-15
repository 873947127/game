/* =========================================================================
 * 今天几点睡 —— 月亮按钮：点击切换月相（满月 → 月牙 → 满月循环）+ 玉碎音效
 * 依赖 style.css 的 .moon-btn / .moon-svg、SVG 里的 #moonPath 与 sfx.js 的
 * SFX.play("moon")（播放同目录 moon.mp3）。月牙形状是「圆月减去偏移的阴影圆」，用 SVG 弧线拼成。
 * ========================================================================= */
(function (root) {
  "use strict";

  // 月相阴影位移（px）。正值 = 阴影在右（亏），负值 = 阴影在左（盈）；
  // 绝对值越大月面越满，0 为新月。初始为满月（128）。
  const SHIFTS = [128, 90, 55, 22, -22, -55, -90, -112];
  let idx = 0;

  const R = 64;   // 月亮半径
  const C = 112;  // 月亮圆心（224×224 viewBox 正中，四周留 48px 给光晕）

  // 生成月相 SVG path 的 d 字符串
  function moonD(s) {
    if (s >= 127) {
      // 满月：两个半圆弧拼成一个整圆
      return `M ${C} ${C - R} A ${R} ${R} 0 1 0 ${C} ${C + R} A ${R} ${R} 0 1 0 ${C} ${C - R} Z`;
    }
    const m = Math.abs(s);
    const xInt = C + s / 2;                          // 两圆交点 x（阴影一侧，符号决定左右）
    const h = Math.sqrt(R * R - (m / 2) * (m / 2));  // 交点到圆心水平线的高度
    const topY = C - h, botY = C + h;
    const f = (n) => n.toFixed(2);
    if (s > 0) {
      // 阴影在右，亮面在左（亏）
      return `M ${f(xInt)} ${f(topY)} A ${R} ${R} 0 1 0 ${f(xInt)} ${f(botY)} A ${R} ${R} 0 0 1 ${f(xInt)} ${f(topY)} Z`;
    }
    // 阴影在左，亮面在右（盈）
    return `M ${f(xInt)} ${f(topY)} A ${R} ${R} 0 1 1 ${f(xInt)} ${f(botY)} A ${R} ${R} 0 0 0 ${f(xInt)} ${f(topY)} Z`;
  }

  function apply(pathEl, i) {
    pathEl.setAttribute("d", moonD(SHIFTS[i]));
  }

  function init() {
    const btn = document.getElementById("moonBtn");
    const pathEl = document.getElementById("moonPath");
    if (!btn || !pathEl) return;
    apply(pathEl, idx);
    btn.addEventListener("click", function () {
      idx = (idx + 1) % SHIFTS.length;
      apply(pathEl, idx);
      if (root.SFX) root.SFX.play("moon");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof self !== "undefined" ? self : this);
