function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch { return null; }
}

const BOOKING_API_BASE = (window.SN_API_BASE || window.SN?.utils?.apiBase?.() || ((window.location.protocol === 'file:' || window.location.port === '5500') ? `http://${window.location.hostname === '127.0.0.1' ? 'localhost' : window.location.hostname}:3000` : window.location.origin));
let bookingDeviceCoords = null;
let bookingProviderServices = [];

function bookingEsc(value) {
 return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayInputValue() {
 const now = new Date();
 const local = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
 return local.toISOString().slice(0, 10);
}

async function bookingFetch(path, options = {}) {
 const response = await fetch(`${BOOKING_API_BASE}${path}`, options);
 const data = await response.json().catch(() => ({}));
 if (!response.ok) {
  const error = new Error(data.message || 'Request failed.');
  error.status = response.status;
  error.data = data;
  throw error;
 }
 return data;
}

function bookingDateValue(value) {
 return String(value || '').slice(0, 10);
}

function bookingSlotLabel(slot) {
 const date = new Date(slot.available_date);
 const dateLabel = Number.isNaN(date.getTime())
  ? bookingDateValue(slot.available_date)
  : date.toLocaleDateString('en-PH', { month: 'short', day: '2-digit' });
 return `${dateLabel} - ${slot.start_time}`;
}

function bookingMoney(value) {
 return `PHP ${Number(value || 0).toLocaleString('en-PH')}`;
}

function bookingServiceOptions(provider) {
 const services = bookingProviderServices.length
  ? bookingProviderServices
  : [{
   title: provider?.service || provider?.category || 'Service',
   starting_price: 0,
   max_price: 0,
  }];
 return services.map((service, index) => `
  <option value="${bookingEsc(service.title)}" data-index="${index}">
   ${bookingEsc(service.title)}${service.starting_price ? ` - ${bookingMoney(service.starting_price)}${service.max_price && service.max_price !== service.starting_price ? ` to ${bookingMoney(service.max_price)}` : ''}` : ''}
  </option>
 `).join('');
}

function updateBookingPaymentChoices() {
 const serviceSelect = document.getElementById('sn-booking-service');
 const amountSelect = document.getElementById('sn-booking-amount-choice');
 const customAmount = document.getElementById('sn-booking-custom-amount');
 const amountHint = document.getElementById('sn-booking-amount-hint');
 if (!serviceSelect || !amountSelect || !customAmount) return;

 const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
 const service = bookingProviderServices[Number(selectedOption?.dataset.index || 0)] || null;
 const min = Number(service?.starting_price || 0);
 const max = Number(service?.max_price || min || 0);
 const midpoint = min && max && max !== min ? Math.round((min + max) / 2) : 0;
 const amounts = [...new Set([min, midpoint, max].filter(value => value > 0))];

 amountSelect.innerHTML = amounts.length
  ? amounts.map((amount, index) => `<option value="${amount}">${index === 0 ? 'Starting price' : index === amounts.length - 1 ? 'Maximum price' : 'Mid price'} - ${bookingMoney(amount)}</option>`).join('') + '<option value="custom">Custom cash amount</option>'
  : '<option value="custom">Custom cash amount</option>';
 customAmount.value = amounts[0] || '';
 customAmount.min = min || 0;
 customAmount.max = max || '';
 customAmount.hidden = amountSelect.value !== 'custom';
 customAmount.required = amountSelect.value === 'custom';
 if (amountHint) {
  amountHint.textContent = amounts.length
   ? `Allowed amount: ${bookingMoney(min)}${max && max !== min ? ` to ${bookingMoney(max)}` : ''}`
   : 'Provider has no listed price yet. Enter the agreed amount.';
 }
}

function bookingAlert(message, options = {}) {
 if (window.snAlert) return window.snAlert(message, options);
 const modal = document.createElement('div');
 modal.className = `sn-modal sn-modal--${options.type || 'warning'}`;
 modal.innerHTML = `
  <div class="sn-modal-card">
   <button type="button" class="sn-modal-close" aria-label="Close">x</button>
   <div class="sn-modal-icon sn-modal-icon--${options.type || 'warning'}">!</div>
   <h3 class="sn-modal-title">${bookingEsc(options.title || 'Notice')}</h3>
   <p class="sn-modal-body">${bookingEsc(message)}</p>
   <div class="sn-modal-actions"><button class="btn btn-primary" type="button">OK</button></div>
  </div>
 `;
 document.body.appendChild(modal);
 modal.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => modal.remove()));
 return Promise.resolve(true);
}

