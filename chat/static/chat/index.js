const chatRoot     = document.getElementById("chat-root");
const currentUser  = chatRoot.dataset.username;
const currentRoom  = chatRoot.dataset.roomSlug;
const messagesEl   = document.getElementById("messages");
const innerEl      = document.getElementById("messages-inner");
const headerStatus = document.getElementById("header-status");
const messageInput = document.getElementById("message");
const sendBtn      = document.getElementById("send");

/* ─── Escape HTML ─── */
function esc(text) {
  const m = { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" };
  return String(text).replace(/[&<>"']/g, c => m[c]);
}

/* ─── Time / date formatting (ISO-8601 input from server) ─── */
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit" });
  } catch { return iso; }
}

function fmtDay(iso) {
  try {
    const d   = new Date(iso);
    const now = new Date();
    const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay    = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());
    const diffDays  = Math.round((today - msgDay) / 86_400_000);
    if (diffDays === 0) return "Сегодня";
    if (diffDays === 1) return "Вчера";
    return d.toLocaleDateString("ru-RU", { day:"numeric", month:"long" });
  } catch { return ""; }
}

/* ─── Double-tick SVG ─── */
const TICK = `<svg viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 5l3.5 3.5L11 2"  stroke="#4bae48" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 5l3.5 3.5L15 2" stroke="#4bae48" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ─── Day separator ─── */
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

/* ─── Render one message ─── */
function appendMessage(data) {
  const isMine = data.username === currentUser;
  ensureDayBadge(data.created_at);

  const row = document.createElement("div");
  row.className = `msg-row ${isMine ? "out" : "in"}`;
  row.innerHTML = `
    <div class="bubble-wrap">
      <div class="bubble">
        ${!isMine ? `<span class="bubble-sender">${esc(data.username)}</span>` : ""}
        ${esc(data.message)}
        <div class="bubble-meta">
          <span class="bubble-time">${esc(fmtTime(data.created_at))}</span>
          ${isMine ? `<span class="bubble-tick">${TICK}</span>` : ""}
        </div>
      </div>
    </div>`;
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

/* ─── Online status ─── */
function setStatus(online) {
  if (!headerStatus) return;
  if (online) {
    headerStatus.textContent = "в сети";
    headerStatus.classList.add("online");
  } else {
    headerStatus.textContent = "не в сети";
    headerStatus.classList.remove("online");
  }
}

/* ─── WebSocket ─── */
const proto  = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}/ws/chat/${currentRoom}/`);

socket.onopen = () => {
  // Status will be set by the 'status' message from the server
  if (headerStatus) {
    headerStatus.textContent = "подключено";
    headerStatus.classList.remove("online");
  }
};

socket.onclose = () => {
  if (headerStatus) {
    headerStatus.textContent = "отключено";
    headerStatus.classList.remove("online");
  }
};

socket.onerror = () => {
  if (headerStatus) {
    headerStatus.textContent = "ошибка";
    headerStatus.classList.remove("online");
  }
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
    return;
  }

  // Real-time online/offline status from the other participant
  if (payload.type === "status") {
    setStatus(payload.online);
    return;
  }
};

/* ─── Send ─── */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ message: text }));
  messageInput.value = "";
  messageInput.style.height = "auto";
  messageInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

/* ─── Auto-grow input ─── */
messageInput.addEventListener("input", () => {
  messageInput.style.height = "auto";
  messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});

/* ─── Sidebar search ─── */
const searchInput = document.getElementById("room-search");
if (searchInput) {
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".room-item").forEach(el => {
      el.style.display = (!q || (el.dataset.title || "").includes(q)) ? "" : "none";
    });
  });
}