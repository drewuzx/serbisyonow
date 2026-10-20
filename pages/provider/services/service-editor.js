'use strict';

async function openServiceEdit(service) {
 const host = document.querySelector('.sn-section, .sn-panel');
 if (!host || !service?.id || host.querySelector('#sn-service-editor')) return;
 let dirty = false, busy = false;
 const categoryOptions = [...new Set([service.category || '', 'Others'].filter(Boolean))];
 host.innerHTML = `<form id="sn-service-editor" novalidate>
  <header class="sn-price-heading"><button type="button" class="btn btn-outline sn-price-back" aria-label="Back to services" title="Back to services">&larr;</button><div><h2>Edit Service</h2><p>${esc(service.title)}</p></div></header>
  <p class="sn-price-state" role="status"></p>
  <div class="sn-price-layout">
   <section class="sn-price-main sn-price-section"><h3>1. Service Details</h3>
    <label class="sn-price-field">Service name<input name="title" value="${esc(service.title)}" maxlength="160" required autocomplete="off"></label>
    <label class="sn-price-field">Description<textarea name="description" aria-label="Description" rows="7">${esc(service.description || '')}</textarea></label>
   </section>
   <aside class="sn-price-side"><section class="sn-price-section"><h3>2. Category</h3>
    <label class="sn-price-field">Category<select name="category" aria-label="Category" required>${categoryOptions.map(category => `<option${category === service.category ? ' selected' : ''}>${esc(category)}</option>`).join('')}</select></label>
    <label class="sn-price-field" data-custom-category hidden>New category name<input name="custom_category" maxlength="80" autocomplete="off"></label>
   </section></aside>
  </div>
  <p class="sn-service-error" role="alert" tabindex="-1"></p>
  <footer class="sn-price-footer"><button type="button" class="btn btn-outline" data-service-cancel>Cancel</button><button type="submit" class="btn btn-primary"><img src="/shared/icons/lucide/pencil.svg" alt="" width="18" height="18"> Save Changes</button></footer>
 </form>`;
 const form = host.querySelector('#sn-service-editor');
 const category = form.elements.category;
 const notice = form.querySelector('.sn-service-error');
 const submit = form.querySelector('[type="submit"]');
 const submitMarkup = submit.innerHTML;
 function beforeUnload(event) {
  if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
 }
 function updateCategory() {
  const custom = category.value === 'Others';
  form.querySelector('[data-custom-category]').hidden = !custom;
  form.elements.custom_category.required = custom;
 }
 async function close() {
  if (busy) return;
  if (dirty && !await openProviderModal({ title: 'Discard service changes?', message: 'Your unsaved service details will be lost.', confirmText: 'Discard', danger: true })) return;
  if (!form.isConnected || busy) return;
  window.removeEventListener('beforeunload', beforeUnload);
  renderServices(window.snProviderLiveData?.services || []);
  host.querySelector(`[data-service-id="${service.id}"] [data-action="edit-service"]`)?.focus();
 }
 window.addEventListener('beforeunload', beforeUnload);
 form.addEventListener('input', () => {
  dirty = true;
  form.querySelector('.sn-price-state').textContent = 'Unsaved changes';
  notice.textContent = '';
 });
 category.addEventListener('change', updateCategory);
 form.querySelector('.sn-price-back').addEventListener('click', close);
 form.querySelector('[data-service-cancel]').addEventListener('click', close);
 form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  // Only service details belong in this request. Set Price owns all rates and add-ons.
  const body = {
   title: form.elements.title.value.trim(),
   description: form.elements.description.value.trim(),
   category: (category.value === 'Others' ? form.elements.custom_category.value : category.value).trim(),
  };
  notice.textContent = !body.title ? 'Enter a service name.' : body.title.length > 160 ? 'Service name must be no more than 160 characters.' : !body.category ? 'Enter a service category.' : body.category.length > 80 ? 'Category must be no more than 80 characters.' : '';
  if (notice.textContent) { notice.focus(); return; }
  busy = true;
  ++providerDatabaseVersion;
  form.setAttribute('aria-busy', 'true');
  form.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = true; });
  submit.textContent = 'Saving...';
  try {
   const result = await providerSend(`/api/provider/${getProviderUser().id}/services/${service.id}`, 'PATCH', body);
   ++providerDatabaseVersion;
   dirty = false;
   window.removeEventListener('beforeunload', beforeUnload);
   const services = window.snProviderLiveData?.services || [];
   const updated = services.map(item => String(item.id) === String(service.id) ? result.service : item);
   if (window.snProviderLiveData) window.snProviderLiveData.services = updated;
   renderServices(updated);
   await loadProviderDatabase();
   host.insertAdjacentHTML('afterbegin', '<p class="sn-price-success" role="status">Service details saved.</p>');
  } catch (error) {
   notice.textContent = error.message || 'Unable to save service details. Please try again.';
   form.querySelectorAll('input,textarea,select,button').forEach(control => { control.disabled = false; });
   submit.innerHTML = submitMarkup;
   notice.focus();
  } finally {
   busy = false;
   form.removeAttribute('aria-busy');
  }
 });
 updateCategory();
 form.querySelector('.sn-price-back').focus({ preventScroll: true });
 window.scrollTo({ top: 0, behavior: 'instant' });
 const categories = await getAvailableServiceCategories();
 if (!form.isConnected || busy) return;
 const selected = category.value;
 category.innerHTML = [...new Set([...categories.filter(value => value !== 'Others'), ...categoryOptions])].map(value => `<option${value === selected ? ' selected' : ''}>${esc(value)}</option>`).join('');
 updateCategory();
}
