'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/appliancePricing');
const inputs = key => ({ ...pricing.defaults(key), brand: 'Test brand', appliance_type: key === 'tv' ? 'LED / LCD' : 'Test appliance', problem: 'Not working properly' });
const quote = (key, changes = {}) => pricing.assessment(key, { ...inputs(key), ...changes });

test('aircon estimates use the rate for each unit type and service multiplied by units', () => {
 for (const [unit_type, services] of Object.entries(pricing.RATES.aircon)) {
  for (const [service, rate] of Object.entries(services)) {
   const result = quote('aircon cleaning', { unit_type, service, units: 3 });
   assert.equal(result.amount, rate * 3);
   assert.equal(result.estimatedMin, result.amount);
   assert.equal(result.estimatedMax, result.amount);
   assert.equal(result.pricingType, 'calculated');
   assert.equal(result.details.answers['Number of units'], '3');
   assert.equal(result.details.breakdown[0].amount, rate * 3);
   assert.equal(result.details.sample_rates, true);
  }
 }
});

test('other appliances save their own questions with diagnostic ranges and provider quotation', () => {
 assert.equal(Object.keys(pricing.configs).length, 7);
 for (const key of Object.keys(pricing.RATES.diagnostics)) {
  const result = quote(key);
  assert.deepEqual([result.estimatedMin, result.estimatedMax], pricing.RATES.diagnostics[key]);
  assert.equal(result.amount, result.estimatedMin);
  assert.equal(result.pricingType, 'provider_quote');
  assert.equal(result.details.category, 'Appliance Maintenance');
  assert.equal(result.details.sample_rates, true);
  assert.match(result.details.estimate_label, /Sample diagnostic estimate/);
  assert.match(result.details.note, /not the final repair price/);
  assert.equal(result.details.answers['Problem / symptom'], 'Not working properly');
  assert.equal(result.details.inputs.model, undefined);
 }
 assert.equal(quote('refrigerator', { cooling_issue: 'Yes', unusual_noise: 'Yes', leaking: 'Yes', turning_on: 'No' }).details.answers['Is there a cooling issue?'], 'Yes');
 assert.equal(quote('washing machine', { washer_type: 'Front load', draining: 'No', spinning: 'No' }).details.answers['Is it draining?'], 'No');
 assert.equal(quote('microwave', { heating: 'No', sparking: 'Yes', display_working: 'No' }).details.answers['Does it spark?'], 'Yes');
 assert.equal(quote('electronics', { visible_damage: 'Yes', operational_status: 'Not turning on' }).details.answers['Operational status'], 'Not turning on');
});

test('required descriptions, valid options and bounded counts are enforced', () => {
 for (const units of ['', ' ', 0, -1, 1.5, 21, Infinity, [], {}, true]) assert.throws(() => quote('aircon cleaning', { units }), { statusCode: 400 });
 assert.throws(() => quote('aircon cleaning', { unit_type: 'Unknown' }), { statusCode: 400 });
 assert.throws(() => quote('aircon cleaning', { service: 'Repair' }), { statusCode: 400 });
 for (const key of Object.keys(pricing.RATES.diagnostics)) {
  for (const problem of ['', ' ', 5, [], 'x'.repeat(2001)]) assert.throws(() => quote(key, { problem }), { statusCode: 400 });
 }
 assert.throws(() => quote('refrigerator', { brand: '' }), { statusCode: 400 });
 assert.throws(() => quote('small appliances', { appliance_type: '' }), { statusCode: 400 });
 assert.throws(() => quote('tv', { operational_status: 'Fine' }), { statusCode: 400 });
 assert.throws(() => quote('microwave', { sparking: 'Always' }), { statusCode: 400 });
 assert.equal(quote('washing machine', { brand: '', model: '' }).details.inputs.brand, undefined);
 assert.throws(() => pricing.assessment('toString', {}), { statusCode: 400 });
});

test('aliases and existing TV / Electronics offerings remain compatible without widening their scope', () => {
 assert.equal(pricing.serviceKey(' Aircon '), 'aircon cleaning');
 assert.equal(pricing.serviceKey('Fridge'), 'refrigerator');
 assert.equal(pricing.serviceKey('Television'), 'tv');
 assert.equal(pricing.serviceKey('Appliance Repair'), '', 'repair category keeps its existing assessment');
 assert.equal(pricing.serviceKey('constructor'), '');
 assert.deepEqual(pricing.serviceKeys('TV / Electronics'), ['tv', 'electronics']);
 assert.equal(pricing.serviceKeys('Appliance Maintenance').length, 7);
 for (const key of ['tv', 'electronics']) assert.equal(pricing.forBooking(key, { inputs: inputs(key) }, { title: 'TV / Electronics' }).pricingType, 'provider_quote');
 assert.throws(() => pricing.forBooking('Microwave', { inputs: inputs('microwave') }, { title: 'TV / Electronics' }), { statusCode: 400 });
});

test('booking validation rebuilds estimates and checks the actual provider offering', () => {
 const provider = { title: 'Appliance Maintenance', is_active: true };
 const details = { inputs: { ...inputs('aircon cleaning'), units: 2, unit_type: 'Split-type', service: 'Deep cleaning' }, amount: 1, sample_rates: false, breakdown: [] };
 assert.equal(pricing.forBooking('Aircon', details, provider).amount, 2000);
 assert.throws(() => pricing.forBooking('Aircon', details, { title: 'Refrigerator' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Aircon', details, { ...provider, is_active: false }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Aircon', { ...details, service_type: 'Microwave' }, provider), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Aircon', {}, provider), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Appliance Maintenance', details, provider), { statusCode: 400 });
 assert.equal(pricing.forBooking('Aircon', details, provider).details.sample_rates, true);
});
