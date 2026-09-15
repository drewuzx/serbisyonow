/* SerbisyoNow – Customer Login JS */
'use strict';

const AUTH_API_BASE = SN.utils.apiBase();

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

function clearLoginFormErrors() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.querySelectorAll('.field-error').forEach((err) => err.remove());
  form.querySelectorAll('.form-control').forEach((field) => field.classList.remove('error'));
  clearLoginBanner();
}

function loginBanner() {
  const form = document.getElementById('login-form');
  if (!form) return null;
  let banner = document.getElementById('login-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'login-banner';
    banner.className = 'auth-banner';
    banner.hidden = true;
    form.parentNode.insertBefore(banner, form);
  }
  return banner;
}

function showLoginBanner(message) {
  const banner = loginBanner();
  if (!banner) return;
  banner.textContent = message;
  banner.hidden = false;
}

function clearLoginBanner() {
  const banner = document.getElementById('login-banner');
  if (banner) banner.hidden = true;
}

async function apiRequest(path, payload) {
  const response = await fetch(`${AUTH_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Request failed.');
  }
  return data;
}

function handleLogin(e) {
  e.preventDefault();
  const emailField = document.getElementById('email');
  const passField = document.getElementById('password');
  const email = emailField.value.trim();
  const pass = passField.value;
  const btn = document.getElementById('login-btn');

  clearLoginFormErrors();

  let valid = true;
  if (!email) {
    showFieldError(emailField, 'Please enter your email address.');
    valid = false;
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFieldError(emailField, 'Please enter a valid email address.');
    valid = false;
  }

  if (!pass) {
    showFieldError(passField, 'Please enter your password.');
    valid = false;
  }

  if (!valid) return;

  btn.textContent = 'Logging in...'; btn.disabled = true;

  apiRequest('/api/auth/customer/login', { email, password: pass })
    .then((data) => {
      localStorage.setItem('sn_customer_user', JSON.stringify(data.user));
      if (data.user?.is_verified) SN.toast.success('Login successful! Redirecting...');
      else SN.toast.warning('Account pending verification. Limited dashboard access only.');
      setTimeout(() => window.location.href = '../customer/dashboard/dashboard.html', 700);
    })
    .catch((error) => {
      const message = error.message || 'Login failed.';
      if (message.toLowerCase().includes('invalid email or password')) {
        showFieldError(passField, 'Wrong email or password. Please try again.');
      } else if (message.toLowerCase().includes('failed to fetch')) {
        showLoginBanner('Cannot reach the auth server. Please check your connection and try again.');
      } else {
        showLoginBanner(message);
      }
    })
    .finally(() => {
      btn.textContent = 'Login'; btn.disabled = false;
    });
}

function googleLogin() {
  window.location.href = `${AUTH_API_BASE}/api/auth/google/start?role=customer`;
}

document.addEventListener('DOMContentLoaded', () => {
  const emailField = document.getElementById('email');
  const passField = document.getElementById('password');

  emailField?.addEventListener('input', () => {
    clearFieldError(emailField);
    clearLoginBanner();
  });
  passField?.addEventListener('input', () => {
    clearFieldError(passField);
    clearLoginBanner();
  });
});
