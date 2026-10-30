/* ============================================================
   chat.js — Refad ERP v1.1
   💬 Chat Widget (Fab + Panel + Realtime)
   ⭐ v1.1: إصلاح مشاكل realtime + error handling
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg || !cfg.CHAT) {
    console.error('[Refad Chat] config.js لازم يتحمل الأول!');
    return;
  }

  const state = {
    open: false,
    conversations: [],
    unread: 0,
    activeConvId: null,
    messages: [],
    pollTimer: null,
    channel: null,
    lastMessageAt: null,
    usersMap: {}
  };

  function esc(s) {
    return window.Refad?.esc ? window.Refad.esc(s) : String(s || '');
  }

  function timeAgo(d) {
    return window.Refad?.timeAgo ? window.Refad.timeAgo(d) : '';
  }

  // ═══════════════════════════════════════════════════════════
  // STYLES
  // ═══════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('refad-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'refad-chat-styles';
    style.textContent = `
      .refad-chat-fab {
        position: fixed;
        bottom: 20px;
        left: 20px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--accent, #14B8A6);
        color: #fff;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 10px 30px rgba(20,184,166,0.4);
        z-index: 9997;
        transition: all 0.2s;
        -webkit-tap-highlight-color: transparent;
      }
      .refad-chat-fab:hover {
        transform: scale(1.08);
        box-shadow: 0 14px 40px rgba(20,184,166,0.5);
      }
      .refad-chat-fab svg { width: 24px; height: 24px; }
      .refad-chat-fab .refad-chat-fab-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 10px;
        background: var(--danger, #ef4444);
        color: #fff;
        font-size: 11px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 0 2px var(--bg, #F1F5F9);
      }
      .refad-chat-fab .refad-chat-fab-badge.hidden { display: none; }

      .refad-chat-panel {
        position: fixed;
        bottom: 88px;
        left: 20px;
        width: 380px;
        max-width: calc(100vw - 40px);
        height: 540px;
        max-height: calc(100vh - 120px);
        background: var(--card, #fff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,0.2);
        z-index: 9996;
        display: none;
        flex-direction: column;
        overflow: hidden;
        direction: rtl;
        animation: refad-chat-panel-in 0.25s cubic-bezier(0.4,0,0.2,1);
      }
      .refad-chat-panel.show { display: flex; }
      @keyframes refad-chat-panel-in {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      .refad-chat-header {
        padding: 14px 16px;
        background: var(--primary, #0B2C4D);
        color: #fff;
        display: flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
      }
      .refad-chat-header-back {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.1);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .refad-chat-header-back:hover { background: rgba(255,255,255,0.2); }
      .refad-chat-header-back svg { width: 16px; height: 16px; }
      .refad-chat-header-avatar {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: var(--accent, #14B8A6);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 14px;
        flex-shrink: 0;
      }
      .refad-chat-header-info {
        flex: 1;
        min-width: 0;
      }
      .refad-chat-header-title {
        font-size: 14px;
        font-weight: 800;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-chat-header-subtitle {
        font-size: 11px;
        color: rgba(255,255,255,0.7);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 1px;
      }
      .refad-chat-header-close {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.1);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .refad-chat-header-close:hover { background: rgba(255,255,255,0.2); }
      .refad-chat-header-close svg { width: 16px; height: 16px; }

      .refad-chat-body {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }
      .refad-chat-body::-webkit-scrollbar { width: 4px; }
      .refad-chat-body::-webkit-scrollbar-thumb {
        background: var(--border, #e2e8f0);
        border-radius: 2px;
      }

      .refad-chat-list {
        padding: 4px;
      }
      .refad-chat-conv {
        display: flex;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        cursor: pointer;
        transition: background 0.15s;
        align-items: center;
      }
      .refad-chat-conv:hover { background: var(--bg-soft, #f8fafc); }
      .refad-chat-conv.active { background: var(--accent-soft, rgba(20,184,166,0.1)); }
      .refad-chat-conv-avatar {
        width: 40px;
        height: 40px;
        border-radius: 12px;
        background: linear-gradient(135deg, var(--accent, #14B8A6), var(--accent-dark, #0d9488));
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        font-size: 14px;
        flex-shrink: 0;
      }
      .refad-chat-conv-info {
        flex: 1;
        min-width: 0;
      }
      .refad-chat-conv-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--text, #0f172a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-chat-conv-preview {
        font-size: 11.5px;
        color: var(--text-muted, #64748b);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }
      .refad-chat-conv-meta {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 4px;
        flex-shrink: 0;
      }
      .refad-chat-conv-time {
        font-size: 10px;
        color: var(--text-muted, #64748b);
      }
      .refad-chat-conv-unread {
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--accent, #14B8A6);
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .refad-chat-empty {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-muted, #64748b);
        font-size: 13px;
      }
      .refad-chat-empty svg {
        width: 40px;
        height: 40px;
        opacity: 0.3;
        margin-bottom: 10px;
        display: block;
        margin-left: auto;
        margin-right: auto;
      }

      .refad-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        background: var(--bg-soft, #f8fafc);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
      }
      .refad-chat-msg {
        display: flex;
        gap: 6px;
        max-width: 80%;
      }
      .refad-chat-msg.mine { align-self: flex-start; flex-direction: row; }
      .refad-chat-msg.theirs { align-self: flex-end; }
      .refad-chat-msg-avatar {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: var(--accent, #14B8A6);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        flex-shrink: 0;
      }
      .refad-chat-msg-bubble {
        padding: 8px 12px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.45;
        word-wrap: break-word;
        white-space: pre-wrap;
      }
      .refad-chat-msg.mine .refad-chat-msg-bubble {
        background: var(--accent, #14B8A6);
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .refad-chat-msg.theirs .refad-chat-msg-bubble {
        background: var(--card, #fff);
        color: var(--text, #0f172a);
        border: 1px solid var(--border, #e2e8f0);
        border-bottom-left-radius: 4px;
      }
      .refad-chat-msg-time {
        font-size: 9.5px;
        color: var(--text-muted, #64748b);
        margin-top: 3px;
        padding: 0 4px;
      }

      .refad-chat-input {
        padding: 10px 12px;
        border-top: 1px solid var(--border, #e2e8f0);
        display: flex;
        gap: 8px;
        align-items: flex-end;
        background: var(--card, #fff);
        flex-shrink: 0;
      }
      .refad-chat-input textarea {
        flex: 1;
        resize: none;
        border: 1.5px solid var(--border, #e2e8f0);
        border-radius: 12px;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 13px;
        color: var(--text, #0f172a);
        background: var(--bg-soft, #f8fafc);
        outline: none;
        max-height: 100px;
        min-height: 38px;
      }
      .refad-chat-input textarea:focus {
        border-color: var(--accent, #14B8A6);
        background: var(--card, #fff);
      }
      .refad-chat-send {
        width: 38px;
        height: 38px;
        border-radius: 50%;
        border: none;
        background: var(--accent, #14B8A6);
        color: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .refad-chat-send:hover { background: var(--accent-dark, #0d9488); }
      .refad-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
      .refad-chat-send svg { width: 16px; height: 16px; }

      @media (max-width: 480px) {
        .refad-chat-fab {
          width: 48px;
          height: 48px;
          bottom: 14px;
          left: 14px;
        }
        .refad-chat-fab svg { width: 20px; height: 20px; }
        .refad-chat-panel {
          left: 8px;
          right: 8px;
          bottom: 72px;
          width: auto;
          max-width: none;
          height: calc(100vh - 100px);
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  function renderFab() {
    if (document.getElementById('refad-chat-fab')) return;
    const fab = document.createElement('button');
    fab.className = 'refad-chat-fab';
    fab.id = 'refad-chat-fab';
    fab.title = 'المحادثات';
    fab.setAttribute('aria-label', 'المحادثات');
    fab.innerHTML = '<i data-lucide="message-circle"></i><span class="refad-chat-fab-badge hidden" id="refad-chat-fab-badge">0</span>';
    fab.onclick = togglePanel;
    document.body.appendChild(fab);
    return fab;
  }

  function renderPanel() {
    if (document.getElementById('refad-chat-panel')) return;

    const panel = document.createElement('div');
    panel.className = 'refad-chat-panel';
    panel.id = 'refad-chat-panel';
    panel.innerHTML = `
      <div class="refad-chat-header" id="refad-chat-header"></div>
      <div class="refad-chat-body" id="refad-chat-body">
        <div class="refad-chat-list" id="refad-chat-list">
          <div class="refad-chat-empty">
            <i data-lucide="loader"></i>
            <div>جاري التحميل...</div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
  }

  function updateFabBadge(count) {
    state.unread = count;
    const badge = document.getElementById('refad-chat-fab-badge');
    if (!badge) return;
    if (count > 0) {
      badge.classList.remove('hidden');
      badge.textContent = count > 99 ? '99+' : String(count);
    } else {
      badge.classList.add('hidden');
    }
  }

  function renderHeaderConversations() {
    const h = document.getElementById('refad-chat-header');
    if (!h) return;
    h.innerHTML = `
      <div class="refad-chat-header-info">
        <div class="refad-chat-header-title">💬 المحادثات</div>
        <div class="refad-chat-header-subtitle">${state.conversations.length} محادثة</div>
      </div>
      <button class="refad-chat-header-close" id="refad-chat-close" title="إغلاق">
        <i data-lucide="x"></i>
      </button>
    `;
    const closeBtn = document.getElementById('refad-chat-close');
    if (closeBtn) closeBtn.onclick = closePanel;
    if (window.lucide) window.lucide.createIcons();
  }

  function renderHeaderConversation(conv) {
    const h = document.getElementById('refad-chat-header');
    if (!h) return;
    const title = conv.name || getConversationDisplayName(conv);
    const initial = (title || '?').charAt(0).toUpperCase();
    h.innerHTML = `
      <button class="refad-chat-header-back" id="refad-chat-back" title="رجوع">
        <i data-lucide="arrow-right"></i>
      </button>
      <div class="refad-chat-header-avatar">${esc(initial)}</div>
      <div class="refad-chat-header-info">
        <div class="refad-chat-header-title">${esc(title)}</div>
        <div class="refad-chat-header-subtitle">${conv.type === 'group' ? 'مجموعة' : 'محادثة فردية'}</div>
      </div>
      <button class="refad-chat-header-close" id="refad-chat-close" title="إغلاق">
        <i data-lucide="x"></i>
      </button>
    `;
    const backBtn = document.getElementById('refad-chat-back');
    if (backBtn) backBtn.onclick = backToList;
    const closeBtn = document.getElementById('refad-chat-close');
    if (closeBtn) closeBtn.onclick = closePanel;
    if (window.lucide) window.lucide.createIcons();
  }

  function getConversationDisplayName(conv) {
    if (conv.name) return conv.name;
    if (conv.type === 'direct' && conv.participants) {
      const myId = window.Refad?._session?.user_id;
      const other = conv.participants.find(p => p.user_id !== myId);
      if (other) {
        const userName = state.usersMap[other.user_id];
        if (userName) return userName;
        return 'محادثة';
      }
    }
    return 'محادثة';
  }

  async function loadUsersMap() {
    if (!window.Refad || !window.Refad.sb || !window.Refad._session) return;
    try {
      const allUserIds = new Set();
      state.conversations.forEach(c => {
        (c.participants || []).forEach(p => {
          if (p.user_id !== window.Refad._session.user_id) {
            allUserIds.add(p.user_id);
          }
        });
      });
      if (allUserIds.size === 0) return;

      const { data } = await window.Refad.sb.from('users')
        .select('id, full_name')
        .in('id', Array.from(allUserIds));

      (data || []).forEach(u => {
        state.usersMap[u.id] = u.full_name || 'مستخدم';
      });
    } catch (e) {
      console.warn('[Refad Chat] loadUsersMap failed:', e);
    }
  }

  function renderConversations() {
    const list = document.getElementById('refad-chat-list');
    if (!list) return;

    if (state.conversations.length === 0) {
      list.innerHTML = `
        <div class="refad-chat-empty">
          <i data-lucide="message-square-dashed"></i>
          <div>لا توجد محادثات</div>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    list.innerHTML = state.conversations.map(c => {
      const name = getConversationDisplayName(c);
      const initial = (name || '?').charAt(0).toUpperCase();
      return `
        <div class="refad-chat-conv" data-conv-id="${esc(c.id)}">
          <div class="refad-chat-conv-avatar">${esc(initial)}</div>
          <div class="refad-chat-conv-info">
            <div class="refad-chat-conv-name">${esc(name)}</div>
            <div class="refad-chat-conv-preview">اضغط لعرض المحادثة</div>
          </div>
          <div class="refad-chat-conv-meta">
            <div class="refad-chat-conv-time">${timeAgo(c.last_message_at)}</div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();

    list.querySelectorAll('.refad-chat-conv').forEach(el => {
      el.onclick = () => openConversation(el.dataset.convId);
    });
  }

  function renderMessages() {
    const body = document.getElementById('refad-chat-body');
    if (!body) return;
    body.innerHTML = `
      <div class="refad-chat-messages" id="refad-chat-messages">
        ${state.messages.length === 0 ? `
          <div class="refad-chat-empty">
            <i data-lucide="message-square"></i>
            <div>لا توجد رسائل — ابدأ المحادثة</div>
          </div>
        ` : state.messages.map(m => {
          const myId = window.Refad?._session?.user_id;
          const isMine = m.sender_id === myId;
          return `
            <div class="refad-chat-msg ${isMine ? 'mine' : 'theirs'}">
              <div class="refad-chat-msg-bubble">${esc(m.body)}</div>
            </div>
          `;
        }).join('')}
      </div>
      <div class="refad-chat-input">
        <textarea id="refad-chat-textarea" placeholder="اكتب رسالة..." rows="1"></textarea>
        <button class="refad-chat-send" id="refad-chat-send" disabled>
          <i data-lucide="send"></i>
        </button>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    const textarea = document.getElementById('refad-chat-textarea');
    const sendBtn = document.getElementById('refad-chat-send');

    textarea.oninput = () => {
      sendBtn.disabled = !textarea.value.trim();
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    };
    textarea.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) sendMessage();
      }
    };
    sendBtn.onclick = sendMessage;

    const messagesEl = document.getElementById('refad-chat-messages');
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ═══════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════
  async function loadConversations() {
    try {
      const convs = await window.Refad.chat.conversations();
      state.conversations = convs || [];
      await loadUsersMap();
      renderConversations();
      const sub = document.querySelector('.refad-chat-header-subtitle');
      if (sub) sub.textContent = state.conversations.length + ' محادثة';
    } catch (e) {
      console.warn('[Refad Chat] loadConversations failed:', e);
      state.conversations = [];
      renderConversations();
    }
  }

  async function openConversation(convId) {
    state.activeConvId = convId;
    const conv = state.conversations.find(c => c.id === convId);
    if (!conv) return;

    renderHeaderConversation(conv);

    const msgs = await window.Refad.chat.messages(convId);
    state.messages = msgs || [];
    renderMessages();

    await window.Refad.chat.markRead(convId);
    await loadUnreadCount();
  }

  async function backToList() {
    state.activeConvId = null;
    state.messages = [];
    const body = document.getElementById('refad-chat-body');
    if (body) {
      body.innerHTML = `
        <div class="refad-chat-list" id="refad-chat-list">
          <div class="refad-chat-empty">
            <i data-lucide="loader"></i>
            <div>جاري التحميل...</div>
          </div>
        </div>
      `;
    }
    renderHeaderConversations();
    await loadConversations();
  }

  async function sendMessage() {
    const textarea = document.getElementById('refad-chat-textarea');
    if (!textarea || !state.activeConvId) return;
    const text = textarea.value.trim();
    if (!text) return;

    textarea.disabled = true;
    const sendBtn = document.getElementById('refad-chat-send');
    if (sendBtn) sendBtn.disabled = true;

    const msg = await window.Refad.chat.send(state.activeConvId, text, []);
    if (msg) {
      state.messages.push(msg);
      textarea.value = '';
      renderMessages();
    } else {
      if (window.Refad.toast) window.Refad.toast.error('فشل إرسال الرسالة');
      textarea.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  async function loadUnreadCount() {
    try {
      const count = await window.Refad.chat.unreadCount();
      updateFabBadge(count);
    } catch (e) {
      updateFabBadge(0);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PANEL TOGGLE
  // ═══════════════════════════════════════════════════════════
  async function togglePanel() {
    if (state.open) closePanel();
    else await openPanel();
  }

  async function openPanel() {
    const panel = document.getElementById('refad-chat-panel');
    if (!panel) renderPanel();
    document.getElementById('refad-chat-panel').classList.add('show');
    state.open = true;
    renderHeaderConversations();
    await loadConversations();
  }

  function closePanel() {
    const panel = document.getElementById('refad-chat-panel');
    if (panel) panel.classList.remove('show');
    state.open = false;
    state.activeConvId = null;
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  async function init() {
    if (!window.Refad || !window.Refad.chat) {
      console.warn('[Refad Chat] app.js لازم يتحمل الأول');
      return;
    }

    injectStyles();
    renderFab();
    renderPanel();

    await loadUnreadCount();

    try {
      window.Refad.chat.subscribe((msg) => {
        if (state.activeConvId === msg.conversation_id) {
          if (!state.messages.find(m => m.id === msg.id)) {
            state.messages.push(msg);
            renderMessages();
          }
          window.Refad.chat.markRead(msg.conversation_id);
        }
        loadUnreadCount();
      });
    } catch (e) {
      console.warn('[Refad Chat] Realtime failed, using polling:', e);
      state.pollTimer = window.Refad.chat.startPolling(5000);
      window.addEventListener(cfg.EVENTS?.CHAT_UNREAD_CHANGED || 'refad:chat-unread-changed', () => {
        loadUnreadCount();
      });
    }

    window.addEventListener('focus', () => loadUnreadCount());

    if (window.lucide) window.lucide.createIcons();
    console.log('[Refad Chat] v1.1 ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 400));
  } else {
    setTimeout(init, 400);
  }

  // ═══════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.RefadChat = {
    open: openPanel,
    close: closePanel,
    toggle: togglePanel,
    refresh: loadConversations,
    getUnread: () => state.unread
  };

})();