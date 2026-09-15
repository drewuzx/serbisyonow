/* SerbisyoNow - Reset Password */
(function () {
  'use strict';

  const AUTH_API_BASE = window.SN?.utils?.apiBase?.() || window.location.origin;

  function tokenFromUrl() {
    return new URLSearchParams(window.location.search).get('token') || '';
  }

  function clearFieldError(field) {
    if (!field) return;
    field.classList.remove('error');
    field.closest('.form-group')?.querySelector('.field-error')?.remove();
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

  function showBanner(message) {
    const banner = document.getElementById('reset-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearBanner() {
    const banner = document.getElementById('reset-banner');
    if (banner) banner.hidden = true;
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.innerHTML = loading
      ? '<span class="auth-spinner"></span>Updating...'
      : 'Update Password';
  }

  async function postPasswordReset(token, password) {
    const response = await fetch(`${AUTH_API_BASE}/api/auth/password-reset/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Could not reset password.');
      error.field = data.field;
      throw error;
    }
    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const token = tokenFromUrl();
    const passwordField = document.getElementById('password');
    const confirmField = document.getElementById('confirm-password');
    const button = document.getElementById('reset-btn');
    const password = passwordField.value;
    const confirmPassword = confirmField.value;

    clearBanner();
    clearFieldError(passwordField);
    clearFieldError(confirmField);

    if (!token) {
      showBanner('Missing reset token. Please request a new password reset link.');
      return;
    }

    if (!password) {
      showFieldError(passwordField, 'Please enter a new password.');
      return;
    }

    if (password.length < 8) {
      showFieldError(passwordField, 'Password must be at least 8 characters.');
      return;
    }

    if (!confirmPassword) {
      showFieldError(confirmField, 'Please confirm your new password.');
      return;
    }

    if (password !== confirmPassword) {
      showFieldError(confirmField, 'Passwords do not match.');
      return;
    }

    setLoading(button, true);
    try {
      const data = await postPasswordReset(token, password);
      const form = document.getElementById('reset-form');
      const success = document.getElementById('reset-success');
      const loginLink = document.getElementById('success-login-link');

      form.hidden = true;
      success.hidden = false;
      loginLink.href = data.redirect || 'loginChoice.html';
      loginLink.textContent = data.role === 'provider'
        ? 'Go to Provider Login'
        : 'Go to Customer Login';
    } catch (error) {
      if (error.field === 'password') {
        showFieldError(passwordField, error.message);
      } else if (String(error.message || '').toLowerCase().includes('failed to fetch')) {
        showBanner('Cannot reach the auth server. Please check your connection and try again.');
      } else {
        showBanner(error.message || 'Could not reset password.');
      }
    } finally {
      setLoading(button, false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const token = tokenFromUrl();
    const form = document.getElementById('reset-form');
    const passwordField = document.getElementById('password');
    const confirmField = document.getElementById('confirm-password');
    const button = document.getElementById('reset-btn');

    form?.addEventListener('submit', handleSubmit);
    passwordField?.addEventListener('input', () => {
      clearFieldError(passwordField);
      clearBanner();
    });
    confirmField?.addEventListener('input', () => {
      clearFieldError(confirmField);
      clearBanner();
    });

    if (!token) {
      button.disabled = true;
      showBanner('Missing reset token. Please request a new password reset link.');
    }
  });
})();
