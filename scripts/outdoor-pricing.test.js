'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/outdoorPricing');
const quote = (key, changes = {}) => pricing.assessment(key, { ...pricing.defaults(key), ...changes });

test('all five outdoor services save itemized sample estimates and guide answers', () => {
 assert.equal(Object.keys(pricing.configs).length, 5);
 for (const key of Object.keys(pricing.configs)) {
  const result = quote(key);
  assert.equal(result.details.category, 'Outdoor and Property Maintenance');
  assert.equal(result.details.sample_rates, true);
  assert.equal(result.details.rate_version, pricing.VERSION);
  assert.equal(result.amount, result.estimatedMin);
  assert.ok(result.amount > 0 && result.estimatedMax >= result.estimatedMin);
  assert.equal(result.details.breakdown.reduce((sum, row) => sum + row.amount, 0), result.amount);
  assert.equal(result.details.breakdown.reduce((sum, row) => sum + (row.max_amount ?? row.amount), 0), result.estimatedMax);
  assert.ok(Object.keys(result.details.answers).length);
  assert.match(result.details.note, /disposal fees are separate/);
  assert.equal(result.pricingType, ['gardening', 'lawn mowing'].includes(key) ? 'calculated' : 'provider_quote');
 }
});

test('gardening accounts for area, service, plants and per-visit frequency', () => {
 assert.equal(quote('gardening').amount, 375);
 assert.equal(quote('gardening', { area_m2: 50, service: 'Planting', plants: 10 }).amount, 800);
 assert.equal(quote('gardening', { area_m2: 50, service: 'Pruning', plants: 10 }).amount, 550);
 assert.equal(quote('gardening', { area_m2: 50, service: 'General maintenance', plants: 10 }).amount, 500);
 assert.equal(quote('gardening', { area_m2: 100, service: 'Weeding', plants: 8 }).amount, 650);
 const weekly = quote('gardening', { area_m2: 50, plants: 10, frequency: 'Weekly' });
 assert.equal(weekly.amount, 720);
 assert.equal(weekly.details.answers.Frequency, 'Weekly');
 assert.equal(weekly.details.pricing_basis, 'per_visit');
 assert.match(weekly.details.estimate_label, /per visit/);
 assert.match(weekly.details.note, /does not include future visits/);
 assert.match(weekly.details.note, /10% off per-visit labor/);
 assert.equal(quote('gardening', { frequency: 'Every 2 weeks' }).amount, 356.25);
 assert.equal(quote('gardening', { frequency: 'Monthly' }).amount, 375);
});

test('lawn mowing supports sizes, exact custom m2, grass height and cleanup', () => {
 for (const [size, amount] of [['Small', 350], ['Medium', 650], ['Large', 1100]]) assert.equal(quote('lawn mowing', { lawn_size: size }).amount, amount);
 const changes = { lawn_size: 'Custom m2', area_m2: 80, grass_height: 'Tall (over 30 cm)', cleanup: 'Bag grass clippings' };
 const result = quote('lawn mowing', changes);
 assert.equal(result.amount, 1304);
 assert.equal(result.details.answers['Custom lawn size (m2)'], '80');
 assert.match(result.details.breakdown[1].label, /80 m2/);
 assert.equal(quote('lawn mowing', { ...changes, frequency: 'Weekly' }).amount, 1173.6);
 assert.equal(quote('lawn mowing', { lawn_size: 'Large', grass_height: 'Tall (over 30 cm)', cleanup: 'Grass and debris cleanup' }).amount, 2720);
 const hidden = quote('lawn mowing', { area_m2: 'stale hidden value' });
 assert.equal(hidden.amount, 350);
 assert.equal(hidden.details.inputs.area_m2, undefined);
 assert.equal(hidden.details.answers['Custom lawn size (m2)'], undefined);
});

test('landscape maintenance quotes each area with condition and frequency', () => {
 const changes = { area_m2: 40, areas: 3, maintenance_type: 'Soil and garden bed care', condition: 'Overgrown', frequency: 'Weekly' };
 const result = quote('landscape maintenance', changes);
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [2106, 4212]);
 assert.equal(result.pricingType, 'provider_quote');
 assert.equal(result.details.answers['Number of areas'], '3');
 assert.match(result.details.note, /one visit only/);
 assert.ok(result.details.breakdown.every(row => row.max_amount >= row.amount));
 assert.equal(quote('landscape maintenance', { areas: 2 }).amount, 500);
 const custom = quote('landscape maintenance', { maintenance_type: 'Other', other_maintenance: 'Rock garden maintenance' });
 assert.equal(custom.details.answers['Other maintenance type'], 'Rock garden maintenance');
 assert.match(custom.details.breakdown[0].label, /Rock garden/);
});

