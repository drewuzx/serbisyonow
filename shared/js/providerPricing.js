(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNProviderPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';
 const rooms = ['Studio', '1 Bedroom', '2 Bedrooms', '3 Bedrooms', '4+ Bedrooms'];
 const durations = ['2 hours', '3 hours', '4 hours', '5+ hours'];
 const typicalDurations = ['Flexible', '30 minutes', '1 hour', '90 minutes', ...durations];
 const areas = ['Kitchen', 'Living room', 'Balcony', 'Garage', 'Other'];
 const units = ['Per service', 'Per load', 'Per window', 'Per unit', 'Per hour'];
 const repairServices = ['plumbing services','electrical repair','appliance repair','carpentry','roof repair','furniture repair','painting services','door and window repair'];
 const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
 const isHouse = title => ['general house cleaning', 'house cleaning'].includes(normalize(title));
 function matchesQuoteService(service, requestedTitle) {
  const offered = normalize(service.title), requested = normalize(requestedTitle);
  return offered === requested || (normalize(service.category) === 'repair services' && !repairServices.includes(offered) && repairServices.includes(requested));
 }
 const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
 function fail(message) { const error = new Error(message); error.statusCode = 400; throw error; }
 function amount(value, label, minimum = 0) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') fail(`${label} is required.`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < minimum || n > 1000000 || Math.abs(n - round(n)) > 0.000001) fail(`${label} must be between ${minimum} and 1,000,000, with up to two decimal places.`);
  return n;
 }
 function text(value, label, max) {
  if (typeof value !== 'string' || value.length > max) fail(`${label} must be no more than ${max} characters.`);
  return value.trim();
 }
 function validate(raw, title) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Enter service pricing.');
  if (!['range', 'house_matrix'].includes(raw.mode)) fail('Select a pricing method.');
  if (raw.mode === 'house_matrix' && !isHouse(title)) fail('Room and duration pricing is available for General House Cleaning.');
  const config = { version: 1, mode: raw.mode, service_area: text(raw.service_area ?? '', 'Service area', 200), notes: text(raw.notes ?? '', 'Special instructions', 500) };
  if (!(raw.mode === 'house_matrix' ? ['Flexible', ...durations] : typicalDurations).includes(raw.duration)) fail('Select a service duration.');
  config.duration = raw.duration;
  if (raw.mode === 'range') {
   config.min = amount(raw.min, 'Minimum price', 1);
   config.max = amount(raw.max, 'Maximum price', 1);
   if (config.max < config.min) fail('Maximum price must be at least the minimum price.');
  } else {
   if (!Array.isArray(raw.matrix) || raw.matrix.length !== rooms.length) fail('Complete all room prices.');
   config.matrix = raw.matrix.map((row, r) => {
    if (!Array.isArray(row) || row.length !== durations.length) fail('Complete all duration prices.');
    return row.map((value, c) => amount(value, `${rooms[r]}, ${durations[c]}`, 1));
   });
   config.extra_hour = amount(raw.extra_hour, 'Additional hour');
   config.extra_bedroom = amount(raw.extra_bedroom, 'Additional bedroom');
   config.extra_bathroom = amount(raw.extra_bathroom, 'Additional bathroom');
   config.areas = Object.fromEntries(areas.map(area => [area, amount(raw.areas?.[area], area)]));
  }
  if (!Array.isArray(raw.addons) || raw.addons.length > 15) fail('Add up to 15 additional services.');
  const ids = new Set(), names = new Set();
  config.addons = raw.addons.map(addon => {
   if (!addon || typeof addon !== 'object') fail('Invalid additional service.');
   const id = text(addon.id, 'Add-on identifier', 80);
   if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) fail('Additional service identifiers must be unique.');
   ids.add(id);
   const name = text(addon.name, 'Additional service name', 80);
   if (!name || names.has(normalize(name))) fail('Each additional service needs a unique name.');
   names.add(normalize(name));
   const min = amount(addon.min, `${name} minimum`), max = amount(addon.max, `${name} maximum`);
   if (max < min) fail(`${name}: maximum price must be at least the minimum.`);
   if (!units.includes(addon.unit) || typeof addon.enabled !== 'boolean') fail('Invalid additional service settings.');
   return { id, name, min, max, unit: addon.unit, enabled: addon.enabled };
  });
  return config;
 }
 function bounds(config) {
  const prices = config.mode === 'house_matrix'
   ? config.matrix.flatMap(row => config.duration === 'Flexible' ? row : [row[durations.indexOf(config.duration)]]) : [config.min, config.max];
  return { min: Math.min(...prices), max: Math.max(...prices) };
 }
 function defaults(service) {
  if (service.pricing_config) return JSON.parse(JSON.stringify(service.pricing_config));
  return { version: 1, mode: 'range', min: Number(service.starting_price) || 500, max: Math.max(Number(service.max_price) || 500, Number(service.starting_price) || 500),
   matrix: [[400,550,700,850],[500,650,800,950],[650,800,950,1100],[800,950,1100,1300],[1000,1200,1400,1700]],
   extra_hour: 150, extra_bedroom: 150, extra_bathroom: 100, areas: { Kitchen: 100, 'Living room': 75, Balcony: 100, Garage: 150, Other: 100 },
   addons: [], service_area: '', duration: 'Flexible', notes: '' };
 }
 function count(value, label, min = 0, max = 100) {
  const n = Number(value);
  if (!['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
 }
 function apply(estimate, service, selection = {}) {
  if (!service?.pricing_config) return estimate;
  const config = validate(service.pricing_config, service.title);
  const inputs = estimate?.details?.inputs || {};
  const breakdown = [];
  let min = 0, max = 0;
  function add(label, low, high = low, quantity = 1) {
   const lineMin = round(low * quantity), lineMax = round(high * quantity);
   min = round(min + lineMin); max = round(max + lineMax);
   breakdown.push({ label, amount: lineMin, ...(lineMax !== lineMin ? { max_amount: lineMax } : {}) });
  }
  if (config.mode === 'house_matrix') {
   const r = rooms.indexOf(inputs.property_type), c = durations.indexOf(inputs.duration);
   if (r < 0 || c < 0) fail('Choose a property size and duration.');
   if (config.duration !== 'Flexible' && config.duration !== inputs.duration) fail(`This provider offers ${config.duration} for this service.`);
   add(`${rooms[r]}, ${durations[c]}, 1 bathroom`, config.matrix[r][c]);
   const bathrooms = inputs.bathrooms === '3+' ? count(inputs.bathroom_count, 'Bathrooms', 3) : count(inputs.bathrooms, 'Bathrooms', 1, 2);
   if (bathrooms > 1) add(`${bathrooms - 1} additional bathroom(s)`, config.extra_bathroom, config.extra_bathroom, bathrooms - 1);
   if (r === 4) { const n = count(inputs.bedrooms, 'Bedrooms', 4) - 4; if (n) add(`${n} additional bedroom(s)`, config.extra_bedroom, config.extra_bedroom, n); }
   if (c === 3) { const n = count(inputs.hours, 'Hours', 5, 24) - 5; if (n) add(`${n} additional hour(s)`, config.extra_hour, config.extra_hour, n); }
   if (!Array.isArray(inputs.areas) || inputs.areas.some(area => !areas.includes(area))) fail('Select valid additional areas.');
   [...new Set(inputs.areas)].forEach(area => add(area, config.areas[area]));
  } else add(`${service.title} - base service`, config.min, config.max);
  const selected = selection.addons ?? [];
  if (!Array.isArray(selected) || selected.length > 15) fail('Invalid additional services.');
  const seen = new Set();
  const addons = selected.map(item => {
   const addon = config.addons.find(a => a.id === item?.id && a.enabled);
   if (!addon || seen.has(addon.id)) fail('An additional service is no longer available. Reopen this booking.');
   seen.add(addon.id);
   const quantity = count(item.quantity, addon.name, 1, 100);
   if (addon.unit === 'Per service' && quantity !== 1) fail('Per-service add-ons can only be selected once.');
   add(`${addon.name} (${quantity}, ${addon.unit.toLowerCase()})`, addon.min, addon.max, quantity);
   return { id: addon.id, quantity };
  });
  if (max > 99999999.99) fail('Total price exceeds the booking limit.');
  const repairQuote = normalize(service.category) === 'repair services' && normalize(estimate?.details?.service_type || service.title) !== 'painting services';
  const pricingType = max !== min || estimate?.pricingType === 'provider_quote' || repairQuote ? 'provider_quote' : 'calculated';
  const label = `Provider estimated ${min === max ? 'price' : 'range'}: PHP ${min.toLocaleString('en-PH')}${max !== min ? ` - PHP ${max.toLocaleString('en-PH')}` : ''}`;
  return { ...estimate, amount: min, estimatedMin: min, estimatedMax: max, pricingType, mediaFiles: estimate?.mediaFiles || [],
   details: { ...estimate?.details, service_type: estimate?.details?.service_type || service.title, category: estimate?.details?.category || service.category,
    pricing_type: pricingType, sample_rates: false, rate_version: 'provider-v1', breakdown, estimate_label: label,
    note: 'Provider-set estimate. Final scope and price require confirmation; additional charges need customer approval.' + (estimate?.details?.requires_safety_assessment ? ' A safety assessment is required before work can be confirmed.' : ''),
    provider_pricing: { revision: service.updated_at, service_id: service.id, config, addons },
    service_area: config.service_area, service_duration: config.duration, special_instructions: config.notes } };
 }
 return { rooms, durations, typicalDurations, areas, units, isHouse, matchesQuoteService, validate, defaults, bounds, apply };
});
