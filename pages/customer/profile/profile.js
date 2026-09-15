/* ============================================================
 SerbisyoNow Customer Profile JS
 ============================================================ */

const AUTH_API_BASE = (window.SN_API_BASE || ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') ? 'http://localhost:3000' : `http://${window.location.hostname}:3000`));

function getCurrentCustomer() {
 try {
 const raw = localStorage.getItem('sn_customer_user');
 if (!raw) return null;
 return JSON.parse(raw);
 } catch { return null; }
}

function saveCurrentCustomer(data) {
 localStorage.setItem('sn_customer_user', JSON.stringify(data));
}

function formatDate(dateStr) {
 if (!dateStr) return '';
 try {
 const d = new Date(dateStr);
 return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
 } catch { return dateStr; }
}

function showNotice(elId, message, type = 'success') {
 const el = document.getElementById(elId);
 if (!el) return;
 el.textContent = message;
 el.className = `sn-save-notice ${type}`;
 el.style.display = '';
 setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function populatePage(user) {
 const status = user?.verification_status || (user?.is_verified? 'verified': 'pending');
 const isVerified = status === 'verified';
 const isRejected = status === 'rejected';

 // Sidebar greeting
 const sidebarName = document.getElementById('sn-user-name');
 const sidebarStatus = document.getElementById('sn-user-status');
 if (sidebarName) sidebarName.textContent = user?.full_name || 'Customer';
 if (sidebarStatus) {
 sidebarStatus.textContent = isVerified? 'Verified customer': isRejected? 'Verification declined': 'Awaiting verification';
 }

 // Hero banner
 document.getElementById('sn-profile-name').textContent = user?.full_name || '';
 document.getElementById('sn-profile-email').textContent = user?.email || '';
 document.getElementById('sn-profile-address').textContent =
 user?.address? ` ${user.address}`: ' Address not yet provided';

 // Verification badge next to name
 document.getElementById('sn-verified-badge').style.display = isVerified? '': 'none';
 document.getElementById('sn-pending-badge').style.display = (!isVerified &&!isRejected)? '': 'none';
 document.getElementById('sn-rejected-badge').style.display = isRejected? '': 'none';

 // Show re-verify card only when rejected
 const reverifyCard = document.getElementById('sn-reverify-card');
 if (reverifyCard) reverifyCard.style.display = isRejected? '': 'none';

 // View mode fields
 document.getElementById('view-fullname').textContent = user?.full_name || '';
 document.getElementById('view-email').textContent = user?.email || '';
 document.getElementById('view-contact').textContent = user?.contact || '';
 document.getElementById('view-address').textContent = user?.address || '';
 document.getElementById('view-gender').textContent = user?.gender || '';
 document.getElementById('view-dob').textContent = user?.dob? formatDate(user.dob): '';

 const statusLabels = { verified: ' Verified', pending: ' Pending', rejected: ' Rejected' };
 document.getElementById('view-status').textContent = statusLabels[status] || status;

 // Account card
 document.getElementById('acc-joined').textContent = user?.created_at? formatDate(user.created_at): '';
 document.getElementById('acc-status').textContent = statusLabels[status] || status;

 // Pre-fill edit form
 document.getElementById('edit-fullname').value = user?.full_name || '';
 document.getElementById('edit-email').value = user?.email || '';
 document.getElementById('edit-contact').value = user?.contact || '';
 document.getElementById('edit-address').value = user?.address || '';
 document.getElementById('edit-gender').value = user?.gender || '';
 document.getElementById('edit-dob').value = user?.dob? user.dob.split('T')[0]: '';
}

document.addEventListener('DOMContentLoaded', async () => {
 const currentCustomer = getCurrentCustomer();
 if (!currentCustomer) {
 window.location.href = '../../auth/customerLogin.html';
 return;
 }

 // Always re-fetch fresh data from the API so all registered fields appear
 // (localStorage may have been saved before contact/address/gender/dob were included)
 try {
 const res = await fetch(`${AUTH_API_BASE}/api/auth/customer/status/${currentCustomer.id}`);
 if (res.ok) {
 const data = await res.json().catch(() => ({}));
 if (data.user) {
 // Merge: keep any local-only keys, overwrite with fresh server data
 const merged = {...currentCustomer,...data.user };
 saveCurrentCustomer(merged);
 populatePage(merged);
 } else {
 populatePage(currentCustomer);
 }
 } else {
 populatePage(currentCustomer);
 }
 } catch (_) {
 // Server offline fall back to what's in localStorage
 populatePage(currentCustomer);
 }

 // Sidebar toggle 
 const shell = document.getElementById('sn-shell');
 const overlay = document.getElementById('sn-overlay');
 const hamburger = document.getElementById('sn-hamburger');
 const hamburgerTop = document.getElementById('sn-hamburger-top');
 const logoutBtn = document.getElementById('sn-logout');

 function isMobile() { return window.matchMedia('(max-width: 940px)').matches; }
 function closeSidebar() { shell?.classList.remove('sidebar-open'); shell?.classList.add('sidebar-collapsed'); document.body.style.overflow = ''; }
 function openSidebar() { shell?.classList.remove('sidebar-collapsed'); shell?.classList.add('sidebar-open'); if (isMobile()) document.body.style.overflow = 'hidden'; }
 function toggleSidebar() {
 if (!shell) return;
 const open = shell.classList.contains('sidebar-open') ||!shell.classList.contains('sidebar-collapsed');
 if (open) closeSidebar(); else openSidebar();
 }

 hamburger?.addEventListener('click', toggleSidebar);
 hamburgerTop?.addEventListener('click', toggleSidebar);
 overlay?.addEventListener('click', () => { if (isMobile()) closeSidebar(); });
 logoutBtn?.addEventListener('click', () => { localStorage.removeItem('sn_customer_user'); window.location.href = '../../landing/index.html'; });
 if (isMobile()) closeSidebar(); else openSidebar();

 // Edit / View toggle 
 const editToggleBtn = document.getElementById('sn-edit-toggle');
 const profileView = document.getElementById('sn-profile-view');
 const profileForm = document.getElementById('sn-profile-form');
 const cancelEditBtn = document.getElementById('sn-cancel-edit');

 function enterEditMode() {
 profileView.style.display = 'none';
 profileForm.style.display = '';
 editToggleBtn.textContent = ' Cancel';
 editToggleBtn.classList.add('editing');
 }

 function exitEditMode() {
 profileView.style.display = '';
 profileForm.style.display = 'none';
 editToggleBtn.textContent = ' Edit Profile';
 editToggleBtn.classList.remove('editing');
 document.getElementById('sn-save-notice').style.display = 'none';
 }

 editToggleBtn?.addEventListener('click', () => {
 const isEditing = profileForm.style.display!== 'none';
 if (isEditing) exitEditMode(); else enterEditMode();
 });

 cancelEditBtn?.addEventListener('click', exitEditMode);

 // Save Profile 
 profileForm?.addEventListener('submit', async (e) => {
 e.preventDefault();

 const fullName = document.getElementById('edit-fullname').value.trim();
 const contact = document.getElementById('edit-contact').value.trim();
 const address = document.getElementById('edit-address').value.trim();
 const gender = document.getElementById('edit-gender').value;
 const dob = document.getElementById('edit-dob').value;

 if (!fullName) {
 showNotice('sn-save-notice', 'Full name is required.', 'error');
 return;
 }

 const saveBtn = document.getElementById('sn-save-btn');
 saveBtn.disabled = true;
 saveBtn.textContent = 'Saving...';

 try {
 // Update local customer data
 // NOTE: When your API supports PATCH /api/auth/customer/update, call it here.
 // For now we update localStorage directly.
 const updatedCustomer = {...currentCustomer,
 full_name: fullName,
 contact,
 address,
 gender,
 dob,
 };

 // Attempt API update if endpoint exists
 try {
 const res = await fetch(`${AUTH_API_BASE}/api/auth/customer/update`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id: currentCustomer.id, full_name: fullName, contact, address, gender, dob }),
 });
 if (res.ok) {
 const data = await res.json().catch(() => ({}));
 if (data.user) Object.assign(updatedCustomer, data.user);
 }
 } catch (_) {
 // API not yet available continue with local update
 }

 saveCurrentCustomer(updatedCustomer);
 populatePage(updatedCustomer);
 showNotice('sn-save-notice', ' Profile updated successfully!', 'success');

 setTimeout(exitEditMode, 1500);
 } catch (err) {
 showNotice('sn-save-notice', err.message || 'Failed to save changes.', 'error');
 } finally {
 saveBtn.disabled = false;
 saveBtn.textContent = ' Save Changes';
 }
 });

 // Re-submit Verification (shown when rejected) 
 document.getElementById('sn-reverify-form')?.addEventListener('submit', async (e) => {
 e.preventDefault();

 const idType = document.getElementById('rv-id-type');
 const idAddress = document.getElementById('rv-id-address');
 const idFront = document.getElementById('rv-id-front');
 const idBack = document.getElementById('rv-id-back');
 const btn = document.getElementById('sn-reverify-btn');

 if (!idType?.value ||!idAddress?.value.trim() ||!idFront?.files?.[0] ||!idBack?.files?.[0]) {
 showNotice('sn-reverify-notice', 'Please complete all fields and upload both ID images.', 'error');
 return;
 }

 const payload = new FormData();
 payload.append('email', currentCustomer.email || '');
 payload.append('idType', idType.value);
 payload.append('idAddress', idAddress.value.trim());
 payload.append('idFront', idFront.files[0]);
 payload.append('idBack', idBack.files[0]);

 btn.disabled = true;
 btn.textContent = 'Submitting...';

 try {
 const res = await fetch(`${AUTH_API_BASE}/api/auth/customer/verification/resubmit`, {
 method: 'PATCH',
 body: payload,
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(data.message || 'Failed to resubmit verification.');

 const merged = {...currentCustomer,...data.user };
 saveCurrentCustomer(merged);
 Object.assign(currentCustomer, merged);
 populatePage(merged);
 showNotice('sn-reverify-notice', ' Verification resubmitted! Please wait for admin review.', 'success');
 e.target.reset();
 } catch (err) {
 showNotice('sn-reverify-notice', err.message || 'Failed to resubmit verification.', 'error');
 } finally {
 btn.disabled = false;
 btn.textContent = ' Submit Verification Again';
 }
 });

 // Change Password 
 document.getElementById('sn-password-form')?.addEventListener('submit', async (e) => {
 e.preventDefault();

 const current = document.getElementById('pw-current').value;
 const newPw = document.getElementById('pw-new').value;
 const confirm = document.getElementById('pw-confirm').value;

 if (!current ||!newPw ||!confirm) {
 showNotice('sn-pw-notice', 'Please fill in all password fields.', 'error');
 return;
 }
 if (newPw.length < 8) {
 showNotice('sn-pw-notice', 'New password must be at least 8 characters.', 'error');
 return;
 }
 if (newPw!== confirm) {
 showNotice('sn-pw-notice', 'New passwords do not match.', 'error');
 return;
 }

 const btn = e.target.querySelector('button[type="submit"]');
 btn.disabled = true;
 btn.textContent = 'Updating...';

 try {
 const res = await fetch(`${AUTH_API_BASE}/api/auth/customer/change-password`, {
 method: 'PATCH',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ id: currentCustomer.id, email: currentCustomer.email, currentPassword: current, newPassword: newPw }),
 });
 const data = await res.json().catch(() => ({}));
 if (!res.ok) throw new Error(data.message || 'Failed to update password.');
 showNotice('sn-pw-notice', ' Password updated successfully!', 'success');
 e.target.reset();
 } catch (err) {
 showNotice('sn-pw-notice', err.message || 'Failed to update password.', 'error');
 } finally {
 btn.disabled = false;
 btn.textContent = ' Update Password';
 }
 });
});