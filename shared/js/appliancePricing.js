(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNAppliancePricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';

 // Provisional PHP estimates shared by the booking form and server.
 const RATES = {
  aircon: {
   Window: { 'Basic cleaning': 450, 'Deep cleaning': 750, 'General maintenance': 600 },
   'Split-type': { 'Basic cleaning': 650, 'Deep cleaning': 1000, 'General maintenance': 850 },
   Portable: { 'Basic cleaning': 500, 'Deep cleaning': 800, 'General maintenance': 700 },
  },
  diagnostics: { refrigerator: [500, 800], 'washing machine': [350, 650], microwave: [300, 500], tv: [400, 700], electronics: [300, 600], 'small appliances': [250, 450] },
 };
 const VERSION = 'appliance-maintenance-sample-v1';
 const NOTE = 'Sample-rate estimate only. Provider confirms the maintenance scope and final price; any extra charge needs your approval.';
 const QUOTE_NOTE = 'Sample diagnostic estimate only, not the final repair price. Provider assesses the appliance and confirms the service quotation, including any parts and labor, for your approval.';
 const select = (key, label, options) => ({ key, label, type: 'select', options });
 const text = (key, label, required = true, placeholder = '') => ({ key, label, type: 'text', required, maxLength: 100, placeholder });
 const brand = text('brand', 'Brand');
 const model = text('model', 'Model (optional)', false);
 const problem = { key: 'problem', label: 'Problem / symptom', type: 'textarea', maxLength: 2000, placeholder: 'Describe the problem you have noticed' };
 const yesNo = (key, label) => select(key, label, ['Yes', 'No', 'Not sure']);
 const power = select('turning_on', 'Is it turning on?', ['Yes', 'No', 'Sometimes', 'Not sure']);
 const general = applianceType => [
  applianceType, brand, model, problem,
  select('operational_status', 'Operational status', ['Working with an issue', 'Not turning on', 'Intermittent operation', 'Not sure']),
  yesNo('visible_damage', 'Is there visible damage?'),
 ];
 const configs = {
  'aircon cleaning': { title: 'Aircon Cleaning', pricingType: 'calculated', fields: [
   select('unit_type', 'Unit type', Object.keys(RATES.aircon)),
   { key: 'units', label: 'Number of units', type: 'number', min: 1, max: 20, step: 1, default: 1 },
   select('service', 'Service', ['Basic cleaning', 'Deep cleaning', 'General maintenance']),
  ] },
  refrigerator: { title: 'Refrigerator', pricingType: 'provider_quote', media: true, fields: [
   select('refrigerator_type', 'Refrigerator type', ['Single-door', 'Double-door', 'Side-by-side', 'Mini refrigerator', 'Other']),
   brand, model, problem, yesNo('cooling_issue', 'Is there a cooling issue?'),
   yesNo('unusual_noise', 'Is there unusual noise?'), yesNo('leaking', 'Is it leaking?'), power,
  ] },
  'washing machine': { title: 'Washing Machine', pricingType: 'provider_quote', media: true, fields: [
   select('washer_type', 'Type', ['Top load', 'Front load']), text('brand', 'Brand (optional)', false), model, problem, power,
   yesNo('draining', 'Is it draining?'), yesNo('spinning', 'Is it spinning?'), yesNo('unusual_noise', 'Is there unusual noise?'),
  ] },
  microwave: { title: 'Microwave', pricingType: 'provider_quote', media: true, fields: [
   text('brand', 'Brand (optional)', false), model, problem, power,
   yesNo('heating', 'Does it heat?'), yesNo('sparking', 'Does it spark?'), yesNo('display_working', 'Does the display work?'),
  ] },
  tv: { title: 'TV', pricingType: 'provider_quote', media: true, fields: general(select('appliance_type', 'TV type', ['LED / LCD', 'OLED', 'Smart TV', 'Other'])) },
  electronics: { title: 'Electronics', pricingType: 'provider_quote', media: true, fields: general(text('appliance_type', 'Appliance type', true, 'Speaker, amplifier, game console, etc.')) },
  'small appliances': { title: 'Small Appliances', pricingType: 'provider_quote', media: true, fields: general(text('appliance_type', 'Appliance type', true, 'Electric fan, rice cooker, iron, etc.')) },
 };
 const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
 function serviceKey(value) {
  const aliases = { aircon: 'aircon cleaning', 'air conditioning': 'aircon cleaning', 'aircon maintenance': 'aircon cleaning', 'air conditioning cleaning': 'aircon cleaning', fridge: 'refrigerator', 'refrigerator maintenance': 'refrigerator', washer: 'washing machine', 'washing machine maintenance': 'washing machine', 'microwave maintenance': 'microwave', television: 'tv', 'tv maintenance': 'tv', 'small appliance': 'small appliances' };
  const raw = normalize(value);
  const key = Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
  return Object.hasOwn(configs, key) ? key : '';
 }
 function isCategory(value) { return ['appliance maintenance', 'appliance maintenance services'].includes(normalize(value)); }
 function serviceKeys(value) {
  if (isCategory(value)) return Object.keys(configs);
  if (['tv / electronics', 'tv/electronics', 'tv and electronics'].includes(normalize(value))) return ['tv', 'electronics'];
  const key = serviceKey(value);
  return key ? [key] : [];
 }
 function invalid(message) { const error = new Error(message); error.statusCode = 400; throw error; }
 function fields(key) {
  if (!Object.hasOwn(configs, key)) invalid('Choose a valid appliance maintenance service.');
  return configs[key].fields;
 }
 function fieldVisible() { return true; }
 function defaults(key) {
  return Object.fromEntries(fields(key).map(field => [field.key, field.default ?? (field.type === 'select' ? field.options[0] : '')]));
 }
 function validate(key, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Complete the appliance maintenance details.');
  const inputs = {};
  for (const field of fields(key)) {
   const value = raw[field.key];
   if (field.type === 'select') {
    if (!field.options.includes(value)) invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = value;
   } else if (field.type === 'number') {
    const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isInteger(count) || count < field.min || count > field.max) invalid(`${field.label} must be a whole number from ${field.min} to ${field.max}.`);
    inputs[field.key] = count;
   } else {
    if (value !== undefined && typeof value !== 'string') invalid(`Enter valid ${field.label.toLowerCase()}.`);
    const input = (value || '').trim();
    if ((!input && field.required !== false) || input.length > field.maxLength) invalid(`${field.label} ${input ? `must be at most ${field.maxLength} characters.` : 'is required.'}`);
    if (input) inputs[field.key] = input;
   }
  }
  return inputs;
 }
 function assessment(key, raw) {
  const inputs = validate(key, raw);
  const config = configs[key];
  const calculated = config.pricingType === 'calculated';
  const [min, max] = calculated
   ? Array(2).fill(RATES.aircon[inputs.unit_type][inputs.service] * inputs.units)
   : RATES.diagnostics[key];
  const breakdown = calculated
   ? [{ label: `${inputs.unit_type} - ${inputs.service} x ${inputs.units} unit(s)`, amount: min }]
   : [{ label: `${config.title} diagnostic assessment`, amount: min, max_amount: max }];
  const answers = Object.fromEntries(fields(key).filter(field => inputs[field.key] !== undefined).map(field => [field.label, String(inputs[field.key])]));
  return {
   amount: min, estimatedMin: min, estimatedMax: max, pricingType: config.pricingType, mediaFiles: [],
   details: { category: 'Appliance Maintenance', service_type: config.title, pricing_type: config.pricingType, inputs, answers, breakdown,
    estimate_label: calculated ? `Sample estimated price: PHP ${min.toLocaleString('en-PH')}` : `Sample diagnostic estimate: PHP ${min.toLocaleString('en-PH')} - PHP ${max.toLocaleString('en-PH')}`,
    note: calculated ? NOTE : QUOTE_NOTE, rate_version: VERSION, sample_rates: true },
  };
 }
 function forBooking(serviceName, details, providerService) {
  const key = serviceKey(serviceName);
  if (!key) invalid('Choose a specific appliance maintenance service.');
  if (!providerService || providerService.is_active === false || !serviceKeys(providerService.title).includes(key)) invalid('Choose an active appliance maintenance service offered by this provider.');
  if (details.service_type && serviceKey(details.service_type) !== key) invalid('Appliance details do not match the booked service.');
  return assessment(key, details.inputs);
 }
 return { RATES, VERSION, NOTE, QUOTE_NOTE, configs, serviceKey, serviceKeys, isCategory, fields, fieldVisible, defaults, validate, assessment, forBooking };
});
