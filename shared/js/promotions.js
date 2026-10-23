(function () {
 'use strict';
 const role = document.body.dataset.promotionRole;
 if (!role) return;
 const host = document.getElementById('promotion-workspace');
 const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
 const money = cents => new Intl.NumberFormat('en-PH', { style:'currency',currency:'PHP' }).format(Number(cents || 0) / 100);
 const date = value => value ? new Date(value).toLocaleString('en-PH', { timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',hour12:true,minute:'2-digit' }) : '-';
 const label = value => String(value).replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
 const automatic = () => state?.gateway?.channel === 'paymongo';
 let state, busy = false, currentDialog = null, filter = 'all', signature = '', orderPage = 1, loadVersion = 0, providerView = 'promotion';
 const user = () => { try { return JSON.parse(localStorage.getItem(`sn_${role}_user`) || 'null'); } catch { return null; } };
 const headers = () => user()?.auth_token ? { Authorization:`Bearer ${user().auth_token}` } : {};
 const base = () => role === 'admin' ? '/api/admin/promotions' : `/api/provider/${user()?.id}/promotions`;
 async function request(url, method = 'GET', body) {
  const multipart = body instanceof FormData;
  const response = await fetch(url, { method,credentials:'same-origin',headers:{ ...headers(),...(!multipart && body ? { 'Content-Type':'application/json' } : {}) },...(body ? { body:multipart ? body : JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Request failed. Please try again.');
  return data;
 }
 const status = value => `<span class="promotion-status ${esc(value)}">${esc(label(value))}</span>`;
 const button = (action, title, id = '', primary = false) => `<button class="promotion-button${primary ? ' primary' : ''}" data-action="${action}" data-id="${esc(id)}" type="button">${esc(title)}</button>`;
 function modal(title, html) {
  const dialog = document.createElement('dialog');
  dialog.className = 'promotion-dialog';
  dialog.innerHTML = `<div class="promotion-heading"><h2>${esc(title)}</h2><button class="promotion-button promotion-icon-button" type="button" data-close aria-label="Close" title="Close"><img src="/shared/icons/lucide/x.svg" alt=""></button></div>${html}<p class="promotion-error" role="alert"></p>`;
  const urls = [];
  dialog.blobUrls = urls;
  dialog.closeSafely = () => { if (!busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => { urls.forEach(URL.revokeObjectURL); dialog.remove(); if (currentDialog === dialog) currentDialog = null; });
  dialog.querySelector('[data-close]').onclick = dialog.closeSafely;
  document.body.appendChild(dialog); currentDialog = dialog; dialog.showModal();
  return dialog;
 }
 async function media(dialog, kind, id, target) {
  try {
   const response = await fetch(`/api/promotion-media/${kind}/${id}?role=${role}`, { headers:headers(),credentials:'same-origin',cache:'no-store' });
   if (!response.ok) throw new Error('Unable to load the payment image. Close and reopen to retry.');
   const url = URL.createObjectURL(await response.blob());
   if (!dialog.isConnected) { URL.revokeObjectURL(url); return; }
   dialog.blobUrls.push(url);
   dialog.querySelector(target).src = url;
  } catch (error) { if (dialog.isConnected) dialog.querySelector('[role=alert]').textContent = error.message; }
 }
 async function save(dialog, work, after) {
  if (busy) return;
  busy = true;
  const controls = [...dialog.querySelectorAll('button')];
  controls.forEach(control => { control.disabled = true; });
  dialog.setAttribute('aria-busy', 'true');
  dialog.querySelector('[role=alert]').textContent = '';
  try {
   const result = await work();
   busy = false; dialog.closeSafely();
   await load();
   if (after) after(result);
  } catch (error) { dialog.querySelector('[role=alert]').textContent = error.message; }
  finally { busy = false; controls.forEach(control => { control.disabled = false; }); dialog.removeAttribute('aria-busy'); }
 }
 function orderList() {
  const rows = (state.orders || []).filter(order => filter === 'all' || order.display_status === filter);
  return rows.map(order => `<article class="promotion-order"><div><strong>${esc(order.plan_name)}</strong><p>#${order.id}${role === 'admin' ? ` / ${esc(order.provider_name)}` : ''} / ${order.duration_days} days / ${date(order.created_at)}</p>${order.expires_at ? `<p>${date(order.starts_at)} to ${date(order.expires_at)}</p>` : ''}</div><div><strong>${money(order.amount_centavos)}</strong><br>${status(order.display_status)}</div><div class="promotion-actions">${button('order', role === 'admin' && order.status === 'awaiting_verification' ? 'Review Payment' : 'Payment Details', order.id)}</div></article>`).join('') || '<p>No matching payments.</p>';
 }
 const icon = name => `<img src="/shared/icons/lucide/${name}.svg" alt="" width="22" height="22">`;
 function providerContent() {
  const current = state.current_boost;
  const unavailable = !state.verified || !state.payment_ready || state.has_pending;
  const plans = state.plans.filter(plan => plan.kind === providerView);
  return `<header class="promotion-provider-header"><div><span class="promotion-eyebrow">Provider account</span><h1>Subscriptions &amp; Promotions</h1></div><a class="promotion-button promotion-icon-button" href="/pages/provider/dashboard/dashboard.html" title="Back to dashboard" aria-label="Back to dashboard">${icon('arrow-left')}</a></header>
   <div class="promotion-tabs" role="tablist" aria-label="Subscription and promotion views">${[['subscription','Subscriptions'],['promotion','Promotions'],['purchases','My Purchases']].map(([value,title]) => `<button type="button" role="tab" id="promotion-tab-${value}" aria-selected="${providerView === value}" aria-controls="promotion-panel" tabindex="${providerView === value ? 0 : -1}" data-action="view" data-view="${value}">${title}</button>`).join('')}</div>
   <div id="promotion-panel" role="tabpanel" aria-labelledby="promotion-tab-${providerView}" tabindex="0">
   ${providerView !== 'purchases' ? `<section class="promotion-section promotion-current"><div class="promotion-symbol">${icon('star')}</div><div class="promotion-current-content"><span class="promotion-eyebrow">Current boost</span><h2>${current ? esc(current.plan_name) : 'No active boost'}</h2><p>${current ? `Ends ${date(current.expires_at)}` : 'Your regular provider account remains available.'}</p></div>${current ? `<div class="promotion-current-action">${status('active')}${button('current','View Details')}</div>` : ''}</section>` : ''}
   ${!state.verified ? '<p class="promotion-notice">Provider verification is required before purchasing a plan.</p>' : ''}
   ${!state.payment_ready ? '<p class="promotion-notice">Platform payments are not available yet.</p>' : ''}
   ${automatic() && !state.gateway.livemode ? '<p class="promotion-notice">Test mode: payments do not activate real promotions.</p>' : ''}
   ${state.has_pending && providerView !== 'purchases' ? `<div class="promotion-pending"><span>A purchase needs payment or admin review.</span>${button('pending','View Purchase')}</div>` : ''}
   ${providerView !== 'purchases' ? `<section class="promotion-section"><div class="promotion-heading"><h2>${providerView === 'subscription' ? 'Subscription Plans' : 'Available Promotions'}</h2><span class="promotion-muted">One-time payment / No automatic renewal</span></div><div class="promotion-plans">
   ${providerView === 'subscription' ? `<article class="promotion-plan promotion-basic"><div class="promotion-plan-top"><span class="promotion-symbol">${icon('user')}</span><span class="promotion-status">Included</span></div><h2>Basic</h2><div class="promotion-plan-price"><strong class="promotion-price">Free</strong></div><p>Your standard provider account, without a paid profile boost.</p><ul class="promotion-benefits"><li>${icon('check')}<span>Provider profile</span></li><li>${icon('check')}<span>Service and booking management</span></li></ul><span class="promotion-plan-footer">No subscription required</span></article>` : ''}
   ${plans.map(plan => `<article class="promotion-plan"><div class="promotion-plan-top"><span class="promotion-symbol">${icon('star')}</span><span class="promotion-duration">${plan.duration_days} days</span></div><h2>${esc(plan.name)}</h2><div class="promotion-plan-price"><strong class="promotion-price">${money(plan.price_centavos)}</strong><span class="promotion-muted">/ ${plan.duration_days} days</span></div><p>${esc(plan.description)}</p><ul class="promotion-benefits"><li>${icon('check')}<span>Fixed-duration profile boost</span></li><li>${icon('check')}<span>${automatic() ? 'PayMongo QR Ph payment' : 'Admin-verified QR payment'}</span></li></ul><button type="button" class="promotion-button primary" data-action="purchase" data-id="${plan.id}" ${unavailable ? 'disabled' : ''}>Choose Plan ${icon('arrow-right')}</button></article>`).join('')}
   </div>${!plans.length ? `<div class="promotion-empty">${icon('star')}<h3>No ${providerView === 'subscription' ? 'paid subscription plans' : 'promotions'} available yet</h3><p>Plans will appear here when the admin makes them available.</p></div>` : ''}</section>` : ''}</div>`;
 }
 function render() {
  if (role === 'admin') {
   host.innerHTML = `<div class="promotion-metrics"><div class="promotion-metric"><span>Verified platform revenue</span><strong>${money(state.metrics.revenue_centavos)}</strong></div><div class="promotion-metric"><span>Payments awaiting review</span><strong>${state.metrics.pending_count}</strong></div><div class="promotion-metric"><span>Providers with active boosts</span><strong>${state.metrics.active_providers}</strong></div></div>
    <section class="promotion-section"><div class="promotion-heading"><h2>${automatic() ? 'PayMongo QR Ph' : 'Platform Receiving Account'}</h2>${automatic() ? status(!state.gateway.ready ? 'not_configured' : state.gateway.livemode ? 'live' : 'test_mode') : button('settings','Edit Receiving QR')}</div><p>${automatic() ? 'Promotions activate after confirmed payment. Test payments do not activate boosts or count as revenue.' : state.settings.configured ? `${esc(state.settings.wallet)} / ${esc(state.settings.account_name)} / ${esc(state.settings.account_number)}` : 'No receiving account configured. Purchases are unavailable.'}</p><p class="promotion-muted">Subscription and promotion payments are platform revenue. Customer service payments go directly to providers. Revenue shown is before fees and expenses, not net profit.</p></section>
    <section class="promotion-section"><div class="promotion-heading"><h2>Subscription &amp; Promotion Plans</h2>${button('plan','Add Plan','',true)}</div><div class="promotion-table-wrap"><table class="promotion-table"><thead><tr><th>Plan</th><th>Type</th><th>Duration</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${state.plans.map(plan => `<tr><td>${esc(plan.name)}</td><td>${esc(plan.kind)}</td><td>${plan.duration_days} days</td><td>${money(plan.price_centavos)}</td><td>${status(plan.enabled ? 'active' : 'draft')}</td><td><button class="promotion-button promotion-icon-button" data-action="plan" data-id="${plan.id}" title="Edit ${esc(plan.name)}" aria-label="Edit ${esc(plan.name)}"><img src="/shared/icons/lucide/pencil.svg" alt=""></button></td></tr>`).join('')}</tbody></table></div></section>`;
  } else {
   host.innerHTML = providerContent();
  }
  const historyHost = role === 'provider' ? host.querySelector('#promotion-panel') : host;
  if (role === 'admin' || providerView === 'purchases') historyHost.insertAdjacentHTML('beforeend', `<section class="promotion-section"><div class="promotion-heading"><h2>${role === 'admin' ? 'Recent Platform Payments' : 'My Purchases'}</h2><label class="promotion-field">Payment status<select id="promotion-filter">${['all','awaiting_payment','awaiting_verification','rejected','active','scheduled','expired','cancelled','test_paid','refund_review'].map(value => `<option value="${value}" ${value === filter ? 'selected' : ''}>${esc(label(value))}</option>`).join('')}</select></label></div><div id="promotion-orders">${orderList()}</div></section>`);
  if (role === 'admin') host.innerHTML += `<section class="promotion-section"><h2>Provider Service Payment Records</h2><p class="promotion-muted">These amounts belong to providers and are not platform revenue. Remaining cash/QR balances are not marked received without payment confirmation.</p><div class="promotion-table-wrap"><table class="promotion-table"><thead><tr><th>Provider</th><th>Completed services</th><th>Verified downpayments</th><th>Completed service totals</th><th>Unverified remaining balances</th></tr></thead><tbody>${state.earnings.map(row => `<tr><td>${esc(row.full_name)}</td><td>${row.completed_jobs}</td><td>${money(Number(row.verified_downpayments)*100)}</td><td>${money(Number(row.completed_service_totals)*100)}</td><td>${money(Number(row.unverified_balances)*100)}</td></tr>`).join('') || '<tr><td colspan="5">No service payment records yet.</td></tr>'}</tbody></table></div></section>`;
  const filterControl = host.querySelector('#promotion-filter');
  if (filterControl) filterControl.onchange = event => { filter = event.target.value; orderPage = 1; load(); };
  host.querySelector('#promotion-orders')?.insertAdjacentHTML('afterend', `<div class="promotion-heading promotion-pagination"><span class="promotion-muted">Page ${state.order_page} of ${Math.max(1,Math.ceil(state.order_count/state.page_size))} / ${state.order_count} payments</span><div class="promotion-actions"><button class="promotion-button promotion-icon-button" title="Previous page" aria-label="Previous page" data-action="previous" ${orderPage<=1 ? 'disabled' : ''}>${icon('chevron-left')}</button><button class="promotion-button promotion-icon-button" title="Next page" aria-label="Next page" data-action="next" ${orderPage*state.page_size>=state.order_count ? 'disabled' : ''}>${icon('chevron-right')}</button></div></div>`);
  host.querySelectorAll('.promotion-table').forEach(table => {
   const headings = [...table.querySelectorAll('thead th')].map(heading => heading.textContent || 'Action');
   table.querySelectorAll('tbody tr').forEach(row => [...row.children].forEach((cell, index) => { if (!cell.colSpan || cell.colSpan === 1) cell.dataset.label = headings[index]; }));
  });
 }
 async function load(background = false) {
  if (background && (busy || document.querySelector('.promotion-dialog[open]') || !window.snLiveRefresh?.isIdle())) return;
  const version = ++loadVersion;
  try {
   const next = await request(`${base()}?page=${orderPage}&status=${filter}`);
   if (version !== loadVersion) return;
   if (background && (busy || document.querySelector('.promotion-dialog[open]') || !window.snLiveRefresh?.isIdle())) return;
   const nextSignature = JSON.stringify(next);
   state = next;
   if (!background || signature !== nextSignature) { signature = nextSignature; render(); }
   host.removeAttribute('aria-busy');
  } catch (error) {
   if (!background && version === loadVersion) { host.innerHTML = `<p class="promotion-error" role="alert">${esc(error.message)}</p>${button('retry','Retry')}`; host.removeAttribute('aria-busy'); }
  }
 }
 function editPlan(plan = {}) {
  const dialog = modal(plan.id ? 'Edit Plan' : 'Add Plan', `<form id="promotion-plan-form"><label class="promotion-field">Plan name<input name="name" maxlength="100" required value="${esc(plan.name || '')}"></label><label class="promotion-field">Description<textarea name="description" maxlength="1000" rows="3">${esc(plan.description || 'Priority placement in matching recommended search results. Does not change verification badges or guarantee bookings.')}</textarea></label><div class="promotion-fields"><label class="promotion-field">Type<select name="kind"><option value="promotion">Promotion</option><option value="subscription">Subscription</option></select></label><label class="promotion-field">Duration (days)<input name="duration_days" type="number" min="1" max="365" required value="${plan.duration_days || 14}"></label><label class="promotion-field">Price (PHP)<input name="price" type="number" min="0" max="100000" step="0.01" required value="${Number(plan.price_centavos || 0)/100}"></label></div><label class="promotion-check"><input type="checkbox" name="enabled" ${plan.enabled ? 'checked' : ''}>Available for purchase</label><p>One-time payment with a fixed expiration. Existing purchases keep their original price and duration.</p><div class="promotion-actions"><button class="promotion-button primary" type="submit">Save Plan</button></div></form>`);
  const form = dialog.querySelector('form'); form.elements.kind.value = plan.kind || 'promotion';
  form.onsubmit = event => { event.preventDefault(); const body = Object.fromEntries(new FormData(form)); body.enabled = form.elements.enabled.checked; save(dialog, () => request(base() + '/plans' + (plan.id ? `/${plan.id}` : ''), plan.id ? 'PATCH' : 'POST', body)); };
 }
 function editSettings() {
  const settings = state.settings;
  const dialog = modal('Platform Receiving QR', `<form><div class="promotion-fields"><label class="promotion-field">Payment app<select name="wallet"><option>GCash</option><option>Maya</option><option>Bank / QR Ph</option></select></label><label class="promotion-field">Account name<input name="account_name" maxlength="120" required value="${esc(settings.account_name)}"></label><label class="promotion-field full">Account number<input name="account_number" maxlength="60" required value="${esc(settings.account_number)}"></label></div>${settings.configured ? '<img class="promotion-media" alt="Current platform receiving QR" data-settings-qr>' : ''}<label class="promotion-field">Receiving QR<input name="qr" type="file" accept="image/png,image/jpeg,image/webp" ${settings.configured ? '' : 'required'}><small>PNG, JPG or WebP, up to 5 MB.</small></label><label class="promotion-check"><input type="checkbox" name="confirm_account" value="true" required>I confirm these are the platform's receiving account and QR.</label><div class="promotion-actions"><button class="promotion-button primary" type="submit">Save Receiving Account</button></div></form>`);
  const form = dialog.querySelector('form'); form.elements.wallet.value = settings.wallet || 'GCash';
  if (settings.configured) media(dialog, 'settings', 1, '[data-settings-qr]');
  form.onsubmit = event => { event.preventDefault(); const data = new FormData(form); if (!form.elements.qr.files.length) data.delete('qr'); save(dialog, () => request(base() + '/payment-qr', 'PUT', data)); };
 }
 function purchaseCheckout(plan) {
  const id = crypto.randomUUID();
  const dialog = modal(plan.name, `<p><strong>${money(plan.price_centavos)}</strong> / ${plan.duration_days} days</p><p>${esc(plan.description)}</p><p>Activation follows PayMongo payment confirmation. An additional purchase extends your current boost. No automatic renewal.</p>${!state.gateway.livemode ? '<p class="promotion-notice">Test mode: no real payment or profile boost.</p>' : ''}<form><label class="promotion-check"><input type="checkbox" required>I agree to this price, duration and one-time payment.</label><div class="promotion-actions"><button class="promotion-button primary" type="submit">Continue to QR Ph</button></div></form>`);
  dialog.querySelector('form').onsubmit = event => {
   event.preventDefault(); filter = 'all'; orderPage = 1; providerView = 'purchases';
   save(dialog, () => request(base() + '/orders','POST',{ plan_id:plan.id,revision:plan.updated_at,request_id:id,accept_terms:true }), result => {
    const order = state.orders.find(item => item.id === result.id);
    if (order) openCheckoutOrder(order);
   });
  };
 }
 function openCheckoutOrder(order) {
  const pending = order.status === 'awaiting_payment';
  const messages = {
   awaiting_payment:'Payment is not confirmed yet. Do not pay again if your account was debited; check payment status first.',
   paid:order.display_status === 'scheduled' ? 'Payment confirmed. Your boost is scheduled below.' : order.display_status === 'expired' ? 'This promotion has ended.' : 'Payment confirmed. Your promotion is active.',
   test_paid:'Test payment confirmed. No real funds were collected and no profile boost was activated.',
   refund_review:'Payment needs admin review. Do not pay again. Contact support for reconciliation or a refund.',
   cancelled:'This checkout is closed. No promotion was activated.'
  };
  const dialog = modal(`Payment #${order.id}`, `<div class="promotion-detail-summary"><div><strong>${esc(order.plan_name)}</strong><p>${money(order.amount_centavos)} / ${order.duration_days} days</p></div>${status(order.display_status)}</div><p>${esc(messages[order.status] || 'Payment needs review.')}</p><p>PayMongo QR Ph${order.payment_livemode === false ? ' / Test mode' : ''}</p>${order.gateway_reference ? `<p>Reference: ${esc(order.gateway_reference)}</p>` : ''}${order.checkout_status === 'review' || order.checkout_status === 'creating' ? '<p class="promotion-notice">Checkout confirmation is pending. Contact the admin before starting another payment.</p>' : ''}${order.expires_at ? `<p>${date(order.starts_at)} to ${date(order.expires_at)}</p>` : ''}<div class="promotion-actions">${role === 'provider' && pending && !['creating','review'].includes(order.checkout_status) ? '<button type="button" class="promotion-button primary" data-checkout>Pay with QR Ph</button>' : ''}${pending ? '<button type="button" class="promotion-button" data-payment-refresh>Check Payment Status</button>' : ''}${role === 'provider' && pending ? '<button type="button" class="promotion-button danger" data-checkout-cancel>Cancel Unpaid Order</button>' : ''}</div>`);
  dialog.querySelector('[data-checkout]')?.addEventListener('click', () => save(dialog, () => request(`${base()}/orders/${order.id}/checkout`,'POST'), result => {
   const url = new URL(result.checkout_url);
   if (url.protocol === 'https:' && url.hostname === 'checkout.paymongo.com' && !url.username && !url.password && !url.port) window.location.assign(url.href);
  }));
  dialog.querySelector('[data-payment-refresh]')?.addEventListener('click', () => save(dialog, () => request(`${base()}/orders/${order.id}/payment-status`,'POST'), () => {
   const updated = state.orders.find(item => item.id === order.id);
   if (updated) openCheckoutOrder(updated);
  }));
  dialog.querySelector('[data-checkout-cancel]')?.addEventListener('click', () => {
   const confirm = modal('Cancel Unpaid Order','<p>Cancel only if you have not paid. If your balance was debited, check payment status instead.</p><label class="promotion-check"><input type="checkbox" required data-confirm-unpaid>I have not paid this order.</label><div class="promotion-actions"><button type="button" class="promotion-button danger" data-confirm-cancel>Cancel Order</button></div>');
   confirm.querySelector('[data-confirm-cancel]').onclick = () => {
    if (!confirm.querySelector('[data-confirm-unpaid]').checked) { confirm.querySelector('[role=alert]').textContent = 'Confirm that this order is unpaid.'; return; }
    save(confirm, () => request(`${base()}/orders/${order.id}/cancel`,'PATCH'), () => dialog.closeSafely());
   };
  });
 }
 function purchase(plan) {
  if (automatic()) return purchaseCheckout(plan);
  const id = crypto.randomUUID();
  const dialog = modal(plan.name, `<div class="promotion-detail-summary"><span class="promotion-symbol">${icon('star')}</span><div><span class="promotion-eyebrow">${esc(label(plan.kind))}</span><p class="promotion-detail-price"><strong>${money(plan.price_centavos)}</strong><span>${plan.duration_days} days</span></p></div></div><p>${esc(plan.description)}</p><ul class="promotion-benefits"><li>${icon('check')}<span>Starts after admin payment verification.</span></li><li>${icon('check')}<span>An additional purchase extends your current boost.</span></li><li>${icon('check')}<span>One-time payment. No automatic renewal.</span></li></ul><div class="promotion-payment-method">${icon('qr-code')}<div><strong>Admin QR</strong><p>Receipt upload and admin verification</p></div></div><form><label class="promotion-check"><input type="checkbox" required>I agree to this price, duration and one-time payment.</label><div class="promotion-actions"><button class="promotion-button primary" type="submit">Continue to Admin QR</button></div></form>`);
  dialog.querySelector('form').onsubmit = event => { event.preventDefault(); filter = 'all'; orderPage = 1; providerView = 'purchases'; save(dialog, () => request(base() + '/orders', 'POST', { plan_id:plan.id,revision:plan.updated_at,request_id:id,accept_terms:true }), result => { const order = state.orders.find(item => item.id === result.id); if (order) openOrder(order); }); };
 }
 function openOrder(order) {
  if (order.payment_channel === 'paymongo') return openCheckoutOrder(order);
  const payable = role === 'provider' && ['awaiting_payment','rejected'].includes(order.status);
  const review = role === 'admin' && order.status === 'awaiting_verification';
  const outcome = order.status === 'paid' ? ['check','Payment verified',order.display_status === 'active' ? 'Your profile boost is active.' : order.display_status === 'scheduled' ? 'Your profile boost is scheduled for the dates below.' : 'This profile boost has ended.'] : order.status === 'awaiting_verification' ? ['clock','Awaiting verification','Your receipt was submitted. Activation follows admin confirmation of the payment.'] : null;
  const dialog = modal(`Payment #${order.id}`, `${outcome ? `<div class="promotion-outcome"><span class="promotion-symbol">${icon(outcome[0])}</span><h3>${outcome[1]}</h3><p>${outcome[2]}</p></div>` : ''}<div class="promotion-detail-summary"><div><strong>${esc(order.plan_name)}</strong><p class="promotion-detail-price"><strong>${money(order.amount_centavos)}</strong><span>${order.duration_days} days</span></p></div>${status(order.display_status)}</div><p>${role === 'admin' ? `Provider: ${esc(order.provider_name)}<br>` : ''}${esc(order.wallet)} / ${esc(order.account_name)}<br>${esc(order.account_number)}</p>
   ${payable ? `<img class="promotion-media" alt="Admin receiving QR" data-order-qr><p>Send exactly ${money(order.amount_centavos)} to the account above. Check the recipient before confirming. ${order.status === 'rejected' ? 'Correct the receipt or contact admin before making another transfer.' : 'Do not pay twice.'}</p>` : ''}
   ${order.expires_at ? `<p>Boost period: ${date(order.starts_at)} to ${date(order.expires_at)}</p>` : ''}
   ${order.review_note ? `<p class="promotion-notice">Admin note: ${esc(order.review_note)}</p>` : ''}
   ${order.receipt_id ? `<p>Transaction reference: <strong>${esc(order.reference_number)}</strong></p><img class="promotion-media receipt" alt="Submitted promotion receipt" data-order-receipt>` : ''}
   ${payable ? `<form data-receipt-form><label class="promotion-field">Transaction reference<input name="reference_number" minlength="4" maxlength="120" required value="${esc(order.reference_number || '')}"></label><label class="promotion-field">Payment receipt<input name="receipt" type="file" accept="image/png,image/jpeg,image/webp" required></label><div class="promotion-actions">${order.status === 'awaiting_payment' && !order.receipt_id ? '<button type="button" class="promotion-button danger" data-cancel-order>Cancel Unpaid Order</button>' : ''}<button type="submit" class="promotion-button primary">Submit Receipt</button></div></form>` : ''}
   ${review ? '<form data-review-form><label class="promotion-field">Review notes<textarea name="notes" maxlength="1000" rows="3"></textarea></label><label class="promotion-check"><input name="payment_received" type="checkbox">I checked the actual receiving account and confirmed the full payment.</label><div class="promotion-actions"><button class="promotion-button danger" type="button" data-reject>Reject Receipt</button><button class="promotion-button primary" type="submit">Verify &amp; Activate</button></div></form>' : ''}`);
  if (payable) media(dialog, 'qr', order.id, '[data-order-qr]');
  if (order.receipt_id) media(dialog, 'receipt', order.receipt_id, '[data-order-receipt]');
  const form = dialog.querySelector('[data-receipt-form]');
  if (form) form.onsubmit = event => { event.preventDefault(); save(dialog, () => request(`${base()}/orders/${order.id}/receipt`, 'POST', new FormData(form)), () => { const updated = state.orders.find(item => item.id === order.id); if (updated) openOrder(updated); }); };
  dialog.querySelector('[data-cancel-order]')?.addEventListener('click', () => {
   const confirm = modal('Cancel Unpaid Order', `<p>Cancel only if you have not transferred money. Contact the admin if a transfer was made.</p><label class="promotion-check"><input type="checkbox" data-unpaid-confirm>I have not sent payment.</label><div class="promotion-actions"><button class="promotion-button danger" data-confirm-cancel type="button">Cancel Order</button></div>`);
   confirm.querySelector('[data-confirm-cancel]').onclick = () => {
    if (!confirm.querySelector('[data-unpaid-confirm]').checked) { confirm.querySelector('[role=alert]').textContent = 'Confirm no money was transferred.'; return; }
    save(confirm, () => request(`${base()}/orders/${order.id}/cancel`, 'PATCH'), () => dialog.closeSafely());
   };
  });
  const reviewForm = dialog.querySelector('[data-review-form]');
  if (reviewForm) {
   const submit = decision => save(dialog, () => request(`${base()}/orders/${order.id}/review`, 'PATCH', { decision,receipt_id:order.receipt_id,notes:reviewForm.elements.notes.value,payment_received:reviewForm.elements.payment_received.checked }));
   reviewForm.onsubmit = event => { event.preventDefault(); submit('verify'); };
   reviewForm.querySelector('[data-reject]').onclick = () => submit('reject');
  }
 }
 host.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || busy) return;
  const id = Number(target.dataset.id), action = target.dataset.action;
  if (action === 'retry') load();
  else if (action === 'view') { providerView = target.dataset.view; render(); host.querySelector(`#promotion-tab-${providerView}`).focus(); }
  else if (action === 'pending') { providerView = 'purchases'; filter = 'all'; orderPage = 1; load(); }
  else if (action === 'current' && state.current_boost) openOrder(state.current_boost);
  else if (action === 'previous' || action === 'next') { orderPage = Math.max(1,orderPage+(action === 'next' ? 1 : -1)); load(); }
  else if (action === 'settings') editSettings();
  else if (action === 'plan') editPlan(state.plans.find(plan => plan.id === id));
  else if (action === 'purchase') purchase(state.plans.find(plan => plan.id === id));
  else if (action === 'order') openOrder(state.orders.find(order => order.id === id));
 });
 host.addEventListener('keydown', event => {
  if (event.target.getAttribute('role') !== 'tab' || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...host.querySelectorAll('[role=tab]')], index = tabs.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].click();
 });
 document.addEventListener('DOMContentLoaded', async () => {
  await window.snAccountSessionReady;
  await load();
  const returnedOrder = new URLSearchParams(location.search).get('order_id');
  if (role === 'provider' && /^[1-9]\d*$/.test(returnedOrder || '')) {
   providerView = 'purchases';
   let error;
   try { await request(`${base()}/orders/${returnedOrder}/payment-status`,'POST'); } catch (reason) { error = reason.message; }
   await load();
   const order = state?.orders?.find(item => String(item.id) === returnedOrder);
   if (order) { openOrder(order); if (error) currentDialog.querySelector('[role=alert]').textContent = error; }
   history.replaceState(null,'',location.pathname);
  }
  window.snStartLiveRefresh?.(`promotions-${role}`, () => load(true));
 });
})();
