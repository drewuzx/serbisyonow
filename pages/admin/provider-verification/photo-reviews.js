(function () {
 'use strict';
 const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/shared/css/profile-photos.css'; document.head.append(link);
 const section = document.createElement('section'); section.className = 'admin-panel sn-photo-queue';
 section.innerHTML = '<div class="admin-panel-head"><h2>Profile Photo Reviews</h2><button type="button" class="btn btn-outline" data-photo-refresh>Refresh</button></div><p role="status" data-photo-status></p><div data-photo-list></div>';
 document.querySelector('.admin-module-nav').after(section);
 const list = section.querySelector('[data-photo-list]'), status = section.querySelector('[data-photo-status]');
 let revision = 0;
 async function load() {
  const current = ++revision; status.textContent = 'Loading photo submissions...';
  try {
   const data = await adminGet('/api/admin/profile-photo-reviews');
   if (current !== revision) return;
   list.replaceChildren(); status.textContent = data.reviews.length ? `${data.reviews.length} awaiting review` : 'No profile photos awaiting review.';
   for (const review of data.reviews) {
    const item = document.createElement('article');
    const name = document.createElement('strong'); name.textContent = review.full_name;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = 'Review ID & Selfie'; button.onclick = () => open(review, button);
    item.append(name, button); list.append(item);
   }
  } catch (error) { status.textContent = error.message; }
 }
 async function open(review, opener) {
  const dialog = document.createElement('dialog'); dialog.className = 'sn-photo-dialog'; dialog.style.width = 'min(920px, calc(100% - 24px))'; dialog.setAttribute('aria-label', 'Review provider photo');
  dialog.innerHTML = `<header><h2>Review Provider Photo</h2><button type="button" class="sn-photo-button secondary sn-photo-close" aria-label="Close"><img src="/shared/icons/lucide/x.svg" alt=""></button></header><h3 data-name></h3><p>Compare the ID and selfie manually. Approving publishes this selfie only; it does not change account verification.</p><div class="sn-photo-review-images"></div><label class="sn-photo-consent"><input type="checkbox" data-confirm><span>I reviewed the ID and selfie and confirm this photo is suitable for this provider.</span></label><label class="sn-photo-field">Decline reason<textarea rows="3" maxlength="500" data-reason></textarea></label><div class="sn-photo-actions"><button class="sn-photo-button secondary" data-decision="declined" disabled>Decline Photo</button><button class="sn-photo-button" data-decision="approved" disabled>Approve Photo</button></div><p role="status" class="sn-photo-notice"></p>`;
  dialog.querySelector('[data-name]').textContent = review.full_name;
  const notice = dialog.querySelector('.sn-photo-notice'), urls = [], controller = new AbortController();
  dialog.querySelector('.sn-photo-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); dialog.remove(); opener.focus(); });
  document.body.append(dialog); dialog.showModal();
  let ready = false, busy = false;
  try {
   for (const [kind, label] of [['selfie', 'Camera selfie'], ['front', 'Front of ID'], ['back', 'Back of ID (optional)']]) {
    const response = await fetch(`${ADMIN_API_BASE}/api/admin/profile-photo-reviews/${review.provider_id}/${review.revision}/${kind}`, { credentials: 'same-origin', headers: adminAuthHeaders(), cache: 'no-store', signal: controller.signal });
    if (response.status === 404 && kind === 'back') continue;
    if (!response.ok) throw new Error('Unable to load review images. Close and refresh the queue.');
    const blob = await response.blob(); if (!dialog.open) return;
    const url = URL.createObjectURL(blob); urls.push(url);
    const figure = document.createElement('figure'), caption = document.createElement('figcaption'), img = new Image();
    caption.textContent = label; img.alt = label; img.src = url;
    await img.decode(); figure.append(caption, img); dialog.querySelector('.sn-photo-review-images').append(figure);
   }
   ready = true; dialog.querySelectorAll('[data-decision]').forEach(button => { button.disabled = false; });
  } catch (error) { if (dialog.open) notice.textContent = error.message; }
  dialog.querySelectorAll('[data-decision]').forEach(button => { button.onclick = async () => {
   if (!ready || busy) return;
   const decision = button.dataset.decision, reason = dialog.querySelector('[data-reason]').value.trim();
   if (decision === 'approved' && !dialog.querySelector('[data-confirm]').checked) { notice.textContent = 'Confirm that you reviewed the ID and selfie first.'; return; }
   if (decision === 'declined' && !reason) { notice.textContent = 'Enter a reason so the provider knows what to correct.'; return; }
   busy = true; dialog.querySelectorAll('[data-decision]').forEach(node => { node.disabled = true; }); notice.textContent = 'Saving decision...';
   try {
    const response = await fetch(`${ADMIN_API_BASE}/api/admin/profile-photo-reviews/${review.provider_id}`, { method: 'POST', credentials: 'same-origin', headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: review.revision, decision, reason }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Unable to save review.');
    dialog.close(); await load(); status.textContent = data.message;
   } catch (error) { notice.textContent = error.message; }
   finally { busy = false; dialog.querySelectorAll('[data-decision]').forEach(node => { node.disabled = false; }); }
  }; });
 }
 section.querySelector('[data-photo-refresh]').onclick = load;
 load();
})();
