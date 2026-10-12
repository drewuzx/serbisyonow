(function () {
 'use strict';
 function qrUrl(base, value) {
  return /^\/uploads\/provider-payment-qrs\/[a-zA-Z0-9_.-]+$/.test(value || '') ? `${base}${value}` : '';
 }
 function loadReceiptImage(root, base, role, token, receiptId) {
  const img = root.querySelector('[data-payment-receipt-image]');
  const error = root.querySelector('[data-receipt-error]');
  const controller = new AbortController();
  let objectUrl;
  if (img && /^\d+$/.test(String(receiptId))) {
   fetch(`${base}/api/payment-receipts/${receiptId}/image?role=${role}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
   }).then(async response => {
    if (!response.ok || !/^image\/(png|jpeg|webp)(;|$)/.test(response.headers.get('content-type') || '')) throw new Error('Receipt image is unavailable. Refresh and try again.');
    const blob = await response.blob();
    if (controller.signal.aborted || !img.isConnected) return;
    objectUrl = URL.createObjectURL(blob);
    img.src = objectUrl;
    img.hidden = false;
   }).catch(reason => { if (reason.name !== 'AbortError' && error) { error.textContent = reason.message; error.hidden = false; } });
  }
  return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
 }
 window.snDirectPayments = { qrUrl, loadReceiptImage };
})();
