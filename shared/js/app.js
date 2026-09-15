/* ============================================================
   SerbisyoNow – Shared JavaScript Utilities
   File: shared/js/app.js
   ============================================================ */

'use strict';

// ── SerbisyoNow Global Namespace ─────────────────────────────
const SN = {

  // ── Sidebar Toggle ──────────────────────────────────────────
  sidebar: {
    init() {
      const hamburger = document.querySelector('.hamburger');
      const sidebar   = document.querySelector('.sidebar');
      const overlay   = document.getElementById('sidebar-overlay');

      if (!hamburger || !sidebar) return;

      hamburger.addEventListener('click', () => this.toggle(sidebar, overlay));
      overlay?.addEventListener('click', () => this.close(sidebar, overlay));

      // Close on nav item click (mobile)
      sidebar.querySelectorAll('.sidebar-menu-item').forEach(item => {
        item.addEventListener('click', () => {
          if (window.innerWidth <= 1024) this.close(sidebar, overlay);
        });
      });
    },

    toggle(sidebar, overlay) {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('show');
      document.body.style.overflow = sidebar.classList.contains('open') ? 'hidden' : '';
    },

    close(sidebar, overlay) {
      sidebar.classList.remove('open');
      overlay?.classList.remove('show');
      document.body.style.overflow = '';
    }
  },

  // ── Active Nav Item ─────────────────────────────────────────
  nav: {
    setActive() {
      const currentPage = window.location.pathname.split('/').pop();
      document.querySelectorAll('.sidebar-menu-item').forEach(item => {
        const href = item.getAttribute('href') || item.dataset.page;
        if (href && href.includes(currentPage)) {
          item.classList.add('active');
        }
      });
    }
  },

  // ── Toast Notifications ─────────────────────────────────────
  toast: {
    container: null,

    updatePosition() {
      if (!this.container) return;
      const authCard = document.querySelector('.auth-card');
      if (authCard) {
        if (getComputedStyle(authCard).position === 'static') {
          authCard.style.position = 'relative';
        }
        if (this.container.parentElement !== authCard) {
          authCard.appendChild(this.container);
        }
        this.container.style.position = 'absolute';
        this.container.style.top = '12px';
        this.container.style.left = '50%';
        this.container.style.transform = 'translateX(-50%)';
        this.container.style.width = 'calc(100% - 24px)';
        this.container.style.maxWidth = '640px';
      } else {
        if (this.container.parentElement !== document.body) {
          document.body.appendChild(this.container);
        }
        this.container.style.position = 'fixed';
        this.container.style.top = '20px';
        this.container.style.left = '50%';
        this.container.style.transform = 'translateX(-50%)';
        this.container.style.width = 'auto';
        this.container.style.maxWidth = 'none';
      }
    },

    init() {
      this.container = document.getElementById('toast-container');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.id = 'toast-container';
        this.container.style.cssText = `
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          z-index: 9999; display: flex; flex-direction: column; gap: 10px;
          align-items: center;
        `;
        document.body.appendChild(this.container);
      }
      this.updatePosition();
      window.addEventListener('resize', () => this.updatePosition());
    },

    show(message, type = 'info', duration = 3500) {
      if (!this.container) this.init();
      this.updatePosition();

      const colors = {
        success: { bg: '#DCFCE7', border: '#22C55E', text: '#15803D', icon: '✓' },
        error:   { bg: '#FEE2E2', border: '#EF4444', text: '#B91C1C', icon: '✕' },
        warning: { bg: '#FEF3C7', border: '#F59E0B', text: '#92400E', icon: '⚠' },
        info:    { bg: '#DBEAFE', border: '#3B82F6', text: '#1D4ED8', icon: 'ℹ' },
      };

      const c = colors[type] || colors.info;
      const toast = document.createElement('div');
      toast.style.cssText = `
        background: ${c.bg}; border: 1.5px solid ${c.border};
        color: ${c.text}; padding: 12px 16px; border-radius: 10px;
        font-size: 0.875rem; font-weight: 500; display: flex;
        align-items: center; gap: 10px; min-width: 260px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        animation: fadeUp 0.3s ease;
        font-family: 'Poppins', sans-serif;
      `;
      toast.innerHTML = `<span style="font-weight:700">${c.icon}</span>${message}`;
      this.container.appendChild(toast);

      setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    },

    success: (msg, d) => SN.toast.show(msg, 'success', d),
    error:   (msg, d) => SN.toast.show(msg, 'error', d),
    warning: (msg, d) => SN.toast.show(msg, 'warning', d),
    info:    (msg, d) => SN.toast.show(msg, 'info', d),
  },

  // ── Modal ────────────────────────────────────────────────────
  modal: {
    open(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        setTimeout(() => modal.classList.add('show'), 10);
      }
    },

    close(id) {
      const modal = document.getElementById(id);
      if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
        setTimeout(() => modal.style.display = 'none', 300);
      }
    },

    init() {
      // Close modal on overlay click
      document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) this.close(modal.id);
        });
      });

      // Close button
      document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
          const modalId = btn.closest('.modal-overlay')?.id;
          if (modalId) this.close(modalId);
        });
      });
    }
  },

  // ── Form Helpers ─────────────────────────────────────────────
  form: {
    validate(formEl) {
      let valid = true;
      formEl.querySelectorAll('[required]').forEach(field => {
        const group = field.closest('.form-group');
        if (!field.value.trim()) {
          valid = false;
          field.style.borderColor = 'var(--danger)';
          const err = group?.querySelector('.field-error');
          if (!err && group) {
            const e = document.createElement('span');
            e.className = 'field-error';
            e.style.cssText = 'color: var(--danger); font-size: 0.75rem; margin-top: 4px; display: block;';
            e.textContent = 'This field is required.';
            group.appendChild(e);
          }
        } else {
          field.style.borderColor = '';
          group?.querySelector('.field-error')?.remove();
        }
      });
      return valid;
    },

    clearErrors(formEl) {
      formEl.querySelectorAll('.field-error').forEach(e => e.remove());
      formEl.querySelectorAll('.form-control').forEach(f => f.style.borderColor = '');
    }
  },

  // ── Password Toggle ──────────────────────────────────────────
  pwToggle: {
    init() {
      document.querySelectorAll('.toggle-pw').forEach(btn => {
        btn.addEventListener('click', function() {
          const input = this.closest('.input-wrap')?.querySelector('input');
          if (!input) return;
          const isText = input.type === 'text';
          input.type = isText ? 'password' : 'text';
          this.querySelector('svg').innerHTML = isText
            ? `<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
               <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
               <line x1="1" y1="1" x2="23" y2="23"/>`
            : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8"/>
               <circle cx="12" cy="12" r="3"/>`;
        });
      });
    }
  },

  // ── Search Filter ────────────────────────────────────────────
  search: {
    init(inputSelector, rowSelector) {
      const input = document.querySelector(inputSelector);
      if (!input) return;
      input.addEventListener('input', function() {
        const q = this.value.toLowerCase();
        document.querySelectorAll(rowSelector).forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  },

  // ── Helpers ──────────────────────────────────────────────────
  utils: {
    apiBase: () => {
      if (window.SN_API_BASE) return window.SN_API_BASE;
      const { protocol, hostname, port, origin } = window.location;
      const host = hostname === '127.0.0.1' ? 'localhost' : hostname;
      if (protocol === 'file:' || port === '5500') return `http://${host}:3000`;
      return origin;
    },
    isValidEmail: (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
    isValidPhone:  (p) => /^(\+63|0)[0-9]{10}$/.test(p.replace(/\s/g, '')),
    formatDate: (d) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }),
    formatCurrency: (n) => '₱' + Number(n).toLocaleString('en-PH'),
    debounce(fn, ms = 300) {
      let t;
      return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
    }
  }
};

window.SN = SN;

// ── Auto-init on DOM Ready ───────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  SN.sidebar.init();
  SN.nav.setActive();
  SN.modal.init();
  SN.pwToggle.init();
  SN.toast.init();
});
