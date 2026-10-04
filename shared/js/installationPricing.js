(function (root, factory) {
 'use strict';
 const api = factory();
 if (typeof module === 'object' && module.exports) module.exports = api;
 else root.SNInstallationPricing = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
 'use strict';

 // Provisional PHP labor estimates shared by the form and server.
 const RATES = {
  furniture: { types: { Chair: 250, Table: 450, Desk: 500, Bed: 750, Wardrobe: 1000, Shelf: 400, Other: 700 }, sizes: { Small: 1, Medium: 1.5, Large: 2 }, customWork: [250, 700] },
  cabinet: { types: { Kitchen: [650, 1300], Wall: [500, 1000], Storage: [600, 1200], Bathroom: [450, 900], Other: [600, 1400] }, wallMount: [250, 500], materials: { Wood: 1, 'Plywood / MDF': 1, Metal: 1.25, Other: 1.3 } },
  curtains: { types: { Curtains: 200, 'Roller blinds': 250, 'Venetian blinds': 300, 'Vertical blinds': 350, Other: 350 }, sizes: { Small: 1, Medium: 1.5, Large: 2 }, installation: { 'Existing brackets / track': 0, 'New brackets / track': 100, Replacement: 50 } },
  lighting: { types: { 'Ceiling light': [250, 450], 'Wall light': [250, 450], Chandelier: [700, 1400], 'LED strip': [200, 400], Other: [400, 900] }, newWiring: [300, 900], wiringAssessment: [150, 500], height: [200, 600] },
  cctv: { types: { 'Wired IP camera': 550, 'Analog camera': 450, 'Wi-Fi camera': 350 }, environment: { Indoor: 0, Outdoor: 150, 'Indoor + outdoor': 100 }, cabling: 300, wiringAssessment: [150, 400], highMount: [200, 500], storage: { 'Existing DVR / NVR': 0, 'New DVR / NVR setup': 500, 'Memory card': 150, 'Cloud setup': 200, 'Not sure': [100, 350] }, extraFloor: 250 },
  network: { packages: { 'Router installation': 300, 'Wi-Fi setup': 250, 'Router configuration': 200, 'Mesh setup': 700 }, extraDevice: 15, extraAccessPoint: 250, newWiring: [150, 450], wiringAssessment: [100, 300] },
  appliance: { types: { Refrigerator: 300, 'Washing machine': 450, Dishwasher: 700, Aircon: 1200, TV: 600, Microwave: 250, 'Oven / stove': 850, Other: 600 }, connection: [200, 600], materials: [100, 400], assessment: [100, 300], outdoor: [150, 350] },
 };
 const VERSION = 'installation-services-sample-v1';
 const NOTE = 'Sample-rate installation labor estimate only. Equipment and materials are separate. Provider confirms the scope and final price; any extra charge needs your approval.';
 const QUOTE_NOTE = 'Sample installation estimate only. Provider assesses the mounting, connections, materials, and access before confirming the final quotation for your approval. Equipment and materials are separate.';
 const select = (key, label, options, extra = {}) => ({ key, label, type: 'select', options, ...extra });
 const number = (key, label, extra = {}) => ({ key, label, type: 'number', min: 1, max: 50, step: 1, default: 1, ...extra });
 const text = (key, label, extra = {}) => ({ key, label, type: 'text', maxLength: 150, ...extra });
 const yesNo = (key, label, defaultValue = 'Yes') => select(key, label, ['Yes', 'No', 'Not sure'], { default: defaultValue });
 const other = (key, label, dependsOn) => text(key, label, { when: { key: dependsOn, value: 'Other' } });
 const configs = {
  'furniture installation': { title: 'Furniture Installation', media: true, fields: [
   select('furniture_type', 'Furniture type', Object.keys(RATES.furniture.types)), other('other_furniture', 'Other furniture type', 'furniture_type'),
   number('units', 'Number of units', { max: 30 }), yesNo('ready_to_assemble', 'Ready-to-assemble?'), select('size', 'Approximate size', ['Small', 'Medium', 'Large']),
   { key: 'product_url', label: 'Product link (optional)', type: 'url', maxLength: 1000, required: false, placeholder: 'https://...' },
  ] },
  'cabinet installation': { title: 'Cabinet Installation', pricingType: 'provider_quote', media: true, fields: [
   select('cabinet_type', 'Cabinet type', Object.keys(RATES.cabinet.types)), other('other_cabinet', 'Other cabinet type', 'cabinet_type'),
   number('cabinets', 'Number of cabinets', { max: 20 }), text('dimensions', 'Approximate dimensions per cabinet', { placeholder: 'Width x height x depth, including units' }),
   select('mounting', 'Mounting', ['Wall-mounted', 'Freestanding']), select('material', 'Material', Object.keys(RATES.cabinet.materials)), other('other_material', 'Other material', 'material'),
  ] },
  'curtain / blinds installation': { title: 'Curtain / Blinds Installation', media: true, fields: [
   number('windows', 'Number of windows'), select('covering_type', 'Curtain / blind type', Object.keys(RATES.curtains.types)), other('other_covering', 'Other curtain / blind type', 'covering_type'),
   select('window_size', 'Approximate window size', ['Small', 'Medium', 'Large', 'Custom width']),
   number('width_m', 'Approximate width per window (m)', { min: 0.2, max: 10, step: 0.1, default: 1, when: { key: 'window_size', value: 'Custom width' } }),
   select('installation_type', 'Installation type', Object.keys(RATES.curtains.installation)),
  ] },
  'lighting installation': { title: 'Lighting Installation', pricingType: 'provider_quote', media: true, fields: [
   number('fixtures', 'Number of fixtures'), select('fixture_type', 'Fixture type', Object.keys(RATES.lighting.types)), other('other_fixture', 'Other fixture type', 'fixture_type'),
   yesNo('existing_wiring', 'Existing wiring?'), yesNo('new_wiring', 'New wiring required?', 'No'), select('mounting', 'Ceiling / wall', ['Ceiling', 'Wall']),
   select('access', 'Height / accessibility', ['Easy access', 'Ladder required', 'High / difficult access']),
  ] },
  'cctv installation': { title: 'CCTV Installation', media: true, fields: [
   number('cameras', 'Number of cameras', { max: 16 }), select('environment', 'Indoor / outdoor', Object.keys(RATES.cctv.environment)),
   select('camera_type', 'Camera type', Object.keys(RATES.cctv.types)), select('height', 'Installation height', ['Standard (up to 3 m)', 'High / difficult access']),
   yesNo('existing_wiring', 'Existing wiring?'), select('storage', 'Storage option', Object.keys(RATES.cctv.storage)), number('floors', 'Number of floors', { max: 10 }),
  ] },
  'internet / router setup': { title: 'Internet / Router Setup', media: true, fields: [
   select('package', 'Service', Object.keys(RATES.network.packages)), number('devices', 'Number of devices', { default: 5 }),
   number('access_points', 'Number of access points', { max: 20 }), yesNo('new_wiring', 'New wiring required?', 'No'),
  ] },
  'appliance installation': { title: 'Appliance Installation', media: true, fields: [
   select('appliance_type', 'Appliance type', Object.keys(RATES.appliance.types)), other('other_appliance', 'Other appliance type', 'appliance_type'),
   text('brand', 'Brand'), text('model', 'Model (optional)', { required: false }), number('units', 'Number of units', { max: 20 }),
   yesNo('existing_connection', 'Existing connection?'), yesNo('additional_materials', 'Additional materials required?', 'No'),
   select('location', 'Installation location', ['Kitchen', 'Living room', 'Bedroom', 'Laundry area', 'Outdoor', 'Other']), other('other_location', 'Other installation location', 'location'),
  ] },
 };
 const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
 function serviceKey(value) {
  const aliases = {
   'furniture assembly': 'furniture installation', 'furniture assembly and installation': 'furniture installation',
   'curtain/blinds installation': 'curtain / blinds installation', 'curtain or blinds installation': 'curtain / blinds installation', 'curtain and blinds installation': 'curtain / blinds installation', 'curtain installation': 'curtain / blinds installation', 'blinds installation': 'curtain / blinds installation',
   'internet/router setup': 'internet / router setup', 'internet or router setup': 'internet / router setup', 'internet and router setup': 'internet / router setup', 'router setup': 'internet / router setup',
  };
  const raw = normalize(value);
  const key = Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
  return Object.hasOwn(configs, key) ? key : '';
 }
 function isCategory(value) { return ['installation services', 'installation service', 'installation', 'home installation', 'home installations'].includes(normalize(value)); }
 function invalid(message) { const error = new Error(message); error.statusCode = 400; throw error; }
 function fields(key) {
  if (!Object.hasOwn(configs, key)) invalid('Choose a valid installation service.');
  return configs[key].fields;
 }
 function fieldVisible(field, inputs) { return !field.when || inputs[field.when.key] === field.when.value; }
 function defaults(key) { return Object.fromEntries(fields(key).map(field => [field.key, field.default ?? (field.type === 'select' ? field.options[0] : '')])); }
 function validate(key, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Complete the installation details.');
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
    if (input && field.type === 'url') {
     let url;
     try { url = new URL(input); } catch { invalid('Enter a full product link beginning with http:// or https://.'); }
     if (!['http:', 'https:'].includes(url.protocol)) invalid('Use an http:// or https:// product link.');
     inputs[field.key] = url.href;
    } else if (input) inputs[field.key] = input;
   }
  }
  return inputs;
 }
 const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
 function assessment(key, raw) {
  const inputs = validate(key, raw);
  const breakdown = [];
  let range = configs[key].pricingType === 'provider_quote';
  const add = (label, cost, count = 1) => {
   const [min, max] = Array.isArray(cost) ? cost : [cost, cost];
   if (min !== max) range = true;
   if (min || max) breakdown.push({ label, amount: round(min * count), ...(min !== max ? { max_amount: round(max * count) } : {}) });
  };
  switch (key) {
   case 'furniture installation': {
    const rate = RATES.furniture.types[inputs.furniture_type] * RATES.furniture.sizes[inputs.size];
    add(`${inputs.size} ${inputs.other_furniture || inputs.furniture_type} x ${inputs.units} unit(s)`, rate, inputs.units);
    if (inputs.furniture_type === 'Other' || inputs.ready_to_assemble !== 'Yes') add('Assembly / custom work assessment', RATES.furniture.customWork, inputs.units);
    break;
   }
   case 'cabinet installation': {
    const rate = RATES.cabinet.types[inputs.cabinet_type].map(value => value * RATES.cabinet.materials[inputs.material]);
    add(`${inputs.other_cabinet || inputs.cabinet_type} cabinet installation x ${inputs.cabinets}`, rate, inputs.cabinets);
    if (inputs.mounting === 'Wall-mounted') add('Wall mounting', RATES.cabinet.wallMount, inputs.cabinets);
    break;
   }
   case 'curtain / blinds installation': {
    const size = inputs.window_size === 'Custom width' ? Math.max(1, inputs.width_m) : RATES.curtains.sizes[inputs.window_size];
    add(`${inputs.other_covering || inputs.covering_type} x ${inputs.windows} window(s)`, RATES.curtains.types[inputs.covering_type] * size, inputs.windows);
    add(inputs.installation_type, RATES.curtains.installation[inputs.installation_type], inputs.windows);
    break;
   }
   case 'lighting installation':
    add(`${inputs.other_fixture || inputs.fixture_type} x ${inputs.fixtures} fixture(s)`, RATES.lighting.types[inputs.fixture_type], inputs.fixtures);
    if (inputs.new_wiring === 'Yes') add('New wiring labor assessment', RATES.lighting.newWiring, inputs.fixtures);
    else if (inputs.new_wiring === 'Not sure' || inputs.existing_wiring !== 'Yes') add('Existing connection / wiring assessment', RATES.lighting.wiringAssessment, inputs.fixtures);
    if (inputs.access !== 'Easy access') add(inputs.access, RATES.lighting.height, inputs.fixtures);
    break;
   case 'cctv installation':
    add(`Base installation: ${inputs.camera_type} x ${inputs.cameras} camera(s)`, RATES.cctv.types[inputs.camera_type], inputs.cameras);
    add(inputs.environment, RATES.cctv.environment[inputs.environment], inputs.cameras);
    if (inputs.height !== 'Standard (up to 3 m)') add('High mounting assessment', RATES.cctv.highMount, inputs.cameras);
    if (inputs.existing_wiring === 'No') add('New cabling labor', RATES.cctv.cabling, inputs.cameras);
    if (inputs.existing_wiring === 'Not sure') add('Wiring assessment', RATES.cctv.wiringAssessment, inputs.cameras);
    add(inputs.storage, RATES.cctv.storage[inputs.storage]);
    if (inputs.floors > 1) add(`${inputs.floors - 1} additional floor(s)`, RATES.cctv.extraFloor, inputs.floors - 1);
    break;
   case 'internet / router setup':
    add(inputs.package, RATES.network.packages[inputs.package]);
    if (inputs.devices > 5) add(`${inputs.devices - 5} additional device(s)`, RATES.network.extraDevice, inputs.devices - 5);
    if (inputs.access_points > 1) add(`${inputs.access_points - 1} additional access point(s)`, RATES.network.extraAccessPoint, inputs.access_points - 1);
    if (inputs.new_wiring !== 'No') add('Network wiring assessment', inputs.new_wiring === 'Yes' ? RATES.network.newWiring : RATES.network.wiringAssessment, inputs.access_points);
    break;
   case 'appliance installation': {
    const base = RATES.appliance.types[inputs.appliance_type];
    const specialized = ['Aircon', 'Dishwasher', 'Oven / stove', 'Other'].includes(inputs.appliance_type);
    add(`${inputs.other_appliance || inputs.appliance_type} x ${inputs.units} unit(s)`, specialized ? [base, base * 1.5] : base, inputs.units);
    if (inputs.existing_connection !== 'Yes') add('Connection assessment', inputs.existing_connection === 'No' ? RATES.appliance.connection : RATES.appliance.assessment, inputs.units);
    if (inputs.additional_materials !== 'No') add('Additional fitting / materials labor', inputs.additional_materials === 'Yes' ? RATES.appliance.materials : RATES.appliance.assessment, inputs.units);
    if (inputs.location === 'Outdoor') add('Outdoor installation assessment', RATES.appliance.outdoor, inputs.units);
    break;
   }
  }
  const min = round(breakdown.reduce((sum, item) => sum + item.amount, 0));
  const max = round(breakdown.reduce((sum, item) => sum + (item.max_amount ?? item.amount), 0));
  const pricingType = range ? 'provider_quote' : 'calculated';
  const answers = Object.fromEntries(fields(key).filter(field => inputs[field.key] !== undefined).map(field => [field.label, String(inputs[field.key])]));
  return {
   amount: min, estimatedMin: min, estimatedMax: max, pricingType, mediaFiles: [],
   details: { category: 'Installation Services', service_type: configs[key].title, pricing_type: pricingType, inputs, answers, breakdown,
    ...(inputs.product_url ? { product_url: inputs.product_url } : {}),
    estimate_label: `Sample estimated ${range ? 'range' : 'price'}: PHP ${min.toLocaleString('en-PH')}${range ? ` - PHP ${max.toLocaleString('en-PH')}` : ''}`,
    note: range ? QUOTE_NOTE : NOTE, rate_version: VERSION, sample_rates: true },
  };
 }
 function forBooking(serviceName, details, providerService) {
  const key = serviceKey(serviceName);
  if (!key) invalid('Choose a specific installation service.');
  if (!providerService || providerService.is_active === false || !(serviceKey(providerService.title) === key || isCategory(providerService.title))) invalid('Choose an active installation service offered by this provider.');
  if (details.service_type && serviceKey(details.service_type) !== key) invalid('Installation details do not match the booked service.');
  return assessment(key, details.inputs);
 }
 return { RATES, VERSION, NOTE, QUOTE_NOTE, configs, serviceKey, isCategory, fields, fieldVisible, defaults, validate, assessment, forBooking };
});
