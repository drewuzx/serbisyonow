const API_BASE = (window.SN_API_BASE || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3000' : `http://${window.location.hostname}:3000`));

function getCurrentCustomer() {
  try {
    return JSON.parse(localStorage.getItem('sn_customer_user') || 'null');
  } catch {
    return null;
  }
}

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

function groupConversations(messages, contacts = []) {
  const map = new Map();
  for (const contact of contacts) {
    if (!contact.provider_id) continue;
    const key = String(contact.provider_id);
    if (!map.has(key)) {
      map.set(key, {
        provider_id: contact.provider_id,
        provider_name: contact.provider_name || 'Provider',
        booking_ref: contact.booking_ref || '',
        messages: [],
        unread: 0,
      });
    }
  }
  for (const message of messages) {
    const key = String(message.provider_id || 'unknown');
    if (!map.has(key)) {
      map.set(key, {
        provider_id: message.provider_id,
        provider_name: message.provider_name || 'Provider',
        booking_ref: '',
        messages: [],
        unread: 0,
      });
    }
    const convo = map.get(key);
    convo.messages.push(message);
    if (message.sender_role === 'provider' && !message.is_read) convo.unread += 1;
  }

  return [...map.values()]
    .map((convo) => ({
      ...convo,
      messages: convo.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    }))
    .sort((a, b) => new Date(b.messages.at(-1)?.created_at || 0) - new Date(a.messages.at(-1)?.created_at || 0));
}

function bookingContact(booking) {
  return {
    provider_id: booking.provider_id,
    provider_name: booking.provider_name || 'Provider',
    booking_ref: `${booking.service || 'Service'} - ${timeLabel(booking.scheduled_date)} ${booking.scheduled_time || ''}`.trim(),
  };
}

function showInboxToast(item) {
  let host = document.getElementById('sn-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'sn-toast-host';
    host.className = 'sn-toast-host';
    document.body.appendChild(host);
  }
  const toast = document.createElement('button');
  toast.className = 'sn-live-toast';
  toast.type = 'button';
  toast.innerHTML = `<strong>${esc(item.title)}</strong><span>${esc(item.body)}</span>`;
  toast.addEventListener('click', () => {
    if (item.provider_id) {
      const target = document.querySelector(`[data-provider-id="${CSS.escape(String(item.provider_id))}"]`);
      target?.click();
    }
  });
  host.appendChild(toast);
  window.setTimeout(() => toast.remove(), 5200);
}

function setCountBadge(target, count, label = 'new notifications') {
  if (!target) return;
  target.classList.add('sn-has-count-badge');
  target.querySelector('.sn-dot')?.setAttribute('hidden', '');
  let badge = target.querySelector('.sn-badge-count');
  if (count <= 0) {
    badge?.remove();
    target.removeAttribute('data-count');
    target.removeAttribute('aria-label');
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'sn-badge-count';
    target.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : String(count);
  target.dataset.count = String(count);
  target.setAttribute('aria-label', `${count} ${label}`);
}

function activeBookingCount(bookings = []) {
  const active = new Set(['pending', 'accepted', 'upcoming', 'ongoing']);
  return bookings.filter((booking) => active.has(String(booking.status || '').toLowerCase())).length;
}

function storedNoticeList(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function customerSeenNoticeKey(customerId) {
  return `sn_customer_seen_notifications_${customerId}`;
}

function customerNotificationItems({ messages = [], bookings = [] } = {}) {
  return [
    ...messages.filter((message) => message.sender_role === 'provider').slice(0, 5).map((message) => ({
      id: `message-${message.id}`,
      kind: 'Message',
      title: message.provider_name || 'Provider',
      body: message.message || 'New message received.',
      time: message.created_at,
    })),
    ...bookings.slice(0, 5).map((booking) => ({
      id: `booking-${booking.id}-${booking.status}`,
      kind: 'Booking',
      title: booking.provider_name || 'Booking',
      body: `${booking.service || 'Service'} is ${booking.status || 'pending'}.`,
      time: booking.created_at,
    })),
  ].sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0)).slice(0, 8);
}

function unseenCustomerNotices(customerId, items) {
  const seen = new Set(storedNoticeList(customerSeenNoticeKey(customerId)).map(String));
  return items.filter((item) => !seen.has(String(item.id)));
}

function markCustomerNoticesSeen(customerId, items) {
  const key = customerSeenNoticeKey(customerId);
  const seen = new Set(storedNoticeList(key).map(String));
  items.forEach((item) => seen.add(String(item.id)));
  localStorage.setItem(key, JSON.stringify([...seen].slice(-150)));
}

function updateInboxBadges({ messages = [], bookings = [] } = {}, notificationCountOverride = null) {
  const unreadMessages = messages.filter((message) => message.sender_role === 'provider' && !message.is_read).length;
  const activeBookings = activeBookingCount(bookings);
  const notificationCount = notificationCountOverride ?? (unreadMessages + activeBookings);
  const messageButton = document.querySelector('.sn-topbar-right [title*="Message"], .sn-topbar-right [title*="message"]');
  const notificationButton = document.getElementById('sn-notification-button')
    || document.querySelector('.sn-topbar-right [title*="Notification"], .sn-topbar-right [title*="notification"]');
  setCountBadge(messageButton, unreadMessages, 'unread messages');
  setCountBadge(notificationButton, notificationCount, 'new notifications');
  setCountBadge(document.querySelector('.sn-nav-item[href*="inbox"]'), unreadMessages, 'unread messages');
  setCountBadge(document.querySelector('.sn-nav-item[href*="bookings"]'), activeBookings, 'active bookings');
  return { unreadMessages, activeBookings, notificationCount };
}

document.addEventListener('DOMContentLoaded', async () => {
  const currentCustomer = getCurrentCustomer();
  if (!currentCustomer) {
    window.location.href = '../../auth/customerLogin.html';
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.user) {
        Object.assign(currentCustomer, data.user);
        localStorage.setItem('sn_customer_user', JSON.stringify(currentCustomer));
      }
    }
  } catch {
    // Continue with cached user when the API is offline.
  }

  const status = currentCustomer?.verification_status || 'pending';
  const verifyBanner = document.getElementById('sn-verify-banner');
  if (status !== 'verified') {
    document.body.classList.add('sn-locked');
    if (verifyBanner) {
      verifyBanner.hidden = false;
      verifyBanner.textContent = status === 'rejected'
        ? 'Your verification was declined by the admin. Please resubmit your documents.'
        : 'Your account is pending admin verification. Actions are disabled until verified.';
      if (status === 'rejected') {
        verifyBanner.style.background = '#fef2f2';
        verifyBanner.style.borderLeft = '4px solid #dc2626';
        verifyBanner.style.color = '#991b1b';
      }
    }
  } else {
    document.body.classList.remove('sn-locked');
    if (verifyBanner) verifyBanner.hidden = true;
  }

  const userName = document.getElementById('sn-user-name');
  const userStatus = document.getElementById('sn-user-status');
  if (userName) userName.textContent = currentCustomer.full_name || 'Customer';
  if (userStatus) {
    userStatus.textContent = status === 'verified'
      ? 'Verified customer'
      : status === 'rejected'
        ? 'Verification declined'
        : 'Awaiting verification';
  }

  const shell = document.querySelector('.sn-shell');
  const overlay = document.getElementById('sn-overlay');
  const hamburger = document.getElementById('sn-hamburger');
  const hamburgerTop = document.getElementById('sn-hamburger-top');
  const logoutBtn = document.getElementById('sn-logout');

  function isMobile() {
    return window.matchMedia('(max-width: 940px)').matches;
  }
  function closeSidebar() {
    shell?.classList.remove('sidebar-open');
    shell?.classList.add('sidebar-collapsed');
    document.body.style.overflow = '';
  }
  function openSidebar() {
    shell?.classList.remove('sidebar-collapsed');
    shell?.classList.add('sidebar-open');
    if (isMobile()) document.body.style.overflow = 'hidden';
  }
  function toggleSidebar() {
    if (!shell) return;
    const open = shell.classList.contains('sidebar-open') || !shell.classList.contains('sidebar-collapsed');
    open ? closeSidebar() : openSidebar();
  }

  hamburger?.addEventListener('click', toggleSidebar);
  hamburgerTop?.addEventListener('click', toggleSidebar);
  overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
  logoutBtn?.addEventListener('click', () => {
    localStorage.removeItem('sn_customer_user');
    window.location.href = '../../landing/index.html';
  });
  if (isMobile()) closeSidebar();
  else openSidebar();

  const convoList = document.getElementById('sn-convo-list');
  const chatPanel = document.getElementById('sn-chat-panel');
  const chatMessages = document.getElementById('sn-chat-messages');
  const chatInput = document.getElementById('sn-chat-input');
  const sendBtn = document.getElementById('sn-send-btn');
  const inboxLayout = document.querySelector('.sn-inbox-layout');
  const searchInput = document.querySelector('.sn-inbox-search input');
  const newMessageBtn = document.querySelector('.sn-inbox-panel-head [title*="New"]');
  const notificationBtn = document.querySelector('.sn-topbar-right [title*="Notification"]');
  const topMessageBtn = document.querySelector('.sn-topbar-right [title*="Message"]');
  notificationBtn?.classList.add('sn-topbar-notification-btn');
  topMessageBtn?.classList.add('sn-topbar-message-btn');

  let conversations = [];
  let selectedProviderId = null;
  let providerContacts = [];
  let latestBookings = [];
  let activeTab = 'all';
  let inboxInitialized = false;
  let latestProviderMessageKey = localStorage.getItem(`sn_customer_inbox_latest_${currentCustomer.id}`) || '';
  let latestNotificationData = { messages: [], bookings: [] };

  function selectedConversation() {
    return conversations.find((convo) => String(convo.provider_id) === String(selectedProviderId));
  }

  function renderConversationList(filter = '') {
    if (!convoList) return;
    const visible = conversations.filter((convo) => {
      const matchesSearch = convo.provider_name.toLowerCase().includes(filter.trim().toLowerCase());
      const matchesTab = activeTab === 'unread' ? convo.unread > 0 : activeTab !== 'archived';
      return matchesSearch && matchesTab;
    });

    if (!visible.length) {
      convoList.innerHTML = '<p class="sn-convo-end">No conversations yet.</p>';
      return;
    }

    convoList.innerHTML = visible.map((convo, index) => {
      const last = convo.messages.at(-1);
      const active = String(convo.provider_id) === String(selectedProviderId);
      return `
        <button class="sn-convo-item ${active ? 'active' : ''}" type="button" data-provider-id="${convo.provider_id}">
          <div class="sn-convo-avatar sn-convo-avatar--${(index % 6) + 1}"></div>
          <div class="sn-convo-body">
            <div class="sn-convo-top"><span class="sn-convo-name">${esc(convo.provider_name)}</span><span class="sn-convo-time">${timeLabel(last?.created_at)}</span></div>
            <div class="sn-convo-preview">${esc(last?.message || convo.booking_ref || 'Start a conversation')}</div>
          </div>
          ${convo.unread ? `<span class="sn-convo-unread">${convo.unread}</span>` : ''}
        </button>
      `;
    }).join('') + '<p class="sn-convo-end">No more conversations.</p>';
  }

  function renderChat() {
    const convo = selectedConversation();
    if (!convo || !chatPanel || !chatMessages) {
      if (chatMessages) chatMessages.innerHTML = '<p class="sn-convo-end">Select a provider conversation.</p>';
      return;
    }

    const chatName = chatPanel.querySelector('.sn-chat-name');
    const chatMeta = chatPanel.querySelector('.sn-chat-booking-ref');
    if (chatName) chatName.textContent = convo.provider_name;
    if (chatMeta) chatMeta.textContent = convo.booking_ref
      ? ` ${convo.booking_ref}`
      : ' Direct conversation with service provider';

    chatMessages.innerHTML = '<div class="sn-chat-day-divider">Conversation</div>' + (convo.messages.length ? convo.messages.map((message) => `
      <div class="sn-msg ${message.sender_role === 'customer' ? 'sn-msg--out' : 'sn-msg--in'}">
        <div class="sn-msg-bubble">${esc(message.message)}</div>
        <div class="sn-msg-time">${timeLabel(message.created_at)}</div>
      </div>
    `).join('') : '<p class="sn-convo-end">No messages yet. Send the first message below.</p>');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function loadProviderContacts() {
    try {
      const res = await fetch(`${API_BASE}/api/customer/${currentCustomer.id}/dashboard`);
      const data = await res.json().catch(() => ({}));
      latestBookings = data.bookings || [];
      latestNotificationData = { ...latestNotificationData, ...data };
      providerContacts = [...new Map((data.bookings || [])
        .filter((booking) => booking.provider_id)
        .map((booking) => [String(booking.provider_id), bookingContact(booking)])).values()];
      renderNotificationPanel(data);
    } catch {
      providerContacts = [];
    }
  }

  async function loadMessages({ silent = false } = {}) {
    if (!silent && convoList) convoList.innerHTML = '<p class="sn-convo-end">Loading conversations...</p>';
    try {
      const res = await fetch(`${API_BASE}/api/customer/${currentCustomer.id}/messages`);
      const data = await res.json();
      const incoming = (data.messages || [])
        .filter((message) => message.sender_role === 'provider')
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
      if (incoming?.id && String(incoming.id) !== latestProviderMessageKey) {
        if (inboxInitialized && silent) {
          showInboxToast({
            title: `New message from ${incoming.provider_name || 'Provider'}`,
            body: incoming.message || 'You received a new message.',
            provider_id: incoming.provider_id,
          });
        }
        latestProviderMessageKey = String(incoming.id);
        localStorage.setItem(`sn_customer_inbox_latest_${currentCustomer.id}`, latestProviderMessageKey);
      }
      conversations = groupConversations(data.messages || [], providerContacts);
      latestNotificationData = { ...latestNotificationData, messages: data.messages || [], bookings: latestBookings };
      renderNotificationPanel(latestNotificationData);
      selectedProviderId = selectedProviderId || conversations[0]?.provider_id || null;
      if (!conversations.some((convo) => String(convo.provider_id) === String(selectedProviderId))) {
        selectedProviderId = conversations[0]?.provider_id || null;
      }
      renderConversationList(searchInput?.value || '');
      renderChat();
      inboxInitialized = true;
    } catch {
      if (!silent && convoList) convoList.innerHTML = '<p class="sn-convo-end">Unable to load messages. Start the auth server first.</p>';
    }
  }

  async function sendMessage() {
    const text = chatInput?.value.trim();
    const convo = selectedConversation();
    if (!text || !convo?.provider_id) return;

    if (sendBtn) sendBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/customer/${currentCustomer.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider_id: convo.provider_id, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Message failed.');
      chatInput.value = '';
      await loadMessages({ silent: true });
    } catch (error) {
      const msg = document.createElement('div');
      msg.className = 'sn-msg sn-msg--out';
      msg.innerHTML = `<div class="sn-msg-bubble">Message was not sent. ${esc(error.message || 'Please check the auth server.')}</div>`;
      chatMessages?.appendChild(msg);
    } finally {
      if (sendBtn) sendBtn.disabled = false;
    }
  }

  convoList?.addEventListener('click', (event) => {
    const item = event.target.closest('[data-provider-id]');
    if (!item) return;
    selectedProviderId = item.dataset.providerId;
    const convo = selectedConversation();
    if (convo) convo.unread = 0;
    fetch(`${API_BASE}/api/customer/${currentCustomer.id}/messages/${selectedProviderId}/read`, { method: 'PATCH' }).catch(() => {});
    renderConversationList(searchInput?.value || '');
    renderChat();
    inboxLayout?.classList.add('chat-open');
  });

  document.querySelectorAll('.sn-inbox-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sn-inbox-tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab || 'all';
      renderConversationList(searchInput?.value || '');
    });
  });

  function openProviderChooser() {
    if (!providerContacts.length) {
      chatMessages.innerHTML = '<p class="sn-convo-end">Book a provider first before starting a message.</p>';
      return;
    }
    selectedProviderId = providerContacts[0].provider_id;
    conversations = groupConversations(conversations.flatMap((convo) => convo.messages), providerContacts);
    renderConversationList(searchInput?.value || '');
    renderChat();
    inboxLayout?.classList.add('chat-open');
  }

  function renderNotificationPanel(data) {
    if (!notificationBtn) return;
    let panel = document.getElementById('sn-notification-panel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'sn-notification-panel';
      panel.className = 'sn-notification-panel';
      panel.hidden = true;
      document.querySelector('.sn-topbar')?.after(panel);
    }
    latestNotificationData = data || { messages: [], bookings: [] };
    const items = customerNotificationItems(latestNotificationData);
    const unseenItems = unseenCustomerNotices(currentCustomer.id, items);
    const unseenIds = new Set(unseenItems.map((item) => String(item.id)));
    panel.innerHTML = `
      <div class="sn-notification-head"><strong>Notifications</strong><span>${unseenIds.size ? `${unseenIds.size} new` : `${items.length} update${items.length === 1 ? '' : 's'}`}</span></div>
      <div class="sn-notification-list">
        ${items.map((item) => `<button class="sn-notification-item ${unseenIds.has(String(item.id)) ? 'is-unseen' : ''}" type="button"><span class="sn-notification-kind">${esc(item.kind)}</span><strong>${esc(item.title)}</strong><small>${esc(item.body)}</small></button>`).join('') || '<p class="sn-notification-empty">No notifications yet.</p>'}
      </div>
    `;
    const dot = notificationBtn.querySelector('.sn-dot');
    if (dot) dot.hidden = unseenItems.length <= 0;
    updateInboxBadges(latestNotificationData, unseenItems.length);
  }

  topMessageBtn?.addEventListener('click', () => chatInput?.focus());
  notificationBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    const panel = document.getElementById('sn-notification-panel');
    if (panel) {
      const isOpen = panel.hidden;
      panel.hidden = !isOpen;
      if (isOpen) {
        markCustomerNoticesSeen(currentCustomer.id, customerNotificationItems(latestNotificationData));
        renderNotificationPanel(latestNotificationData);
      }
    }
  });
  newMessageBtn?.addEventListener('click', openProviderChooser);

  searchInput?.addEventListener('input', () => renderConversationList(searchInput.value));
  document.querySelector('.sn-chat-notice-close')?.addEventListener('click', (event) => {
    event.target.closest('.sn-chat-notice')?.remove();
  });
  sendBtn?.addEventListener('click', sendMessage);
  chatInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendMessage();
  });

  await loadProviderContacts();
  await loadMessages();
  const refreshMessages = () => {
    if (document.visibilityState === 'visible') loadMessages({ silent: true });
  };
  const inboxRefreshTimer = window.setInterval(refreshMessages, 3000);
  window.addEventListener('beforeunload', () => window.clearInterval(inboxRefreshTimer));
  document.addEventListener('visibilitychange', refreshMessages);
});
