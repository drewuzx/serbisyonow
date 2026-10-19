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
 const headers = new Headers(options.headers);
 if (getCurrentCustomer()?.auth_token) headers.set('Authorization', `Bearer ${getCurrentCustomer().auth_token}`);
 const response = await fetch(`${BOOKING_API_BASE}${path}`, { ...options, headers });
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

function providerPriceSelection() {
 const host = document.getElementById('sn-provider-price-options');
 return { addons: [...(host?.querySelectorAll('[data-provider-addon]:checked') || [])].map(input => ({
  id: input.dataset.providerAddon,
  quantity: Number(input.closest('.sn-booking-addon').querySelector('input[type="number"]').value),
 })) };
}

function applyProviderEstimate(estimate) {
 return window.SNProviderPricing.apply(estimate, selectedBookingService().service, providerPriceSelection());
}

function renderProviderPriceOptions() {
 const host = document.getElementById('sn-provider-price-options');
 if (!host) return;
 const service = selectedBookingService().service, config = service?.pricing_config;
 host.hidden = !config;
 host.innerHTML = '';
 if (!config) return;
 setManualAmountVisible(false);
 const addons = config.addons.filter(addon => addon.enabled);
 host.innerHTML = `<h4>Provider Pricing</h4>
  ${config.service_area ? `<p><strong>Service area:</strong> ${bookingEsc(config.service_area)}</p>` : ''}
  <p><strong>${config.mode === 'house_matrix' ? 'Duration' : 'Typical duration'}:</strong> ${bookingEsc(config.duration)}</p>
  ${config.notes ? `<p><strong>Special instructions:</strong> ${bookingEsc(config.notes)}</p>` : ''}
  ${addons.length ? `<fieldset><legend>Optional add-ons</legend>${addons.map((addon, i) => `<div class="sn-booking-addon">
   <label><input type="checkbox" data-provider-addon="${bookingEsc(addon.id)}"><span>${bookingEsc(addon.name)}<small>${bookingMoney(addon.min)}${addon.max !== addon.min ? ` - ${bookingMoney(addon.max)}` : ''} / ${bookingEsc(addon.unit.replace('Per ', '').toLowerCase())}</small></span></label>
   <label class="sn-booking-addon-quantity">Quantity<input type="number" aria-label="${bookingEsc(addon.name)} quantity" min="1" max="${addon.unit === 'Per service' ? '1' : '100'}" step="1" value="1" disabled data-addon-quantity="${i}"></label>
  </div>`).join('')}</fieldset>` : ''}<div id="sn-provider-generic-estimate" role="status"></div>`;
 host.querySelectorAll('[data-provider-addon]').forEach(input => input.addEventListener('change', () => {
  const quantity = input.closest('.sn-booking-addon').querySelector('input[type="number"]');
  quantity.disabled = !input.checked;
  updateProviderPriceOptions();
 }));
 host.querySelectorAll('[data-addon-quantity]').forEach(input => input.addEventListener('input', updateProviderPriceOptions));
 updateProviderPriceOptions();
}

function updateProviderPriceOptions() {
 const category = calculatedBookingCategories().find(item => !document.getElementById(`sn-${item.id}-assessment`)?.hidden);
 if (category) return updateCalculatedEstimateDisplay(category);
 const repair = document.getElementById('sn-repair-assessment');
 if (repair && !repair.hidden) return updateRepairEstimateDisplay();
 const summary = document.getElementById('sn-provider-generic-estimate');
 if (!summary) return;
 try {
  const estimate = applyProviderEstimate(null);
  summary.textContent = estimate?.details.estimate_label || '';
 } catch (error) { summary.textContent = error.message; }
}

function isRepairSelection(selection) {
 const values = [selection?.title, selection?.category]
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
 let estimate = calculateRepairEstimate({ ...config, key });
 if (selectedBookingService().service?.pricing_config) {
  try {
   const priced = applyProviderEstimate({ ...estimate, details: { service_type: config.title, category: 'Repair Services' } });
   estimate = { ...priced, min: priced.estimatedMin, max: priced.estimatedMax };
  } catch (error) { document.getElementById('sn-repair-price-summary').textContent = error.message; return null; }
 }
 const summary = document.getElementById('sn-repair-price-summary');
 const amountInput = document.getElementById('sn-booking-custom-amount');
 if (amountInput) amountInput.value = estimate.amount;
 if (summary) {
  const priceText = estimate.pricingType === 'calculated' || estimate.min === estimate.max
   ? `Calculated estimated price: ${bookingMoney(estimate.amount)}`
   : `Estimated service range: ${bookingMoney(estimate.min)} - ${bookingMoney(estimate.max)}`;
  summary.innerHTML = `
   <strong>${bookingEsc(priceText)}</strong>
   <span>${bookingEsc(estimate.details?.note || config.note)}</span>
  `;
 }
 return estimate;
}

