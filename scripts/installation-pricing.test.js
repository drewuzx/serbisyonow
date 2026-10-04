'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/installationPricing');
const inputs = key => ({ ...pricing.defaults(key), dimensions: '80 x 120 x 40 cm', brand: 'Test brand' });
const quote = (key, changes = {}) => pricing.assessment(key, { ...inputs(key), ...changes });

test('all seven installation services save validated answers and itemized sample labor estimates', () => {
 assert.equal(Object.keys(pricing.configs).length, 7);
 for (const key of Object.keys(pricing.configs)) {
  const result = quote(key);
  assert.equal(result.details.category, 'Installation Services');
  assert.equal(result.details.sample_rates, true);
  assert.equal(result.amount, result.estimatedMin);
  assert.ok(result.estimatedMax >= result.estimatedMin && result.amount > 0);
  assert.equal(result.details.breakdown.reduce((sum, row) => sum + row.amount, 0), result.amount);
  assert.equal(result.details.breakdown.reduce((sum, row) => sum + (row.max_amount ?? row.amount), 0), result.estimatedMax);
  assert.ok(Object.keys(result.details.answers).length);
  assert.match(result.details.note, /Equipment and materials are separate/);
  assert.equal(result.details.inputs.other_location, undefined);
 }
});

test('furniture calculates ready-to-assemble units and quotes additional custom work', () => {
 const result = quote('furniture installation', { furniture_type: 'Chair', size: 'Medium', units: 2, product_url: 'https://example.com/furniture?id=42' });
 assert.equal(result.amount, 750);
 assert.equal(result.pricingType, 'calculated');
 assert.equal(result.details.product_url, 'https://example.com/furniture?id=42');
 assert.equal(result.details.answers['Number of units'], '2');
 const custom = quote('furniture installation', { size: 'Medium', units: 2, ready_to_assemble: 'No' });
 assert.deepEqual([custom.estimatedMin, custom.estimatedMax], [1250, 2150]);
 assert.equal(custom.pricingType, 'provider_quote');
 assert.equal(quote('furniture installation', { furniture_type: 'Other', other_furniture: 'Shoe rack' }).pricingType, 'provider_quote');
});

test('cabinet quote includes quantity, material and wall mounting while preserving dimensions', () => {
 const result = quote('cabinet installation', { cabinets: 2 });
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [1800, 3600]);
 assert.equal(result.details.answers['Approximate dimensions per cabinet'], '80 x 120 x 40 cm');
 assert.equal(result.pricingType, 'provider_quote');
 const metal = quote('cabinet installation', { cabinets: 2, material: 'Metal' });
 assert.deepEqual([metal.estimatedMin, metal.estimatedMax], [2125, 4250]);
 assert.deepEqual([quote('cabinet installation', { mounting: 'Freestanding' }).estimatedMin, quote('cabinet installation', { mounting: 'Freestanding' }).estimatedMax], [650, 1300]);
});

test('curtain and blind prices reflect window type, size, count and installation method', () => {
 const result = quote('curtain / blinds installation', { covering_type: 'Roller blinds', window_size: 'Medium', windows: 3, installation_type: 'New brackets / track' });
 assert.equal(result.amount, 1425);
 assert.equal(result.pricingType, 'calculated');
 assert.equal(quote('curtain / blinds installation', { covering_type: 'Roller blinds', window_size: 'Custom width', width_m: 2.5, windows: 2 }).amount, 1250);
 assert.equal(quote('curtain / blinds installation', { width_m: 'stale invalid value' }).details.inputs.width_m, undefined);
});

test('lighting remains a quote and includes new wiring and difficult access', () => {
 const result = quote('lighting installation', { fixture_type: 'Chandelier', fixtures: 2, new_wiring: 'Yes', access: 'High / difficult access', mounting: 'Ceiling' });
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [2400, 5800]);
 assert.equal(result.pricingType, 'provider_quote');
 assert.equal(result.details.answers['Ceiling / wall'], 'Ceiling');
 assert.ok(quote('lighting installation', { existing_wiring: 'No' }).estimatedMin > quote('lighting installation').estimatedMin);
});

test('CCTV itemizes base installation, cabling, outdoor placement, storage and floors', () => {
 const selections = { cameras: 4, environment: 'Outdoor', existing_wiring: 'No', storage: 'New DVR / NVR setup', floors: 2 };
 const result = quote('cctv installation', selections);
 assert.equal(result.amount, 4750);
 assert.equal(result.pricingType, 'calculated');
 assert.match(result.details.breakdown[0].label, /Base installation/);
 assert.equal(result.details.breakdown[0].amount, 2200);
 const high = quote('cctv installation', { ...selections, height: 'High / difficult access' });
 assert.deepEqual([high.estimatedMin, high.estimatedMax], [5550, 6750]);
 assert.equal(high.pricingType, 'provider_quote');
 assert.equal(quote('cctv installation', { existing_wiring: 'Not sure' }).pricingType, 'provider_quote');
 assert.equal(quote('cctv installation', { storage: 'Not sure' }).pricingType, 'provider_quote');
});

