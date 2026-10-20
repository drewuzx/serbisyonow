'use strict';

function openServicePricing(service) {
 const title = service.title;
 const api = window.SNProviderPricing;
 const host = document.querySelector('.sn-section, .sn-panel');
 if (!api || !host) return;
 let draft = api.defaults(service);
 const fallback = api.defaults({ ...service, pricing_config: null });
 draft = { ...fallback, ...draft };
 let step = 0, roomIndex = 0, dirty = false, busy = false;
 const icon = name => `<img src="/shared/icons/lucide/${name}.svg" alt="" width="18" height="18">`;
 const price = (name, value, label, minimum = 0) => `<label class="sn-price-input"><span class="sn-sr-only">${esc(label)}</span><span aria-hidden="true">PHP</span><input name="${name}" aria-label="${esc(label)}" type="number" inputmode="decimal" min="${minimum}" max="1000000" step="0.01" required value="${esc(value)}"></label>`;
 const options = (values, current) => values.map(value => `<option${value === current ? ' selected' : ''}>${esc(value)}</option>`).join('');
 function read() {
  const form = host.querySelector('form');
  if (!form) return;
  const data = new FormData(form);
  draft.mode = data.get('mode');
  draft.min = data.get('min'); draft.max = data.get('max');
  draft.service_area = data.get('service_area'); draft.duration = data.get('duration'); draft.notes = data.get('notes');
  draft.matrix = api.rooms.map((_, r) => api.durations.map((_, c) => data.get(`cell_${r}_${c}`)));
  ['extra_hour', 'extra_bedroom', 'extra_bathroom'].forEach(key => { draft[key] = data.get(key); });
  draft.areas = Object.fromEntries(api.areas.map((area, i) => [area, data.get(`area_${i}`)]));
  draft.addons = draft.addons.map((addon, i) => ({ ...addon, enabled: data.get(`enabled_${i}`) === 'on', name: data.get(`name_${i}`), description: data.get(`description_${i}`), min: data.get(`addon_min_${i}`), max: data.get(`addon_max_${i}`), unit: data.get(`unit_${i}`) }));
 }
 function updateSummary() {
  read();
  const summary = host.querySelector('#sn-price-summary');
  try {
   const config = api.validate(draft, title), range = api.bounds(config);
   summary.textContent = `${money(range.min)}${range.max !== range.min ? ` - ${money(range.max)}` : ''}`;
  } catch { summary.textContent = 'Incomplete pricing'; }
  host.querySelector('#sn-price-notes-count').textContent = `${draft.notes.length}/500`;
  host.querySelector('.sn-price-state').textContent = dirty ? 'Unsaved changes' : service.pricing_config ? '' : 'Unsaved sample rates';
  host.querySelector('#sn-price-addon-count').textContent = `${draft.addons.filter(addon=>addon.enabled).length} available add-ons`;
 }
 async function close() {
  if (busy) return;
  if (dirty && !await openProviderModal({ title: 'Discard pricing changes?', message: 'Your unsaved prices will be lost.', confirmText: 'Discard', danger: true })) return;
  window.removeEventListener('beforeunload', beforeUnload);
  renderServices(window.snProviderLiveData?.services || []);
  host.querySelector(`[data-service-id="${service.id}"] [data-action="set-price"]`)?.focus();
 }
 function beforeUnload(event) { if (dirty) { event.preventDefault(); event.returnValue = ''; } }
 window.addEventListener('beforeunload', beforeUnload);
 function showRates() {
  const saved = service.pricing_config;
  const range = saved ? api.bounds(saved) : { min: service.starting_price, max: service.max_price };
  const lines = [
   service.title, `${saved ? 'Saved base price' : 'Listed range'}: ${money(range.min)} - ${money(range.max)}`,
   ...(saved ? [`Service area: ${saved.service_area || 'Not specified'}`, `Duration: ${saved.duration}`,
    ...saved.addons.filter(addon => addon.enabled).map(addon => `${addon.name}: ${money(addon.min)} - ${money(addon.max)} (${addon.unit})${addon.description ? `\n${addon.description}` : ''}`),
    ...(saved.notes ? [`Special instructions: ${saved.notes}`] : [])] : ['Booking rates not configured']),
  ];
  openProviderModal({ title: 'Provider rates', message: lines.join('\n'), confirmText: 'OK', className: 'sn-provider-rates-dialog' });
 }
 function render() {
  host.innerHTML = `<form id="sn-price-editor" novalidate>
   <header class="sn-price-heading"><button type="button" class="btn btn-outline sn-price-back" aria-label="Back to services" title="Back to services">&larr;</button><div><h2>Set Price</h2><p>${esc(title)}</p></div><button type="button" class="btn btn-outline sn-provider-rates">Provider rates</button></header>
   <p class="sn-price-state" role="status"></p>
   <nav class="sn-price-steps" aria-label="Pricing steps">${['Base Prices','Add-ons','Settings'].map((label, i) => `<button type="button" data-step="${i}" aria-current="${i === step ? 'step' : 'false'}"><span>${i + 1}</span>${label}</button>`).join('')}</nav>
   <div class="sn-price-layout">
    <div class="sn-price-main">
     <section class="sn-price-section" data-price-step="0"><h3>1. Base Prices</h3>
      <label class="sn-price-field">Pricing method<select name="mode" required><option value="range"${draft.mode === 'range' ? ' selected' : ''}>Service price range</option>${api.isHouse(title) ? `<option value="house_matrix"${draft.mode === 'house_matrix' ? ' selected' : ''}>Rooms and duration</option>` : ''}</select></label>
      <div class="sn-price-range" ${draft.mode !== 'range' ? 'hidden' : ''}><div><span>Minimum price</span>${price('min',draft.min,'Minimum price',1)}</div><div><span>Maximum price</span>${price('max',draft.max,'Maximum price',1)}</div></div>
      <div class="sn-price-matrix-wrap" ${draft.mode !== 'house_matrix' ? 'hidden' : ''}>
       <label class="sn-price-field sn-price-room-picker">Rooms / Area<select id="sn-price-room">${api.rooms.map((room,i)=>`<option value="${i}"${i===roomIndex?' selected':''}>${esc(room)}</option>`).join('')}</select></label>
       <table class="sn-price-matrix"><caption>Base service: 1 bathroom included</caption><thead><tr><th scope="col">Rooms / Area</th>${api.durations.map(d => `<th scope="col">${esc(d)}</th>`).join('')}</tr></thead><tbody>${api.rooms.map((room, r) => `<tr data-price-room="${r}" class="${r===roomIndex?'is-selected':''}"><th scope="row">${esc(room)}</th>${api.durations.map((duration,c) => `<td data-duration="${esc(duration)}">${price(`cell_${r}_${c}`,draft.matrix[r][c],`${room}, ${duration}`,1)}</td>`).join('')}</tr>`).join('')}</tbody></table>
       <h4>Additional scope</h4><div class="sn-price-scope">${[['extra_bedroom','Per bedroom above 4'],['extra_bathroom','Per bathroom above 1'],['extra_hour','Per hour above 5']].map(([key,label]) => `<div><span>${label}</span>${price(key,draft[key],label)}</div>`).join('')}${api.areas.map((area,i) => `<div><span>${esc(area)}</span>${price(`area_${i}`,draft.areas[area],`${area} price`)}</div>`).join('')}</div>
      </div>
     </section>
     <section class="sn-price-section" data-price-step="1"><div class="sn-section-head"><h3>2. Additional Services</h3><span>Optional</span></div>
      <div class="sn-price-addons">${draft.addons.map((addon,i) => `<div class="sn-price-addon" data-addon="${i}">
       <label class="sn-price-enabled"><input type="checkbox" name="enabled_${i}" aria-label="Enable add-on ${i+1}"${addon.enabled ? ' checked' : ''}>Active</label>
       <label class="sn-price-field sn-price-addon-name">Service name<input name="name_${i}" aria-label="Add-on ${i+1} name" maxlength="80" required value="${esc(addon.name)}"></label>
       <label class="sn-price-field sn-price-addon-description">Description (optional)<input name="description_${i}" aria-label="Add-on ${i+1} description" maxlength="300" value="${esc(addon.description || '')}"></label>
       <div><span>Minimum</span>${price(`addon_min_${i}`,addon.min,`Add-on ${i+1} minimum`)}</div><div><span>Maximum</span>${price(`addon_max_${i}`,addon.max,`Add-on ${i+1} maximum`)}</div>
       <label class="sn-price-field">Charge type<select name="unit_${i}" aria-label="Add-on ${i+1} charge type">${options(api.units,addon.unit)}</select></label>
       <button type="button" class="btn btn-outline sn-price-remove" data-remove-addon="${i}" aria-label="Remove add-on ${i+1}" title="Remove add-on">${icon('x')}</button>
      </div>`).join('') || '<p class="sn-price-empty">No additional services.</p>'}</div>
      <button type="button" class="btn btn-outline" id="sn-price-add"${draft.addons.length >= 15 ? ' disabled' : ''}><span aria-hidden="true">+</span> Add Another Add-on</button>
     </section>
    </div>
    <aside class="sn-price-side" data-price-step="2">
     <section class="sn-price-section"><h3>3. Service Area &amp; Duration</h3><label class="sn-price-field">Service area<input name="service_area" maxlength="200" value="${esc(draft.service_area)}" placeholder="e.g. Angeles City"></label>
      <label class="sn-price-field">${draft.mode === 'house_matrix' ? 'Service duration' : 'Typical duration'}<select name="duration" aria-label="${draft.mode === 'house_matrix' ? 'Service duration' : 'Typical duration'}">${options(draft.mode === 'house_matrix' ? ['Flexible',...api.durations] : api.typicalDurations,draft.duration)}</select></label>
     </section>
     <section class="sn-price-section"><h3>4. Special Instructions</h3><label class="sn-price-field"><span class="sn-sr-only">Special instructions</span><textarea name="notes" aria-label="Special instructions" maxlength="500" rows="4">${esc(draft.notes)}</textarea></label><span id="sn-price-notes-count">${draft.notes.length}/500</span></section>
     <section class="sn-price-section sn-price-summary"><h3>Pricing Summary</h3><strong id="sn-price-summary"></strong><span>Base service estimate</span><p id="sn-price-addon-count"></p></section>
    </aside>
   </div>
   <p id="sn-price-error" role="alert" tabindex="-1"></p>
   <footer class="sn-price-footer"><button type="button" class="btn btn-outline" data-price-cancel>Cancel</button><button type="button" class="btn btn-outline" id="sn-price-prev">Back</button><button type="button" class="btn btn-primary" id="sn-price-next">Next &rarr;</button><button type="submit" class="btn btn-primary" id="sn-price-save">${icon('pencil')} Save Changes</button></footer>
  </form>`;
  host.querySelector('.sn-price-back').addEventListener('click', close);
  host.querySelector('.sn-provider-rates').addEventListener('click', showRates);
  host.querySelector('[data-price-cancel]').addEventListener('click', close);
  host.querySelector('form').addEventListener('input', event => { if (event.target.id !== 'sn-price-room') dirty = true; updateSummary(); });
  host.querySelector('[name="mode"]').addEventListener('change', () => { read(); render(); });
  host.querySelector('#sn-price-room')?.addEventListener('change', event => {
   roomIndex = Number(event.target.value);
   host.querySelectorAll('[data-price-room]').forEach(row => row.classList.toggle('is-selected',Number(row.dataset.priceRoom)===roomIndex));
  });
  host.querySelector('#sn-price-add').addEventListener('click', () => {
   read(); dirty = true;
   draft.addons.push({ id: `addon_${Date.now()}_${draft.addons.length}`, enabled: true, name: '', description: '', min: 0, max: 0, unit: 'Per service' });
   render(); host.querySelector(`[name="name_${draft.addons.length-1}"]`)?.focus();
  });
  host.querySelectorAll('[data-remove-addon]').forEach(button => button.addEventListener('click', () => { read(); dirty = true; draft.addons.splice(Number(button.dataset.removeAddon),1); render(); }));
  const go = value => { read(); step = value; setStep(); host.querySelector(`[data-price-step="${step}"] h3`)?.scrollIntoView({block:'start'}); };
  host.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => go(Number(button.dataset.step))));
  host.querySelector('#sn-price-prev').addEventListener('click', () => go(Math.max(0, step-1)));
  host.querySelector('#sn-price-next').addEventListener('click', () => go(Math.min(2, step+1)));
  host.querySelector('form').addEventListener('submit', save);
  updateSummary(); setStep();
 }
 function setStep() {
  host.querySelectorAll('[data-price-step]').forEach(section => { section.classList.toggle('sn-price-inactive', Number(section.dataset.priceStep) !== step); });
  host.querySelectorAll('[data-step]').forEach(button => button.setAttribute('aria-current', Number(button.dataset.step) === step ? 'step' : 'false'));
  host.querySelector('#sn-price-prev').classList.toggle('sn-price-hide-mobile', step === 0);
  host.querySelector('#sn-price-next').classList.toggle('sn-price-hide-mobile', step === 2);
  host.querySelector('#sn-price-save').classList.toggle('sn-price-hide-mobile', step !== 2);
 }
 async function save(event) {
  event.preventDefault(); if (busy) return;
  read();
  const errorHost = host.querySelector('#sn-price-error'); errorHost.textContent = '';
  let config;
  try {
   config = api.validate(draft, title);
  }
  catch (error) { errorHost.textContent = error.message; errorHost.focus(); return; }
  busy = true;
  host.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = true; });
  host.querySelector('#sn-price-save').textContent = 'Saving...';
  try {
   const result = await providerSend(`/api/provider/${getProviderUser().id}/services/${service.id}`, 'PATCH', { pricing_config: config });
   dirty = false; window.removeEventListener('beforeunload', beforeUnload);
   const services = window.snProviderLiveData?.services || [];
   renderServices(services.map(item => item.id === service.id ? result.service : item));
   await loadProviderDatabase();
   host.insertAdjacentHTML('afterbegin','<p class="sn-price-success" role="status">Service pricing saved.</p>');
  } catch (error) {
   errorHost.textContent = error.message || 'Unable to save prices. Please try again.';
   host.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = false; });
   host.querySelector('#sn-price-save').innerHTML = `${icon('pencil')} Save Changes`;
   errorHost.focus();
  } finally { busy = false; }
 }
 render();
 host.querySelector('.sn-price-back').focus({ preventScroll: true });
 window.scrollTo({ top: 0, behavior: 'instant' });
}