function setManualAmountVisible(visible) {
 const amountChoice = document.getElementById('sn-booking-amount-choice')?.closest('label');
 const amountInput = document.getElementById('sn-booking-custom-amount')?.closest('label');
 if (amountChoice) amountChoice.hidden = !visible;
 if (amountInput) amountInput.hidden = !visible;
 amountChoice?.querySelectorAll('input, select').forEach(field => { field.disabled = !visible; });
 amountInput?.querySelectorAll('input, select').forEach(field => { field.disabled = !visible; });
}

function calculatedBookingCategories() {
 const service = selectedBookingService().service;
 return [
  { id: 'cleaning', prefix: 'cleaning', title: 'Cleaning Services', pricing: window.SNCleaningPricing,
   context: { pickupDelivery: service?.laundry_pickup_delivery === true } },
  { id: 'personal-care', prefix: 'personal_care', title: 'Personal Care', pricing: window.SNPersonalCarePricing,
   context: { massageTypes: service?.massage_types || [] } },
  { id: 'appliance', prefix: 'appliance', title: 'Appliance Maintenance', pricing: window.SNAppliancePricing, context: {} },
  { id: 'installation', prefix: 'installation', title: 'Installation Services', pricing: window.SNInstallationPricing, context: {} },
  { id: 'outdoor', prefix: 'outdoor', title: 'Outdoor and Property Maintenance', pricing: window.SNOutdoorPricing, context: {} },
 ];
}

function calculatedFields(category, key, inputs = {}) {
 const fields = category.pricing.fields?.(key, category.context, inputs) || category.pricing.configs[key].fields;
 const config = selectedBookingService().service?.pricing_config;
 if (key === 'general house cleaning' && config?.mode === 'house_matrix' && config.duration !== 'Flexible') {
  return fields.map(field => field.key === 'duration' ? { ...field, options: [config.duration] } : field);
 }
 return fields;
}

function calculatedInputs(category) {
 const panel = document.getElementById(`sn-${category.id}-assessment`);
 const config = category.pricing.configs[panel?.dataset.serviceKey];
 if (!config) return {};
 return Object.fromEntries(config.fields.map(field => {
  const controls = [...panel.querySelectorAll(`[name="${category.prefix}_${field.key}"]`)];
  return [field.key, field.type === 'checkboxes' ? controls.filter(input => input.checked).map(input => input.value) : controls[0]?.value || ''];
 }));
}

function calculatedQuestionField(field, defaults, category) {
 const name = `${category.prefix}_${field.key}`;
 const id = `sn-${name}`;
 const wrapper = `data-service-field="${field.key}"`;
 if (field.type === 'checkboxes') {
  return `<fieldset class="sn-calculated-areas full" ${wrapper}><legend>${bookingEsc(field.label)}</legend><div>${field.options.map((option, i) =>
   `<label for="${id}-${i}"><input id="${id}-${i}" type="checkbox" name="${name}" value="${bookingEsc(option)}" /><span>${bookingEsc(option)}</span></label>`).join('')}</div></fieldset>`;
 }
 const required = field.required === false ? '' : ' required';
 const placeholder = field.placeholder ? ` placeholder="${bookingEsc(field.placeholder)}"` : '';
 const length = field.maxLength ? ` maxlength="${field.maxLength}"` : '';
 const control = field.type === 'select'
  ? `<select id="${id}" name="${name}"${required}>${field.options.map(option => `<option value="${bookingEsc(option)}"${option === defaults[field.key] ? ' selected' : ''}>${bookingEsc(option)}</option>`).join('')}</select>`
  : field.type === 'textarea'
   ? `<textarea id="${id}" name="${name}"${length}${placeholder}${required}>${bookingEsc(defaults[field.key])}</textarea>`
   : `<input id="${id}" name="${name}" type="${field.type}" value="${bookingEsc(defaults[field.key])}"${field.type === 'number' ? ` min="${field.min}" max="${field.max}" step="${field.step}"` : length}${placeholder}${required} />`;
 return `<label${field.type === 'textarea' ? ' class="full"' : ''} ${wrapper} for="${id}"><span>${bookingEsc(field.label)}</span>${control}</label>`;
}

