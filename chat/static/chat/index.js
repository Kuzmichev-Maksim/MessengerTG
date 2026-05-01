const chatRoot      = document.getElementById("chat-root");
const currentUser   = chatRoot.dataset.username;
const currentRoom   = chatRoot.dataset.roomSlug;
const messagesEl    = document.getElementById("messages");
const headerStatus  = document.getElementById("header-status");
const messageInput  = document.getElementById("message");
const sendBtn       = document.getElementById("send");

/* ─── helpers ─── */
function esc(text) {
    const m = { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" };
    return String(text).replace(/[&<>"']/g, c => m[c]);
}

function fmtTime(iso) {
    try {
        return new Date(iso).toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit" });
    } catch { return iso; }
}

function fmtDay(iso) {
    try {
        const d = new Date(iso);
        const today = new Date();
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === today.toDateString()) return "Сегодня";
        if (d.toDateString() === yesterday.toDateString()) return "Вчера";
        return d.toLocaleDateString("ru-RU", { day:"numeric", month:"long" });
    } catch { return ""; }
}

/* double-tick SVG */
const TICK = `<svg viewBox="0 0 16 10" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 5l3.5 3.5L11 2" stroke="#4fae4e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M5 5l3.5 3.5L15 2" stroke="#4fae4e" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ─── render one message ─── */
let lastDayLabel = "";

function appendMessage(data, prepend = false) {
    const isMine = data.username === currentUser;
    const dayLabel = fmtDay(data.created_at);

    // day separator
    let dayBadge = "";
    if (!prepend && dayLabel !== lastDayLabel) {
        lastDayLabel = dayLabel;
        dayBadge = `<div class="day-badge">${esc(dayLabel)}</div>`;
    }

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
        </div>
    `;

    if (prepend) {
        messagesEl.prepend(row);
    } else {
        if (dayBadge) {
            const badge = document.createElement("div");
            badge.innerHTML = dayBadge;
            messagesEl.appendChild(badge.firstElementChild);
        }
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }
}

/* ─── WebSocket ─── */
const proto  = location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${proto}://${location.host}/ws/chat/${currentRoom}/`);

socket.onopen = () => {
    headerStatus.textContent = "онлайн";
    headerStatus.style.color = "#3390ec";
};

socket.onclose = () => {
    headerStatus.textContent = "отключено";
    headerStatus.style.color = "#a0acb5";
};

socket.onerror = () => {
    headerStatus.textContent = "ошибка соединения";
    headerStatus.style.color = "#e53e3e";
};

socket.onmessage = (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === "history") {
        messagesEl.innerHTML = "";
        lastDayLabel = "";
        payload.messages.forEach(m => appendMessage(m));
        return;
    }

    if (payload.type === "message") {
        appendMessage(payload);
    }
};

/* ─── Send ─── */
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ message: text }));
    messageInput.value = "";
    messageInput.focus();
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

/* auto-grow textarea */
messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 160) + "px";
});