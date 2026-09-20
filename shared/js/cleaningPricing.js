(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNCleaningPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';

 // Provisional PHP rates, shared by browser estimates and server validation.
 const RATES = {
  house: { properties: { Studio: 500, '1 Bedroom': 625, '2 Bedrooms': 775, '3 Bedrooms': 925, '4+ Bedrooms': 1075 }, extraBedroom: 150, extraBathroom: 100, extraHour: 125 },
  areas: { Kitchen: 100, 'Living room': 75, Balcony: 100, Garage: 150, Other: 100 },
  deep: { sqm: 30, minimum: 1000, bedroom: 100, bathroom: 150, extraHour: 150, area: 75, dirt: { Light: 1, Moderate: 1.25, Heavy: 1.5 } },
  bathroom: { sizes: { Small: 250, Medium: 350, Large: 500 }, deep: 1.6 },
  sofa: { types: { 'Single seat': 350, '2-seater': 600, '3-seater': 850, 'L-shaped': 1200, Recliner: 500, Other: 600 }, materials: { Fabric: 1, Leather: 1.25, Other: 1.1 } },
  carpet: { sqm: 60, sizes: { Small: 4, Medium: 8, Large: 12 }, types: { 'Area rug': 1, 'Fitted carpet': 1.15, 'Delicate carpet': 1.3, Other: 1.15 }, deep: 1.5 },
  window: { sizes: { Small: 100, Medium: 150, Large: 220 }, bothSides: 1.6, stepLadder: 1.25, highMin: 1.3, highMax: 1.6 },
  laundry: { packages: { 'Wash only': 45, 'Wash + dry': 65, 'Wash + dry + fold': 85 }, types: { 'Everyday clothes': 1, 'Bedding / towels': 1.4, Delicates: 1.7, Other: 1.5 }, pickupDelivery: 100 },
 };
 const VERSION = 'cleaning-sample-v1';
 const NOTE = 'Sample-rate estimate only. Provider confirms the scope and final price; any extra charge needs your approval.';
 const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
 const number = (key, label, value = 1, extra = {}) => ({ key, label, type: 'number', min: 1, max: 100, step: 1, default: value, ...extra });
 const text = (key, label, extra = {}) => ({ key, label, type: 'text', maxLength: 200, ...extra });
 const areas = (label) => ({ key: 'areas', label, type: 'checkboxes', options: Object.keys(RATES.areas), required: false });
 const otherArea = text('other_area', 'Other area', { when: { key: 'areas', value: 'Other' } });
 const cleaningLevel = select('cleaning_level', 'Cleaning level', ['Regular', 'Deep cleaning']);
 const configs = {
  'general house cleaning': {
   title: 'General House Cleaning',
   fields: [
    select('property_type', 'Property type', Object.keys(RATES.house.properties)),
    number('bedrooms', 'Number of bedrooms', 4, { min: 4, when: { key: 'property_type', value: '4+ Bedrooms' } }),
    select('bathrooms', 'Number of bathrooms', ['1', '2', '3+']),
    number('bathroom_count', 'Exact number of bathrooms', 3, { min: 3, when: { key: 'bathrooms', value: '3+' } }),
    select('duration', 'Duration', ['2 hours', '3 hours', '4 hours', '5+ hours']),
    number('hours', 'Exact duration (hours)', 5, { min: 5, max: 24, when: { key: 'duration', value: '5+ hours' } }),
    areas('Additional areas'), otherArea,
   ],
  },
  'deep cleaning': {
   title: 'Deep Cleaning',
   fields: [
    select('property_type', 'Property type', ['Studio', 'Condo', 'Apartment', 'House', 'Other']),
    text('other_property', 'Other property type', { when: { key: 'property_type', value: 'Other' } }),
    number('bedrooms', 'Number of bedrooms', 1, { min: 0 }),
    number('bathrooms', 'Number of bathrooms', 1, { min: 0 }),
    number('sqm', 'Approximate size (sq m)', 30, { max: 10000, step: 0.1 }),
    areas('Areas included'), otherArea,
    select('dirt_level', 'Level of dirt', ['Light', 'Moderate', 'Heavy']),
    number('hours', 'Duration preference (hours)', 3, { min: 2, max: 24 }),
   ],
  },
  'bathroom cleaning': {
   title: 'Bathroom Cleaning',
   fields: [number('bathrooms', 'Number of bathrooms'), select('size', 'Bathroom size', ['Small', 'Medium', 'Large']), cleaningLevel],
  },
  'sofa & upholstery cleaning': {
   title: 'Sofa & Upholstery Cleaning',
   fields: [
    select('type', 'Type', Object.keys(RATES.sofa.types)),
    text('other_type', 'Other furniture type', { when: { key: 'type', value: 'Other' } }),
    number('quantity', 'Quantity'),
    select('material', 'Material', ['Fabric', 'Leather', 'Other']),
    text('other_material', 'Other material', { when: { key: 'material', value: 'Other' } }),
   ],
  },
  'carpet cleaning': {
   title: 'Carpet Cleaning',
   fields: [
    select('type', 'Carpet type', Object.keys(RATES.carpet.types)),
    text('other_type', 'Other carpet type', { when: { key: 'type', value: 'Other' } }),
    select('size', 'Approximate size per carpet', ['Small', 'Medium', 'Large', 'Custom sq m']),
    number('sqm', 'Custom size per carpet (sq m)', 4, { min: 0.1, max: 10000, step: 0.1, when: { key: 'size', value: 'Custom sq m' } }),
    number('quantity', 'Number of carpets'), cleaningLevel,
   ],
  },
  'window cleaning': {
   title: 'Window Cleaning',
   fields: [
    number('quantity', 'Number of windows'),
    select('size', 'Window size', ['Small', 'Medium', 'Large']),
    select('sides', 'Cleaning coverage', ['Indoor only', 'Indoor + outdoor']),
    select('access', 'Height / accessibility', ['Ground level / easy access', 'Step ladder required', 'High / difficult access']),
   ],
  },
  'laundry services': {
   title: 'Laundry Services',
   fields: [
    select('type', 'Laundry type', Object.keys(RATES.laundry.types)),
    text('other_type', 'Other laundry type', { when: { key: 'type', value: 'Other' } }),
    select('weight', 'Estimated weight', ['3 kg', '5 kg', '7 kg', '10 kg+']),
    number('kg', 'Estimated weight (kg)', 10, { min: 10, max: 500, step: 0.1, when: { key: 'weight', value: '10 kg+' } }),
    select('package', 'Laundry package', Object.keys(RATES.laundry.packages)),
    select('fulfillment', 'Pickup / delivery', ['Drop-off / collection', 'Pickup + delivery'], { pickupOnly: true }),
   ],
  },
 };

 function normalize(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
 function serviceKey(value) {
  let key = normalize(value).replace(/\band\b/g, '&');
  if (key === 'house cleaning') key = 'general house cleaning';
  if (key === 'laundry') key = 'laundry services';
  return Object.hasOwn(configs, key) ? key : '';
 }
 function isCategory(value) { return ['cleaning', 'cleaning services'].includes(normalize(value)); }
 function fieldVisible(field, inputs, context = {}) {
  if (field.pickupOnly && context.pickupDelivery !== true) return false;
  if (!field.when) return true;
  const value = inputs[field.when.key];
  return Array.isArray(value) ? value.includes(field.when.value) : value === field.when.value;
 }
 function defaults(key) {
  return Object.fromEntries(configs[key].fields.map(field => [field.key,
   field.default ?? (field.type === 'select' ? field.options[0] : field.type === 'checkboxes' ? [] : '')]));
 }
 function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  throw error;
 }
 function validate(key, raw, context = {}) {
  if (!Object.hasOwn(configs, key)) invalid('Choose a valid cleaning service.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Complete the cleaning service selections.');
  if (key === 'laundry services' && raw.fulfillment === 'Pickup + delivery' && context.pickupDelivery !== true) {
   invalid('This provider does not offer laundry pickup and delivery.');
  }
  const inputs = {};
  for (const field of configs[key].fields) {
   if (!fieldVisible(field, raw, context)) continue;
   const value = raw[field.key];
   if (field.type === 'checkboxes') {
    const values = value === undefined ? [] : value;
    if (!Array.isArray(values) || values.some(item => !field.options.includes(item))) invalid(`Choose valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = [...new Set(values)];
   } else if (field.type === 'number') {
    const amount = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    const onStep = Math.abs(amount / field.step - Math.round(amount / field.step)) < 0.00001;
    if (String(value ?? '').trim() === '' || !Number.isFinite(amount) || amount < field.min || amount > field.max || !onStep) {
     invalid(`${field.label} must be between ${field.min} and ${field.max}${field.step === 1 ? ' in whole numbers' : ''}.`);
    }
    inputs[field.key] = amount;
   } else if (field.type === 'select') {
    if (!field.options.includes(value)) invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = value;
   } else {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > field.maxLength) invalid(`Enter ${field.label.toLowerCase()} (up to ${field.maxLength} characters).`);
    inputs[field.key] = value.trim();
   }
  }
  return inputs;
 }
 const money = value => `PHP ${Number(value).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;
 const round = value => Math.round((value + Number.EPSILON) * 100) / 100;

 function assessment(key, raw, context = {}) {
  const inputs = validate(key, raw, context);
  const config = configs[key];
  const breakdown = [];
  const add = (label, amount) => breakdown.push({ label, amount: round(amount) });
  const subtotal = () => round(breakdown.reduce((sum, item) => sum + item.amount, 0));
  const adjust = (label, multiplier) => { if (multiplier !== 1) add(label, subtotal() * (multiplier - 1)); };
  let note = NOTE;
  let range = false;
  switch (key) {
   case 'general house cleaning': {
    add(`${inputs.property_type}, 2 hours, 1 bathroom`, RATES.house.properties[inputs.property_type]);
    if (inputs.bedrooms > 4) add('Additional bedrooms', (inputs.bedrooms - 4) * RATES.house.extraBedroom);
    const baths = inputs.bathrooms === '3+' ? inputs.bathroom_count : Number(inputs.bathrooms);
    if (baths > 1) add('Additional bathrooms', (baths - 1) * RATES.house.extraBathroom);
    const hours = inputs.duration === '5+ hours' ? inputs.hours : parseInt(inputs.duration, 10);
    if (hours > 2) add(`${hours - 2} additional hour(s)`, (hours - 2) * RATES.house.extraHour);
    inputs.areas.forEach(area => add(area, RATES.areas[area]));
    break;
   }
   case 'deep cleaning':
    add(`${inputs.sqm} sq m (minimum ${money(RATES.deep.minimum)})`, Math.max(RATES.deep.minimum, inputs.sqm * RATES.deep.sqm));
    if (inputs.bedrooms) add(`${inputs.bedrooms} bedroom(s)`, inputs.bedrooms * RATES.deep.bedroom);
    if (inputs.bathrooms) add(`${inputs.bathrooms} bathroom(s)`, inputs.bathrooms * RATES.deep.bathroom);
    inputs.areas.forEach(area => add(area, RATES.deep.area));
    adjust(`${inputs.dirt_level} dirt level`, RATES.deep.dirt[inputs.dirt_level]);
    if (inputs.hours > 3) add(`${inputs.hours - 3} additional hour(s)`, (inputs.hours - 3) * RATES.deep.extraHour);
    break;
   case 'bathroom cleaning':
    add(`${inputs.bathrooms} ${inputs.size.toLowerCase()} bathroom(s)`, inputs.bathrooms * RATES.bathroom.sizes[inputs.size]);
    if (inputs.cleaning_level === 'Deep cleaning') adjust('Deep cleaning', RATES.bathroom.deep);
    break;
   case 'sofa & upholstery cleaning':
    add(`${inputs.quantity} x ${inputs.type}`, inputs.quantity * RATES.sofa.types[inputs.type]);
    adjust(`${inputs.material} material`, RATES.sofa.materials[inputs.material]);
    break;
   case 'carpet cleaning': {
    const sqm = inputs.size === 'Custom sq m' ? inputs.sqm : RATES.carpet.sizes[inputs.size];
    add(`${inputs.quantity} carpet(s) x ${sqm} sq m x ${money(RATES.carpet.sqm)}`, inputs.quantity * sqm * RATES.carpet.sqm);
    adjust(inputs.type, RATES.carpet.types[inputs.type]);
    if (inputs.cleaning_level === 'Deep cleaning') adjust('Deep cleaning', RATES.carpet.deep);
    break;
   }
   case 'window cleaning':
    add(`${inputs.quantity} ${inputs.size.toLowerCase()} window(s)`, inputs.quantity * RATES.window.sizes[inputs.size]);
    if (inputs.sides === 'Indoor + outdoor') adjust('Indoor + outdoor', RATES.window.bothSides);
    if (inputs.access === 'Step ladder required') adjust('Step ladder access', RATES.window.stepLadder);
    range = inputs.access === 'High / difficult access';
    if (range) note += ' High or difficult access requires provider assessment before confirmation.';
    break;
   case 'laundry services': {
    const kg = inputs.weight === '10 kg+' ? inputs.kg : parseInt(inputs.weight, 10);
    add(`${kg} kg x ${money(RATES.laundry.packages[inputs.package])} (${inputs.package})`, kg * RATES.laundry.packages[inputs.package]);
    adjust(inputs.type, RATES.laundry.types[inputs.type]);
    if (inputs.fulfillment === 'Pickup + delivery') add('Pickup + delivery', RATES.laundry.pickupDelivery);
    note += ' Final laundry weight is confirmed by the provider.';
    break;
   }
  }
  const base = subtotal();
  const min = round(range ? base * RATES.window.highMin : base);
  const max = round(range ? base * RATES.window.highMax : base);
  if (range) breakdown.push({ label: 'High / difficult access allowance', amount: round(min - base), max_amount: round(max - base) });
  const answers = {};
  for (const field of config.fields) {
   if (!fieldVisible(field, inputs, context)) continue;
   const value = inputs[field.key];
   answers[field.label] = Array.isArray(value) ? value.join(', ') || 'None' : String(value);
  }
  if (key === 'laundry services' && !context.pickupDelivery) answers['Pickup / delivery'] = 'Drop-off / collection';
  const pricingType = range ? 'provider_quote' : 'calculated';
  const estimateLabel = range ? `Sample estimated range: ${money(min)} - ${money(max)}` : `Sample estimated price: ${money(min)}`;
  return {
   amount: min, estimatedMin: min, estimatedMax: max, pricingType, mediaFiles: [],
   details: { category: 'Cleaning Services', service_type: config.title, pricing_type: pricingType, estimate_label: estimateLabel, note,
    answers, inputs, breakdown, rate_version: VERSION, sample_rates: true },
  };
 }
 function forBooking(serviceName, details, providerService) {
  const key = serviceKey(serviceName);
  if (!key) invalid('Choose a specific cleaning service.');
  if (!providerService || providerService.is_active === false ||
   !(serviceKey(providerService.title) === key || isCategory(providerService.title))) {
   invalid('Choose an active cleaning service offered by this provider.');
  }
  if (details.service_type && serviceKey(details.service_type) !== key) invalid('Cleaning selections do not match the booked service.');
  return assessment(key, details.inputs, { pickupDelivery: providerService.laundry_pickup_delivery === true });
 }
 return { RATES, VERSION, NOTE, configs, serviceKey, isCategory, fieldVisible, defaults, validate, assessment, forBooking };
});
