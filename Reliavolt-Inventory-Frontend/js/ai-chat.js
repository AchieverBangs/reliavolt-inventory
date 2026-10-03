// ===== AI CHAT WIDGET — floating bubble + panel, loaded on every authenticated page =====
// Keeps a running conversation for the session (lost on page reload, same as closing a
// chat tab) — each message sends the recent history back so follow-up questions like
// "what about yesterday?" still have context.
let _aiChatHistory = [];
const AI_CHAT_ROLES = ['Admin', 'Manager', 'Cashier', 'Stock Manager'];

function initAiChatWidget() {
    const bubble = document.getElementById('aiChatBubble');
    const panel = document.getElementById('aiChatPanel');
    if (!bubble || !panel) return;
    if (!AI_CHAT_ROLES.includes(getCurrentUserRole())) return; // hidden for Delivery Person / logged out

    bubble.classList.remove('hidden');

    bubble.addEventListener('click', () => {
        panel.classList.toggle('active');
        if (panel.classList.contains('active')) document.getElementById('aiChatInput')?.focus();
    });
    document.getElementById('aiChatClose')?.addEventListener('click', () => panel.classList.remove('active'));
    document.getElementById('aiChatForm')?.addEventListener('submit', sendAiChatMessage);
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