test('tree assessment saves height, branches, access, optional type and power-line safety', () => {
 const result = quote('tree trimming', { trees: 2, height_m: 8, tree_type: 'Mango', branch_condition: 'Damaged / dead', access: 'Limited access', near_power_lines: 'Yes' });
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [5760, 11520]);
 assert.equal(result.details.answers['Tree type (if known)'], 'Mango');
 assert.equal(result.details.answers['Near power lines?'], 'Yes');
 assert.equal(result.details.requires_safety_assessment, true);
 assert.equal(result.details.safety_note, pricing.SAFETY_NOTE);
 assert.match(result.details.note, /before work can be confirmed/);
 assert.equal(quote('tree trimming', { near_power_lines: 'Not sure' }).details.requires_safety_assessment, true);
 assert.equal(quote('tree trimming').details.requires_safety_assessment, false);
 assert.equal(quote('tree trimming').details.safety_note, undefined);
 assert.equal(quote('tree trimming').details.inputs.tree_type, undefined);
 assert.deepEqual([quote('tree trimming', { height_m: 12 }).estimatedMin, quote('tree trimming', { height_m: 12 }).estimatedMax], [2500, 5000]);
});

test('fence quotes use material, damaged length, sections, problem and height', () => {
 assert.deepEqual([quote('fence repair').estimatedMin, quote('fence repair').estimatedMax], [500, 950]);
 const result = quote('fence repair', { material: 'Metal', length_m: 12, sections: 3, problem: 'Broken panel', height_m: 2.5 });
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [2160, 4470]);
 assert.equal(result.details.answers['Fence height (m)'], '2.5');
 assert.equal(result.details.answers['Number of damaged sections'], '3');
 const custom = quote('fence repair', { material: 'Other', other_material: 'Bamboo', problem: 'Other', other_problem: 'Split rails' });
 assert.equal(custom.details.inputs.other_material, 'Bamboo');
 assert.equal(custom.details.answers['Other fence problem'], 'Split rails');
 assert.equal(quote('fence repair', { other_material: 'stale', other_problem: 'stale' }).details.inputs.other_material, undefined);
});

test('numeric bounds, steps, valid options and required other descriptions are enforced', () => {
 for (const key of Object.keys(pricing.configs)) {
  for (const field of pricing.fields(key).filter(field => field.type === 'number' && !field.when)) {
   for (const value of ['', -1, field.max + field.step, NaN, Infinity, true, {}, []]) assert.throws(() => quote(key, { [field.key]: value }), { statusCode: 400 }, `${key}: ${field.key}`);
  }
 }
 assert.throws(() => quote('gardening', { plants: 1.5 }), { statusCode: 400 });
 assert.throws(() => quote('lawn mowing', { lawn_size: 'Custom m2', area_m2: 0 }), { statusCode: 400 });
 assert.throws(() => quote('tree trimming', { height_m: 3.2 }), { statusCode: 400 });
 assert.throws(() => quote('fence repair', { height_m: 1.55 }), { statusCode: 400 });
 assert.throws(() => quote('fence repair', { material: 'Other' }), { statusCode: 400 });
 assert.throws(() => quote('landscape maintenance', { maintenance_type: 'Other' }), { statusCode: 400 });
 assert.throws(() => quote('fence repair', { problem: 'Other' }), { statusCode: 400 });
 assert.throws(() => quote('tree trimming', { tree_type: 'a'.repeat(151) }), { statusCode: 400 });
 assert.throws(() => quote('tree trimming', { near_power_lines: 'maybe' }), { statusCode: 400 });
 assert.throws(() => quote('gardening', { frequency: 'Daily' }), { statusCode: 400 });
 assert.throws(() => pricing.assessment('gardening', null), { statusCode: 400 });
 assert.throws(() => pricing.assessment('gardening', []), { statusCode: 400 });
});

test('legacy outdoor category and service titles match without widening other categories', () => {
 for (const name of ['Outdoor and Property Maintenance', 'Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance']) assert.equal(pricing.isCategory(name), true);
 for (const [name, key] of [['Gardening services', 'gardening'], ['Lawn & Mowing', 'lawn mowing'], ['Landscape maintenance', 'landscape maintenance'], ['Tree trimming', 'tree trimming'], ['Fence repair', 'fence repair']]) assert.equal(pricing.serviceKey(name), key);
 for (const name of ['Cleaning', 'Furniture repair', 'Roof repair', 'constructor', 'toString']) assert.equal(pricing.serviceKey(name), '');
 assert.throws(() => pricing.fields('constructor'), { statusCode: 400 });
});

test('forBooking trusts validated answers and actual active offerings, not submitted totals', () => {
 const details = { inputs: { ...pricing.defaults('gardening'), plants: 10, area_m2: 50, frequency: 'Weekly' }, amount: 1, sample_rates: false, answers: { Fake: 'ignore' }, breakdown: [], requires_safety_assessment: true };
 const result = pricing.forBooking('Gardening services', details, { title: 'Outdoor & Property Maintenance' });
 assert.equal(result.amount, 720);
 assert.equal(result.details.sample_rates, true);
 assert.equal(result.details.answers.Fake, undefined);
 assert.equal(result.details.requires_safety_assessment, false);
 for (const offering of [null, { title: 'Fence repair' }, { title: 'Cleaning' }, { title: 'Gardening services', is_active: false }]) assert.throws(() => pricing.forBooking('Gardening services', details, offering), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Gardening services', { ...details, service_type: 'Tree Trimming' }, { title: 'Gardening services' }), { statusCode: 400 });
 for (const invalid of [{}, null, []]) assert.throws(() => pricing.forBooking('Gardening services', invalid, { title: 'Gardening services' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Outdoor and Property Maintenance', details, { title: 'Outdoor and Property Maintenance' }), { statusCode: 400 });
});
