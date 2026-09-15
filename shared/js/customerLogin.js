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
      SN.toast.error(error.message || 'Login failed.');
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

  emailField?.addEventListener('input', () => clearFieldError(emailField));
  passField?.addEventListener('input', () => clearFieldError(passField));
});
