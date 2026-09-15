(function () {
  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function iconFor(type) {
    if (type === 'success') return 'OK';
    if (type === 'danger') return '!';
    if (type === 'warning') return '!';
    return 'i';
  }

  function openModal({ title = 'Notice', message = '', type = 'info', confirmText = 'OK', cancelText = '', closeOnBackdrop = true } = {}) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = `sn-modal sn-modal--${type}`;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = `
        <div class="sn-modal-card">
          <button type="button" class="sn-modal-close" aria-label="Close">x</button>
          <div class="sn-modal-icon sn-modal-icon--${type}">${esc(iconFor(type))}</div>
          <h3 class="sn-modal-title">${esc(title)}</h3>
          <p class="sn-modal-body">${esc(message)}</p>
          <div class="sn-modal-actions">
            ${cancelText ? `<button type="button" class="btn btn-outline" data-sn-cancel>${esc(cancelText)}</button>` : ''}
            <button type="button" class="btn ${type === 'danger' ? 'btn-danger' : 'btn-primary'}" data-sn-confirm>${esc(confirmText)}</button>
          </div>
        </div>
      `;

      function close(result) {
        document.removeEventListener('keydown', onKeydown);
        modal.remove();
        resolve(result);
      }

      function onKeydown(event) {
        if (event.key === 'Escape') close(false);
        if (event.key === 'Enter') close(true);
      }

      modal.addEventListener('click', (event) => {
        if (closeOnBackdrop && event.target === modal) close(false);
      });
      modal.querySelector('.sn-modal-close')?.addEventListener('click', () => close(false));
      modal.querySelector('[data-sn-cancel]')?.addEventListener('click', () => close(false));
      modal.querySelector('[data-sn-confirm]')?.addEventListener('click', () => close(true));
      document.addEventListener('keydown', onKeydown);
      document.body.appendChild(modal);
      requestAnimationFrame(() => modal.querySelector('[data-sn-confirm]')?.focus());
    });
  }

  window.snShowModal = openModal;
  window.snAlert = (message, options = {}) => openModal({ message, ...options });
  window.snConfirm = (message, options = {}) => openModal({ message, cancelText: 'Cancel', confirmText: 'Confirm', ...options });
}());
