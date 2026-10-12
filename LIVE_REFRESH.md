# Idle Live Refresh

Signed-in customer, provider, and admin pages update their live data after about
3 seconds without interaction, then every 3 seconds while the page remains idle.
Pointer movement, clicks, typing, input changes, scrolling with the wheel, and
touch interactions restart the idle delay. Hidden or offline pages do not poll.
Returning to the page starts a fresh idle delay.

The shared scheduler is `shared/js/live-refresh.js`, loaded by `pwa-register.js`.
Each data source has a keyed registration, so slow requests do not overlap.
Background response handlers check idle state again before updating the page.
Explicit actions such as saving, sending messages, and manually refreshing still
take effect immediately.

Only changed data is rendered. Booking filters, history selections, profile and
availability drafts, QR/receipt uploads, and chat drafts are preserved. Customer
payment status can update while its dialog is open. A changed payment price or
status can invalidate the old payment form; it must show the current server state.
Account session renewal continues independently to keep signed-in users remembered.

No new environment variables or database migrations are needed. The PWA cache
version is v54. Deployment uses the existing Render service.

## Verification

- `node --test scripts/live-refresh.test.js`: idle timing, activity handling,
  hidden/offline behavior, slow requests, disposal, and recovery.
- `node scripts/live-refresh.browser-test.js`: isolated browser fixtures covering
  customer, provider, and admin views, drafts, files, payment changes, filters,
  unchanged sessions, and no document reloads. Requires Playwright and Edge.
- `node scripts/provider-qr-payments.browser-test.js`: real local test-schema QR
  workflow, including receipt upload, rejection, resubmission, and verification.
