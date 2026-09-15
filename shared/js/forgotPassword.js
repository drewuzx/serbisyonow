/* SerbisyoNow - Forgot Password */
(function () {
  'use strict';

  const AUTH_API_BASE = window.SN?.utils?.apiBase?.() || window.location.origin;
  const ROLE_CONFIG = {
    customer: {
      title: 'Reset Customer Password',
      subtitle: 'Enter your customer email and we will prepare a password reset link.',
      login: 'customerLogin.html',
    },
    provider: {
      title: 'Reset Provider Password',
      subtitle: 'Enter your provider email and we will prepare a password reset link.',
      login: 'providerLogin.html',
    },
  };

  function currentRole() {
    const role = new URLSearchParams(window.location.search).get('role');
    return role === 'provider' ? 'provider' : 'customer';
  }

  function isEmailLike(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
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
    const banner = document.getElementById('forgot-banner');
    if (!banner) return;
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearBanner() {
    const banner = document.getElementById('forgot-banner');
    if (banner) banner.hidden = true;
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.innerHTML = loading
      ? '<span class="auth-spinner"></span>Sending...'
      : 'Send Reset Link';
  }

  async function postResetRequest(role, email) {
    const response = await fetch(`${AUTH_API_BASE}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, email }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || 'Could not request password reset.');
      error.field = data.field;
      error.detail = data.detail;
      error.smtpCode = data.smtp_code;
      error.smtpResponseCode = data.smtp_response_code;
      throw error;
    }
    return data;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const role = currentRole();
    const emailField = document.getElementById('email');
    const button = document.getElementById('forgot-btn');
    const email = emailField.value.trim();

    clearBanner();
    clearFieldError(emailField);

    if (!email) {
      showFieldError(emailField, 'Please enter your email address.');
      return;
    }

    if (!isEmailLike(email)) {
      showFieldError(emailField, 'Please enter a valid email address.');
      return;
    }

    setLoading(button, true);
    try {
      const data = await postResetRequest(role, email);
      const success = document.getElementById('forgot-success');
      const successCopy = document.getElementById('forgot-success-copy');
      const devPanel = document.getElementById('reset-dev-link');
      const resetLink = document.getElementById('reset-link');

      success.hidden = false;
      successCopy.textContent = data.email_sent
        ? `If ${email} is registered, the reset link was sent.`
        : `If ${email} is registered, a reset link has been prepared.`;

      if (data.reset_url) {
        resetLink.href = data.reset_url;
        devPanel.hidden = false;
      } else {
        devPanel.hidden = true;
      }
    } catch (error) {
      const detail = error.detail ? ` ${error.detail}` : '';
      if (error.field === 'email') {
        showFieldError(emailField, error.message);
      } else if (String(error.message || '').toLowerCase().includes('failed to fetch')) {
        showBanner('Cannot reach the auth server. Please check your connection and try again.');
      } else {
        showBanner(`${error.message || 'Could not request password reset.'}${detail}`);
      }
    } finally {
      setLoading(button, false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const role = currentRole();
    const config = ROLE_CONFIG[role];
    document.getElementById('forgot-title').textContent = config.title;
    document.getElementById('forgot-subtitle').textContent = config.subtitle;
    document.getElementById('back-link').href = config.login;
    document.getElementById('login-link').href = config.login;

    const form = document.getElementById('forgot-form');
    const emailField = document.getElementById('email');
    form?.addEventListener('submit', handleSubmit);
    emailField?.addEventListener('input', () => {
      clearFieldError(emailField);
      clearBanner();
    });
  });
})();