function bookingConfirm(message, options = {}) {
 const modal = document.createElement('div');
 modal.className = `sn-modal sn-modal--${options.type || 'warning'}`;
 modal.innerHTML = `
  <div class="sn-modal-card">
   <button type="button" class="sn-modal-close" aria-label="Close">x</button>
   <div class="sn-modal-icon sn-modal-icon--${options.type || 'warning'}">!</div>
   <h3 class="sn-modal-title">${bookingEsc(options.title || 'Confirm action')}</h3>
   <p class="sn-modal-body">${bookingEsc(message)}</p>
   <div class="sn-modal-actions">
    <button class="btn btn-outline" type="button" data-confirm="no">Keep Booking</button>
    <button class="btn btn-primary" type="button" data-confirm="yes">${bookingEsc(options.confirmText || 'Confirm')}</button>
   </div>
  </div>
 `;
 document.body.appendChild(modal);
 document.body.classList.add('sn-modal-open');
 return new Promise((resolve) => {
  function finish(value) {
   modal.remove();
   document.body.classList.remove('sn-modal-open');
   resolve(value);
  }
  modal.querySelector('.sn-modal-close')?.addEventListener('click', () => finish(false));
  modal.querySelector('[data-confirm="no"]')?.addEventListener('click', () => finish(false));
  modal.querySelector('[data-confirm="yes"]')?.addEventListener('click', () => finish(true));
  modal.addEventListener('click', (event) => {
   if (event.target === modal) finish(false);
  });
 });
}

function bookingFriendlyError(message) {
 const text = String(message || '').trim();
 const messages = {
  'provider_id is required.': 'Please choose a service provider before submitting your booking.',
  'service is required.': 'Please enter or choose the service you want to book.',
  'scheduled_date is required.': 'Please choose your preferred booking date.',
  'scheduled_time is required.': 'Please select an available time slot.',
  'address is required.': 'Please enter the service address.',
 };
 return messages[text] || text.replaceAll('_', ' ') || 'Unable to submit booking.';
}

function bookingDisplayDate(value) {
 if (!value) return '-';
 const date = new Date(value);
 return Number.isNaN(date.getTime())
  ? String(value)
  : date.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric', weekday: 'short' });
}