test('router packages calculate devices and access points and quote new wiring', () => {
 const selections = { package: 'Mesh setup', devices: 8, access_points: 3 };
 assert.equal(quote('internet / router setup', selections).amount, 1245);
 const result = quote('internet / router setup', { ...selections, new_wiring: 'Yes' });
 assert.deepEqual([result.estimatedMin, result.estimatedMax], [1695, 2595]);
 assert.equal(result.pricingType, 'provider_quote');
 assert.equal(quote('internet / router setup', { new_wiring: 'Not sure' }).pricingType, 'provider_quote');
});

test('appliance installation prices simple ready connections and quotes specialized work', () => {
 const selections = { appliance_type: 'Washing machine', units: 2 };
 assert.equal(quote('appliance installation', selections).amount, 900);
 assert.equal(quote('appliance installation', selections).pricingType, 'calculated');
 const extra = quote('appliance installation', { ...selections, existing_connection: 'No', additional_materials: 'Yes' });
 assert.deepEqual([extra.estimatedMin, extra.estimatedMax], [1500, 2900]);
 const aircon = quote('appliance installation', { appliance_type: 'Aircon', units: 2 });
 assert.deepEqual([aircon.estimatedMin, aircon.estimatedMax], [2400, 3600]);
 assert.equal(aircon.pricingType, 'provider_quote');
 assert.equal(quote('appliance installation', { location: 'Outdoor' }).pricingType, 'provider_quote');
 assert.equal(quote('appliance installation').details.inputs.model, undefined);
});

test('invalid counts, missing details, unknown options and unsafe product links are rejected', () => {
 for (const units of ['', ' ', 0, -1, 1.5, 31, Infinity, [], {}, true]) assert.throws(() => quote('furniture installation', { units }), { statusCode: 400 });
 for (const url of ['javascript:alert(1)', 'data:text/plain,x', 'file:///test', 'example.com/product']) assert.throws(() => quote('furniture installation', { product_url: url }), { statusCode: 400 });
 assert.throws(() => quote('cabinet installation', { dimensions: '' }), { statusCode: 400 });
 assert.throws(() => quote('appliance installation', { brand: '' }), { statusCode: 400 });
 assert.throws(() => quote('curtain / blinds installation', { window_size: 'Custom width', width_m: 1.25 }), { statusCode: 400 });
 assert.throws(() => quote('furniture installation', { furniture_type: 'Other', other_furniture: '' }), { statusCode: 400 });
 assert.throws(() => quote('cctv installation', { camera_type: 'Unlisted', cameras: 4 }), { statusCode: 400 });
 assert.throws(() => quote('cabinet installation', { dimensions: 'a'.repeat(151) }), { statusCode: 400 });
 assert.equal(quote('furniture installation', { other_furniture: 'stale' }).details.inputs.other_furniture, undefined);
});

test('existing service names and old category names match without crossing categories', () => {
 for (const [name, expected] of [['Furniture assembly', 'furniture installation'], ['Curtain or blinds installation', 'curtain / blinds installation'], ['Internet or router setup', 'internet / router setup']]) assert.equal(pricing.serviceKey(name), expected);
 assert.equal(pricing.isCategory('Home Installation'), true);
 assert.equal(pricing.isCategory('Installation Services'), true);
 assert.equal(pricing.serviceKey('Appliance repair'), '');
 assert.equal(pricing.serviceKey('Aircon'), '');
 assert.equal(pricing.serviceKey('constructor'), '');
 assert.throws(() => pricing.assessment('toString', {}), { statusCode: 400 });
});

test('server booking calculation rebuilds totals and requires a matching active provider service', () => {
 const details = { inputs: { ...inputs('furniture installation'), units: 2 }, amount: 1, sample_rates: false, breakdown: [] };
 const result = pricing.forBooking('Furniture assembly', details, { title: 'Home Installation' });
 assert.equal(result.amount, 500);
 assert.equal(result.details.category, 'Installation Services');
 assert.equal(result.details.sample_rates, true);
 assert.throws(() => pricing.forBooking('Furniture assembly', details, { title: 'Cabinet installation' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Furniture assembly', details, { title: 'Furniture assembly', is_active: false }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Furniture assembly', { ...details, service_type: 'Lighting Installation' }, { title: 'Installation Services' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Furniture assembly', {}, { title: 'Installation Services' }), { statusCode: 400 });
 assert.throws(() => pricing.forBooking('Installation Services', details, { title: 'Installation Services' }), { statusCode: 400 });
});
