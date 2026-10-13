'use strict';

(async function initSystemFeedback() {
 if (window.__snSystemFeedbackLoaded) return;
 window.__snSystemFeedbackLoaded = true;
 const role = location.pathname.match(/\/pages\/(customer|provider)\//)?.[1];
 if (!role) return;
 await window.snAccountSessionReady;
 function currentUser() {
  try { return JSON.parse(localStorage.getItem(`sn_${role}_user`) || 'null'); } catch { return null; }
 }
 const user = currentUser();
 if (!user?.id) return;
 const key = `sn_system_feedback_${role}_${user.id}`;
 const apiBase = window.SN_API_BASE || window.SN?.utils?.apiBase?.()
  || ((location.protocol === 'file:' || location.port === '5500')
   ? `http://${location.hostname === '127.0.0.1' ? 'localhost' : location.hostname}:3000` : location.origin);
 const day = 86400000;
 let memory = {};
 function preferences() {
  try { return JSON.parse(localStorage.getItem(key) || 'null') || memory; } catch { return memory; }
 }
 function remember(patch) {
  memory = { ...preferences(), ...patch };
  try { localStorage.setItem(key, JSON.stringify(memory)); } catch { /* Keep the cooldown for this page when storage is unavailable. */ }
 }
 if (!preferences().auto_after) remember({ auto_after: Date.now() + 45000 + Math.floor(Math.random() * 45000) });
 const sameAccount = () => String(currentUser()?.id) === String(user.id);
 let statusKnown = false;
 let statusVersion = 0;
 let sending = false;
 let shownAutomatically = false;
 let submissionId = crypto.randomUUID();
 const style = document.createElement('link');
 style.rel = 'stylesheet';
 style.href = '/shared/css/system-feedback.css';
 document.head.appendChild(style);
 const root = document.createElement('div');
 root.className = 'sn-feedback-root';
 root.innerHTML = `
  <section class="sn-feedback-panel" id="sn-system-feedback" role="dialog" aria-modal="false" aria-labelledby="sn-feedback-title" hidden>
   <header class="sn-feedback-head"><span class="sn-feedback-mark" aria-hidden="true"><i class="sn-feedback-icon"></i></span>
    <button class="sn-feedback-close" type="button" title="Close feedback" aria-label="Close feedback"><i class="sn-feedback-icon sn-feedback-icon--close" aria-hidden="true"></i></button>
   </header>
   <h2 id="sn-feedback-title">Rate SerbisyoNow</h2>
   <p class="sn-feedback-question">How was your experience with the system?</p>
   <form class="sn-feedback-form">
    <fieldset class="sn-feedback-fields">
     <legend class="sn-feedback-sr">System rating</legend>
     <div class="sn-feedback-stars">
      ${[1, 2, 3, 4, 5].map(value => `<label title="${value} ${value === 1 ? 'star' : 'stars'}"><input type="radio" name="rating" value="${value}" required aria-label="${value} ${value === 1 ? 'star' : 'stars'}"><span class="sn-feedback-icon" aria-hidden="true"></span></label>`).join('')}
     </div>
     <output class="sn-feedback-rating-label" aria-live="polite">Select a rating</output>
     <label class="sn-feedback-comment-label" for="sn-feedback-comment">Comment <span>(optional)</span></label>
     <textarea id="sn-feedback-comment" name="comment" rows="3" maxlength="2000"></textarea>
     <div class="sn-feedback-count"><span data-feedback-count>0</span>/2,000</div>
     <button class="sn-feedback-submit" type="submit" disabled>Submit Feedback</button>
    </fieldset>
    <p class="sn-feedback-error" role="alert" hidden></p>
    <button class="sn-feedback-later" type="button">Not now</button>
   </form>
   <p class="sn-feedback-thanks" role="status" hidden>Thank you! Your feedback has been sent to the admin.</p>
  </section>
  <button class="sn-feedback-launch" type="button" title="Rate SerbisyoNow" aria-label="Rate SerbisyoNow" aria-controls="sn-system-feedback" aria-expanded="false"><i class="sn-feedback-icon" aria-hidden="true"></i></button>`;
 document.body.appendChild(root);
 const panel = root.querySelector('.sn-feedback-panel');
 const launch = root.querySelector('.sn-feedback-launch');
 const form = root.querySelector('form');
 const fields = root.querySelector('fieldset');
 const submit = root.querySelector('[type="submit"]');
 const close = root.querySelector('.sn-feedback-close');
 const later = root.querySelector('.sn-feedback-later');
 const comment = root.querySelector('textarea');
 const errorText = root.querySelector('.sn-feedback-error');
 const thanks = root.querySelector('.sn-feedback-thanks');
 const labels = ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];

 function updateRating() {
  const rating = Number(form.elements.rating.value);
  root.querySelectorAll('.sn-feedback-stars label').forEach((label, i) => label.classList.toggle('is-selected', i < rating));
  root.querySelector('output').textContent = rating ? `${rating}/5 - ${labels[rating - 1]}` : 'Select a rating';
  submit.disabled = sending || !rating;
 }
 function syncThanks() {
  const rated = Number(preferences().submitted_until || 0) > Date.now();
  form.hidden = rated;
  thanks.hidden = !rated;
 }
 function closePanel(dismiss = true) {
  if (sending) return;
  const restoreFocus = panel.contains(document.activeElement);
  panel.hidden = true;
  launch.setAttribute('aria-expanded', 'false');
  if (dismiss) remember({ dismissed_until: Date.now() + 7 * day });
  if (restoreFocus) launch.focus({ preventScroll: true });
 }
 function openPanel(manual = false) {
  if (!sameAccount() || root.hidden) return;
  syncThanks();
  panel.hidden = false;
  launch.setAttribute('aria-expanded', 'true');
  if (manual) close.focus({ preventScroll: true });
 }
 async function request(options = {}) {
  const response = await fetch(`${apiBase}/api/system-feedback${options.method ? '' : `?role=${role}`}`, {
   credentials: 'same-origin', cache: 'no-store', ...options,
   headers: { 'Content-Type': 'application/json', ...(currentUser()?.auth_token ? { Authorization: `Bearer ${currentUser().auth_token}` } : {}) },
   signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
   const error = new Error(data.message || 'Unable to send feedback. Please try again.');
   error.nextPromptAt = data.next_prompt_at;
   throw error;
  }
  return data;
 }
 async function loadStatus() {
  const version = ++statusVersion;
  try {
   const data = await request();
   if (!sameAccount() || version !== statusVersion) return;
   remember({ submitted_until: Date.parse(data.next_prompt_at) || 0 });
   statusKnown = true;
   syncThanks();
  } catch { /* The manual form remains available; automatic prompts wait for a successful check. */ }
 }
 function syncVisibility() {
  const blocked = !sameAccount() || [...document.querySelectorAll('.sn-float-panel.is-open, .sn-modal-backdrop, [aria-modal="true"]')]
   .some(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
  if (root.hidden !== blocked) root.hidden = blocked;
 }
 function promptWhenIdle() {
  syncVisibility();
  const prefs = preferences();
  if (root.hidden || !panel.hidden || !statusKnown || shownAutomatically || !window.snLiveRefresh?.isIdle()
   || Math.max(prefs.auto_after || 0, prefs.dismissed_until || 0, prefs.submitted_until || 0) > Date.now()
   || document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
  shownAutomatically = true;
  // Navigation and additional tabs must not repeatedly reopen an unanswered prompt.
  remember({ dismissed_until: Date.now() + 7 * day });
  openPanel();
 }
 launch.addEventListener('click', () => panel.hidden ? openPanel(true) : closePanel());
 close.addEventListener('click', () => closePanel());
 later.addEventListener('click', () => closePanel());
 panel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
 });
 form.addEventListener('change', updateRating);
 comment.addEventListener('input', () => { root.querySelector('[data-feedback-count]').textContent = comment.value.length; });
 form.addEventListener('submit', async event => {
  event.preventDefault();
  if (sending || !sameAccount() || !form.reportValidity()) return;
  sending = true;
  statusVersion += 1;
  fields.disabled = close.disabled = later.disabled = true;
  submit.textContent = 'Sending...';
  errorText.hidden = true;
  try {
   const data = await request({ method: 'POST', body: JSON.stringify({ role, rating: Number(form.elements.rating.value), comment: comment.value.trim(), submission_id: submissionId }) });
   if (!sameAccount()) return;
   statusVersion += 1;
   remember({ submitted_until: Date.parse(data.next_prompt_at) || Date.now() + 30 * day });
   submissionId = crypto.randomUUID();
   form.reset();
   syncThanks();
   close.focus({ preventScroll: true });
  } catch (error) {
   if (error.nextPromptAt) { remember({ submitted_until: Date.parse(error.nextPromptAt) }); syncThanks(); }
   else { errorText.textContent = error.name === 'TimeoutError' || error instanceof TypeError ? 'Connection unavailable. Your feedback is still here. Please try again.' : error.message; errorText.hidden = false; }
  } finally {
   sending = false;
   fields.disabled = close.disabled = later.disabled = false;
   submit.textContent = 'Submit Feedback';
   updateRating();
   syncVisibility();
  }
 });
 window.addEventListener('storage', event => { if (event.key === key) syncThanks(); syncVisibility(); });
 window.addEventListener('online', loadStatus);
 document.addEventListener('click', event => { if (event.target.closest('#sn-logout')) root.hidden = true; });
 const observer = new MutationObserver(syncVisibility);
 observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
 syncVisibility();
 loadStatus();
 window.snStartLiveRefresh('system-feedback-prompt', promptWhenIdle);
})();
