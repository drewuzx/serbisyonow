(function initSerbisyoFloatingChat() {
  if (window.snFloatingChat || window.__snFloatingChatBooting) return;
  window.__snFloatingChatBooting = true;

  const API_BASE = window.SN_API_BASE || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : `http://${window.location.hostname}:3000`);

  const CHAT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>';

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeLabel(value) {
    if (!value) return '';
    const date = new Date(value);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function currentContext() {
    try {
      const provider = JSON.parse(localStorage.getItem('sn_provider_user') || 'null');
      if (provider?.id && document.querySelector('.sn-shell--provider')) {
        return { role: 'provider', user: provider };
      }
    } catch {
      /* ignore */
    }
    try {
      const customer = JSON.parse(localStorage.getItem('sn_customer_user') || 'null');
      if (customer?.id) return { role: 'customer', user: customer };
    } catch {
      /* ignore */
    }
    return null;
  }

  function ensureStyles() {
    if (document.querySelector('link[href*="floating-chat.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/shared/css/floating-chat.css';
    document.head.appendChild(link);
  }

  function peerKey(convo) {
    return String(convo.peer_id);
  }

  const state = {
    mounted: false,
    listOpen: false,
    chatOpen: false,
    minimized: false,
    selectedId: null,
    query: '',
    conversations: [],
    sending: false,
    latestKey: '',
  };

  function selectedConvo() {
    return state.conversations.find((convo) => peerKey(convo) === String(state.selectedId)) || null;
  }

  function unreadTotal() {
    return state.conversations.reduce((sum, convo) => sum + Number(convo.unread || 0), 0);
  }

  function parseHashPeer() {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    if (hash.startsWith('messages=')) return hash.slice('messages='.length);
    if (hash === 'messages') return true;
    return null;
  }

  async function fetchJSON(path, options) {
    const response = await fetch(`${API_BASE}${path}`, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Request failed.');
    return data;
  }

  async function loadConversations() {
    const ctx = currentContext();
    if (!ctx) return;
    if (ctx.role === 'customer') {
      const [messageData, dash] = await Promise.all([
        fetchJSON(`/api/customer/${ctx.user.id}/messages`),
        fetchJSON(`/api/customer/${ctx.user.id}/dashboard`).catch(() => ({ bookings: [] })),
      ]);
      const contacts = [...new Map((dash.bookings || [])
        .filter((booking) => booking.provider_id)
        .map((booking) => [String(booking.provider_id), {
          peer_id: booking.provider_id,
          name: booking.provider_name || 'Provider',
          meta: booking.service || 'Service provider',
        }])).values()];
      state.conversations = groupByPeer(messageData.messages || [], contacts, 'provider_id', 'provider', 'customer');
    } else {
      const data = await fetchJSON(`/api/provider/${ctx.user.id}/dashboard`);
      const contacts = [...new Map((data.bookings || data.history_bookings || [])
        .filter((booking) => booking.customer_id)
        .map((booking) => [String(booking.customer_id), {
          peer_id: booking.customer_id,
          name: booking.customer_name || 'Customer',
          meta: booking.service || 'Customer',
        }])).values()];
      state.conversations = groupByPeer(data.messages || [], contacts, 'customer_id', 'customer', 'provider');
    }
  }

  function groupByPeer(messages, contacts, idField, incomingRole, _outgoingRole) {
    const map = new Map();
    for (const contact of contacts) {
      map.set(String(contact.peer_id), {
        peer_id: contact.peer_id,
        name: contact.name,
        meta: contact.meta || '',
        messages: [],
        unread: 0,
      });
    }
    for (const message of messages) {
      const id = message[idField];
      if (!id) continue;
      const key = String(id);
      if (!map.has(key)) {
        map.set(key, {
          peer_id: id,
          name: message.provider_name || message.customer_name || 'Chat',
          meta: '',
          messages: [],
          unread: 0,
        });
      }
      const convo = map.get(key);
      convo.messages.push(message);
      if (message.sender_role === incomingRole && !message.is_read) convo.unread += 1;
    }
    return [...map.values()]
      .map((convo) => ({
        ...convo,
        messages: convo.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
      }))
      .sort((a, b) => new Date(b.messages.at(-1)?.created_at || 0) - new Date(a.messages.at(-1)?.created_at || 0));
  }

  function rootEl() {
    return document.getElementById('sn-float-root');
  }

  function render() {
    const root = rootEl();
    if (!root) return;
    const count = unreadTotal();
    const launchCount = root.querySelector('.sn-float-launch-count');
    if (launchCount) {
      launchCount.textContent = count > 99 ? '99+' : String(count);
      launchCount.classList.toggle('is-on', count > 0);
    }

    const list = root.querySelector('.sn-float-list');
    const chat = root.querySelector('.sn-float-chat');
    list.classList.toggle('is-open', state.listOpen);
    chat.classList.toggle('is-open', state.chatOpen);
    chat.classList.toggle('is-minimized', state.minimized);

    const query = state.query.trim().toLowerCase();
    const visible = state.conversations.filter((convo) => convo.name.toLowerCase().includes(query));
    const convos = root.querySelector('.sn-float-convos');
    convos.innerHTML = visible.length
      ? visible.map((convo, index) => {
        const last = convo.messages.at(-1);
        const active = peerKey(convo) === String(state.selectedId);
        return `
          <button class="sn-float-convo ${active ? 'is-active' : ''}" type="button" data-peer-id="${esc(convo.peer_id)}">
            <span class="sn-float-avatar" style="background:linear-gradient(135deg, ${index % 2 ? '#f97316' : '#4f8ef7'}, ${index % 2 ? '#dc2626' : '#2563eb'})"></span>
            <span class="sn-float-convo-copy">
              <strong>${esc(convo.name)}</strong>
              <span>${esc(last?.message || convo.meta || 'Start a conversation')}</span>
            </span>
            ${convo.unread ? `<span class="sn-float-unread">${convo.unread}</span>` : ''}
          </button>
        `;
      }).join('')
      : '<p class="sn-float-empty">No conversations yet. Book a service to start chatting.</p>';

    const convo = selectedConvo();
    const name = root.querySelector('[data-chat-name]');
    const meta = root.querySelector('[data-chat-meta]');
    const body = root.querySelector('.sn-float-chat-body');
    if (name) name.textContent = convo?.name || 'Messages';
    if (meta) meta.textContent = convo?.meta || (convo ? 'Active chat' : 'Select a conversation');
    if (body) {
      if (!convo) {
        body.innerHTML = '<p class="sn-float-empty">Choose someone from Chats to start messaging.</p>';
      } else if (!convo.messages.length) {
        body.innerHTML = '<p class="sn-float-empty">No messages yet. Say hello below.</p>';
      } else {
        const ctx = currentContext();
        body.innerHTML = convo.messages.map((message) => {
          const outgoing = ctx?.role === 'customer' ? message.sender_role === 'customer' : message.sender_role === 'provider';
          return `
            <div class="sn-float-msg ${outgoing ? 'is-out' : 'is-in'}">
              <div class="sn-float-bubble">${esc(message.message)}</div>
              <div class="sn-float-time">${esc(timeLabel(message.created_at))}</div>
            </div>
          `;
        }).join('');
        body.scrollTop = body.scrollHeight;
      }
    }
  }

  async function markRead(peerId) {
    const ctx = currentContext();
    if (!ctx || !peerId) return;
    const path = ctx.role === 'customer'
      ? `/api/customer/${ctx.user.id}/messages/${peerId}/read`
      : `/api/provider/${ctx.user.id}/messages/${peerId}/read`;
    await fetchJSON(path, { method: 'PATCH' }).catch(() => {});
  }

  async function sendMessage() {
    const ctx = currentContext();
    const input = rootEl()?.querySelector('#sn-float-input');
    const text = input?.value.trim();
    const convo = selectedConvo();
    if (!ctx || !text || !convo || state.sending) return;
    state.sending = true;
    render();
    try {
      if (ctx.role === 'customer') {
        await fetchJSON(`/api/customer/${ctx.user.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider_id: convo.peer_id, message: text }),
        });
      } else {
        await fetchJSON(`/api/provider/${ctx.user.id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_id: convo.peer_id, message: text }),
        });
      }
      if (input) input.value = '';
      await loadConversations();
    } catch (error) {
      const body = rootEl()?.querySelector('.sn-float-chat-body');
      if (body) {
        const note = document.createElement('div');
        note.className = 'sn-float-msg is-out';
        note.innerHTML = `<div class="sn-float-bubble">Not sent. ${esc(error.message || 'Try again.')}</div>`;
        body.appendChild(note);
      }
    } finally {
      state.sending = false;
      render();
    }
  }

  function openList() {
    state.listOpen = true;
    render();
    loadConversations().then(render).catch(() => render());
  }

  function closeList() {
    state.listOpen = false;
    render();
  }

  function toggleList() {
    state.listOpen ? closeList() : openList();
  }

  async function openChat(peerId) {
    state.listOpen = true;
    state.chatOpen = true;
    state.minimized = false;
    if (peerId) state.selectedId = peerId;
    if (!state.conversations.length) {
      try { await loadConversations(); } catch { /* ignore */ }
    }
    if (peerId && !state.conversations.some((convo) => peerKey(convo) === String(peerId))) {
      state.conversations.unshift({
        peer_id: peerId,
        name: 'New chat',
        meta: '',
        messages: [],
        unread: 0,
      });
    }
    const convo = selectedConvo();
    if (convo) convo.unread = 0;
    render();
    if (peerId) await markRead(peerId);
    rootEl()?.querySelector('#sn-float-input')?.focus();
  }

  function closeChat() {
    state.chatOpen = false;
    state.minimized = false;
    render();
  }

  function minimizeChat() {
    if (!state.chatOpen) return;
    state.minimized = !state.minimized;
    render();
  }

  function mount() {
    if (state.mounted || !currentContext() || document.getElementById('sn-float-root')) return;
    ensureStyles();
    const root = document.createElement('div');
    root.id = 'sn-float-root';
    root.className = 'sn-float-root';
    root.innerHTML = `
      <div class="sn-float-windows">
        <section class="sn-float-panel sn-float-chat" aria-label="Chat window">
          <header class="sn-float-head">
            <div class="sn-float-head-main">
              <span class="sn-float-avatar is-online"></span>
              <div class="sn-float-title">
                <strong data-chat-name>Messages</strong>
                <span data-chat-meta>Select a conversation</span>
              </div>
            </div>
            <div class="sn-float-head-actions">
              <button class="sn-float-icon" type="button" data-float-min title="Minimize">–</button>
              <button class="sn-float-icon" type="button" data-float-chat-close title="Close">×</button>
            </div>
          </header>
          <div class="sn-float-chat-body"></div>
          <form class="sn-float-compose" id="sn-float-form">
            <input id="sn-float-input" type="text" placeholder="Aa" autocomplete="off" />
            <button class="sn-float-send" id="sn-float-send" type="submit">➤</button>
          </form>
        </section>
        <section class="sn-float-panel sn-float-list" aria-label="Chats">
          <header class="sn-float-head">
            <div class="sn-float-title"><strong>Chats</strong><span>SerbisyoNow messages</span></div>
            <div class="sn-float-head-actions">
              <button class="sn-float-icon" type="button" data-float-list-close title="Close">×</button>
            </div>
          </header>
          <input class="sn-float-search" id="sn-float-search" type="search" placeholder="Search chats" />
          <div class="sn-float-convos"></div>
        </section>
      </div>
      <button class="sn-float-launch" type="button" title="Open chats" aria-label="Open chats">
        ${CHAT_ICON}
        <span class="sn-float-launch-count">0</span>
      </button>
    `;
    document.querySelectorAll('.sn-float-root').forEach((node) => {
      if (node !== root) node.remove();
    });
    document.body.appendChild(root);
    state.mounted = true;

    root.querySelector('.sn-float-launch').addEventListener('click', toggleList);
    root.querySelector('[data-float-list-close]').addEventListener('click', closeList);
    root.querySelector('[data-float-chat-close]').addEventListener('click', closeChat);
    root.querySelector('[data-float-min]').addEventListener('click', minimizeChat);
    root.querySelector('.sn-float-convos').addEventListener('click', (event) => {
      const item = event.target.closest('[data-peer-id]');
      if (item) openChat(item.dataset.peerId);
    });
    root.querySelector('#sn-float-search').addEventListener('input', (event) => {
      state.query = event.target.value;
      render();
    });
    root.querySelector('#sn-float-form').addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });

    document.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-open-chat]');
      if (!trigger) return;
      event.preventDefault();
      openChat(trigger.getAttribute('data-open-chat'));
    });

    window.addEventListener('hashchange', () => {
      const peer = parseHashPeer();
      if (peer === true) openList();
      else if (peer) openChat(peer);
    });

    const hashPeer = parseHashPeer();
    loadConversations()
      .then(() => {
        if (hashPeer === true) openList();
        else if (hashPeer) openChat(hashPeer);
        else render();
      })
      .catch(() => render());

    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      loadConversations().then(() => {
        const newest = state.conversations
          .flatMap((convo) => convo.messages)
          .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
        if (newest?.id && String(newest.id) !== state.latestKey) {
          state.latestKey = String(newest.id);
        }
        render();
      }).catch(() => {});
    };
    window.setInterval(refresh, 3000);
  }

  function boot(attempt = 0) {
    mount();
    if (!state.mounted && attempt < 20) {
      window.setTimeout(() => boot(attempt + 1), 250);
    }
  }

  window.snFloatingChat = {
    mount,
    open: openChat,
    toggleList,
    closeList,
    closeChat,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
