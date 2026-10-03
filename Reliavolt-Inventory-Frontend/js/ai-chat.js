// ===== AI CHAT WIDGET — floating bubble + panel, loaded on every authenticated page =====
// Keeps a running conversation for the session (lost on page reload, same as closing a
// chat tab) — each message sends the recent history back so follow-up questions like
// "what about yesterday?" still have context.
let _aiChatHistory = [];
let _aiChatUnreadUpdates = [];
const AI_CHAT_ROLES = ['Admin', 'Manager', 'Cashier', 'Stock Manager'];

function initAiChatWidget() {
    const bubble = document.getElementById('aiChatBubble');
    const panel = document.getElementById('aiChatPanel');
    if (!bubble || !panel) return;
    if (!AI_CHAT_ROLES.includes(getCurrentUserRole())) return; // hidden for Delivery Person / logged out

    bubble.classList.remove('hidden');

    bubble.addEventListener('click', () => {
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) {
            document.getElementById('aiChatInput')?.focus();
            showUnreadUpdatesOnce();
        }
    });
    document.getElementById('aiChatClose')?.addEventListener('click', () => panel.classList.remove('active'));
    document.getElementById('aiChatForm')?.addEventListener('submit', sendAiChatMessage);

    checkUnreadUpdates();
}

// "What's new" — a short, one-time announcement delivered through this widget instead of
// a separate changelog page. A red dot marks the bubble until the panel is opened, at
// which point the announcement(s) are shown once and marked read for this user.
async function checkUnreadUpdates() {
    try {
        _aiChatUnreadUpdates = await api.get('/api/updates/unread');
        document.getElementById('aiChatBubble')?.classList.toggle('has-update', _aiChatUnreadUpdates.length > 0);
    } catch {
        _aiChatUnreadUpdates = []; // best-effort — never block the chat itself over this
    }
}

async function showUnreadUpdatesOnce() {
    if (!_aiChatUnreadUpdates.length) return;
    for (const update of _aiChatUnreadUpdates) {
        appendAiChatMessage(`📢 ${update.title}\n\n${update.body}`, 'ai-chat-msg-update');
    }
    const seen = _aiChatUnreadUpdates;
    _aiChatUnreadUpdates = [];
    document.getElementById('aiChatBubble')?.classList.remove('has-update');
    try {
        await api.post('/api/updates/mark-seen', {});
    } catch {
        _aiChatUnreadUpdates = seen; // couldn't confirm server-side — try again next time
    }
}

function appendAiChatMessage(text, cls) {
    const box = document.getElementById('aiChatMessages');
    if (!box) return null;
    const el = document.createElement('div');
    el.className = `ai-chat-msg ${cls}`;
    el.textContent = text;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
}

async function sendAiChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('aiChatInput');
    const sendBtn = document.getElementById('aiChatSend');
    const question = input.value.trim();
    if (!question) return;

    appendAiChatMessage(question, 'ai-chat-msg-user');
    input.value = '';
    sendBtn.disabled = true;
    const loadingEl = appendAiChatMessage('Thinking...', 'ai-chat-msg-loading');

    try {
        const { answer } = await api.post('/api/ai/ask', { question, history: _aiChatHistory });
        loadingEl.remove();
        appendAiChatMessage(answer, 'ai-chat-msg-bot');
        _aiChatHistory.push({ role: 'user', content: question });
        _aiChatHistory.push({ role: 'assistant', content: answer });
        if (_aiChatHistory.length > 20) _aiChatHistory = _aiChatHistory.slice(-20);
    } catch (err) {
        loadingEl.remove();
        appendAiChatMessage(err.message || 'Something went wrong — try again.', 'ai-chat-msg-error');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

document.addEventListener('DOMContentLoaded', initAiChatWidget);
