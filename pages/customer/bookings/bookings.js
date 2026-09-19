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
let bookingProviderProfile = null;

const REPAIR_SERVICE_CONFIGS = {
 'plumbing services': {
  title: 'Plumbing Services',
  pricingType: 'provider_quote',
  baseRange: [500, 1500],
  note: 'Provider will assess the actual condition before confirming the final price.',
  fields: [
   { key: 'problem_type', label: 'Problem type', type: 'select', options: ['Leaking faucet', 'Leaking pipe', 'Clogged drain', 'Clogged toilet', 'Low water pressure', 'Broken/loose fixture', 'Other plumbing issue'] },
   { key: 'location', label: 'Location', type: 'select', options: ['Kitchen', 'Bathroom', 'Laundry area', 'Outdoor', 'Other'] },
   { key: 'severity', label: 'Severity', type: 'select', options: ['Minor', 'Moderate', 'Major / urgent'] },
   { key: 'affected_fixtures', label: 'Number of affected fixtures', type: 'select', options: ['1', '2', '3+'] },
   { key: 'accessible', label: 'Can the issue be seen/accessed easily?', type: 'select', options: ['Yes', 'No'] },
   { key: 'replacement_parts', label: 'Does the customer have replacement parts/materials?', type: 'select', options: ['Yes', 'No', 'Not sure'] },
  ],
 },
 'electrical repair': {
  title: 'Electrical Repair',
  pricingType: 'provider_quote',
  baseRange: [600, 1800],
  note: 'Estimated range only. Provider confirms the safe final quote after assessment.',
  fields: [
   { key: 'problem_type', label: 'What is the problem?', type: 'select', options: ['No electricity in an area', 'Flickering lights', 'Outlet problem', 'Switch problem', 'Circuit breaker issue', 'Wiring issue', 'Other'] },
   { key: 'location', label: 'Location', type: 'select', options: ['Bedroom', 'Kitchen', 'Living room', 'Bathroom', 'Outdoor', 'Other'] },
   { key: 'affected_units', label: 'Number of affected outlets/lights', type: 'select', options: ['1', '2', '3+'] },
   { key: 'burning_smell', label: 'Is there an electrical burning smell/smoke?', type: 'select', options: ['No', 'Yes'] },
   { key: 'without_power', label: 'Is the affected area currently without power?', type: 'select', options: ['No', 'Yes'] },
  ],
 },
 'appliance repair': {
  title: 'Appliance Repair',
  pricingType: 'provider_quote',
  baseRange: [500, 2000],
  note: 'Estimated diagnostic/service range. Provider quotation follows after checking the unit.',
  fields: [
   { key: 'appliance_type', label: 'Appliance type', type: 'text', placeholder: 'Aircon, refrigerator, washer, TV, etc.' },
   { key: 'brand', label: 'Brand', type: 'text', placeholder: 'Brand name' },
   { key: 'model', label: 'Model (optional)', type: 'text', required: false, placeholder: 'Model number if available' },
   { key: 'problem_symptom', label: 'Problem/symptom', type: 'textarea', placeholder: 'Describe what is happening' },
   { key: 'turning_on', label: 'Is the appliance turning on?', type: 'select', options: ['Yes', 'No', 'Sometimes'] },
   { key: 'intermittent', label: 'Is the problem intermittent or continuous?', type: 'select', options: ['Intermittent', 'Continuous', 'Not sure'] },
   { key: 'started', label: 'When did the problem start?', type: 'select', options: ['Today', 'This week', 'This month', 'Longer than a month'] },
   { key: 'visible_damage', label: 'Is there visible damage?', type: 'select', options: ['No', 'Yes', 'Not sure'] },
  ],
 },
 carpentry: {
  title: 'Carpentry',
  pricingType: 'provider_quote',
  baseRange: [700, 2500],
  note: 'Estimated range. Provider confirms materials/labor and final quote.',
  fields: [
   { key: 'work_type', label: 'Type of work', type: 'select', options: ['Repair', 'Replacement', 'Custom work', 'Installation'] },
   { key: 'item_area', label: 'Item/area', type: 'select', options: ['Door', 'Cabinet', 'Table', 'Chair', 'Wall/partition', 'Other'] },
   { key: 'dimensions', label: 'Approximate dimensions', type: 'text', placeholder: 'Example: 2ft x 4ft' },
   { key: 'material', label: 'Material involved', type: 'text', placeholder: 'Wood, plywood, metal frame, etc.' },
   { key: 'quantity', label: 'Quantity', type: 'number', min: 1, placeholder: '1' },
  ],
 },
 'roof repair': {
  title: 'Roof Repair',
  pricingType: 'provider_quote',
  baseRange: [800, 3000],
  note: 'Estimated range. Inspection is needed before final quotation.',
  fields: [
   { key: 'problem_type', label: 'Problem', type: 'select', options: ['Leak', 'Damaged roofing', 'Loose sheet', 'Broken tile', 'Gutter issue', 'Other'] },
   { key: 'roof_size', label: 'Approximate roof size', type: 'select', options: ['Small area', 'Medium area', 'Large area', 'Not sure'] },
   { key: 'affected_areas', label: 'Number of affected areas', type: 'select', options: ['1', '2', '3+'] },
   { key: 'roofing_type', label: 'Type of roofing', type: 'text', placeholder: 'Metal sheet, tile, etc.' },
   { key: 'severity', label: 'Severity', type: 'select', options: ['Minor', 'Moderate', 'Major / urgent'] },
  ],
 },
 'furniture repair': {
  title: 'Furniture Repair',
  pricingType: 'provider_quote',
  baseRange: [400, 1500],
  note: 'Provider will confirm the final quote based on actual materials and labor.',
  fields: [
   { key: 'furniture_type', label: 'Furniture type', type: 'text', placeholder: 'Chair, table, cabinet, sofa, etc.' },
   { key: 'problem_type', label: 'Problem', type: 'select', options: ['Broken', 'Loose', 'Scratch/damage', 'Needs reinforcement', 'Other'] },
   { key: 'material', label: 'Material', type: 'text', placeholder: 'Wood, metal, fabric, etc.' },
   { key: 'size', label: 'Size', type: 'select', options: ['Small', 'Medium', 'Large'] },
   { key: 'quantity', label: 'Quantity', type: 'number', min: 1, placeholder: '1' },
  ],
 },
 'painting services': {
  title: 'Painting Services',
  pricingType: 'calculated',
  note: 'Calculated estimate based on selected area, size, rooms, coats, and surface.',
  fields: [
   { key: 'area', label: 'Area', type: 'select', options: ['Bedroom', 'Living room', 'Kitchen', 'Exterior', 'Whole house'] },
   { key: 'room_size', label: 'Approximate area/room size', type: 'select', options: ['Small', 'Medium', 'Large', 'Custom square meters'] },
   { key: 'custom_sqm', label: 'Custom square meters', type: 'number', min: 1, required: false, placeholder: 'Example: 20' },
   { key: 'rooms', label: 'Number of rooms', type: 'number', min: 1, placeholder: '1' },
   { key: 'coats', label: 'Number of coats', type: 'select', options: ['1', '2', '3'] },
   { key: 'surface', label: 'Surface', type: 'select', options: ['Walls only', 'Walls + ceiling'] },
  ],
 },
 'door and window repair': {
  title: 'Door and Window Repair',
  pricingType: 'provider_quote',
  baseRange: [400, 1800],
  note: 'Provider confirms final quote after checking the unit and material.',
  fields: [
   { key: 'unit_type', label: 'Door/window', type: 'select', options: ['Door', 'Window'] },
   { key: 'material', label: 'Material', type: 'select', options: ['Wood', 'Aluminum', 'Glass', 'Metal'] },
   { key: 'problem_type', label: 'Problem', type: 'select', options: ['Broken', 'Loose', 'Difficult to open', 'Lock issue', 'Glass damage'] },
   { key: 'units', label: 'Number of units', type: 'number', min: 1, placeholder: '1' },
  ],
 },
};

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

