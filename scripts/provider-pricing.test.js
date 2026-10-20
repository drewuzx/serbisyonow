'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../shared/js/providerPricing');
const cleaning = require('../shared/js/cleaningPricing');
const service = { id: 1, title: 'General House Cleaning', category: 'Cleaning Services', updated_at: '2026-10-15T00:00:00.000Z' };
const draft = () => ({ ...pricing.defaults(service), mode: 'house_matrix' });
test('matrix configuration preserves exact prices and derives its listing range', () => {
 const config = pricing.validate(draft(), service.title);
 assert.deepEqual(pricing.bounds(config), { min: 400, max: 1700 });
 assert.deepEqual(pricing.bounds({ ...config, duration: '3 hours' }), { min: 550, max: 1200 });
});
test('provider matrix replaces sample totals and preserves the assessment', () => {
 const inputs = { ...cleaning.defaults('general house cleaning'), property_type: '1 Bedroom', duration: '3 hours', bathrooms: '2', areas: ['Kitchen'] };
 const base = cleaning.assessment('general house cleaning', inputs);
 const config = pricing.validate(draft(), service.title);
 const actual = pricing.apply(base, { ...service, pricing_config: config });
 assert.equal(actual.amount, 850);
 assert.equal(actual.details.sample_rates, false);
 assert.equal(actual.details.provider_pricing.revision, service.updated_at);
 assert.deepEqual(actual.details.inputs, base.details.inputs);
 assert.match(actual.details.note, /customer approval/);
});
test('extra bedrooms, bathrooms and hours use provider rates', () => {
 const inputs = { ...cleaning.defaults('general house cleaning'), property_type: '4+ Bedrooms', bedrooms: 6, duration: '5+ hours', hours: 7, bathrooms: '3+', bathroom_count: 4, areas: [] };
 const actual = pricing.apply(cleaning.assessment('general house cleaning', inputs), { ...service, pricing_config: draft() });
 assert.equal(actual.amount, 1700 + 300 + 300 + 300);
});
test('ranges and add-on quantities use saved values, never customer-supplied amounts', () => {
 const config = { ...draft(), mode: 'range', min: 450, max: 1500, addons: [{ id: 'a1', enabled: true, name: 'Nail art', min: 100, max: 200, unit: 'Per unit' }] };
 const actual = pricing.apply({ amount: 1, details: {} }, { ...service, title: 'Nail Care', pricing_config: config }, { addons: [{ id: 'a1', quantity: 2, min: 1, max: 1 }] });
 assert.equal(actual.estimatedMin, 650); assert.equal(actual.estimatedMax, 1900);
 assert.equal(actual.pricingType, 'provider_quote');
});
test('malformed pricing is rejected', () => {
 for (const invalid of [NaN, Infinity, -1, '', null, true, 1.001, 1000001]) assert.throws(() => pricing.validate({ ...draft(), matrix: draft().matrix.map((r,i)=>i ? r : [invalid,550,700,850]) }, service.title));
 assert.throws(() => pricing.validate({ ...draft(), matrix: [] }, service.title));
 assert.throws(() => pricing.validate({ ...draft(), mode: 'range', min: 500, max: 100 }, service.title));
 assert.throws(() => pricing.validate(draft(), 'Nail Care'));
 assert.throws(() => pricing.validate({ ...draft(), notes: 'a'.repeat(501) }, service.title));
});
test('optional add-on descriptions and half-day duration round-trip with legacy pricing', () => {
 const addon = { id:'a1',name:'Inspection',min:100,max:100,unit:'Per service',enabled:true };
 const config = { ...draft(), mode:'range',min:500,max:1000,duration:'Half day',addons:[{...addon,description:'  Includes diagnosis.  '}] };
 const result = pricing.validate(config,'Appliance repair');
 assert.equal(result.duration,'Half day');
 assert.equal(result.addons[0].description,'Includes diagnosis.');
 assert.deepEqual(pricing.validate({...config,addons:[addon]},'Appliance repair').addons[0],addon);
 assert.throws(()=>pricing.validate({...config,addons:[{...addon,description:'x'.repeat(301)}]},'Appliance repair'),/description/);
 assert.throws(()=>pricing.validate({...config,addons:[{...addon,description:{}}]},'Appliance repair'),/description/);
});
test('unavailable, duplicate and invalid quantity add-ons are rejected', () => {
 const addon = { id:'a1',name:'Fridge',min:200,max:400,unit:'Per service',enabled:true };
 const configured = { ...service, pricing_config: { ...draft(), mode:'range', min:500,max:1000,addons:[addon] } };
 for (const addons of [[{id:'missing',quantity:1}],[{id:'a1',quantity:0}],[{id:'a1',quantity:1.5}],[{id:'a1',quantity:2}],[{id:'a1',quantity:1},{id:'a1',quantity:1}]]) assert.throws(()=>pricing.apply(null,configured,{addons}));
 configured.pricing_config.addons[0].enabled=false;
 assert.throws(()=>pricing.apply(null,configured,{addons:[{id:'a1',quantity:1}]}));
});
test('configured house duration is enforced', () => {
 const base = cleaning.assessment('general house cleaning', cleaning.defaults('general house cleaning'));
 assert.throws(()=>pricing.apply(base,{...service,pricing_config:{...draft(),duration:'4 hours'}}),/offers 4 hours/);
});
test('repair offerings retain quotation and custom repair titles remain bookable', () => {
 const offered = {title:'Leak Detection & Repair', category:'Repair Services'};
 assert.equal(pricing.matchesQuoteService(offered,'Plumbing Services'),true);
 assert.equal(pricing.matchesQuoteService({...offered,title:'Electrical Repair'},'Plumbing Services'),false);
 assert.equal(pricing.matchesQuoteService(offered,'Nail Care'),false);
 assert.equal(pricing.apply({pricingType:'calculated',details:{service_type:'Plumbing Services'}},{...offered,pricing_config:{...draft(),mode:'range',min:500,max:500}}).pricingType,'provider_quote');
});
test('legacy services retain sample estimates; safety assessment flags survive provider pricing', () => {
 const base={amount:500,pricingType:'provider_quote',details:{requires_safety_assessment:true}};
 assert.equal(pricing.apply(base,service),base);
 const result=pricing.apply(base,{...service,pricing_config:{...draft(),mode:'range',min:800,max:800}});
 assert.equal(result.pricingType,'provider_quote');
 assert.equal(result.details.requires_safety_assessment,true);
});
