/* SerbisyoNow – Customer Register JS */
'use strict';

const AUTH_API_BASE = SN.utils.apiBase();
const CUSTOMER_REGISTER_SUCCESS_KEY = 'sn_customer_register_success';

function isGoogleRegistration() {
  if (new URLSearchParams(window.location.search).get('google') !== '1') return false;
  try {
    return Boolean(JSON.parse(localStorage.getItem('sn_google_prefill_customer') || 'null')?.email);
  } catch {
    return false;
  }
}

async function apiRequest(path, payload) {
  const response = await fetch(`${AUTH_API_BASE}${path}`, {
    method: 'POST',
    body: payload,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }
  return data;
}

function clearFieldError(field) {
  if (!field) return;
  field.classList.remove('error');
  const group = field.closest('.form-group');
  group?.querySelector('.field-error')?.remove();
}

function showFieldError(field, message) {
  if (!field) return;
  field.classList.add('error');
  const group = field.closest('.form-group');
  if (!group) return;
  let error = group.querySelector('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    group.appendChild(error);
  }
  error.textContent = message;
}

function clearFormErrors(form) {
  if (!form) return;
  form.querySelectorAll('.field-error').forEach(err => err.remove());
  form.querySelectorAll('.form-control').forEach(field => field.classList.remove('error'));
}

function setStepWarning(stepId, message) {
  const warningEl = document.getElementById(stepId);
  if (!warningEl) return;
  if (!message) {
    warningEl.textContent = '';
    warningEl.classList.remove('show');
    return;
  }
  warningEl.textContent = message;
  warningEl.classList.add('show');
}

function validateForm(form, messages = {}) {
  if (!form) return false;
  clearFormErrors(form);
  let valid = true;
  form.querySelectorAll('[required]').forEach(field => {
    const value = field.type === 'file' ? (field.files.length ? field.files[0].name : '') : field.value.trim();
    if (!value) {
      valid = false;
      const message = messages[field.id] || 'Please fill out this field.';
      showFieldError(field, message);
    }
  });
  return valid;
}

function validateStep1() {
  const form = document.getElementById('form-step1');
  const googleMode = isGoogleRegistration();
  setStepWarning('step-1-warning', '');
  const messages = {
    fullname: 'What is your full name?',
    gender: 'Please choose a gender.',
    contact: 'Enter your contact number.',
    dob: 'Select your birth date.',
    email: 'Enter your email address.',
    password: 'Create a password.',
    'confirm-password': 'Confirm your password.'
  };

  if (!validateForm(form, messages)) {
    SN.toast.error('Please complete all required fields before continuing.');
    return false;
  }

  if (googleMode) return true;

  const pass = document.getElementById('password').value;
  const conf = document.getElementById('confirm-password').value;
  if (pass !== conf) {
    SN.toast.error('Passwords do not match.');
    const confirmField = document.getElementById('confirm-password');
    showFieldError(confirmField, 'Passwords do not match.');
    confirmField.focus();
    return false;
  }

  return true;
}

function validateStep2() {
  const form = document.getElementById('form-step2');
  setStepWarning('step-2-warning', '');
  const messages = {
    'id-type': 'Select your ID type.',
    'id-address': 'Enter your address.',
    'id-front': 'Upload the front of your ID.',
    'id-back': 'Upload the back of your ID.'
  };

  if (!validateForm(form, messages)) {
    SN.toast.error('Please complete all required fields before submitting.');
    return false;
  }

  return true;
}

function goStep(e, step) {
  e.preventDefault();
  if (step === 2 && !validateStep1()) return;
  sessionStorage.removeItem(CUSTOMER_REGISTER_SUCCESS_KEY);
  document.body.classList.remove('is-application-submitted');
  document.querySelector('.provider-flow-card')?.classList.remove('is-success-card');
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  if (step1) {
    step1.hidden = true;
    step1.style.display = 'none';
  }
  if (step2) {
    step2.hidden = false;
    step2.style.display = 'block';
  }
  const success = document.getElementById('customer-success');
  if (success) {
    success.classList.remove('is-visible');
    success.hidden = true;
    success.style.display = 'none';
  }
}

function goBack(step) {
  sessionStorage.removeItem(CUSTOMER_REGISTER_SUCCESS_KEY);
  document.body.classList.remove('is-application-submitted');
  document.querySelector('.provider-flow-card')?.classList.remove('is-success-card');
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  if (step2) {
    step2.hidden = true;
    step2.style.display = 'none';
  }
  if (step1) {
    step1.hidden = false;
    step1.style.display = 'block';
  }
  const success = document.getElementById('customer-success');
  if (success) {
    success.classList.remove('is-visible');
    success.hidden = true;
    success.style.display = 'none';
  }
}

function showCustomerSuccess() {
  sessionStorage.setItem(CUSTOMER_REGISTER_SUCCESS_KEY, '1');
  document.body.classList.add('is-application-submitted');
  document.querySelector('.provider-flow-card')?.classList.add('is-success-card');
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  if (step1) {
    step1.hidden = true;
    step1.style.display = 'none';
  }
  if (step2) {
    step2.hidden = true;
    step2.style.display = 'none';
  }
  const success = document.getElementById('customer-success');
  if (success) {
    success.hidden = false;
    success.classList.add('is-visible');
    success.style.display = 'flex';
    success.removeAttribute('aria-hidden');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleUpload(input, labelId, boxId) {
  if (input.files && input.files[0]) {
    document.getElementById(labelId).textContent = '✓ ' + input.files[0].name;
    document.getElementById(boxId).classList.add('uploaded');
    clearFieldError(input);
  }
}

async function redirectExistingGoogleCustomer(profile) {
  const warning = document.getElementById('step-1-warning');
  const response = await fetch(`${AUTH_API_BASE}/api/auth/google/account-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: 'customer',
      email: profile.email,
      googleSub: profile.googleSub || '',
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (warning && data.message) {
      warning.textContent = data.message;
      warning.classList.add('show');
    }
    return;
  }

  if (data.action === 'login' && data.user && data.redirect) {
    localStorage.removeItem('sn_google_prefill_customer');
    localStorage.setItem('sn_customer_user', JSON.stringify(data.user));
    window.location.replace(data.redirect);
  }
}

function submitRegister(e) {
  e.preventDefault();
  if (!validateStep2()) return;
  setStepWarning('step-2-warning', '');

  const btn = document.getElementById('submit-btn');
  btn.textContent = 'Submitting...'; btn.disabled = true;

  const payload = new FormData();
  const address = document.getElementById('id-address').value.trim();
  payload.append('fullName', document.getElementById('fullname').value.trim());
  payload.append('address', address);
  payload.append('gender', document.getElementById('gender').value);
  payload.append('contact', document.getElementById('contact').value.trim());
  payload.append('dob', document.getElementById('dob').value);
  payload.append('email', document.getElementById('email').value.trim());
  if (isGoogleRegistration()) {
    const profile = JSON.parse(localStorage.getItem('sn_google_prefill_customer') || 'null');
    payload.append('authProvider', 'google');
    payload.append('googleSub', profile?.googleSub || '');
  } else {
    payload.append('password', document.getElementById('password').value);
  }
  payload.append('idType', document.getElementById('id-type').value);
  payload.append('idAddress', address);

  const idFront = document.getElementById('id-front');
  const idBack = document.getElementById('id-back');
  if (idFront?.files?.[0]) payload.append('idFront', idFront.files[0]);
  if (idBack?.files?.[0]) payload.append('idBack', idBack.files[0]);

  apiRequest('/api/auth/customer/register', payload)
    .then((data) => {
      localStorage.setItem('sn_customer_user', JSON.stringify(data.user));
      localStorage.removeItem('sn_google_prefill_customer');
      sessionStorage.setItem(CUSTOMER_REGISTER_SUCCESS_KEY, '1');
      showCustomerSuccess();
      SN.toast.success('Application submitted! Awaiting admin verification.');
    })
    .catch((error) => {
      const isNetworkError = String(error.message || '').toLowerCase().includes('failed to fetch');
      const message = isNetworkError
        ? 'Cannot reach the server. Please make sure the auth server is running and try again.'
        : (error.message || 'Failed to create account.');
      if (message.toLowerCase().includes('email')) {
        setStepWarning('step-2-warning', `${message} Use the back arrow only if you need to change the email.`);
        return;
      }
      setStepWarning('step-2-warning', message);
    })
    .finally(() => {
      btn.textContent = 'Submit'; btn.disabled = false;
    });
}

function applyGooglePrefill() {
  const openedFromGoogle = new URLSearchParams(window.location.search).get('google') === '1';
  if (!openedFromGoogle) {
    localStorage.removeItem('sn_google_prefill_customer');
    return;
  }

  let profile = null;
  try {
    profile = JSON.parse(localStorage.getItem('sn_google_prefill_customer') || 'null');
  } catch {
    profile = null;
  }
  if (!profile?.email) return;

  const nameField = document.getElementById('fullname');
  const emailField = document.getElementById('email');
  const passwordField = document.getElementById('password');
  const confirmField = document.getElementById('confirm-password');

  if (nameField && !nameField.value) nameField.value = profile.fullName || '';
  if (emailField) {
    emailField.value = profile.email;
    emailField.readOnly = true;
    emailField.classList.add('is-google-prefilled');
  }
  if (passwordField && confirmField) {
    passwordField.value = '';
    confirmField.value = '';
    passwordField.required = false;
    confirmField.required = false;
    passwordField.closest('.form-group')?.classList.add('sn-google-hidden-field');
    confirmField.closest('.form-group')?.classList.add('sn-google-hidden-field');
  }

  const warning = document.getElementById('step-1-warning');
  if (warning) {
    warning.textContent = 'Gmail verified. Checking if this account already exists...';
    warning.classList.add('show');
  }

  redirectExistingGoogleCustomer(profile)
    .then(() => {
      if (warning?.textContent?.includes('Checking')) {
        warning.textContent = 'New Gmail verified. Complete these details once; after approval, future Gmail logins go straight to your customer dashboard.';
      }
    })
    .catch(() => {
      if (warning) {
        warning.textContent = 'New Gmail verified. Complete these details once; after approval, future Gmail logins go straight to your customer dashboard.';
      }
    });
}

document.addEventListener('DOMContentLoaded', () => {
  applyGooglePrefill();
  if (sessionStorage.getItem(CUSTOMER_REGISTER_SUCCESS_KEY) === '1') {
    showCustomerSuccess();
  }
});

Object.assign(window, {
  goStep,
  goBack,
  showCustomerSuccess,
  handleUpload,
  submitRegister,
});
