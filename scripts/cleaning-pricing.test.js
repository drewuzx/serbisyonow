'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/cleaningPricing');

function quote(key, changes = {}, context = {}) {
 return pricing.assessment(key, { ...pricing.defaults(key), ...changes }, context);
}

test('all seven cleaning services produce itemized sample estimates', () => {
 assert.equal(Object.keys(pricing.configs).length, 7);
 for (const key of Object.keys(pricing.configs)) {
  const result = quote(key);
  assert.ok(result.amount > 0, key);
  assert.equal(result.estimatedMin, result.estimatedMax);
  assert.equal(result.pricingType, 'calculated');
  assert.equal(result.details.sample_rates, true);
  assert.match(result.details.note, /approval/);
  const sum = result.details.breakdown.reduce((total, item) => total + item.amount, 0);
  assert.equal(Math.round(sum * 100) / 100, result.amount);
 }
});

test('house cleaning includes property, bathrooms, exact extended duration and multiple areas', () => {
 assert.equal(quote('general house cleaning', { property_type: '1 Bedroom', duration: '3 hours' }).amount, 750);
 const result = quote('general house cleaning', { property_type: '4+ Bedrooms', bedrooms: 6, bathrooms: '3+', bathroom_count: 4, duration: '5+ hours', hours: 6, areas: ['Kitchen', 'Balcony'] });
 assert.equal(result.amount, 2375);
 assert.equal(result.details.answers['Additional areas'], 'Kitchen, Balcony');
 assert.throws(() => quote('general house cleaning', { areas: ['Other'] }), /Other area/i);
 assert.throws(() => quote('general house cleaning', { areas: ['Unknown'] }), /valid/);
});

test('deep cleaning responds to area, dirt, rooms, duration and included areas', () => {
 const result = quote('deep cleaning', { sqm: 50, bedrooms: 2, bathrooms: 2, dirt_level: 'Heavy', hours: 4, areas: ['Kitchen'] });
 assert.equal(result.amount, 3262.5);
 assert.ok(quote('deep cleaning', { sqm: 100 }).amount > quote('deep cleaning').amount);
 assert.throws(() => quote('deep cleaning', { sqm: '' }), /Approximate size/);
});

test('bathroom cleaning multiplies size, count and level', () => {
 assert.equal(quote('bathroom cleaning', { bathrooms: 2, size: 'Large', cleaning_level: 'Deep cleaning' }).amount, 1600);
});

test('upholstery accounts for type, material and quantity', () => {
 assert.equal(quote('sofa & upholstery cleaning', { type: '3-seater', quantity: 2, material: 'Leather' }).amount, 2125);
 assert.throws(() => quote('sofa & upholstery cleaning', { material: 'Other' }), /Other material/i);
});

test('carpets calculate actual custom area and exclude hidden stale inputs', () => {
 assert.equal(quote('carpet cleaning', { size: 'Custom sq m', sqm: 6.5, quantity: 2, cleaning_level: 'Deep cleaning' }).amount, 1170);
 const result = quote('carpet cleaning', { size: 'Small', sqm: -200 });
 assert.equal(result.amount, 240);
 assert.equal(result.details.inputs.sqm, undefined);
 assert.throws(() => quote('carpet cleaning', { size: 'Custom sq m', sqm: 0 }), /Custom size/);
});

test('windows produce a range for difficult access and a calculation for reachable windows', () => {
 assert.equal(quote('window cleaning', { quantity: 2, size: 'Medium', sides: 'Indoor + outdoor', access: 'Step ladder required' }).amount, 600);
 const range = quote('window cleaning', { quantity: 2, size: 'Medium', sides: 'Indoor + outdoor', access: 'High / difficult access' });
 assert.equal(range.pricingType, 'provider_quote');
 assert.equal(range.estimatedMin, 624);
 assert.equal(range.estimatedMax, 768);
 assert.match(range.details.note, /provider assessment/);
});

test('laundry uses package per kg, actual 10+ weight and provider-controlled delivery', () => {
 assert.equal(quote('laundry services', { weight: '5 kg', package: 'Wash + dry + fold' }).amount, 425);
 const result = quote('laundry services', { weight: '10 kg+', kg: 12.5, package: 'Wash + dry', fulfillment: 'Pickup + delivery' }, { pickupDelivery: true });
 assert.equal(result.amount, 912.5);
 assert.throws(() => quote('laundry services', { fulfillment: 'Pickup + delivery' }), /does not offer/);
 assert.equal(quote('laundry services').details.answers['Pickup / delivery'], 'Drop-off / collection');
});

test('invalid, negative, fractional counts, nonfinite and over-limit values are rejected', () => {
 for (const quantity of ['', 0, -1, 0.5, 101, Infinity, NaN, [], true]) {
  assert.throws(() => quote('window cleaning', { quantity }), { statusCode: 400 });
 }
 assert.throws(() => quote('bathroom cleaning', { size: 'Huge' }), { statusCode: 400 });
 assert.throws(() => pricing.assessment('unknown', {}), { statusCode: 400 });
});

test('service aliases match existing titles', () => {
 assert.equal(pricing.serviceKey('Sofa and upholstery cleaning'), 'sofa & upholstery cleaning');
 assert.equal(pricing.serviceKey(' General house cleaning '), 'general house cleaning');
 assert.equal(pricing.serviceKey('House Cleaning'), 'general house cleaning');
 assert.equal(pricing.serviceKey('Kitchen cleaning'), '');
 assert.equal(pricing.serviceKey('constructor'), '');
});

test('server booking calculation rebuilds totals and rejects mismatched or unavailable services', () => {
 const service = { title: 'Cleaning Services', is_active: true, laundry_pickup_delivery: false };
 const details = { inputs: pricing.defaults('bathroom cleaning'), amount: 1, breakdown: [{ amount: 1 }], sample_rates: false };
 const result = pricing.forBooking('Bathroom Cleaning', details, service);
 assert.equal(result.amount, 250);
 assert.equal(result.details.sample_rates, true);
 assert.throws(() => pricing.forBooking('Bathroom Cleaning', details, { ...service, is_active: false }), /active cleaning/);
 assert.throws(() => pricing.forBooking('Bathroom Cleaning', details, { title: 'Carpet Cleaning' }), /active cleaning/);
 assert.throws(() => pricing.forBooking('Bathroom Cleaning', { ...details, service_type: 'Deep Cleaning' }, service), /do not match/);
 assert.throws(() => pricing.forBooking('Bathroom Cleaning', {}, service), /Complete/);
 assert.throws(() => pricing.forBooking('Cleaning', details, service), /specific/);
});
