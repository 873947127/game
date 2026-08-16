/* =========================================================================
 * 今天几点睡 —— 表情系统（联机模式通用）
 * 手牌区左侧的「表情」按钮 → 弹出表情面板 → 点选一个表情发送
 * 气泡从发送者的座位上方冒出来，所有玩家同时看到
 * 由 net.js / p2p.js 各自动初始化，注入：
 *   - sendEmoji(emoji)  真正把表情发出去（WebSocket / 数据通道）
 *   - seatEl(pid)       座位对应的 DOM 元素（气泡定位锚点）；自己 → player-area
 *   - myPid()           我的座位号（用于把「自己」的气泡排在正确座位）
 * ========================================================================= */
(function () {
  "use strict";

  const EMOJIS = ["😀", "😂", "😅", "🥲", "😭", "😤", "😡", "🥺", "🤯", "😴", "🤔", "😜", "👍", "👏", "🎉", "🌙"];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function createEmojiSystem(opts) {
    const playerArea = document.querySelector(".player-area");
    if (!playerArea) return { showEmoji: () => {} };
    const hand = document.getElementById("hand");

    /* ---------- 表情按钮（玩家栏最左侧，不占手牌空间） ---------- */
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "emojiBtn";
    btn.className = "emoji-trigger";
    btn.title = "发送表情";
    btn.setAttribute("aria-label", "发送表情");
    btn.textContent = "😀";
    const playerBar = playerArea.querySelector("#playerBar");
    if (playerBar) playerArea.insertBefore(btn, playerBar);
    else if (hand) playerArea.insertBefore(btn, hand);
    else playerArea.appendChild(btn);

    /* ---------- 表情面板（锚定按钮，从按钮上方弹出） ---------- */
    const panel = document.createElement("div");
    panel.className = "emoji-panel hidden";
    for (const e of EMOJIS) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "emoji-cell";
      cell.textContent = e;
      cell.setAttribute("aria-label", "发送 " + e);
      cell.addEventListener("click", (ev) => {
        ev.stopPropagation(); // 不冒泡到按钮（否则面板会重新打开）
        opts.sendEmoji(e);
        close();
      });
      panel.appendChild(cell);
    }
    btn.appendChild(panel);

    function close() { panel.classList.add("hidden"); }
    function open() { panel.classList.remove("hidden"); }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel.classList.contains("hidden")) open();
      else close();
    });
    // 点击按钮/面板以外的任意处关闭
    document.addEventListener("click", (e) => {
      if (btn.contains(e.target) || panel.contains(e.target)) return;
      close();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    /* ---------- 表情气泡：从发送者座位冒出，带聊天气泡框 ---------- */
    function showEmoji(pid, emoji, name) {
      const glyph = EMOJIS.indexOf(emoji) >= 0 ? emoji : "😀";
      const mine = pid === opts.myPid();
      const bubble = document.createElement("div");
      bubble.className = "emoji-bubble" + (mine ? " mine" : "");
      bubble.innerHTML =
        '<div class="eb-bubble">' +
        '<span class="eb-emoji">' + glyph + "</span>" +
        (!mine && name ? '<span class="eb-name">' + esc(name) + "</span>" : "") +
        "</div>";
      document.body.appendChild(bubble);

      const anchor = opts.seatEl ? opts.seatEl(pid) : null;
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        bubble.style.left = (r.left + r.width / 2).toFixed(1) + "px";
        bubble.style.top = (r.top - 10).toFixed(1) + "px";
      } else {
        bubble.style.left = "50%";
        bubble.style.top = "30%";
      }

      // 出现动画（emojiIn）结束后 → 切到消失动画（emojiOut）；消失结束 → 移除
      let removed = false;
      const remove = () => { if (!removed) { removed = true; if (bubble.parentNode) bubble.remove(); } };
      bubble.addEventListener("animationend", (e) => {
        if (e.animationName === "emojiIn") bubble.classList.add("exiting");
        else if (e.animationName === "emojiOut") remove();
      });
      setTimeout(remove, 3000); // 兜底：减少动效时动画不播放，靠它消失
      return bubble;
    }

    return { showEmoji, open, close };
  }

  window.EmojiChat = { create: createEmojiSystem };
})();
