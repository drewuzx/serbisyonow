(function () {
 'use strict';
 if (window.SNProfilePhotos) return;
 const base = window.SN_API_BASE || window.SN?.utils?.apiBase?.() || window.location.origin;
 const pageRole = location.pathname.match(/\/pages\/(customer|provider)\//)?.[1];
 const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/shared/css/profile-photos.css'; document.head.append(style);
 const user = role => { try { return JSON.parse(localStorage.getItem(`sn_${role}_user`) || 'null'); } catch { return null; } };
 const headers = role => user(role)?.auth_token ? { Authorization: `Bearer ${user(role).auth_token}` } : {};
 async function request(role, path, options = {}) {
  const response = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...headers(role), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Unable to save the photo. Please try again.');
  return data;
 }
 let generation = Date.now();
 function hydrate() {
  if (pageRole) document.querySelectorAll('.sn-topbar .sn-avatar:not(a)').forEach(node => {
   const link = document.createElement('a');
   for (const attribute of node.attributes) {
    if (!['aria-hidden', 'role', 'tabindex'].includes(attribute.name)) link.setAttribute(attribute.name, attribute.value);
   }
   link.href = `/pages/${pageRole}/profile/profile.html`;
   link.classList.add('sn-profile-link');
   link.setAttribute('aria-label', 'My profile');
   link.title = 'My profile';
   link.append(...node.childNodes);
   node.replaceWith(link);
  });
  const own = user(pageRole);
  if (own?.id) document.querySelectorAll('.sn-user-greeting .sn-avatar-lg, .sn-topbar .sn-avatar, #sn-profile-avatar').forEach(node => {
   const key = `${pageRole}/${own.id}`;
   if (node.dataset.photoTarget !== key) node.dataset.photoTarget = key;
  });
  document.querySelectorAll('[data-photo-target]').forEach(node => {
   const key = node.dataset.photoTarget;
   if (!/^(customer|provider)\/[1-9]\d*$/.test(key || '')) {
    node.querySelectorAll('.sn-photo-image').forEach(img => img.remove()); delete node.dataset.photoLoaded; return;
   }
   node.classList.add('sn-photo-avatar');
   if (node.dataset.photoLoaded === `${key}:${generation}`) return;
   node.dataset.photoLoaded = `${key}:${generation}`;
   node.querySelectorAll('.sn-photo-image').forEach(img => img.remove());
   const img = new Image(); img.className = 'sn-photo-image'; img.alt = 'Profile photo'; img.loading = 'lazy';
   img.onerror = () => img.remove();
   img.src = `${base}/api/profile-photos/${key}?v=${generation}`;
   node.append(img);
  });
 }
 function refresh() { generation = Date.now(); hydrate(); }
 let frame;
 const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = null; hydrate(); }); });
 observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-photo-target'] });
 window.addEventListener('storage', refresh);
 window.addEventListener('sn:customer-account-updated', hydrate);
 document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); loadStatus(); } });

 function modal(title) {
  const previous = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'sn-photo-dialog'; dialog.setAttribute('aria-label', title);
  dialog.innerHTML = `<header><h2></h2><button class="sn-photo-button secondary sn-photo-close" type="button" aria-label="Close"><img src="/shared/icons/lucide/x.svg" alt=""></button></header><div class="sn-photo-body"></div><p class="sn-photo-notice" role="status" aria-live="polite"></p>`;
  dialog.querySelector('h2').textContent = title;
  dialog.querySelector('.sn-photo-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { dialog.remove(); previous?.focus(); });
  document.body.append(dialog); dialog.showModal();
  const notice = (message, error = false) => {
   const node = dialog.querySelector('.sn-photo-notice'); node.textContent = message; node.dataset.error = String(error);
  };
  return { dialog, body: dialog.querySelector('.sn-photo-body'), notice };
 }
 async function decode(file) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Each image must be 5 MB or smaller.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width < 120 || bitmap.height < 120 || bitmap.width * bitmap.height > 24000000) {
   bitmap.close(); throw new Error('Choose an image between 120 pixels and 24 megapixels.');
  }
  return bitmap;
 }
 function cropper(host, source) {
  host.innerHTML = `<canvas class="sn-photo-crop" width="600" height="600" aria-label="Profile photo preview"></canvas>
   <label class="sn-photo-field">Zoom<input type="range" min="1" max="3" value="1" step="0.01" data-crop="zoom"></label>
   <label class="sn-photo-field">Horizontal position<input type="range" min="0" max="1" value="0.5" step="0.01" data-crop="x"></label>
   <label class="sn-photo-field">Vertical position<input type="range" min="0" max="1" value="0.5" step="0.01" data-crop="y"></label>`;
  const canvas = host.querySelector('canvas'), context = canvas.getContext('2d');
  const draw = () => {
   const val = key => Number(host.querySelector(`[data-crop=${key}]`).value);
   const size = Math.min(source.width, source.height) / val('zoom');
   context.drawImage(source, (source.width - size) * val('x'), (source.height - size) * val('y'), size, size, 0, 0, 600, 600);
  };
  host.querySelectorAll('input').forEach(input => input.addEventListener('input', draw)); draw();
  return () => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
 }
 async function openCustomer() {
  const { dialog, body, notice } = modal('Edit Profile Photo');
  body.innerHTML = `<p>Your saved photo will be visible to other users.</p><label class="sn-photo-field">Profile photo<input type="file" accept="image/jpeg,image/png,image/webp"></label><div data-crop-host></div><div class="sn-photo-actions"><button class="sn-photo-button secondary" data-remove type="button">Remove Photo</button><button class="sn-photo-button" data-save type="button" disabled>Save Photo</button></div>`;
  let source, exportPhoto, busy = false, selection = 0;
  const save = body.querySelector('[data-save]'), remove = body.querySelector('[data-remove]');
  dialog.addEventListener('close', () => { selection++; source?.close(); });
  body.querySelector('input[type=file]').onchange = async event => {
   const current = ++selection; save.disabled = true; exportPhoto = null; notice('');
   try {
    const next = await decode(event.target.files[0]);
    if (current !== selection || !dialog.open) { next.close(); return; }
    source?.close(); source = next; exportPhoto = cropper(body.querySelector('[data-crop-host]'), source); save.disabled = false;
   } catch (error) { notice(error.message, true); }
  };
  async function persist(removing) {
   if (busy) return;
   if (removing && !window.confirm('Remove your profile photo?')) return;
   busy = true; save.disabled = remove.disabled = true; notice('Saving...');
   try {
    let form;
    if (!removing) { form = new FormData(); form.append('photo', await exportPhoto(), 'profile.jpg'); }
    const result = await request('customer', '/api/customer/profile-photo', { method: removing ? 'DELETE' : 'POST', body: form });
    refresh(); notice(result.message); if (dialog.open) dialog.close();
    statusNotice(result.message);
   } catch (error) { notice(error.message, true); }
   finally { busy = false; save.disabled = !exportPhoto; remove.disabled = false; }
  }
  save.onclick = () => persist(false); remove.onclick = () => persist(true);
 }
 async function openProvider(options = {}) {
  const { dialog, body, notice } = modal('Provider Photo Verification');
  let stream, source, exportPhoto, busy = false, front = options.front, back = options.back;
  const stop = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; };
  dialog.querySelector('.sn-photo-close').addEventListener('click', stop);
  dialog.addEventListener('cancel', stop);
  const hide = () => { if (document.hidden) { stop(); const capture = body.querySelector('[data-capture]'); if (capture) capture.disabled = true; } };
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', stop);
  dialog.addEventListener('close', () => { stop(); source?.close?.(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', stop); });
  function showId() {
   stop(); notice('');
   body.innerHTML = `<p>An admin will review your photo ID and camera selfie. This is manual review, not automatic face matching. Only the approved selfie becomes your public profile photo. Review copies are deleted after the decision.</p>
    <label class="sn-photo-field">Front of photo ID<input type="file" data-front accept="image/jpeg,image/png,image/webp"></label><p data-front-name></p>
    <label class="sn-photo-field">Back of ID (optional)<input type="file" data-back accept="image/jpeg,image/png,image/webp"></label><p data-back-name></p>
    <div class="sn-photo-actions"><button class="sn-photo-button" data-next type="button">Next: Take Selfie</button></div>`;
   const names = () => { body.querySelector('[data-front-name]').textContent = front?.name || ''; body.querySelector('[data-back-name]').textContent = back?.name || ''; };
   names(); body.querySelector('[data-front]').onchange = event => { front = event.target.files[0]; names(); };
   body.querySelector('[data-back]').onchange = event => { back = event.target.files[0]; names(); };
   body.querySelector('[data-next]').onclick = async event => {
    event.target.disabled = true;
    try {
     if (!front) throw new Error('Upload the front of your photo ID.');
     (await decode(front)).close(); if (back) (await decode(back)).close();
     if (dialog.open) showCamera();
    } catch (error) { notice(error.message, true); }
    finally { event.target.disabled = false; }
   };
  }
  function showCamera() {
   notice('');
   body.innerHTML = `<p>Take a clear selfie with your full face visible.</p><video class="sn-photo-video" autoplay muted playsinline></video>
    <div class="sn-photo-actions"><button class="sn-photo-button secondary" data-back-step type="button">Back</button><button class="sn-photo-button secondary" data-camera type="button">Start Camera</button><button class="sn-photo-button" data-capture type="button" disabled>Take Selfie</button></div>`;
   const video = body.querySelector('video'), capture = body.querySelector('[data-capture]'), start = body.querySelector('[data-camera]');
   body.querySelector('[data-back-step]').onclick = showId;
   start.onclick = async () => {
    start.disabled = true; notice(''); stop();
    try {
     if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS and a supported browser. Open this page in your phone browser.');
     const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 960 } } });
     if (!dialog.open || !video.isConnected || document.hidden) { media.getTracks().forEach(track => track.stop()); return; }
     stream = media; video.srcObject = stream; await video.play(); capture.disabled = false;
    } catch (error) { stop(); notice(error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser settings, then try again.' : error.message || 'Camera unavailable. Try another device.', true); }
    finally { start.disabled = false; }
   };
   capture.onclick = () => {
    if (!stream || !video.videoWidth) return notice('Wait for the camera preview, then try again.', true);
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0); stop(); source?.close?.(); source = canvas; showReview();
   };
  }
  function showReview() {
   body.innerHTML = `<div data-crop-host></div><label class="sn-photo-consent"><input type="checkbox" data-consent><span>I agree to admin review of my ID and selfie and to publishing the approved selfie as my profile photo.</span></label>
    <div class="sn-photo-actions"><button class="sn-photo-button secondary" data-retake type="button">Retake</button><button class="sn-photo-button" data-submit type="button">Submit for Review</button></div>`;
   exportPhoto = cropper(body.querySelector('[data-crop-host]'), source);
   body.querySelector('[data-consent]').onchange = () => notice('');
   body.querySelector('[data-retake]').onclick = showCamera;
   body.querySelector('[data-submit]').onclick = async event => {
    if (busy) return;
    if (!body.querySelector('[data-consent]').checked) return notice('Please confirm your consent before submitting.', true);
    busy = true; event.target.disabled = true; body.querySelector('[data-retake]').disabled = true; notice('Submitting...');
    try {
     const form = new FormData(); form.append('selfie', await exportPhoto(), 'selfie.jpg'); form.append('idFront', front); if (back) form.append('idBack', back); form.append('consent', 'true');
     const result = await request('provider', '/api/provider/profile-photo', { method: 'POST', body: form });
     if (dialog.open) dialog.close(); await loadStatus(); statusNotice(result.message);
    } catch (error) { notice(error.message, true); }
    finally { busy = false; event.target.disabled = false; const retake = body.querySelector('[data-retake]'); if (retake) retake.disabled = false; }
   };
  }
  showId();
 }
 function statusNotice(message) {
  const node = document.querySelector('#sn-photo-status'); if (node) node.textContent = message;
 }
 async function loadStatus() {
  if (pageRole !== 'provider' || !document.querySelector('#sn-photo-status')) return;
  try {
   const { review } = await request('provider', '/api/provider/profile-photo');
   statusNotice(review ? { pending: 'Awaiting admin review. Your existing account verification is unchanged.', approved: 'Profile photo approved.', declined: `Photo declined: ${review.reason}` }[review.status] : 'No verified profile photo yet.');
   const button = document.querySelector('#sn-photo-open'); if (button) button.disabled = review?.status === 'pending';
  } catch (error) { statusNotice(error.message); }
 }
 function mount() {
  if (!pageRole || !/\/profile\/profile\.html$/.test(location.pathname)) return;
  const section = document.createElement('section'); section.className = 'sn-photo-section';
  section.innerHTML = `<h2>Profile Photo</h2><div class="sn-photo-summary"><div class="sn-photo-portrait" data-photo-target="${pageRole}/${Number(user(pageRole)?.id) || 0}"></div><button class="sn-photo-button secondary" id="sn-photo-open" type="button"><img src="/shared/icons/lucide/pencil.svg" alt="">${pageRole === 'customer' ? 'Edit Photo' : 'Verify Profile Photo'}</button></div><p id="sn-photo-status" role="status"></p>`;
  const anchor = document.querySelector('.sn-profile-hero, .sn-hero, .sn-page-header');
  if (anchor) anchor.after(section); else document.querySelector('.sn-main .sn-topbar')?.after(section);
  section.querySelector('button').onclick = () => pageRole === 'customer' ? openCustomer() : openProvider();
  const edit = document.querySelector('#sn-avatar-edit-btn');
  if (edit) { edit.innerHTML = '<img src="/shared/icons/lucide/pencil.svg" width="18" height="18" alt="">'; edit.setAttribute('aria-label', 'Edit profile photo'); edit.onclick = openCustomer; }
  loadStatus();
 }
 window.SNProfilePhotos = { openCustomer, openProvider, refresh };
 Promise.resolve(window.snAccountSessionReady).then(() => { mount(); hydrate(); });
})();
