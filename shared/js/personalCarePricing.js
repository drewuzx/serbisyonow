(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNPersonalCarePricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';

 // Provisional PHP rates shared by the booking form and server calculation.
 const RATES = {
  massage: { types: { Swedish: 300, 'Deep tissue': 400, Relaxation: 250, 'Other provider-offered type': 350 }, extra30Minutes: 150 },
  spa: { packages: { 'Basic spa': 450, 'Body scrub': 600, 'Full spa package': 900 }, extra30Minutes: 200, addons: { Aromatherapy: 150, 'Foot spa': 250, 'Scalp care': 150 } },
  haircut: { services: { 'Basic haircut': 150, 'Haircut + styling': 300, 'Haircut + treatment': 500 }, lengths: { Short: 0, Medium: 75, Long: 150 }, addons: { 'Hair wash': 80, 'Scalp care': 150 } },
  nails: { services: { Manicure: 150, Pedicure: 200, Both: 325 }, addons: { 'Simple nail art': 100, 'Gel polish': 250, 'Polish removal': 100 } },
  lashes: { services: { Classic: 800, Volume: 1200, Hybrid: 1000, Removal: 250, Refill: 500 }, addons: { 'Lash bath': 100, 'Aftercare kit': 150 } },
  grooming: { types: { 'Beard grooming': 150, Shaving: 120, 'Body grooming': 300 }, areas: { Beard: 0, Moustache: 0, 'Beard + moustache': 50, Face: 0, Head: 50, 'Face + head': 120, Arms: 0, Legs: 100, Underarms: 0, 'Arms + legs': 250 }, extra15Minutes: 100, addons: { 'Aftercare balm': 50, 'Moisturizing finish': 80 } },
 };
 const VERSION = 'personal-care-sample-v1';
 const NOTE = 'Sample-rate estimate only. Provider confirms the selected services and final price; any extra charge needs your approval.';
 const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
 const people = { key: 'persons', label: 'Number of persons', type: 'number', min: 1, max: 20, step: 1, default: 1 };
 const addons = (rates, label = 'Add-ons') => ({ key: 'addons', label, type: 'checkboxes', options: Object.keys(rates) });
 const durations = ['30 min', '60 min', '90 min', '120 min'];
 const configs = {
  'massage therapy': { title: 'Massage Therapy', fields: [
   select('massage_type', 'Massage type', Object.keys(RATES.massage.types)),
   select('other_massage_type', 'Other provider-offered type', [], { when: { key: 'massage_type', value: 'Other provider-offered type' } }),
   select('duration', 'Duration', durations),
  ] },
  'home spa services': { title: 'Home Spa Services', fields: [
   select('package', 'Service / package', Object.keys(RATES.spa.packages)), select('duration', 'Duration per person', durations), people,
   addons(RATES.spa.addons, 'Add-ons (per person)'),
  ] },
  haircut: { title: 'Haircut', fields: [
   select('service', 'Service', Object.keys(RATES.haircut.services)), select('hair_length', 'Hair length', ['Short', 'Medium', 'Long']), addons(RATES.haircut.addons),
  ] },
  'nail care': { title: 'Nail Care', fields: [select('service', 'Service', ['Manicure', 'Pedicure', 'Both']), people, addons(RATES.nails.addons, 'Nail art / add-ons (per person)')] },
  'eyelash care': { title: 'Eyelash Care', fields: [select('service', 'Service', Object.keys(RATES.lashes.services)), addons(RATES.lashes.addons)] },
  grooming: { title: 'Grooming', fields: [
   select('grooming_type', 'Type of grooming', Object.keys(RATES.grooming.types)),
   select('area', 'Area / service', ['Beard', 'Moustache', 'Beard + moustache']),
   select('duration', 'Duration', ['15 min', '30 min', '60 min'], { when: { key: 'grooming_type', value: 'Body grooming' } }),
   addons(RATES.grooming.addons),
  ] },
 };
 const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
 function serviceKey(value) {
  const aliases = { massage: 'massage therapy', 'home spa': 'home spa services', 'hair cut': 'haircut', 'hair cut services': 'haircut', 'haircut services': 'haircut' };
  const raw = normalize(value);
  const key = Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
  return Object.hasOwn(configs, key) ? key : '';
 }
 function isCategory(value) { return ['personal care', 'personal care service', 'personal care services'].includes(normalize(value)); }
 function invalid(message) { const error = new Error(message); error.statusCode = 400; throw error; }

 function massageTypes(value) {
  if (!Array.isArray(value) || value.length > 10 || value.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 60)) {
   invalid('Enter up to 10 massage types, each between 1 and 60 characters.');
  }
  const seen = new Set(Object.keys(RATES.massage.types).map(normalize));
  return value.map(item => item.trim()).filter(item => {
   const key = normalize(item);
   if (seen.has(key)) return false;
   seen.add(key);
   return true;
  });
 }
 function fields(key, context = {}, inputs = {}) {
  if (!Object.hasOwn(configs, key)) invalid('Choose a valid personal care service.');
  return configs[key].fields.map(field => {
   if (key === 'massage therapy') {
    const otherTypes = massageTypes(context.massageTypes || []);
    if (field.key === 'massage_type' && !otherTypes.length) return { ...field, options: field.options.filter(value => value !== 'Other provider-offered type') };
    if (field.key === 'other_massage_type') return { ...field, options: otherTypes };
   }
   if (key === 'grooming' && field.key === 'area') {
    const options = inputs.grooming_type === 'Body grooming' ? ['Arms', 'Legs', 'Underarms', 'Arms + legs']
     : inputs.grooming_type === 'Shaving' ? ['Face', 'Head', 'Face + head'] : ['Beard', 'Moustache', 'Beard + moustache'];
    return { ...field, options };
   }
   return field;
  });
 }
 function fieldVisible(field, inputs) { return !field.when || inputs[field.when.key] === field.when.value; }
 function defaults(key, context = {}) {
  return Object.fromEntries(fields(key, context).map(field => [field.key, field.default ?? (field.type === 'select' ? field.options[0] || '' : [])]));
 }
 function validate(key, raw, context = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Complete the personal care selections.');
  const inputs = {};
  for (const field of fields(key, context, raw)) {
   if (!fieldVisible(field, raw)) continue;
   const value = raw[field.key];
   if (field.type === 'checkboxes') {
    const selected = value === undefined ? [] : value;
    if (!Array.isArray(selected) || selected.some(item => !field.options.includes(item))) invalid(`Choose valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = [...new Set(selected)];
   } else if (field.type === 'number') {
    const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isInteger(count) || count < field.min || count > field.max) invalid(`${field.label} must be a whole number from ${field.min} to ${field.max}.`);
    inputs[field.key] = count;
   } else {
    if (!field.options.includes(value)) invalid(`Choose a valid ${field.label.toLowerCase()}.`);
    inputs[field.key] = value;
   }
  }
  return inputs;
 }
 function assessment(key, raw, context = {}) {
  const inputs = validate(key, raw, context);
  const breakdown = [];
  const add = (label, amount) => breakdown.push({ label, amount });
  const addExtras = (rates, persons = 1) => inputs.addons.forEach(item => add(`${item}${persons > 1 ? ` x ${persons} persons` : ''}`, rates[item] * persons));
  const durationCharge = (baseMinutes, extraMinutes, rate, persons = 1) => {
   const extra = parseInt(inputs.duration, 10) - baseMinutes;
   if (extra > 0) add(`${extra} additional minutes${persons > 1 ? ` x ${persons} persons` : ''}`, extra / extraMinutes * rate * persons);
  };
  switch (key) {
   case 'massage therapy':
    add(`${inputs.other_massage_type || inputs.massage_type} (30 min)`, RATES.massage.types[inputs.massage_type]);
    durationCharge(30, 30, RATES.massage.extra30Minutes);
    break;
   case 'home spa services':
    add(`${inputs.package} (30 min) x ${inputs.persons} person(s)`, RATES.spa.packages[inputs.package] * inputs.persons);
    durationCharge(30, 30, RATES.spa.extra30Minutes, inputs.persons);
    addExtras(RATES.spa.addons, inputs.persons);
    break;
   case 'haircut':
    add(inputs.service, RATES.haircut.services[inputs.service]);
    if (RATES.haircut.lengths[inputs.hair_length]) add(`${inputs.hair_length} hair`, RATES.haircut.lengths[inputs.hair_length]);
    addExtras(RATES.haircut.addons);
    break;
   case 'nail care':
    add(`${inputs.service === 'Both' ? 'Manicure + pedicure' : inputs.service} x ${inputs.persons} person(s)`, RATES.nails.services[inputs.service] * inputs.persons);
    addExtras(RATES.nails.addons, inputs.persons);
    break;
   case 'eyelash care':
    add(inputs.service, RATES.lashes.services[inputs.service]);
    addExtras(RATES.lashes.addons);
    break;
   case 'grooming':
    add(inputs.grooming_type, RATES.grooming.types[inputs.grooming_type]);
    if (RATES.grooming.areas[inputs.area]) add(inputs.area, RATES.grooming.areas[inputs.area]);
    if (inputs.grooming_type === 'Body grooming') durationCharge(15, 15, RATES.grooming.extra15Minutes);
    addExtras(RATES.grooming.addons);
    break;
  }
  const amount = breakdown.reduce((sum, item) => sum + item.amount, 0);
  const answers = {};
  fields(key, context, inputs).forEach(field => {
   if (fieldVisible(field, inputs)) answers[field.label] = Array.isArray(inputs[field.key]) ? inputs[field.key].join(', ') || 'None' : String(inputs[field.key]);
  });
  return {
   amount, estimatedMin: amount, estimatedMax: amount, pricingType: 'calculated', mediaFiles: [],
   details: { category: 'Personal Care', service_type: configs[key].title, pricing_type: 'calculated', inputs, answers, breakdown,
    estimate_label: `Sample estimated price: PHP ${amount.toLocaleString('en-PH')}`, note: NOTE, rate_version: VERSION, sample_rates: true },
  };
 }
 function forBooking(serviceName, details, providerService) {
  const key = serviceKey(serviceName);
  if (!key) invalid('Choose a specific personal care service.');
  if (!providerService || providerService.is_active === false || !(serviceKey(providerService.title) === key || isCategory(providerService.title))) {
   invalid('Choose an active personal care service offered by this provider.');
  }
  if (details.service_type && serviceKey(details.service_type) !== key) invalid('Personal care selections do not match the booked service.');
  return assessment(key, details.inputs, { massageTypes: providerService.massage_types || [] });
 }
 return { RATES, VERSION, NOTE, configs, serviceKey, isCategory, fields, fieldVisible, defaults, validate, assessment, forBooking, massageTypes };
});
