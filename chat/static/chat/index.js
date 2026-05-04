const chatRoot     = document.getElementById("chat-root");
const currentUser  = chatRoot.dataset.username;
const currentRoom  = chatRoot.dataset.roomSlug;
const messagesEl   = document.getElementById("messages");
const innerEl      = document.getElementById("messages-inner");
const headerStatus = document.getElementById("header-status");
const messageInput = document.getElementById("message");
const sendBtn      = document.getElementById("send");

/* ─── Reply state ─── */
let replyTo = null;

/* ─── Typing indicator ─── */
let typingInterval = null;
let lastTypingSent = 0;
const TYPING_INTERVAL_MS = 400;
const TYPING_TIMEOUT_MS = 3000; // сколько держать индикатор после последнего нажатия

/* ─── Escape HTML ─── */
function esc(text) {
  const m = { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" };
  return String(text).replace(/[&<>"']/g, c => m[c]);
}

/* ─── Toast notification ─── */
let _toastTimer = null;
function showToast(text) {
  const old = document.getElementById('tg-toast');
  if (old) old.remove();
  if (_toastTimer) clearTimeout(_toastTimer);

  const el = document.createElement('div');
  el.id = 'tg-toast';
  el.className = 'toast';
  el.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="9 12 11 14 15 10"/>
    </svg>
    ${esc(text)}`;
  document.body.appendChild(el);

  _toastTimer = setTimeout(() => {
    el.classList.add('toast-hide');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2200);
}

/* ─── Time formatting ─── */
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit" });
  } catch { return iso; }
}

function fmtDay(iso) {
  try {
    const d   = new Date(iso);
    const now = new Date();
    const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((today - msgDay) / 86_400_000);
    if (diffDays === 0) return "Сегодня";
    if (diffDays === 1) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day:"numeric", month:"long" });
  } catch { return ""; }
}

/* ─── Ticks ─── */
const TICK_SENT = `<svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 5l3.2 3.2L11 1.5" stroke="#a0acb5" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const TICK_READ = `<svg viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 5l3.2 3.2L11 1.5"  stroke="#3390ec" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 5l3.2 3.2L15 1.5" stroke="#3390ec" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function tickHTML(isRead) {
  return `<span class="bubble-tick ${isRead ? 'tick-read' : 'tick-sent'}">${isRead ? TICK_READ : TICK_SENT}</span>`;
}

/* ─── Day badge ─── */
let lastDayLabel = "";

function ensureDayBadge(iso) {
  const label = fmtDay(iso);
  if (!label || label === lastDayLabel) return;
  lastDayLabel = label;
  const el = document.createElement("div");
  el.className = "day-badge";
  el.textContent = label;
  innerEl.appendChild(el);
}

/* ─── Reply quote ─── */
function buildReplyQuoteHTML(replyData) {
  if (!replyData) return '';
  const truncated = replyData.message.length > 80
    ? replyData.message.slice(0, 80) + '…'
    : replyData.message;
  return `
    <div class="reply-quote" data-reply-id="${esc(String(replyData.id))}">
      <span class="reply-quote-author">${esc(replyData.username)}</span>
      <span class="reply-quote-text">${esc(truncated)}</span>
    </div>`;
}

/* ─── Render message ─── */
function appendMessage(data) {
  const isMine = data.username === currentUser;
  ensureDayBadge(data.created_at);

  const row = document.createElement("div");
  row.className = `msg-row ${isMine ? "out" : "in"}`;
  row.dataset.msgId       = data.id;
  row.dataset.msgUsername = data.username;
  row.dataset.msgText     = data.message;

  row.innerHTML = `
    <div class="bubble-wrap">
      <div class="bubble">
        ${!isMine ? `<span class="bubble-sender">${esc(data.username)}</span>` : ""}
        ${buildReplyQuoteHTML(data.reply_to)}
        ${esc(data.message)}
        <div class="bubble-meta">
          <span class="bubble-time">${esc(fmtTime(data.created_at))}</span>
          ${isMine ? tickHTML(data.is_read) : ""}
        </div>
      </div>
    </div>`;

  const quote = row.querySelector('.reply-quote');
  if (quote) {
    quote.addEventListener('click', () => {
      const targetId = quote.dataset.replyId;
      const target = innerEl.querySelector(`[data-msg-id="${targetId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = target.querySelector('.bubble');
        bubble.style.transition = 'background .2s';
        bubble.style.filter = 'brightness(0.88)';
        setTimeout(() => bubble.style.filter = '', 700);
      }
    });
  }

  innerEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ─── Update sidebar preview ─── */
function updateRoomPreview(message, created_at) {
  const prev = document.querySelector(`.room-preview[data-slug="${currentRoom}"]`);
  const time = document.querySelector(`.room-time[data-slug="${currentRoom}"]`);
  if (prev) prev.textContent = message.length > 36 ? message.slice(0,36)+"…" : message;
  if (time) time.textContent = fmtTime(created_at);
}

/* ─── Status & Typing ─── */
let currentTypingUser = null;
let typingResetTimer = null;

function startTypingAnimation(username) {
  if (!headerStatus) return;

  currentTypingUser = username;

  let dots = 0;
  const baseText = `печатает`;

  if (typingInterval) clearInterval(typingInterval);

  typingInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    headerStatus.textContent = baseText + '.'.repeat(dots);
    headerStatus.classList.add("typing");
  }, TYPING_INTERVAL_MS);

  // Сброс через 3 секунды, если новых typing-сообщений не придёт
  resetTypingTimeout();
}

function resetTypingTimeout() {
  if (typingResetTimer) clearTimeout(typingResetTimer);
  
  typingResetTimer = setTimeout(() => {
    stopTypingAnimation();
  }, TYPING_TIMEOUT_MS);
}

function stopTypingAnimation() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
  }
  if (typingResetTimer) {
    clearTimeout(typingResetTimer);
    typingResetTimer = null;
  }

  currentTypingUser = null;
  headerStatus.classList.remove("typing");
  
  // Возвращаем предыдущий статус
  restoreLastStatus();
}

let lastKnownOnlineStatus = false; // запоминаем последний реальный статус

function setStatus(online) {
  lastKnownOnlineStatus = online;

  if (currentTypingUser) return; // не затираем индикатор печати

  if (!headerStatus) return;

  if (online) {
    headerStatus.textContent = "в сети";
    headerStatus.classList.add("online");
  } else {
    headerStatus.textContent = "не в сети";
    headerStatus.classList.remove("online");
  }
}

/* Восстановление статуса после остановки печати */
function restoreLastStatus() {
  setStatus(lastKnownOnlineStatus);
}

/* ══════════════════════════════════════════
   REPLY BAR
══════════════════════════════════════════ */
const replyBar       = document.getElementById("reply-bar");
const replyBarAuthor = document.getElementById("reply-bar-author");
const replyBarText   = document.getElementById("reply-bar-text");
const replyBarCancel = document.getElementById("reply-bar-cancel");

function showReplyBar(data) {
  replyTo = data;
  replyBarAuthor.textContent = data.username;
  replyBarText.textContent   = data.message.length > 80 ? data.message.slice(0, 80) + '…' : data.message;
  replyBar.style.display = 'flex';
  messageInput.focus();
}

function hideReplyBar() {
  replyTo = null;
  replyBar.style.display = 'none';
  replyBarAuthor.textContent = '';
  replyBarText.textContent   = '';
}

replyBarCancel.addEventListener('click', hideReplyBar);

/* ══════════════════════════════════════════
   CONTEXT MENU (без изменений)
══════════════════════════════════════════ */
const ctxMenu = document.getElementById("ctx-menu");
let ctxTarget = null;

function showCtxMenu(x, y, msgRow) {
  ctxTarget = msgRow;
  ctxMenu.style.visibility = 'hidden';
  ctxMenu.style.display = 'block';

  const mw = ctxMenu.offsetWidth;
  const mh = ctxMenu.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x, top = y;
  if (left + mw > vw - 8) left = vw - mw - 8;
  if (left < 8) left = 8;
  if (top + mh > vh - 8) top = y - mh;
  if (top < 8) top = 8;

  ctxMenu.style.left = left + 'px';
  ctxMenu.style.top  = top + 'px';
  ctxMenu.style.visibility = 'visible';
  ctxMenu.focus();
}

function hideCtxMenu() {
  ctxMenu.style.display = 'none';
  ctxTarget = null;
}

innerEl.addEventListener('contextmenu', e => {
  const bubble = e.target.closest('.bubble');
  if (!bubble) return;
  e.preventDefault();
  const row = bubble.closest('.msg-row');
  showCtxMenu(e.clientX, e.clientY, row);
});

ctxMenu.addEventListener('click', e => {
  const btn = e.target.closest('.ctx-menu-item');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'reply' && ctxTarget) {
    showReplyBar({
      id:       ctxTarget.dataset.msgId,
      username: ctxTarget.dataset.msgUsername,
      message:  ctxTarget.dataset.msgText,
    });
  }

  if (action === 'copy' && ctxTarget) {
    const text = ctxTarget.dataset.msgText;
    navigator.clipboard.writeText(text).then(() => showToast('Скопировано в буфер обмена')).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Скопировано в буфер обмена');
    });
  }

  hideCtxMenu();
});

document.addEventListener('mousedown', e => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideCtxMenu(); });

/* ══════════════════════════════════════════
   WEBSOCKET
══════════════════════════════════════════ */
const proto  = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}/ws/chat/${currentRoom}/`);

socket.onopen = () => {
  headerStatus.textContent = "подключено";
  headerStatus.classList.remove("online");
};

socket.onclose = () => {
  stopTypingAnimation();
  headerStatus.textContent = "отключено";
  headerStatus.classList.remove("online");
};

socket.onerror = () => {
  stopTypingAnimation();
  headerStatus.textContent = "ошибка";
  headerStatus.classList.remove("online");
};

socket.onmessage = (event) => {
  const payload = JSON.parse(event.data);

  if (payload.type === "history") {
    innerEl.innerHTML = "";
    lastDayLabel = "";
    payload.messages.forEach(m => appendMessage(m));
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return;
  }

  if (payload.type === "message") {
    appendMessage(payload);
    updateRoomPreview(payload.message, payload.created_at);

    // Если сообщение пришло от человека, который печатал — убираем индикатор
    if (currentTypingUser === payload.username) {
      stopTypingAnimation();
      restoreLastStatus();
    }
    return;
  }

  if (payload.type === "status") {
    setStatus(payload.online);
    return;
  }

  if (payload.type === "typing") {
    if (payload.username !== currentUser) {
      startTypingAnimation(payload.username);
    }
    return;
  }

  if (payload.type === "read_receipt") {
    const lastId = payload.last_read_id;
    document.querySelectorAll('.msg-row.out').forEach(row => {
      if (parseInt(row.dataset.msgId, 10) <= lastId) {
        const tickEl = row.querySelector('.bubble-tick');
        if (tickEl && !tickEl.classList.contains('tick-read')) {
          tickEl.classList.remove('tick-sent');
          tickEl.classList.add('tick-read');
          tickEl.innerHTML = TICK_READ;
        }
      }
    });
  }
};

/* ─── Typing sender ─── */
function sendTypingSignal() {
  const now = Date.now();
  if (now - lastTypingSent < 800) return; // не чаще чем раз в 800мс

  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "typing" }));
    lastTypingSent = now;
  }
}

/* ─── Send message ─── */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || socket.readyState !== WebSocket.OPEN) return;

  const payload = { message: text };
  if (replyTo) {
    payload.reply_to_id = parseInt(replyTo.id, 10);
  }

  socket.send(JSON.stringify(payload));
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.focus();
  hideReplyBar();
}

/* ─── Event listeners ─── */
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
  if (e.key === "Escape") hideReplyBar();
});

/* Авто-рост поля ввода + отправка typing */
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";

  if (messageInput.value.trim().length > 0) {
    sendTypingSignal();
  }
});

/* ─── Sidebar search ─── */
const searchInput = document.getElementById("room-search");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".room-item").forEach(el => {
      el.style.display = (!q || (el.dataset.title || "").toLowerCase().includes(q)) ? "" : "none";
    });
  });
}