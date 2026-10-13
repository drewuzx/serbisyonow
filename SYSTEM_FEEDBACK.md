# System Ratings

Customer and provider pages load the shared rating widget through `pwa-register.js`.
The star launcher sits above the existing chat button. Ratings are separate from
provider/service reviews and are stored in `admin_feedback` with `source = system`.

## Prompt Behavior

- First automatic prompt: a random 45-90 second delay, then waits for user inactivity.
- No automatic prompt while an input is focused, a chat is open, or a modal is open.
- Dismissed/shown prompts: a seven-day local cooldown, scoped to role and account.
- Submitted ratings: a 30-day server-enforced cooldown, including other devices.
- The star launcher can open the form manually. After submission it shows thanks.
- Live data refresh does not rebuild the form or erase a draft. Failed submissions
  retain the rating and comment; retries use an idempotency ID.

## API and Admin

`GET /api/system-feedback?role=customer|provider` returns the next eligible prompt
time for the authenticated account. `POST /api/system-feedback` accepts `role`,
integer `rating` (1-5), optional `comment` (up to 2,000 characters), and a UUID v4
`submission_id`. The server derives the name and account ID from the session.

Admin > Feedback displays every submission, including positive and low ratings.
It supports source, account-type, and star-rating filters and the existing review
status workflow. The feedback endpoints require an admin session. Admins signed
in before this release need to use Admin Login once to obtain that session;
customer/provider sessions are not cleared.

`feedback-schema.sql` is applied on server startup and by the database initializer.
It only adds feedback fields/indexes and extends the session-role constraint for
admin sessions. No accounts, bookings, reviews, or payments are deleted.

## Verification

- `node --test scripts/system-feedback.test.js`
- `node scripts/system-feedback.browser-test.js` (Playwright runtime required)

Both suites use the existing isolated local-PostgreSQL fixture and refuse hosted
database URLs. They never submit feedback or payments to the live website.

The star and close icons are vendored from Lucide 0.468.0; their license is in
`shared/icons/lucide/LICENSE`.