function updateCalculatedEstimateDisplay(category) {
 const panel = document.getElementById(`sn-${category.id}-assessment`);
 if (!panel || panel.hidden || panel.dataset.rendering === 'true') return null;
 const { pricing, context } = category;
 const key = panel.dataset.serviceKey;
 const inputs = calculatedInputs(category);
 calculatedFields(category, key, inputs).forEach(field => {
  const wrapper = panel.querySelector(`[data-service-field="${field.key}"]`);
  if (field.type === 'select') {
   const select = wrapper.querySelector('select');
   const currentOptions = [...select.options].map(option => option.value);
   if (JSON.stringify(currentOptions) !== JSON.stringify(field.options)) {
    const previous = select.value;
    select.innerHTML = field.options.map(value => `<option value="${bookingEsc(value)}">${bookingEsc(value)}</option>`).join('');
    if (field.options.includes(previous)) select.value = previous;
    inputs[field.key] = select.value;
   }
  }
  const visible = pricing.fieldVisible(field, inputs, context);
  wrapper.hidden = !visible;
  wrapper.querySelectorAll('input, select, textarea').forEach(input => { input.disabled = !visible; });
 });
 const summary = panel.querySelector('.sn-calculated-price-summary');
 try {
  const estimate = applyProviderEstimate(pricing.assessment(key, inputs, context));
  const mode = panel.querySelector('.sn-calculated-head > span');
  if (mode) mode.textContent = estimate.details.provider_pricing ? 'Provider estimate' : estimate.pricingType === 'provider_quote' ? 'Assessment / Quote' : 'Sample estimate';
  summary.innerHTML = `<h5>Price breakdown <span>${estimate.details.provider_pricing ? 'Provider rates' : 'Sample rates'}</span></h5><dl>${estimate.details.breakdown.map(item =>
   `<div><dt>${bookingEsc(item.label)}</dt><dd>${bookingMoney(item.amount)}${item.max_amount !== undefined ? ` - ${bookingMoney(item.max_amount)}` : ''}</dd></div>`).join('')}</dl>
   <p class="sn-calculated-total sn-${category.id}-total" role="status">${bookingEsc(estimate.details.estimate_label)}</p><p>${bookingEsc(estimate.details.note)}</p>`;
  return estimate;
 } catch (error) {
  summary.innerHTML = `<p role="status">${bookingEsc(error.message)}</p>`;
  return null;
 }
}

function renderBookingAssessment() {
 const selection = selectedBookingService();
 const categories = calculatedBookingCategories();
 const category = categories.find(item => item.pricing.serviceKey(selection.title) || item.pricing.isCategory(selection.title) || item.pricing.serviceKeys?.(selection.title)?.length);
 categories.forEach(item => {
  if (item === category) return;
  const inactive = document.getElementById(`sn-${item.id}-assessment`);
  inactive.hidden = true;
  inactive.innerHTML = '';
  delete inactive.dataset.serviceKey;
 });
 if (!category) {
  renderRepairAssessment();
  renderProviderPriceOptions();
  return;
 }
 const repair = document.getElementById('sn-repair-assessment');
 repair.hidden = true;
 repair.innerHTML = '';
 setManualAmountVisible(false);
 const { pricing, context } = category;
 const panel = document.getElementById(`sn-${category.id}-assessment`);
 const selectorId = `sn-${category.id}-specific-service`;
 const directKey = pricing.serviceKey(selection.title);
 const serviceKeys = pricing.serviceKeys?.(selection.title) || Object.keys(pricing.configs);
 const previous = panel.querySelector(`#${selectorId}`)?.value;
 const key = directKey || (serviceKeys.includes(previous) ? previous : serviceKeys[0]);
 const defaults = pricing.defaults(key, context);
 panel.hidden = false;
 // Replacing a focused input can fire its change event before the new fields exist.
 panel.dataset.rendering = 'true';
 panel.dataset.serviceKey = key;
 panel.innerHTML = `<div class="sn-calculated-head"><h4>${category.title}</h4><span>${pricing.configs[key].pricingType === 'provider_quote' ? 'Assessment / Quote' : 'Sample estimate'}</span></div>
  <div class="sn-calculated-grid">${!directKey ? `<label class="full"><span>Specific service</span><select id="${selectorId}">${serviceKeys.map(value => `<option value="${bookingEsc(value)}"${value === key ? ' selected' : ''}>${bookingEsc(pricing.configs[value].title)}</option>`).join('')}</select></label>` : ''}
  ${calculatedFields(category, key, defaults).map(field => calculatedQuestionField(field, defaults, category)).join('')}
  ${pricing.configs[key].media ? `<label class="full"><span>Photo/video (optional)</span><input id="sn-${category.id}-media" type="file" accept="image/*,video/*" multiple /><small>Up to 3 photos/videos, 10 MB each.</small></label>` : ''}</div>
  <div class="sn-calculated-price-summary sn-${category.id}-price-summary"></div>`;
 delete panel.dataset.rendering;
 panel.querySelector(`#${selectorId}`)?.addEventListener('change', renderBookingAssessment);
 const media = panel.querySelector(`#sn-${category.id}-media`);
 media?.addEventListener('change', () => {
  try { calculatedAssessmentMedia(panel, category); media.setCustomValidity(''); }
  catch (error) { media.setCustomValidity(error.message); media.reportValidity(); }
 });
 panel.querySelectorAll(`[name^="${category.prefix}_"]`).forEach(input => {
  input.addEventListener('input', () => updateCalculatedEstimateDisplay(category));
  input.addEventListener('change', () => updateCalculatedEstimateDisplay(category));
 });
 renderProviderPriceOptions();
 updateCalculatedEstimateDisplay(category);
}

function collectCalculatedAssessment() {
 const category = calculatedBookingCategories().find(item => !document.getElementById(`sn-${item.id}-assessment`)?.hidden);
 if (!category) return null;
 const panel = document.getElementById(`sn-${category.id}-assessment`);
 const estimate = applyProviderEstimate(category.pricing.assessment(panel.dataset.serviceKey, calculatedInputs(category), category.context));
 estimate.mediaFiles = calculatedAssessmentMedia(panel, category);
 return estimate;
}

