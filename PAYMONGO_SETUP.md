# PayMongo Booking Downpayments

## Booking Flow

New requests stay Pending until the provider confirms the full service price, the customer agrees to that price, and PayMongo verifies the 30% downpayment. Only the signed `checkout_session.payment.paid` webhook changes the schedule to Upcoming. Redirects and checkout creation do not prove payment.

The server rounds the downpayment to the nearest centavo and subtracts it from the confirmed total to calculate the remaining balance. PHP 333.35 gives PHP 100.01 downpayment and PHP 233.34 remaining. Existing bookings retain their original payment agreement and are not charged retroactively.

Customer and provider logins are remembered with a 30-day rolling server-backed session and a first-party HttpOnly cookie. Normal refreshes and deployments do not clear saved logins. Valid existing bearer sessions receive the cookie on their next page load. Browser profile storage can be restored from a valid cookie before account pages initialize; network failures keep cached account details. Manual logout clears browser state and revokes that browser's session. Password changes/resets still revoke sessions for security. Accounts signed in before server-backed sessions were introduced need one successful sign-in before payment actions can be authenticated; an account ID alone cannot safely create a session. After 30 days without session use, a sign-in is required. New price confirmation and checkout actions also require verified accounts. The agreed price is locked once checkout starts; retries resume the same checkout instead of creating a second charge. Past booking dates cannot open a payable checkout.

## Render Configuration

Set these only in the backend environment, never in browser scripts, screenshots, Git, or chat:

```text
PAYMONGO_SECRET_KEY=<your sk_test_ key first>
PAYMONGO_WEBHOOK_SECRET=<the signing secret for this webhook>
PAYMONGO_PAYMENT_METHODS=gcash,paymaya
PAYMONGO_LIVE_PAYMENTS_ENABLED=false
FRONTEND_BASE_URL=https://<your app domain>
API_PUBLIC_BASE_URL=https://<your API domain>
```

Enable the selected payment methods in your merchant account. Supported method identifiers are `gcash`, `paymaya`, `grab_pay`, `shopeepay`, and `qrph`; default checkout offers GCash and Maya. Merchant eligibility and actual methods must be verified in PayMongo. No extra gateway fee is added to the customer payment.

1. Deploy the changes. Startup and `npm run init-db` both apply the additive payment schema; no account deletion or booking reset is needed.
2. In PayMongo Developers > Webhooks, register `https://<your API domain>/api/payments/paymongo/webhook` and subscribe to `checkout_session.payment.paid`.
3. Put this endpoint's signing secret in `PAYMONGO_WEBHOOK_SECRET` and restart/redeploy the backend. Missing keys leave checkout unavailable and bookings unconfirmed.
4. Use test mode first. Confirm a provider price, agree to it as the customer, complete a test e-wallet checkout, and verify both sides show Upcoming, the downpayment, and the remaining balance.
5. Test declined bookings, checkout cancellation, repeated clicks, webhook redelivery, and late payments. The success redirect alone must never confirm a booking.
6. Only after successful end-to-end testing and explicit approval to accept real payments, configure the live key and matching live webhook signing secret, and set `PAYMONGO_LIVE_PAYMENTS_ENABLED=true`. By default, real checkout is blocked even if a live key was entered accidentally. Test keys work with this flag left false or unset. Live return URLs require HTTPS. Test notifications cannot settle a live checkout. Valid notifications and checkout expiry for existing payments remain available when new live checkout is disabled.

The API uses PayMongo's recommended v2 hosted checkout; secrets stay on the backend. Checkout expiry uses the v1 expire endpoint. Notifications require the original request body, an HMAC signature, matching environment and booking reference, the correct amount/currency, and a unique payment receipt.

## Refunds, Balances, And Provider Settlement

Canceled paid bookings and late/incorrect payments are marked `refund_review`, not automatically refunded. Support must review the saved receipt and carry out any approved refund in PayMongo. An additional paid receipt for an already settled checkout also remains in the receipt ledger for review. Automatic refunds and an admin refund-management screen are not included until a cancellation policy is agreed.

The remaining 70% is shown as due after service and is paid directly to the provider by the selected remaining-balance method. It is not automatically charged by this integration.

Downpayments enter the platform's PayMongo merchant account. This does not automatically split payments or transfer funds to individual providers. Arrange and reconcile provider settlement separately before accepting live payments.

Active checkout expiry is attempted after cancellation. If PayMongo is unavailable, the record stays `expire_pending`; retry cancellation once connectivity returns. Late paid notifications still go to refund review and never restore a canceled schedule. Unpaid pending requests retain the current slot-hold behavior; there is no automatic reservation deadline.

## Verification

Automated tests use fixture-only databases and mocked gateway responses, with no real payment or user-account writes. Local browser checks use the application's fallback fonts when Google Fonts is unreachable. A real PayMongo test-mode checkout and webhook delivery are still required after credentials are configured.

Official references: [Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout), [Webhook Setup and Signature Verification](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management), [E-Wallets](https://docs.paymongo.com/docs/payment-acceptance-e-wallets), [Payouts](https://docs.paymongo.com/docs/money-movement-payouts).