function normalizeBookingText(value) {
 return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function selectedBookingService() {
 const serviceSelect = document.getElementById('sn-booking-service');
 const selectedOption = serviceSelect?.options?.[serviceSelect.selectedIndex];
 const service = bookingProviderServices[Number(selectedOption?.dataset.index || 0)] || null;
 return {
  title: selectedOption?.value || service?.title || bookingProviderProfile?.service || '',
  category: service?.category || bookingProviderProfile?.category || '',
  service,
 };
}

function isRepairSelection(selection) {
 const values = [selection?.title, selection?.category, bookingProviderProfile?.category, bookingProviderProfile?.service]
  .map(normalizeBookingText);
 return values.includes('repair services') || values.some(value => Boolean(REPAIR_SERVICE_CONFIGS[value]));
}

function repairServiceKeyFromSelection(selection) {
 const direct = normalizeBookingText(selection?.title);
 if (REPAIR_SERVICE_CONFIGS[direct]) return direct;
 const fallback = normalizeBookingText(bookingProviderProfile?.service);
 if (REPAIR_SERVICE_CONFIGS[fallback]) return fallback;
 return document.getElementById('sn-repair-specific-service')?.value || 'plumbing services';
}

function repairFieldName(key) {
 return `repair_${key}`;
}

function repairFieldValue(key) {
 const field = document.querySelector(`[name="${repairFieldName(key)}"]`);
 return field?.value?.trim() || '';
}

function repairQuestionField(field) {
 const required = field.required === false ? '' : ' required';
 const placeholder = field.placeholder ? ` placeholder="${bookingEsc(field.placeholder)}"` : '';
 const min = field.min ? ` min="${bookingEsc(field.min)}"` : '';
 const name = repairFieldName(field.key);
 if (field.type === 'select') {
  return `
   <label><span>${bookingEsc(field.label)}</span><select name="${bookingEsc(name)}"${required}>
    ${field.options.map(option => `<option value="${bookingEsc(option)}">${bookingEsc(option)}</option>`).join('')}
   </select></label>
  `;
 }
 if (field.type === 'textarea') {
  return `<label class="full"><span>${bookingEsc(field.label)}</span><textarea name="${bookingEsc(name)}"${placeholder}${required}></textarea></label>`;
 }
 return `<label><span>${bookingEsc(field.label)}</span><input name="${bookingEsc(name)}" type="${field.type || 'text'}"${min}${placeholder}${required} /></label>`;
}

function calculateRepairEstimate(config) {
 const key = config.key;
 if (key === 'painting services') {
  const area = repairFieldValue('area');
  const size = repairFieldValue('room_size');
  const customSqm = Number(repairFieldValue('custom_sqm'));
  const rooms = Math.max(1, Number(repairFieldValue('rooms')) || 1);
  const coats = Math.max(1, Number(repairFieldValue('coats')) || 1);
  const surface = repairFieldValue('surface');
  const areaRates = {
   Bedroom: 650,
   'Living room': 900,
   Kitchen: 800,
   Exterior: 1800,
   'Whole house': 3500,
  };
  const sizeMultipliers = {
   Small: 1,
   Medium: 1.35,
   Large: 1.8,
   'Custom square meters': Number.isFinite(customSqm) && customSqm > 0 ? Math.max(1, customSqm / 12) : 1,
  };
  const surfaceMultiplier = surface === 'Walls + ceiling' ? 1.25 : 1;
  const base = areaRates[area] || 650;
  const total = Math.round(base * (sizeMultipliers[size] || 1) * rooms * coats * surfaceMultiplier);
  return { min: total, max: total, amount: total, pricingType: 'calculated' };
 }

 const [baseMin, baseMax] = config.baseRange || [500, 1500];
 const severity = repairFieldValue('severity').toLowerCase();
 const units = repairFieldValue('affected_fixtures') || repairFieldValue('affected_units') || repairFieldValue('affected_areas') || repairFieldValue('units') || repairFieldValue('quantity');
 const inaccessible = repairFieldValue('accessible') === 'No';
 const highRisk = ['Yes', 'Major / urgent', 'Large area'].some(value => [
  repairFieldValue('burning_smell'),
  repairFieldValue('without_power'),
  repairFieldValue('visible_damage'),
  repairFieldValue('roof_size'),
 ].includes(value));
 let min = baseMin;
 let max = baseMax;
 if (severity.includes('moderate')) {
  min += 250;
  max += 500;
 }
 if (severity.includes('major')) {
  min += 650;
  max += 1200;
 }
 if (String(units).includes('2')) {
  min += 150;
  max += 300;
 }
 if (String(units).includes('3')) {
  min += 400;
  max += 700;
 }
 if (inaccessible) {
  min += 200;
  max += 500;
 }
 if (highRisk) {
  min += 250;
  max += 700;
 }
 return { min, max, amount: min, pricingType: 'provider_quote' };
}

function updateRepairEstimateDisplay() {
 const panel = document.getElementById('sn-repair-assessment');
 if (!panel || panel.hidden) return null;
 const key = panel.dataset.serviceKey;
 const config = REPAIR_SERVICE_CONFIGS[key];
 if (!config) return null;
 const estimate = calculateRepairEstimate({ ...config, key });
 const summary = document.getElementById('sn-repair-price-summary');
 const amountInput = document.getElementById('sn-booking-custom-amount');
 if (amountInput) amountInput.value = estimate.amount;
 if (summary) {
  const priceText = estimate.pricingType === 'calculated' || estimate.min === estimate.max
   ? `Calculated estimated price: ${bookingMoney(estimate.amount)}`
   : `Estimated service range: ${bookingMoney(estimate.min)} - ${bookingMoney(estimate.max)}`;
  summary.innerHTML = `
   <strong>${bookingEsc(priceText)}</strong>
   <span>${bookingEsc(config.note)}</span>
  `;
 }
 return estimate;
}

function setManualAmountVisible(visible) {
 const amountChoice = document.getElementById('sn-booking-amount-choice')?.closest('label');
 const amountInput = document.getElementById('sn-booking-custom-amount')?.closest('label');
 if (amountChoice) amountChoice.hidden = !visible;
 if (amountInput) amountInput.hidden = !visible;
}

function renderRepairAssessment() {
 const host = document.getElementById('sn-repair-assessment');
 if (!host) return;
 const selection = selectedBookingService();
 const showAssessment = isRepairSelection(selection);
 setManualAmountVisible(!showAssessment);
 if (!showAssessment) {
  host.hidden = true;
  host.innerHTML = '';
  return;
 }

 const directKey = normalizeBookingText(selection.title);
 const needsSpecific = !REPAIR_SERVICE_CONFIGS[directKey];
 const selectedKey = repairServiceKeyFromSelection(selection);
 const config = REPAIR_SERVICE_CONFIGS[selectedKey] || REPAIR_SERVICE_CONFIGS['plumbing services'];
 host.hidden = false;
 host.dataset.serviceKey = selectedKey;
 host.innerHTML = `
  <div class="sn-repair-assessment-head">
   <div>
    <h4>Repair Services Assessment</h4>
    <p>Select the specific work and answer the service questions. The system will prepare the estimate for the provider.</p>
   </div>
   <span>${bookingEsc(config.pricingType === 'calculated' ? 'Calculated Price' : 'Assessment / Quote')}</span>
  </div>
  <div class="sn-repair-assessment-grid">
   ${needsSpecific ? `
    <label><span>Specific repair work</span><select id="sn-repair-specific-service">
     ${Object.entries(REPAIR_SERVICE_CONFIGS).map(([key, item]) => `<option value="${bookingEsc(key)}"${key === selectedKey ? ' selected' : ''}>${bookingEsc(item.title)}</option>`).join('')}
    </select></label>
   ` : ''}
   ${config.fields.map(repairQuestionField).join('')}
   <label class="full"><span>Photo/video (optional)</span><input id="sn-repair-media" name="assessmentMedia" type="file" accept="image/*,video/*" multiple /><small>Upload up to 3 files if it helps the provider inspect the problem.</small></label>
  </div>
  <div class="sn-repair-price-summary" id="sn-repair-price-summary"></div>
 `;
 document.getElementById('sn-repair-specific-service')?.addEventListener('change', () => renderRepairAssessment());
 host.querySelectorAll('input, select, textarea').forEach((field) => {
  if (field.id !== 'sn-repair-specific-service') {
   field.addEventListener('input', updateRepairEstimateDisplay);
   field.addEventListener('change', updateRepairEstimateDisplay);
  }
 });
 updateRepairEstimateDisplay();
}

function collectRepairAssessment(form) {
 const panel = document.getElementById('sn-repair-assessment');
 if (!panel || panel.hidden) return null;
 const key = panel.dataset.serviceKey;
 const config = REPAIR_SERVICE_CONFIGS[key];
 if (!config) return null;
 const estimate = updateRepairEstimateDisplay() || calculateRepairEstimate({ ...config, key });
 const answers = {};
 config.fields.forEach((field) => {
  answers[field.label] = repairFieldValue(field.key);
 });
 const mediaInput = form.querySelector('#sn-repair-media');
 const mediaFiles = [...(mediaInput?.files || [])].slice(0, 3);
 return {
  amount: estimate.amount,
  estimatedMin: estimate.min,
  estimatedMax: estimate.max,
  pricingType: estimate.pricingType,
  mediaFiles,
  details: {
   category: 'Repair Services',
   service_type: config.title,
   pricing_type: estimate.pricingType,
   estimate_label: estimate.pricingType === 'calculated' || estimate.min === estimate.max
    ? `Calculated estimated price: ${bookingMoney(estimate.amount)}`
    : `Estimated service range: ${bookingMoney(estimate.min)} - ${bookingMoney(estimate.max)}`,
   note: config.note,
   answers,
   media_files: mediaFiles.map(file => ({ name: file.name, type: file.type || '' })),
  },
 };
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

function bookingEstimateLabel(booking) {
 const min = Number(booking?.estimated_min || 0);
 const max = Number(booking?.estimated_max || 0);
 const type = booking?.pricing_type || booking?.service_details?.pricing_type || '';
 if (type === 'calculated' || (min && max && min === max)) return bookingMoney(booking.amount || min);
 if (min && max) return `${bookingMoney(min)} - ${bookingMoney(max)}`;
 if (min) return `Starts at ${bookingMoney(min)}`;
 return bookingMoney(booking?.amount || 0);
}

function bookingServiceDetailRows(details = {}) {
 const rows = [];
 if (details.service_type) rows.push(bookingDetailRow('Specific work', details.service_type));
 if (details.estimate_label) rows.push(bookingDetailRow('Estimate', details.estimate_label));
 const answers = details.answers && typeof details.answers === 'object' ? details.answers : {};
 Object.entries(answers).forEach(([label, value]) => {
  if (value) rows.push(bookingDetailRow(label, value));
 });
 return rows.join('');
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
    ${bookingDetailRow('Amount / estimate', bookingEstimateLabel(item))}
    ${bookingDetailRow('Payment', item.payment_method || 'cash')}
    ${bookingDetailRow('Service address', item.address)}
    ${bookingDetailRow('Customer pin', customerPin)}
    ${bookingDetailRow('Provider GPS', providerLocation)}
    ${bookingServiceDetailRows(item.service_details)}
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
  bookingProviderProfile = provider;
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
   <section class="sn-repair-assessment full" id="sn-repair-assessment" hidden></section>
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
 renderRepairAssessment();
 document.getElementById('sn-booking-service')?.addEventListener('change', () => {
  updateBookingPaymentChoices();
  renderRepairAssessment();
 });
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
 const repairAssessment = collectRepairAssessment(form);
 const body = {
  provider_id: Number(providerId),
  service: repairAssessment?.details?.service_type || formData.get('service'),
  scheduled_date: formData.get('scheduled_date'),
  scheduled_time: formData.get('scheduled_time'),
  address: formData.get('address'),
 payment_method: formData.get('payment_method'),
 amount: repairAssessment?.amount ?? Number(formData.get('amount') || 0),
 pricing_type: repairAssessment?.pricingType || 'provider_quote',
 estimated_min: repairAssessment?.estimatedMin ?? Number(formData.get('amount') || 0),
 estimated_max: repairAssessment?.estimatedMax ?? Number(formData.get('amount') || 0),
 service_details: repairAssessment?.details || {},
 ...(bookingDeviceCoords || {}),
 };

 const selectedServiceOption = form.querySelector('#sn-booking-service')?.selectedOptions?.[0];
 const selectedService = bookingProviderServices[Number(selectedServiceOption?.dataset.index || 0)] || null;
 const minPrice = Number(selectedService?.starting_price || 0);
 const maxPrice = Number(selectedService?.max_price || minPrice || 0);
 if (!repairAssessment && minPrice && body.amount < minPrice) {
  await bookingAlert(`Cash amount must be at least ${bookingMoney(minPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }
 if (!repairAssessment && maxPrice && body.amount > maxPrice) {
  await bookingAlert(`Cash amount cannot exceed ${bookingMoney(maxPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }

 if (submit) submit.textContent = 'Submitting...';
 try {
  if (repairAssessment?.mediaFiles?.length) {
   const payload = new FormData();
   Object.entries(body).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    payload.append(key, key === 'service_details' ? JSON.stringify(value) : String(value));
   });
   repairAssessment.mediaFiles.slice(0, 3).forEach((file) => payload.append('assessmentMedia', file));
   await bookingFetch(`/api/customer/${customer.id}/bookings`, {
    method: 'POST',
    body: payload,
   });
  } else {
   await bookingFetch(`/api/customer/${customer.id}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
   });
  }
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
 const applyBookingFilter = (filter = 'all') => {
  document.querySelectorAll('.sn-booking-group').forEach(group => {
   group.style.display = filter === 'all' || group.dataset.status === filter ? '' : 'none';
  });
 };

 tabs.forEach(tab => {
 tab.addEventListener('click', () => {
 tabs.forEach(t => t.classList.remove('active'));
 tab.classList.add('active');
 applyBookingFilter(tab.dataset.filter);
 });
 });
 document.addEventListener('sn:customer-bookings-rendered', () => {
  const activeFilter = document.querySelector('.sn-filter-tab.active')?.dataset.filter || 'all';
  applyBookingFilter(activeFilter);
 });
});