function bookingMonthKey(value) {
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return '';
 return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function bookingStatusClass(status) {
 const normalized = String(status || 'pending').toLowerCase().replace(/\s+/g, '-');
 if (normalized === 'accepted') return 'upcoming';
 if (normalized === 'ongoing') return 'in-progress';
 return normalized;
}

function getStoredBookingById(id) {
 return (window.snCustomerBookings || []).find((booking) => String(booking.id) === String(id));
}

function bookingFromStaticCard(card) {
 const section = card?.closest('.sn-booking-section');
 const group = card?.closest('.sn-booking-group');
 const values = [...card?.querySelectorAll('.sn-booking-detail-row') || []].reduce((acc, row) => {
  const key = row.querySelector('.sn-detail-label')?.textContent?.trim().toLowerCase();
  const value = row.querySelector('.sn-detail-value')?.textContent?.trim();
  if (key) acc[key] = value;
  return acc;
 }, {});
 return {
  id: card?.dataset.bookingId || '',
  provider_name: card?.querySelector('.sn-booking-provider-name')?.textContent?.trim() || 'Provider',
  provider_category: section?.querySelector('.sn-booking-category')?.textContent?.trim() || 'Service Booking',
  service: card?.querySelector('.sn-booking-specialty')?.textContent?.trim() || card?.querySelector('.sn-booking-service-type')?.textContent?.trim() || 'Service',
  scheduled_date: values.date || '',
  scheduled_time: values.time || '',
  address: values.location || '',
  amount: card?.querySelector('.sn-amount-value')?.textContent?.replace(/[^\d.]/g, '') || 0,
  payment_method: 'cash',
  status: group?.dataset.status || section?.querySelector('.sn-status-badge')?.textContent?.trim() || 'pending',
  source: 'static',
 };
}

function bookingFromDynamicCard(card) {
 const id = card?.dataset.bookingId || card?.closest('[data-booking-id]')?.dataset.bookingId;
 const stored = getStoredBookingById(id);
 if (stored) return stored;
 const meta = [...card?.querySelectorAll('.sn-customer-booking-meta span') || []].reduce((acc, item) => {
  const [label, ...rest] = item.textContent.split(':');
  if (label && rest.length) acc[label.trim().toLowerCase()] = rest.join(':').trim();
  return acc;
 }, {});
 return {
  id,
  provider_name: card?.querySelector('.sn-booking-provider-name')?.textContent?.trim() || 'Provider',
  provider_category: card?.querySelector('.sn-provider-badge')?.textContent?.trim() || 'Service Booking',
  service: card?.querySelector('.sn-booking-service-type')?.textContent?.trim() || 'Service',
  scheduled_date: meta.date || '',
  scheduled_time: meta.time || '',
  address: meta.location || '',
  payment_method: meta.payment || 'cash',
  amount: card?.querySelector('.sn-customer-booking-amount strong')?.textContent?.replace(/[^\d.]/g, '') || 0,
  status: card?.closest('.sn-booking-group')?.dataset.status || 'pending',
 };
}

function bookingFromElement(element) {
 const card = element?.closest('.sn-customer-booking-card, .sn-booking-card');
 if (!card) return null;
 return card.classList.contains('sn-customer-booking-card')
  ? bookingFromDynamicCard(card)
  : bookingFromStaticCard(card);
}

async function getBookingDetails(booking) {
 const customer = getCurrentCustomer();
 if (!booking?.id || booking.source === 'static' || !customer?.id) return { booking };
 try {
  return await bookingFetch(`/api/customer/${customer.id}/bookings/${booking.id}/track?directions=true`);
 } catch (error) {
  console.warn(error.message || error);
  return { booking, message: 'Live tracking details are unavailable right now.' };
 }
}

function bookingDetailRow(label, value) {
 return `
  <div class="sn-booking-detail-item">
   <span>${bookingEsc(label)}</span>
   <strong>${bookingEsc(value || '-')}</strong>
  </div>
 `;
}

function closeBookingModal(modal) {
 modal?.remove();
 document.body.classList.remove('sn-modal-open');
}

async function showBookingDetails(booking) {
 if (!booking) return;
 const detail = await getBookingDetails(booking);
 const item = detail.booking || booking;
 const trackingMessage = detail.message || (item.provider_location_updated_at ? 'Provider GPS has been shared.' : 'Tracking details will appear when available.');
 const providerLocation = detail.provider_location
  ? `${Number(detail.provider_location.lat).toFixed(5)}, ${Number(detail.provider_location.lng).toFixed(5)}`
  : 'Not shared yet';
 const customerPin = detail.customer_pin
  ? `${Number(detail.customer_pin.lat).toFixed(5)}, ${Number(detail.customer_pin.lng).toFixed(5)}`
  : item.address || '-';

 const modal = document.createElement('div');
 modal.className = 'sn-modal sn-modal--info sn-booking-detail-modal';
 modal.setAttribute('role', 'dialog');
 modal.setAttribute('aria-modal', 'true');
 modal.innerHTML = `
  <div class="sn-modal-card">
   <button type="button" class="sn-modal-close" aria-label="Close">x</button>
   <div class="sn-modal-icon sn-modal-icon--info">i</div>
   <h3 class="sn-modal-title">${bookingEsc(item.service || 'Booking Details')}</h3>
   <p class="sn-modal-body">${bookingEsc(item.provider_name || 'Provider')} - ${bookingEsc(item.provider_category || 'Service Booking')}</p>
   <div class="sn-booking-detail-grid">
    ${bookingDetailRow('Status', item.status)}
    ${bookingDetailRow('Date', bookingDisplayDate(item.scheduled_date))}
    ${bookingDetailRow('Time', item.scheduled_time)}
    ${bookingDetailRow('Amount', bookingMoney(item.amount))}
    ${bookingDetailRow('Payment', item.payment_method || 'cash')}
    ${bookingDetailRow('Service address', item.address)}
    ${bookingDetailRow('Customer pin', customerPin)}
    ${bookingDetailRow('Provider GPS', providerLocation)}
   </div>
   <div class="sn-booking-track-note">${bookingEsc(trackingMessage)}</div>
   <div class="sn-modal-actions">
    ${item.provider_id ? `<a class="btn btn-outline" href="../inbox/inbox.html?provider_id=${bookingEsc(item.provider_id)}">Message</a>` : ''}
    <button class="btn btn-primary" type="button">Done</button>
   </div>
  </div>
 `;
 document.body.appendChild(modal);
 document.body.classList.add('sn-modal-open');
 modal.querySelector('.sn-modal-close')?.addEventListener('click', () => closeBookingModal(modal));
 modal.querySelector('.btn-primary')?.addEventListener('click', () => closeBookingModal(modal));
 modal.addEventListener('click', (event) => {
  if (event.target === modal) closeBookingModal(modal);
 });
}

function allVisibleBookings() {
 const stored = window.snCustomerBookings || [];
 if (stored.length) return stored;
 return [...document.querySelectorAll('#sn-bookings .sn-booking-card, #sn-bookings .sn-customer-booking-card')]
  .map((card) => bookingFromElement(card))
  .filter(Boolean);
}

function calendarDateParts(value) {
 const date = new Date(value);
 return Number.isNaN(date.getTime()) ? null : {
  date,
  key: date.toISOString().slice(0, 10),
  day: date.getDate(),
 };
}

function renderBookingCalendar() {
 const host = document.getElementById('sn-booking-calendar');
 if (!host || host.hidden) return;
 const bookings = allVisibleBookings();
 const dated = bookings.map((booking) => ({ booking, parts: calendarDateParts(booking.scheduled_date) })).filter(item => item.parts);
 if (!dated.length) {
  host.innerHTML = '<div class="sn-calendar-empty">No dated bookings to show yet.</div>';
  return;
 }

 const activeMonth = bookingMonthKey(dated[0].booking.scheduled_date);
 const monthDate = new Date(`${activeMonth}-01T00:00:00`);
 const monthName = monthDate.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
 const firstDay = monthDate.getDay();
 const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
 const byDay = new Map();
 dated.forEach((item) => {
  const key = item.parts.key;
  byDay.set(key, [...(byDay.get(key) || []), item.booking]);
 });

 const cells = [];
 for (let index = 0; index < firstDay; index += 1) cells.push('<div class="sn-calendar-cell is-empty"></div>');
 for (let day = 1; day <= daysInMonth; day += 1) {
  const key = `${activeMonth}-${String(day).padStart(2, '0')}`;
  const dayBookings = byDay.get(key) || [];
  cells.push(`
   <div class="sn-calendar-cell">
    <span class="sn-calendar-day">${day}</span>
    <div class="sn-calendar-events">
     ${dayBookings.map((booking) => `
      <button class="sn-calendar-event sn-calendar-event--${bookingStatusClass(booking.status)}" type="button" data-booking-id="${bookingEsc(booking.id || '')}">
       ${bookingEsc(booking.scheduled_time || '')} ${bookingEsc(booking.service || 'Service')}
      </button>
     `).join('')}
    </div>
   </div>
  `);
 }

 host.innerHTML = `
  <div class="sn-calendar-head">
   <h3>${bookingEsc(monthName)}</h3>
   <span>${dated.length} booking${dated.length === 1 ? '' : 's'}</span>
  </div>
  <div class="sn-calendar-weekdays">
   ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => `<span>${day}</span>`).join('')}
  </div>
  <div class="sn-calendar-grid">${cells.join('')}</div>
 `;
}

function setupBookingActions() {
 const calendarButton = document.getElementById('sn-calendar-view-toggle') || [...document.querySelectorAll('.sn-page-header .sn-btn')]
  .find((button) => button.textContent.trim().toLowerCase().includes('calendar'));
 const tabs = document.querySelector('.sn-filter-tabs');
 if (tabs && !document.getElementById('sn-booking-calendar')) {
  tabs.insertAdjacentHTML('afterend', '<section class="sn-booking-calendar" id="sn-booking-calendar" hidden></section>');
 }

 calendarButton?.addEventListener('click', () => {
  const calendar = document.getElementById('sn-booking-calendar');
  const bookings = document.getElementById('sn-bookings');
  if (!calendar) return;
  const isOpen = calendar.hidden;
  calendar.hidden = !isOpen;
  if (bookings) bookings.hidden = isOpen;
  if (tabs) tabs.hidden = isOpen;
  calendarButton.setAttribute('aria-expanded', String(isOpen));
  calendarButton.textContent = isOpen ? 'List View' : 'Calendar View';
  renderBookingCalendar();
  if (isOpen) calendar.scrollIntoView({ behavior: 'smooth', block: 'start' });
 });

 document.addEventListener('sn:customer-bookings-rendered', renderBookingCalendar);
 document.addEventListener('click', (event) => {
  const cancelButton = event.target.closest('[data-booking-action="cancel"]');
  if (cancelButton) {
   event.preventDefault();
   cancelCustomerBooking(cancelButton.dataset.bookingId, cancelButton);
   return;
  }

  const detailButton = event.target.closest('[data-booking-action="details"], .sn-booking-actions .sn-btn-outline');
  if (detailButton && detailButton.textContent.trim().toLowerCase().includes('view details')) {
   event.preventDefault();
   showBookingDetails(bookingFromElement(detailButton));
   return;
  }

  const calendarEvent = event.target.closest('.sn-calendar-event');
  if (calendarEvent) {
   event.preventDefault();
   const booking = getStoredBookingById(calendarEvent.dataset.bookingId)
    || allVisibleBookings().find(item => String(item.id || '') === String(calendarEvent.dataset.bookingId));
   showBookingDetails(booking);
 }
});
}

async function cancelCustomerBooking(bookingId, button) {
 const customer = getCurrentCustomer();
 if (!customer?.id || !bookingId) return;
 const confirmed = await bookingConfirm('This will cancel your booking and reopen the provider schedule slot.', {
  title: 'Cancel booking?',
  confirmText: 'Cancel Booking',
  type: 'warning',
 });
 if (!confirmed) return;
 const originalText = button?.textContent || 'Cancel Booking';
 if (button) {
  button.disabled = true;
  button.textContent = 'Cancelling...';
 }
 try {
  await bookingFetch(`/api/customer/${customer.id}/bookings/${bookingId}/cancel`, { method: 'PATCH' });
  window.location.reload();
 } catch (error) {
  if (button) {
   button.disabled = false;
   button.textContent = originalText;
  }
  await bookingAlert(bookingFriendlyError(error.message), {
   title: 'Booking Not Cancelled',
   type: 'warning',
  });
 }
}

async function renderBookingRequestForm(customer) {
 const providerId = new URLSearchParams(window.location.search).get('provider_id');
 if (!providerId) return;

 const pageHeader = document.querySelector('.sn-page-header');
 if (!pageHeader) return;

 let provider = null;
 try {
  const data = await bookingFetch(`/api/auth/provider/status/${providerId}`);
  provider = data.user;
 } catch (error) {
  console.warn(error.message || error);
 }
 try {
  const data = await bookingFetch(`/api/provider/${providerId}/dashboard`);
  bookingProviderServices = (data.services || []).filter(service => service.is_active !== false);
 } catch (error) {
  bookingProviderServices = [];
  console.warn(error.message || error);
 }

 const form = document.createElement('section');
 form.className = 'sn-booking-create-panel';
 form.innerHTML = `
  <div class="sn-booking-create-head">
   <div>
    <h3>Book ${bookingEsc(provider?.full_name || 'Service Provider')}</h3>
    <p>Use your device location for the exact service pin the provider will see.</p>
   </div>
   <span id="sn-booking-gps-status">GPS not saved yet</span>
  </div>
  <form id="sn-create-booking-form" class="sn-booking-create-grid">
   <label><span>Service</span><select id="sn-booking-service" name="service" required>${bookingServiceOptions(provider)}</select></label>
   <label><span>Date</span><input id="sn-booking-date" name="scheduled_date" type="date" value="${todayInputValue()}" required /></label>
   <label><span>Available Time</span><select id="sn-booking-time" name="scheduled_time" required><option value="">Loading slots...</option></select></label>
  <label><span>Payment Method</span><select id="sn-booking-payment" name="payment_method"><option value="cash">Cash Payment</option><option value="gcash">GCash</option></select><small id="sn-booking-payment-note" class="sn-booking-payment-note">To be paid directly to the service provider after the service.</small></label>
   <label><span>Cash Amount</span><select id="sn-booking-amount-choice" name="amount_choice"></select></label>
   <label><span>Custom Amount</span><input id="sn-booking-custom-amount" name="amount" type="number" min="0" step="1" placeholder="Enter amount" /><small id="sn-booking-amount-hint" class="sn-booking-amount-hint"></small></label>
   <label class="full"><span>Typed Address</span><textarea name="address" required>${bookingEsc(customer.address || '')}</textarea></label>
   <div class="sn-booking-schedule-note full" id="sn-booking-schedule-note">Checking provider schedule...</div>
   <div class="sn-booking-alternatives full" id="sn-booking-alternatives" hidden></div>
   <div class="sn-booking-location-row full">
    <button class="sn-btn sn-btn-outline" id="sn-use-booking-gps" type="button">Use My Device Location</button>
    <input id="sn-booking-gps-label" value="Device GPS not captured yet" readonly />
   </div>
   <button class="sn-btn sn-btn-primary full" type="submit">Submit Booking Request</button>
  </form>
 `;
 pageHeader.insertAdjacentElement('afterend', form);

 updateBookingPaymentChoices();
 document.getElementById('sn-booking-service')?.addEventListener('change', updateBookingPaymentChoices);
 document.getElementById('sn-booking-payment')?.addEventListener('change', (event) => {
  const note = document.getElementById('sn-booking-payment-note');
  if (note) note.textContent = event.target.value === 'gcash'
   ? 'Use the service provider\'s GCash QR code for easy payment access.'
   : 'To be paid directly to the service provider after the service.';
 });
 document.getElementById('sn-booking-amount-choice')?.addEventListener('change', () => {
  const choice = document.getElementById('sn-booking-amount-choice');
  const custom = document.getElementById('sn-booking-custom-amount');
  if (!choice || !custom) return;
  custom.hidden = choice.value !== 'custom';
  custom.required = choice.value === 'custom';
  if (choice.value !== 'custom') custom.value = choice.value;
  if (choice.value === 'custom') custom.focus();
 });
 document.getElementById('sn-use-booking-gps')?.addEventListener('click', () => captureBookingGps(customer));
 document.getElementById('sn-create-booking-form')?.addEventListener('submit', (event) => submitBookingRequest(event, customer, providerId));
 document.getElementById('sn-booking-date')?.addEventListener('change', () => loadProviderBookingSlots(providerId));
 await loadProviderBookingSlots(providerId);
}

async function loadProviderBookingSlots(providerId, preferredTime = '') {
 const dateInput = document.getElementById('sn-booking-date');
 const timeSelect = document.getElementById('sn-booking-time');
 const note = document.getElementById('sn-booking-schedule-note');
 const alternatives = document.getElementById('sn-booking-alternatives');
 if (!dateInput || !timeSelect) return;

 timeSelect.innerHTML = '<option value="">Checking slots...</option>';
 timeSelect.disabled = true;
 if (alternatives) {
  alternatives.hidden = true;
  alternatives.innerHTML = '';
 }
 if (note) note.textContent = 'Checking provider availability for your selected date...';

 try {
  const params = new URLSearchParams({ date: dateInput.value });
  const data = await bookingFetch(`/api/providers/${providerId}/availability?${params}`);
  const slots = data.availability || [];
  if (!slots.length) {
   timeSelect.innerHTML = '<option value="">No open slots for this date</option>';
   if (note) note.textContent = 'No schedule is open for this date. Pick another date or choose an alternative below.';
   await loadAlternativeBookingSlots(providerId);
   return;
  }

  timeSelect.innerHTML = slots.map((slot) => {
   const selected = preferredTime && preferredTime === slot.start_time ? ' selected' : '';
   return `<option value="${bookingEsc(slot.start_time)}"${selected}>${bookingEsc(slot.start_time)} - ${bookingEsc(slot.end_time)}</option>`;
  }).join('');
  timeSelect.disabled = false;
  if (note) note.textContent = `${slots.length} open slot${slots.length === 1 ? '' : 's'} found. The backend will still re-check before submitting.`;
 } catch (error) {
  timeSelect.innerHTML = '<option value="">Schedule unavailable</option>';
  if (note) note.textContent = error.message || 'Unable to load provider schedule.';
 }
}

async function loadAlternativeBookingSlots(providerId) {
 try {
  const data = await bookingFetch(`/api/providers/${providerId}/availability`);
  renderBookingAlternatives(data.availability || [], providerId);
 } catch (error) {
  console.warn(error.message || error);
 }
}

function renderBookingAlternatives(slots, providerId) {
 const alternatives = document.getElementById('sn-booking-alternatives');
 if (!alternatives) return;
 if (!slots.length) {
  alternatives.hidden = false;
  alternatives.innerHTML = '<strong>No alternative slots available right now.</strong>';
  return;
 }

 alternatives.hidden = false;
 alternatives.innerHTML = `
  <strong>Suggested alternative slots</strong>
  <div class="sn-booking-alt-list">
   ${slots.slice(0, 5).map((slot) => `
    <button class="sn-booking-alt-slot" type="button" data-date="${bookingEsc(bookingDateValue(slot.available_date))}" data-time="${bookingEsc(slot.start_time)}">
     ${bookingEsc(bookingSlotLabel(slot))}
    </button>
   `).join('')}
  </div>
 `;
 alternatives.querySelectorAll('.sn-booking-alt-slot').forEach((button) => {
  button.addEventListener('click', async () => {
   const dateInput = document.getElementById('sn-booking-date');
   if (dateInput) dateInput.value = button.dataset.date || todayInputValue();
   await loadProviderBookingSlots(providerId, button.dataset.time || '');
  });
 });
}

function captureBookingGps(customer) {
 const gpsLabel = document.getElementById('sn-booking-gps-label');
 const gpsStatus = document.getElementById('sn-booking-gps-status');
 if (!navigator.geolocation) {
  if (gpsLabel) gpsLabel.value = 'GPS is not available in this browser.';
  return;
 }
 if (gpsLabel) gpsLabel.value = 'Requesting GPS permission...';
 navigator.geolocation.getCurrentPosition(async (position) => {
  bookingDeviceCoords = {
   latitude: position.coords.latitude,
   longitude: position.coords.longitude,
   accuracy: position.coords.accuracy,
  };
  if (gpsLabel) gpsLabel.value = `${bookingDeviceCoords.latitude.toFixed(6)}, ${bookingDeviceCoords.longitude.toFixed(6)} (+/- ${Math.round(bookingDeviceCoords.accuracy)}m)`;
  if (gpsStatus) gpsStatus.textContent = 'Device GPS ready';
  try {
   const data = await bookingFetch(`/api/customer/${customer.id}/location`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookingDeviceCoords),
   });
   if (data.user) localStorage.setItem('sn_customer_user', JSON.stringify({ ...customer, ...data.user }));
  } catch (error) {
   console.warn(error.message || error);
  }
 }, () => {
  if (gpsLabel) gpsLabel.value = 'GPS permission was denied. Typed address will be used as backup.';
  if (gpsStatus) gpsStatus.textContent = 'Address backup';
 }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

async function submitBookingRequest(event, customer, providerId) {
 event.preventDefault();
 const form = event.currentTarget;
 const submit = form.querySelector('[type="submit"]');
 const formData = new FormData(form);
 const body = {
  provider_id: Number(providerId),
  service: formData.get('service'),
  scheduled_date: formData.get('scheduled_date'),
  scheduled_time: formData.get('scheduled_time'),
  address: formData.get('address'),
 payment_method: formData.get('payment_method'),
 amount: Number(formData.get('amount') || 0),
 ...(bookingDeviceCoords || {}),
 };

 const selectedServiceOption = form.querySelector('#sn-booking-service')?.selectedOptions?.[0];
 const selectedService = bookingProviderServices[Number(selectedServiceOption?.dataset.index || 0)] || null;
 const minPrice = Number(selectedService?.starting_price || 0);
 const maxPrice = Number(selectedService?.max_price || minPrice || 0);
 if (minPrice && body.amount < minPrice) {
  await bookingAlert(`Cash amount must be at least ${bookingMoney(minPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }
 if (maxPrice && body.amount > maxPrice) {
  await bookingAlert(`Cash amount cannot exceed ${bookingMoney(maxPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }

 if (submit) submit.textContent = 'Submitting...';
 try {
  await bookingFetch(`/api/customer/${customer.id}/bookings`, {
   method: 'POST',
   headers: { 'Content-Type': 'application/json' },
   body: JSON.stringify(body),
  });
  if (submit) submit.textContent = 'Booking Submitted';
  window.setTimeout(() => window.location.href = './bookings.html', 700);
 } catch (error) {
  if (submit) submit.textContent = 'Submit Booking Request';
  if (error.status === 409 && error.data?.alternatives) {
   renderBookingAlternatives(error.data.alternatives, providerId);
   const note = document.getElementById('sn-booking-schedule-note');
   if (note) note.textContent = 'That slot was just taken or is unavailable. Choose one of the suggested alternatives.';
   return;
  }
  await bookingAlert(bookingFriendlyError(error.message), {
   title: 'Booking Not Submitted',
   type: 'warning',
  });
 }
}

document.addEventListener('DOMContentLoaded', async () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }
 const bookingsHost = document.getElementById('sn-bookings');
 if (bookingsHost && !window.snCustomerBookings) {
 bookingsHost.innerHTML = '<div class="sn-customer-card"><p>Loading your bookings...</p></div>';
 }

 // Re-fetch fresh verification status from API
 try {
 const _res = await fetch(`${BOOKING_API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
 if (_res.ok) {
 const _data = await _res.json().catch(() => ({}));
 if (_data.user) {
 const _merged = {...currentCustomer,..._data.user };
 localStorage.setItem('sn_customer_user', JSON.stringify(_merged));
 Object.assign(currentCustomer, _merged);
 }
 }
 } catch (_) { /* server offline use cached value */ }

 // Populate sidebar greeting
 const status = currentCustomer?.verification_status || 'pending';
 const userName = document.getElementById('sn-user-name');
 const userStatus = document.getElementById('sn-user-status');
 if (userName) userName.textContent = currentCustomer?.full_name || 'Customer';
 if (userStatus) {
 userStatus.textContent = status === 'verified'? 'Verified customer': status === 'rejected'? 'Verification declined': 'Awaiting verification';
 }

 // Show banner and lock content if not verified
 const _vStatus = currentCustomer?.verification_status || (Boolean(currentCustomer?.is_verified) && currentCustomer?.is_verified!== 'false'? 'verified': 'pending');
 const verifyBanner = document.getElementById('sn-verify-banner');
 if (_vStatus!== 'verified') {
 document.body.classList.add('sn-locked');
 if (verifyBanner) {
 verifyBanner.hidden = false;
 if (status === 'rejected') {
 verifyBanner.textContent = 'Your verification was declined by the admin. Please resubmit your documents.';
 verifyBanner.style.background = '#fef2f2';
 verifyBanner.style.borderLeft = '4px solid #dc2626';
 verifyBanner.style.color = '#991b1b';
 } else {
 verifyBanner.textContent = 'Your account is pending admin verification. Actions are disabled until verified.';
 }
 }
 } else {
 document.body.classList.remove('sn-locked');
 if (verifyBanner) verifyBanner.hidden = true;
 }

 // Sidebar toggle
 const shell = document.querySelector('.sn-shell');
 const overlay = document.getElementById('sn-overlay');
 const hamburger = document.getElementById('sn-hamburger');
 const hamburgerTop = document.getElementById('sn-hamburger-top');
 const logoutBtn = document.getElementById('sn-logout');

 function isMobile() { return window.matchMedia('(max-width: 940px)').matches; }
 function closeSidebar() { shell?.classList.remove('sidebar-open'); shell?.classList.add('sidebar-collapsed'); document.body.style.overflow = ''; }
 function openSidebar() { shell?.classList.remove('sidebar-collapsed'); shell?.classList.add('sidebar-open'); if (isMobile()) document.body.style.overflow = 'hidden'; }
 function toggleSidebar() {
 if (!shell) return;
 const open = shell.classList.contains('sidebar-open') ||!shell.classList.contains('sidebar-collapsed');
 if (open) closeSidebar(); else openSidebar();
 }

 hamburger?.addEventListener('click', toggleSidebar);
 hamburgerTop?.addEventListener('click', toggleSidebar);
 overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
 logoutBtn?.addEventListener('click', () => { localStorage.removeItem('sn_customer_user'); window.location.href = '../../landing/index.html'; });
 if (isMobile()) closeSidebar(); else openSidebar();

 setupBookingActions();
 await renderBookingRequestForm(currentCustomer);

 // Filter tabs
 const tabs = document.querySelectorAll('.sn-filter-tab');
 const groups = document.querySelectorAll('.sn-booking-group');

 tabs.forEach(tab => {
 tab.addEventListener('click', () => {
 tabs.forEach(t => t.classList.remove('active'));
 tab.classList.add('active');
 const filter = tab.dataset.filter;
 groups.forEach(group => {
 if (filter === 'all' || group.dataset.status === filter) {
 group.style.display = '';
 } else {
 group.style.display = 'none';
 }
 });
 });
 });
});
