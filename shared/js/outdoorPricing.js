(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNOutdoorPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';

 // Provisional PHP labor rates; recurring preferences are priced per visit, not as a subscription.
 const RATES = {
  frequency: { 'One-time': 1, Weekly: 0.9, 'Every 2 weeks': 0.95, Monthly: 1 },
  gardening: { visit: 150, area: { Planting: 8, Weeding: 5, Pruning: 4, 'General maintenance': 6 }, plants: { Planting: 25, Weeding: 0, Pruning: 20, 'General maintenance': 5 } },
  lawn: { visit: 200, perSquareMeter: 6, sizes: { Small: 25, Medium: 75, Large: 150 }, grass: { 'Short (under 10 cm)': 1, 'Medium (10 - 30 cm)': 1.3, 'Tall (over 30 cm)': 1.8 }, cleanup: { None: 0, 'Bag grass clippings': 3, 'Grass and debris cleanup': 6 } },
  landscape: { types: { 'Routine maintenance': [10, 20], 'Plant and hedge care': [12, 25], 'Soil and garden bed care': [15, 30], 'Landscape restoration': [20, 45], Other: [15, 35] }, condition: { Good: 1, Overgrown: 1.3, Neglected: 1.6, 'Heavy damage': 2 } },
  tree: { heights: [[3, [400, 800]], [6, [800, 1600]], [10, [1500, 3000]], [30, [2500, 5000]]], branches: { Healthy: 1, Overgrown: 1.2, 'Damaged / dead': 1.6, 'Not sure': 1.3 }, access: { 'Easy access': 1, 'Limited access': 1.2, 'Difficult access': 1.5 } },
  fence: { materials: { Wood: [80, 150], Metal: [100, 200], Vinyl: [90, 180], Concrete: [150, 300], 'Chain-link': [70, 140], Other: [100, 220] }, problems: { 'Loose panel': [100, 200], 'Broken panel': [200, 450], 'Leaning post': [300, 650], 'Damaged gate': [400, 900], 'Rust / wear': [150, 350], Other: [250, 600] } },
 };
 const CATEGORY = 'Outdoor and Property Maintenance';
 const VERSION = 'outdoor-property-maintenance-sample-v1';
 const NOTE = 'Sample-rate labor estimate per visit. Plants, materials, and disposal fees are separate. Provider confirms the scope and final price; any extra charge needs your approval. Selected frequency does not include future visits in this total.';
 const QUOTE_NOTE = 'Sample labor estimate only. Provider assesses the actual condition and access before confirming the final quotation for your approval. Materials and disposal fees are separate.';
 const SAFETY_NOTE = 'Near power lines: provider safety assessment is required before work can be confirmed.';
 const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
 const number = (key, label, extra = {}) => ({ key, label, type: 'number', min: 1, max: 50, step: 1, default: 1, ...extra });
 const text = (key, label, extra = {}) => ({ key, label, type: 'text', maxLength: 150, ...extra });
 const other = (key, label, dependsOn) => text(key, label, { when: { key: dependsOn, value: 'Other' } });
 const frequency = () => select('frequency', 'Frequency', Object.keys(RATES.frequency));
 const area = (key, label, extra = {}) => number(key, label, { max: 5000, default: 25, ...extra });
 const configs = {
  gardening: { title: 'Gardening', media: true, perVisit: true, fields: [
   area('area_m2', 'Area size (m2)'), select('service', 'Type of service', Object.keys(RATES.gardening.area)),
   number('plants', 'Number of plants', { max: 500 }), frequency(),
  ] },
  'lawn mowing': { title: 'Lawn Mowing', media: true, perVisit: true, fields: [
   select('lawn_size', 'Lawn size', ['Small', 'Medium', 'Large', 'Custom m2']),
   area('area_m2', 'Custom lawn size (m2)', { when: { key: 'lawn_size', value: 'Custom m2' } }),
   select('grass_height', 'Grass height', Object.keys(RATES.lawn.grass)), frequency(), select('cleanup', 'Additional cleanup', Object.keys(RATES.lawn.cleanup)),
  ] },
  'landscape maintenance': { title: 'Landscape Maintenance', media: true, perVisit: true, pricingType: 'provider_quote', fields: [
   area('area_m2', 'Approximate size per area (m2)'), select('maintenance_type', 'Maintenance type', Object.keys(RATES.landscape.types)),
   other('other_maintenance', 'Other maintenance type', 'maintenance_type'), frequency(), number('areas', 'Number of areas', { max: 20 }),
   select('condition', 'Current condition', Object.keys(RATES.landscape.condition)),
  ] },
  'tree trimming': { title: 'Tree Trimming', media: true, pricingType: 'provider_quote', fields: [
   number('trees', 'Number of trees', { max: 30 }), number('height_m', 'Approximate height per tree (m)', { max: 30, step: 0.5, default: 3 }),
   text('tree_type', 'Tree type (if known)', { required: false }), select('branch_condition', 'Branch condition', Object.keys(RATES.tree.branches)),
   select('access', 'Accessibility', Object.keys(RATES.tree.access)), select('near_power_lines', 'Near power lines?', ['Yes', 'No', 'Not sure'], { default: 'No' }),
  ] },
  'fence repair': { title: 'Fence Repair', media: true, pricingType: 'provider_quote', fields: [
   select('material', 'Fence material', Object.keys(RATES.fence.materials)), other('other_material', 'Other fence material', 'material'),
   number('length_m', 'Approximate damaged length (m)', { max: 500, step: 0.5, default: 5 }), number('sections', 'Number of damaged sections'),
   select('problem', 'Problem', Object.keys(RATES.fence.problems)), other('other_problem', 'Other fence problem', 'problem'),
   number('height_m', 'Fence height (m)', { min: 0.5, max: 4, step: 0.1, default: 1.5 }),
  ] },
 };
 const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
 function serviceKey(value) {
  const aliases = { 'gardening services': 'gardening', 'gardening service': 'gardening', 'lawn & mowing': 'lawn mowing', 'lawn and mowing': 'lawn mowing', 'lawn mowing services': 'lawn mowing', 'tree trimming services': 'tree trimming', 'fence repair services': 'fence repair' };
  const raw = normalize(value);
  const key = Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
  return Object.hasOwn(configs, key) ? key : '';
 }
 function isCategory(value) {
  return ['outdoor and property maintenance', 'outdoor & property maintenance', 'outdoor & property', 'outdoor and property', 'outdoor maintenance'].includes(normalize(value));
 }
 function invalid(message) { const error = new Error(message); error.statusCode = 400; throw error; }
 function fields(key) {
  if (!Object.hasOwn(configs, key)) invalid('Choose a valid outdoor maintenance service.');
  return configs[key].fields;
 }
 function fieldVisible(field, inputs) { return !field.when || inputs[field.when.key] === field.when.value; }
 function defaults(key) { return Object.fromEntries(fields(key).map(field => [field.key, field.default ?? (field.type === 'select' ? field.options[0] : '')])); }
 function validate(key, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Complete the outdoor maintenance details.');
  const inputs = {};
  for (const field of fields(key)) {
   if (!fieldVisible(field, raw)) continue;
   const value = raw[field.key];
   if (field.type === 'select') {
    if (!field.options.includes(value)) invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = value;
   } else if (field.type === 'number') {
    const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (String(value ?? '').trim() === '' || !Number.isFinite(amount) || amount < field.min || amount > field.max || Math.abs(amount / field.step - Math.round(amount / field.step)) > 0.00001) {
     invalid(`${field.label} must be from ${field.min} to ${field.max}${field.step === 1 ? ' in whole numbers' : ''}.`);
    }
    inputs[field.key] = amount;
   } else {
    if (value !== undefined && typeof value !== 'string') invalid(`Enter valid ${field.label.toLowerCase()}.`);
    const input = (value || '').trim();
    if ((!input && field.required !== false) || input.length > field.maxLength) invalid(`${field.label} ${input ? `must be at most ${field.maxLength} characters.` : 'is required.'}`);
    if (input) inputs[field.key] = input;
   }
  }
  return inputs;
 }
 const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
 function assessment(key, raw) {
  const inputs = validate(key, raw);
  const config = configs[key];
  const breakdown = [];
  const add = (label, cost, count = 1) => {
   const [min, max] = Array.isArray(cost) ? cost : [cost, cost];
   if (min || max) breakdown.push({ label, amount: round(min * count), ...(min !== max ? { max_amount: round(max * count) } : {}) });
  };
  switch (key) {
   case 'gardening':
    add('Visit labor', RATES.gardening.visit);
    add(`${inputs.service}: ${inputs.area_m2} m2`, RATES.gardening.area[inputs.service], inputs.area_m2);
    add(`${inputs.plants} plant(s)`, RATES.gardening.plants[inputs.service], inputs.plants);
    break;
   case 'lawn mowing': {
    const size = inputs.lawn_size === 'Custom m2' ? inputs.area_m2 : RATES.lawn.sizes[inputs.lawn_size];
    add('Visit labor', RATES.lawn.visit);
    add(`${inputs.lawn_size === 'Custom m2' ? 'Custom lawn' : `${inputs.lawn_size} lawn`}: ${size} m2, ${inputs.grass_height.toLowerCase()}`, RATES.lawn.perSquareMeter * RATES.lawn.grass[inputs.grass_height], size);
    add(inputs.cleanup, RATES.lawn.cleanup[inputs.cleanup], size);
    break;
   }
   case 'landscape maintenance': {
    const size = inputs.area_m2 * inputs.areas;
    const rate = RATES.landscape.types[inputs.maintenance_type].map(value => value * RATES.landscape.condition[inputs.condition]);
    add(`${inputs.other_maintenance || inputs.maintenance_type}: ${inputs.areas} area(s) x ${inputs.area_m2} m2, ${inputs.condition.toLowerCase()}`, rate, size);
    break;
   }
   case 'tree trimming': {
    const rate = RATES.tree.heights.find(([height]) => inputs.height_m <= height)[1];
    const multiplier = RATES.tree.branches[inputs.branch_condition] * RATES.tree.access[inputs.access];
    add(`${inputs.trees} tree(s), approximately ${inputs.height_m} m, ${inputs.branch_condition.toLowerCase()}, ${inputs.access.toLowerCase()}`, rate.map(value => value * multiplier), inputs.trees);
    break;
   }
   case 'fence repair': {
    const height = inputs.height_m <= 1.5 ? 1 : 1 + (inputs.height_m - 1.5) * 0.3;
    add(`${inputs.other_material || inputs.material} fence: ${inputs.length_m} m long, ${inputs.height_m} m high`, RATES.fence.materials[inputs.material].map(value => value * height), inputs.length_m);
    add(`${inputs.other_problem || inputs.problem}: ${inputs.sections} damaged section(s)`, RATES.fence.problems[inputs.problem], inputs.sections);
    break;
   }
  }
  if (config.perVisit && RATES.frequency[inputs.frequency] !== 1) {
   breakdown.forEach(item => {
    item.amount = round(item.amount * RATES.frequency[inputs.frequency]);
    if (item.max_amount !== undefined) item.max_amount = round(item.max_amount * RATES.frequency[inputs.frequency]);
   });
  }
  const min = round(breakdown.reduce((sum, item) => sum + item.amount, 0));
  const max = round(breakdown.reduce((sum, item) => sum + (item.max_amount ?? item.amount), 0));
  const pricingType = config.pricingType || 'calculated';
  const requiresSafetyAssessment = key === 'tree trimming' && inputs.near_power_lines !== 'No';
  const answers = Object.fromEntries(fields(key).filter(field => inputs[field.key] !== undefined).map(field => [field.label, String(inputs[field.key])]));
  const frequencyNote = config.perVisit && RATES.frequency[inputs.frequency] !== 1 ? ` ${inputs.frequency} sample-rate adjustment: ${Math.round((1 - RATES.frequency[inputs.frequency]) * 100)}% off per-visit labor.` : '';
  const note = (pricingType === 'calculated' ? NOTE : `${QUOTE_NOTE}${config.perVisit ? ' This estimate covers one visit only; selected frequency does not include future visits in this total.' : ''}${requiresSafetyAssessment ? ` ${SAFETY_NOTE}` : ''}`) + frequencyNote;
  return {
   amount: min, estimatedMin: min, estimatedMax: max, pricingType, mediaFiles: [],
   details: { category: CATEGORY, service_type: config.title, pricing_type: pricingType, inputs, answers, breakdown,
    pricing_basis: config.perVisit ? 'per_visit' : 'per_job', requires_safety_assessment: requiresSafetyAssessment,
    ...(requiresSafetyAssessment ? { safety_note: SAFETY_NOTE } : {}),
    estimate_label: `Sample estimated ${pricingType === 'provider_quote' ? 'range' : 'price'}${config.perVisit ? ' per visit' : ''}: PHP ${min.toLocaleString('en-PH')}${pricingType === 'provider_quote' ? ` - PHP ${max.toLocaleString('en-PH')}` : ''}`,
    note, rate_version: VERSION, sample_rates: true },
  };
 }
 function forBooking(serviceName, details, providerService) {
  const key = serviceKey(serviceName);
  if (!key) invalid('Choose a specific outdoor maintenance service.');
  if (!providerService || providerService.is_active === false || !(serviceKey(providerService.title) === key || isCategory(providerService.title))) invalid('Choose an active outdoor maintenance service offered by this provider.');
  if (!details || typeof details !== 'object' || Array.isArray(details)) invalid('Complete the outdoor maintenance details.');
  if (details.service_type && serviceKey(details.service_type) !== key) invalid('Outdoor maintenance details do not match the booked service.');
  return assessment(key, details.inputs);
 }
 return { RATES, CATEGORY, VERSION, NOTE, QUOTE_NOTE, SAFETY_NOTE, configs, serviceKey, isCategory, fields, fieldVisible, defaults, validate, assessment, forBooking };
});
