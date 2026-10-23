# Promotion QR Ph checkout

New promotion and subscription purchases use PayMongo hosted checkout with
`qrph` as the only payment method. Existing manual-QR purchases retain their
receipt review flow. Booking downpayments and provider payouts are unchanged.

## Render configuration

- `PROMOTION_PAYMENT_CHANNEL=paymongo` (the default).
- `PAYMONGO_SECRET_KEY`: secret key from the correct PayMongo account and mode.
- `PAYMONGO_WEBHOOK_SECRET`: signing secret for the webhook below, in the same mode.
- `PAYMONGO_LIVE_PAYMENTS_ENABLED=true` only after live QR Ph is enabled on the merchant account.
- `FRONTEND_BASE_URL=https://serbisyonow-fbm8.onrender.com`.

Create/enable a PayMongo webhook for `checkout_session.payment.paid` at:
`https://serbisyonow-fbm8.onrender.com/api/payments/paymongo/webhook`.
Do not put secrets in frontend code, screenshots, or Git. Keep live payments
disabled while using test credentials. Admin shows gateway readiness and mode;
readiness means local configuration is present, not merchant approval.

## Payment behavior

The server snapshots the plan amount and duration. One order has one checkout;
retrying an active checkout reuses its URL. A signed notification or authenticated
server-side status retrieval must match the session, order, reference, PHP amount,
and mode. Redirect query strings and uploaded screenshots cannot activate orders.

Successful live payments activate immediately, or extend an existing boost from
its expiry. Replayed notifications do not extend the duration twice. Test payments
show `test_paid`, without a boost or live revenue. Amount mismatches, late payments
for cancelled orders, and payments for unverified providers enter `refund_review`.
Refund review does not issue a refund automatically; reconcile in PayMongo first.

Providers and Admin can use **Check Payment Status** when notification delivery is
delayed. Unpaid checkout cancellation first checks payment status and expires the
gateway session. In-progress/paid payments cannot be silently cancelled.

If session creation times out, a durable attempt blocks another session. Admin
must check the `SN-PROMO-<order id>` reference in PayMongo and contact support to
reconcile the attempt. Do not delete the attempt or instruct another payment while
its outcome is uncertain. A valid paid webhook can still settle that attempt.

Gateway fees are not passed on by checkout. Reported revenue is gross confirmed
promotion sales, not net settlement. Provider service payments are not platform
revenue. No provider payout or custody workflow is enabled by this change.

## Verification

Run `node --test scripts/promotion-checkout.test.js scripts/paymongo.test.js scripts/promotions.test.js`.
Run `node scripts/promotion-checkout.browser-test.js` with Playwright available.
Tests use isolated local PostgreSQL and simulated gateway responses, never real
charges. Verify live credentials and webhook delivery in Render/PayMongo before
announcing that live QR Ph purchases are available. A bank transfer can still fail;
never promise that changing checkout eliminates InstaPay/bank failures.
