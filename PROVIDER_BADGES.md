# Provider Badge Rules

The Skill Assessment page and provider badges use one server-side calculation in `scripts/provider-badges.js`.

## Score

- Assessment: latest assessment percentage multiplied by 70%, maximum 70 points.
- Supporting credentials: 20 points only when supporting documents exist and the provider is admin-verified. Uploading new credentials returns verification to pending and removes these points until reviewed.
- Customer ratings: average eligible rating divided by 5, multiplied by 10. No reviews means 0 rating points.
- Only reviews tied to that provider's completed booking and the matching customer count. A booking counts at most once.

## Badges

All verified badges require a passing assessment of at least 60% and admin verification.

| Badge | Minimum total | Additional conditions |
| --- | --- | --- |
| Basic Verified | 60 | Common verification requirements |
| Skilled Verified | 80 | Common verification requirements |
| Top-Rated | 90 | At least 5 completed services, 5 eligible reviews, and a 4.5/5 average |

A new provider with a 100% assessment and approved documents earns 70 + 20 + 0 = 90 points, but remains Skilled Verified until the service and review requirements are met. Self-reported experience does not award points. Providers who do not meet a prerequisite see Needs Reassessment, Pending Verification, Verification Declined, or Not Yet Qualified instead of an unearned verified badge.

Badges are computed on reads, so existing badges update to these rules without changing historical assessment scores. Admin approval no longer overwrites assessment history. Assessment submission is authenticated and graded against the shared question bank on the server, ignoring submitted score and answer-key values.

## Verification

`node --test scripts/provider-badges.test.js` covers thresholds, server grading, signup, credential review, review eligibility, and consistent results across provider, customer, and admin APIs.

`node scripts/provider-badges.browser-test.js` checks responsive layouts, idle updates, pending-document state, reassessment, customer labels, and login persistence using an isolated local test database. Playwright must be available through the workspace runtime.
