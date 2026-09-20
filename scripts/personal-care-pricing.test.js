'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/personalCarePricing');
const quote = (key, inputs = {}, context = {}) => pricing.assessment(key, { ...pricing.defaults(key, context), ...inputs }, context);

test('all six personal care services produce calculated sample estimates and saved answers', () => {
 assert.equal(Object.keys(pricing.configs).length, 6);
 for (const key of Object.keys(pricing.configs)) {
  const result = quote(key);
  assert.ok(result.amount > 0, key);
  assert.equal(result.pricingType, 'calculated');
  assert.equal(result.estimatedMin, result.amount);
  assert.equal(result.estimatedMax, result.amount);
  assert.equal(result.details.sample_rates, true);
  assert.equal(result.details.category, 'Personal Care');
  assert.equal(result.details.breakdown.reduce((sum, item) => sum + item.amount, 0), result.amount);
  assert.ok(Object.keys(result.details.answers).length);
 }
});

test('massage combines selected type and all supported durations', () => {
 for (const [duration, expected] of [['30 min', 400], ['60 min', 550], ['90 min', 700], ['120 min', 850]]) {
  assert.equal(quote('massage therapy', { massage_type: 'Deep tissue', duration }).amount, expected);
 }
 assert.equal(quote('massage therapy', { massage_type: 'Relaxation' }).amount, 250);
 assert.throws(() => quote('massage therapy', { duration: '45 min' }), { statusCode: 400 });
});

test('other massage types must be offered by this provider and are omitted when unavailable', () => {
 const context = { massageTypes: ['Traditional massage', 'Foot massage'] };
 const result = quote('massage therapy', { massage_type: 'Other provider-offered type', other_massage_type: 'Foot massage', duration: '60 min' }, context);
 assert.equal(result.amount, 500);
 assert.equal(result.details.answers['Other provider-offered type'], 'Foot massage');
 assert.throws(() => quote('massage therapy', { massage_type: 'Other provider-offered type', other_massage_type: 'Unlisted' }, context), { statusCode: 400 });
 assert.throws(() => quote('massage therapy', { massage_type: 'Other provider-offered type', other_massage_type: 'Foot massage' }), { statusCode: 400 });
 assert.equal(pricing.fields('massage therapy')[0].options.includes('Other provider-offered type'), false);
 assert.equal(quote('massage therapy', { other_massage_type: 'Stale value' }).details.inputs.other_massage_type, undefined);
});

test('spa duration, package and add-ons are calculated per person without duplicate charges', () => {
 const result = quote('home spa services', { package: 'Full spa package', duration: '60 min', persons: 2, addons: ['Foot spa', 'Aromatherapy', 'Foot spa'] });
 assert.equal(result.amount, 3000);
 assert.equal(result.details.answers['Add-ons (per person)'], 'Foot spa, Aromatherapy');
});

test('haircut package, hair length and add-ons affect the estimate', () => {
 assert.equal(quote('haircut', { service: 'Haircut + styling', hair_length: 'Long', addons: ['Hair wash'] }).amount, 530);
 assert.equal(quote('haircut', { service: 'Haircut + treatment', hair_length: 'Medium' }).amount, 575);
});

test('nail care applies the selected service and nail art to each person', () => {
 const result = quote('nail care', { service: 'Both', persons: 3, addons: ['Simple nail art', 'Gel polish'] });
 assert.equal(result.amount, 2025);
 assert.match(result.details.breakdown[0].label, /Manicure \+ pedicure/);
});

test('eyelash options include removal and refill with independent prices', () => {
 for (const [service, expected] of [['Classic', 800], ['Volume', 1200], ['Hybrid', 1000], ['Removal', 250], ['Refill', 500]]) {
  assert.equal(quote('eyelash care', { service }).amount, expected);
 }
 assert.equal(quote('eyelash care', { service: 'Refill', addons: ['Lash bath', 'Aftercare kit'] }).amount, 750);
});

test('grooming permits compatible areas and only charges duration for body grooming', () => {
 assert.equal(quote('grooming', { grooming_type: 'Body grooming', area: 'Arms + legs', duration: '60 min', addons: ['Aftercare balm'] }).amount, 900);
 const shave = quote('grooming', { grooming_type: 'Shaving', area: 'Face + head', duration: '60 min' });
 assert.equal(shave.amount, 240);
 assert.equal(shave.details.inputs.duration, undefined);
 assert.equal(shave.details.answers.Duration, undefined);
 assert.throws(() => quote('grooming', { grooming_type: 'Shaving', area: 'Legs' }), { statusCode: 400 });
});

test('invalid persons, unknown options and unsupported add-ons are rejected', () => {
 for (const persons of ['', 0, -1, 1.5, 21, Infinity, [], {}, true]) {
  assert.throws(() => quote('home spa services', { persons }), { statusCode: 400 });
 }
 assert.throws(() => quote('haircut', { hair_length: 'Unknown' }), { statusCode: 400 });
 assert.throws(() => quote('nail care', { addons: ['Aromatherapy'] }), { statusCode: 400 });
 assert.throws(() => quote('eyelash care', { addons: 'Lash bath' }), { statusCode: 400 });
});

test('provider massage lists are bounded, trimmed, deduplicated and can be cleared', () => {
 assert.deepEqual(pricing.massageTypes([' Foot massage ', 'foot massage', 'Swedish']), ['Foot massage']);
 assert.deepEqual(pricing.massageTypes([]), []);
 for (const value of ['Foot massage', null, [42], [''], ['a'.repeat(61)], Array(11).fill('Type')]) {
  assert.throws(() => pricing.massageTypes(value), { statusCode: 400 });
 }
});

test('legacy service aliases and category names match the new forms', () => {
 assert.equal(pricing.serviceKey(' Hair Cut '), 'haircut');
 assert.equal(pricing.serviceKey('Massage'), 'massage therapy');
 assert.equal(pricing.serviceKey('Home Spa'), 'home spa services');
 assert.equal(pricing.isCategory('Personal Care Services'), true);
 assert.equal(pricing.serviceKey('constructor'), '');
});

test('booking recalculates tampered amounts and validates the selected offering', () => {
 const service = { title: 'Personal Care', is_active: true, massage_types: [] };
 const details = { inputs: pricing.defaults('haircut'), amount: 1, breakdown: [], sample_rates: false };
 const result = pricing.forBooking('Hair Cut', details, service);
 assert.equal(result.amount, 150);
 assert.equal(result.details.sample_rates, true);
 assert.throws(() => pricing.forBooking('Hair Cut', details, { ...service, is_active: false }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Hair Cut', details, { title: 'Nail Care' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Hair Cut', { ...details, service_type: 'Massage' }, service), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Hair Cut', {}, service), { statusCode: 400 });
});