function calculatedAssessmentMedia(panel, category) {
 const files = [...(panel.querySelector(`#sn-${category.id}-media`)?.files || [])];
 if (files.length > 3) throw new Error('Upload up to 3 photos/videos.');
 if (files.some(file => !/^(image|video)\//.test(file.type))) throw new Error('Attach photos or videos only.');
 if (files.some(file => file.size > 10 * 1024 * 1024)) throw new Error('Each photo/video must be 10 MB or smaller.');
 return files;
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
 const services = bookingProviderServices;
 if (!services.length) return '<option value="">No services available</option>';
 return services.map((service, index) => {
  const calculated = [window.SNCleaningPricing, window.SNPersonalCarePricing, window.SNAppliancePricing, window.SNInstallationPricing, window.SNOutdoorPricing]
   .some(pricing => pricing.serviceKey(service.title) || pricing.isCategory(service.title) || pricing.serviceKeys?.(service.title)?.length);
  return `
  <option value="${bookingEsc(service.title)}" data-index="${index}">
   ${bookingEsc(service.title)}${!calculated && service.starting_price ? ` - ${bookingMoney(service.starting_price)}${service.max_price && service.max_price !== service.starting_price ? ` to ${bookingMoney(service.max_price)}` : ''}` : ''}
  </option>
 `;
 }).join('');
}

function updateBookingPaymentChoices() {
 const serviceSelect = document.getElementById('sn-booking-service');
 const amountSelect = document.getElementById('sn-booking-amount-choice');
 const customAmount = document.getElementById('sn-booking-custom-amount');
 const amountHint = document.getElementById('sn-booking-amount-hint');
 if (!serviceSelect || !amountSelect || !customAmount) return;

 const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
 const service = bookingProviderServices[Number(selectedOption?.dataset.index || 0)] || null;
 const payment = document.getElementById('sn-booking-payment');
 const previousPayment = payment.value;
 const methods = [];
 if (service?.accepts_cash) methods.push(['cash', 'Cash']);
 if (service?.accepts_gcash) methods.push(['gcash', 'QR']);
 payment.innerHTML = methods.length ? methods.map(([value, label]) => `<option value="${value}">${label}</option>`).join('') : '<option value="">No payment options available</option>';
 if (methods.some(([value]) => value === previousPayment)) payment.value = previousPayment;
 payment.disabled = !methods.length;
 serviceSelect.disabled = !service;
 const submit = document.querySelector('#sn-create-booking-form [type="submit"]');
 if (submit) submit.disabled = !service || !methods.length;
 updateBookingPaymentNote();
 const min = Number(service?.starting_price || 0);
 const max = Number(service?.max_price || min || 0);
 const midpoint = min && max && max !== min ? Math.round((min + max) / 2) : 0;
 const amounts = [...new Set([min, midpoint, max].filter(value => value > 0))];

 amountSelect.innerHTML = amounts.length
  ? amounts.map((amount, index) => `<option value="${amount}">${index === 0 ? 'Starting price' : index === amounts.length - 1 ? 'Maximum price' : 'Mid price'} - ${bookingMoney(amount)}</option>`).join('') + '<option value="custom">Custom amount</option>'
  : '<option value="custom">Custom amount</option>';
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

function updateBookingPaymentNote() {
 const value = document.getElementById('sn-booking-payment')?.value;
 const note = document.getElementById('sn-booking-payment-note');
 if (note) note.textContent = value === 'gcash'
  ? "Remaining 70% is paid using the provider's QR after service."
  : value === 'cash' ? 'Remaining 70% is paid directly to the provider in cash after service.'
   : 'This service cannot accept new bookings right now.';
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
 if (booking?.confirmed_price != null) return bookingMoney(booking.confirmed_price);
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
 let productLink = '';
 if (details.product_url) {
  try {
   const url = new URL(details.product_url);
   if (['http:', 'https:'].includes(url.protocol)) productLink = url.href;
  } catch {}
 }
 if (details.service_type) rows.push(bookingDetailRow('Specific work', details.service_type));
 if (details.estimate_label) rows.push(bookingDetailRow('Estimate', details.estimate_label));
 if (details.sample_rates && details.note) rows.push(bookingDetailRow('Pricing note', details.note));
 (details.breakdown || []).forEach(item => rows.push(bookingDetailRow(item.label,
  `${bookingMoney(item.amount)}${item.max_amount !== undefined ? ` - ${bookingMoney(item.max_amount)}` : ''}`)));
 const answers = details.answers && typeof details.answers === 'object' ? details.answers : {};
 Object.entries(answers).forEach(([label, value]) => {
  if (productLink && value === productLink) rows.push(`<div class="sn-booking-detail-item"><span>${bookingEsc(label)}</span><strong><a href="${bookingEsc(productLink)}" target="_blank" rel="noopener">Open product link</a></strong></div>`);
  else if (value) rows.push(bookingDetailRow(label, value));
 });
 const files = (details.media_files || []).filter(file => file?.url);
 if (files.length) rows.push(`<div class="sn-booking-detail-item sn-booking-detail-files"><span>Photos/videos</span><div>${files.map(file =>
  `<a href="${bookingEsc(file.url)}" target="_blank" rel="noopener">${bookingEsc(file.name || 'Uploaded file')}</a>`).join('')}</div></div>`);
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
    ${bookingDetailRow(item.deposit_required ? 'Remaining balance method' : 'Payment', ({ cash: 'Cash', gcash: 'QR', qr: 'QR' })[item.payment_method || 'cash'] || item.payment_method)}
    ${item.deposit_required ? bookingDetailRow('Downpayment', item.deposit_status.replace(/_/g, ' ')) : ''}
    ${item.deposit_amount != null ? bookingDetailRow('30% downpayment', bookingMoney(item.deposit_amount)) + bookingDetailRow('70% remaining balance', bookingMoney(item.balance_due)) : ''}
    ${item.price_notes ? bookingDetailRow('Confirmed price notes', item.price_notes) : ''}
    ${item.deposit_livemode === false ? bookingDetailRow('Payment mode', 'Test payment only. No real funds received.') : ''}
    ${item.deposit_status === 'refund_review' ? bookingDetailRow('Refund', 'Review required. Not automatically refunded; contact support.') : ''}
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

async function showBookingPayment(bookingId, returnState = '') {
 const customer = getCurrentCustomer();
 if (!customer?.id || document.querySelector('.sn-downpayment-modal')) return;
 const previousFocus = document.activeElement;
 const modal = document.createElement('div');
 modal.className = 'sn-modal sn-downpayment-modal';
 modal.setAttribute('role', 'dialog');
 modal.setAttribute('aria-modal', 'true');
 modal.setAttribute('aria-labelledby', 'sn-downpayment-title');
 modal.innerHTML = `<div class="sn-modal-card"><button type="button" class="sn-modal-close" aria-label="Close">x</button><h3 id="sn-downpayment-title" class="sn-modal-title">Booking Downpayment</h3><div class="sn-downpayment-content">Loading payment details...</div><p class="sn-downpayment-message" role="status"></p><div class="sn-modal-actions"><button type="button" class="btn btn-outline" data-payment-refresh>Refresh Status</button><button type="button" class="btn btn-primary" data-payment-pay hidden>Pay 30%</button></div></div>`;
 document.body.appendChild(modal);
 document.body.classList.add('sn-modal-open');
 let booking;
 let busy = false;
 let stopLiveRefresh = () => {};
 let loading = false;
 let paymentSignature = '';
 let loadVersion = 0;
 let releaseReceiptImage = () => {};
 const message = modal.querySelector('[role="status"]');
 const pay = modal.querySelector('[data-payment-pay]');
 const refresh = modal.querySelector('[data-payment-refresh]');
 const close = () => { if (busy) return; stopLiveRefresh(); releaseReceiptImage(); document.removeEventListener('keydown', onKey); closeBookingModal(modal); previousFocus?.focus(); };
 const onKey = event => {
  if (event.key === 'Escape') close();
  if (event.key === 'Tab') {
   const controls = [...modal.querySelectorAll('button:not(:disabled):not([hidden]), input, a[href]')];
   if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1).focus(); }
   else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
  }
 };
 document.addEventListener('keydown', onKey);
 modal.querySelector('.sn-modal-close').onclick = close;
 modal.onclick = event => { if (event.target === modal) close(); };
 const load = async ({ background = false } = {}) => {
  if ((loading && background) || busy) return;
  loading = true;
  const version = ++loadVersion;
  if (!background) { refresh.disabled = true; pay.disabled = true; }
  try {
   const data = await bookingFetch(`/api/customer/${customer.id}/bookings/${encodeURIComponent(bookingId)}/payment`);
   if (background && !window.snLiveRefresh?.isIdle()) return;
   if (!modal.isConnected || version !== loadVersion) return;
   const signature = JSON.stringify(data);
   if (background && signature === paymentSignature) return;
   paymentSignature = signature;
   booking = data.booking;
   const direct = booking.deposit_channel === 'provider_qr';
   const awaiting = booking.status === 'pending' && booking.deposit_status === 'awaiting_payment';
   const paid = booking.deposit_status === 'paid';
   const balanceQr = paid && ['upcoming', 'ongoing', 'completed'].includes(booking.status) && ['gcash', 'qr'].includes(booking.payment_method);
   const qrUrl = direct && data.recipient && window.snDirectPayments?.qrUrl(BOOKING_API_BASE, data.recipient.qr_url);
   releaseReceiptImage();
   modal.querySelector('.sn-downpayment-content').innerHTML = `<p><strong>${bookingEsc(booking.service)}</strong></p>
    ${booking.confirmed_price != null ? `<dl class="sn-downpayment-breakdown"><div><dt>Confirmed service total</dt><dd>${bookingMoney(booking.confirmed_price)}</dd></div><div><dt>30% downpayment due now</dt><dd>${bookingMoney(booking.deposit_amount)}</dd></div><div><dt>70% remaining balance</dt><dd>${bookingMoney(booking.balance_due)}</dd></div></dl>` : '<p>Waiting for the provider to confirm the service price.</p>'}
    ${booking.price_notes ? `<p>${bookingEsc(booking.price_notes)}</p>` : ''}
    ${direct && qrUrl ? `<section class="sn-direct-recipient"><h4>Pay ${bookingEsc(data.recipient.wallet)} directly</h4><p><strong>${bookingEsc(data.recipient.account_name)}</strong><br>${bookingEsc(data.recipient.account_number)}</p>${awaiting ? `<img class="sn-payment-qr-image" src="${bookingEsc(qrUrl)}" alt="Provider payment QR" /><a class="btn btn-outline btn-sm" href="${bookingEsc(qrUrl)}" target="_blank" rel="noopener">Open QR</a><p>Send exactly <strong>${bookingMoney(booking.deposit_amount)}</strong>. Check the recipient name in your payment app before confirming.</p>` : ''}</section>` : ''}
    ${balanceQr && qrUrl ? `<section class="sn-direct-balance"><h4>Remaining Balance - QR</h4><img class="sn-payment-qr-image" src="${bookingEsc(qrUrl)}" alt="Provider QR for remaining balance" /><a class="btn btn-outline btn-sm" href="${bookingEsc(qrUrl)}" target="_blank" rel="noopener">Open QR</a><p>${bookingMoney(booking.balance_due)} is due after service. Confirm the recipient with your provider before paying. Pay only once; the provider must verify the transfer. Balance payment is not automatically tracked here.</p></section>` : ''}
    ${direct && data.receipt ? `<section class="sn-direct-receipt"><h4>Submitted payment</h4><p>Reference: <strong>${bookingEsc(data.receipt.reference_number)}</strong></p><p>${bookingEsc(data.receipt.status.replace(/_/g, ' '))}${data.receipt.review_note ? ': ' + bookingEsc(data.receipt.review_note) : ''}</p><img class="sn-payment-receipt-image" data-payment-receipt-image alt="Your submitted receipt" hidden /><p data-receipt-error role="alert" hidden></p></section>` : ''}
    ${awaiting && (!direct || !booking.customer_agreed_at) ? '<label class="sn-payment-consent"><input type="checkbox" data-payment-consent /> <span>I agree to this service price and the 30% downpayment. The remaining balance is due after service. Canceled payments require refund review.</span></label>' : ''}
    ${direct && awaiting && qrUrl ? `<form class="sn-direct-receipt-form"><label>Transaction reference<input name="reference_number" minlength="4" maxlength="120" required autocomplete="off" /></label><label>Payment receipt<input name="receipt" type="file" accept="image/png,image/jpeg,image/webp" required /></label><button class="btn btn-primary" type="submit">Submit Payment Receipt</button></form>` : ''}`;
   if (direct && data.receipt) releaseReceiptImage = window.snDirectPayments.loadReceiptImage(modal, BOOKING_API_BASE, 'customer', customer.auth_token, data.receipt.id);
   pay.textContent = direct ? 'Show Provider QR' : 'Pay 30%';
   pay.hidden = !awaiting || (direct && Boolean(booking.customer_agreed_at));
   pay.disabled = true;
   modal.querySelector('[data-payment-consent]')?.addEventListener('change', event => { pay.disabled = !event.target.checked || (!direct && !data.checkout_configured); });
   modal.querySelector('.sn-direct-receipt-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (busy || !form.reportValidity()) return;
    const file = form.elements.receipt.files[0];
    if (file.size > 5 * 1024 * 1024) { message.textContent = 'Receipt must be 5 MB or smaller.'; return; }
    const body = new FormData(form);
    body.append('price_version', booking.price_version);
    busy = true;
    form.querySelector('button').disabled = refresh.disabled = true;
    try {
     await bookingFetch(`/api/customer/${customer.id}/bookings/${booking.id}/direct-payment/receipt`, { method: 'POST', body });
     busy = false;
     await load();
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; if (form.isConnected) form.querySelector('button').disabled = false; refresh.disabled = false; }
   });
   message.textContent = paid
    ? (booking.deposit_livemode === false ? 'Test downpayment verified. The test booking schedule is confirmed; no real funds received.' : 'Downpayment verified. Your booking schedule is confirmed.')
    : booking.deposit_status === 'refund_review' ? (direct ? 'Booking cancelled. Contact the provider to check the transfer and arrange any refund. Refunds are not automatic.' : 'Payment received, but this booking is not confirmed. Contact support for refund review.')
    : booking.status === 'cancelled' ? 'This booking is cancelled. No new payment is allowed.'
    : direct ? (booking.deposit_status === 'awaiting_verification' ? 'Receipt submitted. The provider must check their wallet before your schedule is confirmed.'
      : data.receipt?.status === 'rejected' ? 'Payment was not verified. Review the provider note and contact them before paying again.'
      : !awaiting ? 'Waiting for the provider to confirm the service price.'
      : qrUrl ? 'Payment goes directly to your provider. Submit the receipt after paying; do not pay twice.' : 'Review the price to view your provider\'s payment QR.')
    : !data.checkout_configured ? 'E-wallet checkout is not configured yet. Please contact support.'
    : returnState === 'success' ? 'Waiting for PayMongo payment verification. Your schedule is not confirmed yet.'
    : returnState === 'cancelled' ? 'Checkout was closed. The booking remains pending until a payment is verified.'
    : data.livemode === false ? 'PayMongo test checkout. Do not use real payment details.' : 'Pay securely with an e-wallet through PayMongo.';
   if ((window.snCustomerBookings || []).some(item => String(item.id) === String(bookingId) && (item.status !== booking.status || item.deposit_status !== booking.deposit_status))) {
    const index = window.snCustomerBookings.findIndex(item => String(item.id) === String(bookingId));
    window.snCustomerBookings[index] = { ...window.snCustomerBookings[index], ...booking };
    const list = document.getElementById('sn-bookings');
    if (list) list.innerHTML = renderCustomerBookings(window.snCustomerBookings);
    document.dispatchEvent(new CustomEvent('sn:customer-bookings-rendered'));
   }
  } catch (error) { if (!background && version === loadVersion) message.textContent = error.message; }
  finally { if (version === loadVersion) { loading = false; if (!busy) refresh.disabled = false; } }
 };
 refresh.onclick = () => load();
 pay.onclick = async () => {
  if (busy || !modal.querySelector('[data-payment-consent]')?.checked) return;
  busy = true;
  pay.disabled = refresh.disabled = true;
  try {
   const direct = booking.deposit_channel === 'provider_qr';
   const data = await bookingFetch(`/api/customer/${customer.id}/bookings/${booking.id}/${direct ? 'direct-payment' : 'checkout'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept_price: true, price_version: booking.price_version }) });
   if (direct) { busy = false; await load(); return; }
   const url = new URL(data.checkout_url);
   if (url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com' || url.port || url.username || url.password) throw new Error('Invalid checkout address. Contact support.');
   window.location.assign(url.href);
  } catch (error) { message.textContent = error.message; busy = false; pay.disabled = refresh.disabled = false; }
 };
 await load();
 window.snStartLiveRefresh(`customer-payment-${bookingId}`, () => load({ background: true })).then(dispose => {
  if (!dispose) return;
  if (!modal.isConnected) dispose(); else stopLiveRefresh = dispose;
 });
 modal.querySelector('.sn-modal-close').focus();
}

let bookingPaymentReturnHandled = false;
function handleBookingPaymentReturn() {
 if (bookingPaymentReturnHandled) return;
 const params = new URLSearchParams(window.location.search);
 const id = params.get('pay_booking_id') || (params.has('payment_return') && params.get('booking_id'));
 if (!id || !/^\d+$/.test(id)) return;
 bookingPaymentReturnHandled = true;
 const returnState = params.get('payment_return') || '';
 ['payment_return', 'booking_id', 'pay_booking_id'].forEach(key => params.delete(key));
 history.replaceState(null, '', `${window.location.pathname}${params.size ? '?' + params : ''}`);
 showBookingPayment(id, returnState);
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
 document.addEventListener('sn:customer-bookings-rendered', handleBookingPaymentReturn);
 document.addEventListener('click', (event) => {
  const payButton = event.target.closest('[data-booking-action="pay"]');
  if (payButton) { event.preventDefault(); showBookingPayment(payButton.dataset.bookingId); return; }
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
 const booking = getStoredBookingById(bookingId);
 const confirmed = await bookingConfirm(`This will cancel your booking and reopen the provider schedule slot.${booking?.deposit_paid_at ? ' The downpayment needs refund review and is not automatically refunded.' : ''}`, {
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
  <label><span>Remaining Balance Method</span><select id="sn-booking-payment" name="payment_method" required></select><small id="sn-booking-payment-note" class="sn-booking-payment-note"></small></label>
   <p class="sn-booking-downpayment-terms full">A 30% downpayment is paid directly using the provider's payment QR after the price is confirmed. Submit your payment receipt; your schedule is confirmed only after the provider verifies the transfer. The remaining 70% is due after service.</p>
   <section class="sn-provider-price-options full" id="sn-provider-price-options" hidden></section>
   <section class="sn-repair-assessment full" id="sn-repair-assessment" hidden></section>
   <section class="sn-calculated-assessment full" id="sn-cleaning-assessment" hidden></section>
   <section class="sn-calculated-assessment full" id="sn-personal-care-assessment" hidden></section>
   <section class="sn-calculated-assessment full" id="sn-appliance-assessment" hidden></section>
   <section class="sn-calculated-assessment full" id="sn-installation-assessment" hidden></section>
   <section class="sn-calculated-assessment full" id="sn-outdoor-assessment" hidden></section>
   <label><span>Service Amount</span><select id="sn-booking-amount-choice" name="amount_choice"></select></label>
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
 renderBookingAssessment();
 document.getElementById('sn-booking-service')?.addEventListener('change', () => {
  updateBookingPaymentChoices();
  renderBookingAssessment();
 });
 document.getElementById('sn-booking-payment')?.addEventListener('change', updateBookingPaymentNote);
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
 window.snStartLiveRefresh('booking-availability', () => {
  if (form.querySelector('[type="submit"]:disabled') || document.activeElement?.id === 'sn-booking-time') return;
  return loadProviderBookingSlots(providerId, document.getElementById('sn-booking-time')?.value || '', { background: true });
 });
}

let bookingSlotsVersion = 0;
let bookingSlotsSignature = '';
async function loadProviderBookingSlots(providerId, preferredTime = '', { background = false } = {}) {
 const dateInput = document.getElementById('sn-booking-date');
 const timeSelect = document.getElementById('sn-booking-time');
 const note = document.getElementById('sn-booking-schedule-note');
 const alternatives = document.getElementById('sn-booking-alternatives');
 if (!dateInput || !timeSelect) return;
 const version = ++bookingSlotsVersion;

 if (!background) {
 timeSelect.innerHTML = '<option value="">Checking slots...</option>';
 timeSelect.disabled = true;
 if (alternatives) {
  alternatives.hidden = true;
  alternatives.innerHTML = '';
 }
 if (note) note.textContent = 'Checking provider availability for your selected date...';
 }

 try {
  const params = new URLSearchParams({ date: dateInput.value });
  const data = await bookingFetch(`/api/providers/${providerId}/availability?${params}`);
  if (background && !window.snLiveRefresh?.isIdle()) return;
  if (version !== bookingSlotsVersion || dateInput.value !== params.get('date')) return;
  const slots = data.availability || [];
  const signature = JSON.stringify([params.get('date'), slots]);
  if (background && (signature === bookingSlotsSignature || document.activeElement === timeSelect)) return;
  bookingSlotsSignature = signature;
  if (alternatives) alternatives.hidden = true;
  if (!slots.length) {
   timeSelect.innerHTML = '<option value="">No open slots for this date</option>';
   timeSelect.disabled = true;
   if (note) note.textContent = 'No schedule is open for this date. Pick another date or choose an alternative below.';
   await loadAlternativeBookingSlots(providerId);
   return;
  }

  const previousTime = background ? timeSelect.value : preferredTime;
  timeSelect.innerHTML = slots.map((slot) => {
   const selected = previousTime && previousTime === slot.start_time ? ' selected' : '';
   return `<option value="${bookingEsc(slot.start_time)}"${selected}>${bookingEsc(slot.start_time)} - ${bookingEsc(slot.end_time)}</option>`;
  }).join('');
  timeSelect.disabled = false;
  if (note) note.textContent = `${slots.length} open slot${slots.length === 1 ? '' : 's'} found. The backend will still re-check before submitting.`;
 } catch (error) {
  if (background || version !== bookingSlotsVersion) return;
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
 if (!selectedBookingService().service || !formData.get('payment_method')) {
  await bookingAlert('Select an available service and payment option.', { title: 'Booking Unavailable' });
  return;
 }
 let assessment;
 try {
  assessment = applyProviderEstimate(collectCalculatedAssessment() || collectRepairAssessment(form));
 } catch (error) {
  await bookingAlert(error.message, { title: 'Check Service Details', type: 'warning' });
  return;
 }
 const body = {
  provider_id: Number(providerId),
  service: assessment?.details?.service_type || formData.get('service'),
  provider_service_id: selectedBookingService().service?.id || null,
  scheduled_date: formData.get('scheduled_date'),
  scheduled_time: formData.get('scheduled_time'),
  address: formData.get('address'),
 payment_method: formData.get('payment_method'),
 amount: assessment?.amount ?? Number(formData.get('amount') || 0),
 pricing_type: assessment?.pricingType || 'provider_quote',
 estimated_min: assessment?.estimatedMin ?? Number(formData.get('amount') || 0),
 estimated_max: assessment?.estimatedMax ?? Number(formData.get('amount') || 0),
 service_details: assessment?.details || {},
 ...(bookingDeviceCoords || {}),
 };

 const selectedServiceOption = form.querySelector('#sn-booking-service')?.selectedOptions?.[0];
 const selectedService = bookingProviderServices[Number(selectedServiceOption?.dataset.index || 0)] || null;
 const minPrice = Number(selectedService?.starting_price || 0);
 const maxPrice = Number(selectedService?.max_price || minPrice || 0);
 if (!assessment && minPrice && body.amount < minPrice) {
  await bookingAlert(`Cash amount must be at least ${bookingMoney(minPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }
 if (!assessment && maxPrice && body.amount > maxPrice) {
  await bookingAlert(`Cash amount cannot exceed ${bookingMoney(maxPrice)} for this service.`, {
   title: 'Invalid Cash Amount',
   type: 'warning',
  });
  return;
 }

 if (submit) submit.textContent = 'Submitting...';
 try {
  if (assessment?.mediaFiles?.length) {
   const payload = new FormData();
   Object.entries(body).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    payload.append(key, key === 'service_details' ? JSON.stringify(value) : String(value));
   });
   assessment.mediaFiles.slice(0, 3).forEach((file) => payload.append('assessmentMedia', file));
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
 await window.snAccountSessionReady;
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
