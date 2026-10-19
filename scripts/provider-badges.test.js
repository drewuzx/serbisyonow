'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { providerBadge, gradeAssessment } = require('./provider-badges');
const { assessmentQuestionBanks } = require('../shared/js/providerAssessmentBank');
const { startQrFixture } = require('./provider-qr-test-fixture');
const { issueSession } = require('./account-sessions');

const verified = { is_verified: true, verification_status: 'verified', documents_files: ['certificate.pdf'], assessment_score: 100, rating: null, review_count: 0, completed_jobs: 0 };

test('70/20/10 breakdown: new providers cannot get Top-Rated', () => {
  const badge = providerBadge(verified);
  assert.equal(badge.assessment_points, 70);
  assert.equal(badge.credential_points, 20);
  assert.equal(badge.rating_points, 0);
  assert.equal(badge.total_points, 90);
  assert.equal(badge.badge, 'Skilled Verified');
  assert.equal(badge.average_rating, null);
  assert.equal(providerBadge({ ...verified, experience_years: '50 years' }).badge, 'Skilled Verified');
  assert.equal(providerBadge({ ...verified, assessment_score: 60 }).badge, 'Basic Verified');
  assert.equal(providerBadge({ ...verified, assessment_score: 80 }).total_points, 76);
  assert.equal(providerBadge({ ...verified, documents_files: [] }).total_points, 70);
});

test('Top-Rated requires every gate and uses unrounded thresholds', () => {
  const top = { ...verified, review_count: 5, completed_jobs: 5, rating: 4.5 };
  assert.equal(providerBadge(top).badge, 'Top-Rated');
  for (const override of [{ review_count: 4 }, { completed_jobs: 4 }, { rating: 4.49 }, { assessment_score: 85 }, { documents_files: [] }]) {
    assert.notEqual(providerBadge({ ...top, ...override }).badge, 'Top-Rated');
  }
  const borderline = providerBadge({ ...top, assessment_score: 87, rating: 4.549 });
  assert.equal(borderline.total_points, 89.99);
  assert.notEqual(borderline.badge, 'Top-Rated');
  assert.equal(providerBadge({ ...top, assessment_score: 50 }).badge, 'Needs Reassessment');
  assert.equal(providerBadge({ ...top, is_verified: false, verification_status: 'pending' }).badge, 'Pending Verification');
  assert.equal(providerBadge({ ...top, verification_status: 'rejected' }).credential_points, 0);
  assert.equal(providerBadge({ ...verified, assessment_score: 60, documents_files: [] }).badge, 'Not Yet Qualified');
});

test('assessment grades trusted answers, not client-provided scores or correct values', () => {
  const questions = assessmentQuestionBanks.Cleaning.slice(0, 10);
  const answers = questions.map(q => ({ question: q.q, answer: q.o.find(answer => answer !== q.a), correct: q.o.find(answer => answer !== q.a) }));
  assert.equal(gradeAssessment('Cleaning Services', answers).score, 0);
  const valid = questions.map(q => ({ question: q.q, answer: q.a }));
  assert.equal(gradeAssessment('Cleaning Services', valid).score, 100);
  assert.throws(() => gradeAssessment('Cleaning Services', [...valid.slice(1), valid[1]]), { statusCode: 400 });
  assert.throws(() => gradeAssessment('Cleaning Services', valid.slice(0, 9)), { statusCode: 400 });
  assert.throws(() => gradeAssessment('Personal Care', valid), { statusCode: 400 });
});

test('live API badges are consistent, review-backed and recalculate after review, upload and reassessment', async () => {
  const f = await startQrFixture();
  try {
    const signupQuestions = assessmentQuestionBanks.Cleaning.slice(0, 10);
    const signupAnswers = signupQuestions.map((q, index) => ({ question: q.q, answer: index < 6 ? q.a : q.o.find(a => a !== q.a), correct: 'untrusted' }));
    const registration = new FormData();
    for (const [key, value] of Object.entries({ fullName: 'Badge Signup Test', address: 'Test address', gender: 'Female', contact: '09123456789', dob: '2000-01-01', email: 'badge-signup@fixture.invalid', password: 'FixturePassword123', category: 'Cleaning', service: 'General House Cleaning', experienceYears: '20 years', experienceCertification: 'Certificate', experience: `Assessment score: 100%. Answers: ${JSON.stringify(signupAnswers)}` })) registration.append(key, value);
    const registered = await f.request('/api/auth/provider/register', 'POST', registration, null);
    assert.equal(registered.status, 201, JSON.stringify(registered.data));
    assert.equal(registered.data.user.assessment_score, 60, 'signup score is graded on the server');
    assert.equal(registered.data.user.badge_status, 'Pending Verification');
    await f.db.query("INSERT INTO admins (id, username, password_hash) VALUES (91, 'badge-admin', 'fixture')");
    const adminToken = await issueSession(f.db, 'admin', 91);
    await f.db.query("UPDATE providers SET documents_files = ARRAY['certificate.pdf'], experience_years = '20 years' WHERE id = 81");
    await f.db.query('UPDATE provider_skill_assessments SET score = 100 WHERE provider_id = 81');
    const dashboard = async () => (await f.request('/api/provider/81/dashboard', 'GET', undefined, f.providerToken)).data;
    assert.equal((await dashboard()).provider.badge_status, 'Skilled Verified');
    const bookings = [];
    for (const rating of [5, 5, 5, 4, 4]) {
      const booking = await f.createBooking({ status: 'completed' }); bookings.push(booking);
      await f.db.query('INSERT INTO customer_reviews (customer_id, provider_id, booking_id, rating, comment) VALUES (61, 81, $1, $2, $3)', [booking.id, rating, 'Completed-service review']);
    }
    const data = await dashboard();
    assert.equal(data.provider.badge_status, 'Top-Rated');
    assert.equal(data.provider.badge_details.total_points, 99.2);
    assert.equal(data.provider.badge_details.review_count, 5);
    assert.equal(data.metrics.badge_status, 'Top-Rated');
    assert.equal(data.assessment.badge, 'Top-Rated');
    await f.db.query('INSERT INTO customer_favorites (customer_id, provider_id) VALUES (61, 81)');
    for (const [url, select] of [
      ['/api/auth/provider/status/81', body => body.user],
      ['/api/auth/provider/session', body => body.user],
      ['/api/admin/providers?status=all', body => body.providers.find(p => p.id === 81)],
      ['/api/customer/61/favorites', body => body.favorites.find(p => p.id === 81)],
      ['/api/customer/61/dashboard', body => body.providers.find(p => p.id === 81)],
      ['/api/providers/search?sort=top', body => body.providers.find(p => p.id === 81)],
      ['/api/providers/search?sort=highest', body => body.providers.find(p => p.id === 81)],
      ['/api/providers/search?sort=basic', body => body.providers.find(p => p.id === 81)],
      ['/api/customer/61/recommendations', body => body.providers.find(p => p.id === 81)],
      ['/api/customer/61/location-map', body => body.providers.find(p => p.id === 81)],
    ]) {
      const response = await f.request(url, 'GET', undefined, url.startsWith('/api/admin/') ? adminToken : f.providerToken);
      assert.equal(response.status, 200, url + ': ' + JSON.stringify(response.data));
      assert.equal(select(response.data)?.badge_status, 'Top-Rated', url);
      assert.equal(select(response.data)?.badge_details.total_points, 99.2, url);
    }
    await f.db.query("UPDATE customer_bookings SET status = 'cancelled' WHERE id = $1", [bookings[0].id]);
    assert.equal((await dashboard()).provider.badge_status, 'Skilled Verified');
    assert.equal((await dashboard()).provider.review_count, 4);
    await f.db.query("UPDATE customer_bookings SET status = 'completed' WHERE id = $1", [bookings[0].id]);
    const pending = await f.createBooking();
    await f.db.query('INSERT INTO customer_reviews (customer_id, provider_id, booking_id, rating) VALUES (61, 81, $1, 1)', [pending.id]);
    assert.equal((await dashboard()).provider.review_count, 5);
    await f.db.query('UPDATE customer_reviews SET rating = 1 WHERE booking_id = $1', [bookings[0].id]);
    assert.equal((await dashboard()).provider.badge_status, 'Skilled Verified');
    await f.db.query('UPDATE customer_reviews SET rating = 5 WHERE booking_id = $1', [bookings[0].id]);

    const form = new FormData(); form.append('docs', new Blob([f.image], { type: 'image/png' }), 'new-proof.png');
    const upload = await f.request('/api/provider/81/credentials', 'PATCH', form, f.providerToken);
    assert.equal(upload.data.user.badge_status, 'Pending Verification');
    assert.equal(upload.data.user.badge_details.credential_points, 0);
    assert.equal((await f.request('/api/admin/providers/81/verify', 'PATCH', {}, f.providerToken)).status, 403);
    assert.equal((await f.request('/api/admin/providers/81/verify', 'PATCH', {}, null)).status, 401);
    const approved = await f.request('/api/admin/providers/81/verify', 'PATCH', {}, adminToken);
    assert.equal(approved.status, 200);
    assert.equal(approved.data.provider.badge_status, 'Top-Rated');
    const questions = assessmentQuestionBanks.Cleaning.slice(0, 10);
    const answers = questions.map(q => ({ question: q.q, answer: q.o.find(a => a !== q.a), correct: q.o.find(a => a !== q.a) }));
    assert.equal((await f.request('/api/provider/81/reassessment', 'POST', { score: 100, answers }, f.otherProviderToken)).status, 403);
    const failed = await f.request('/api/provider/81/reassessment', 'POST', { category: 'Cleaning', score: 100, answers }, f.providerToken);
    assert.equal(failed.status, 200);
    assert.equal(failed.data.assessment.score, 0);
    assert.equal(failed.data.user.badge_status, 'Needs Reassessment');
    assert.equal((await f.request('/api/admin/providers/81/verify', 'PATCH', {}, adminToken)).status, 400);
    const passed = await f.request('/api/provider/81/reassessment', 'POST', { answers: questions.map(q => ({ question: q.q, answer: q.a })) }, f.providerToken);
    assert.equal(passed.data.user.badge_status, 'Top-Rated');
    const rejected = await f.request('/api/admin/providers/81/reject', 'PATCH', {}, adminToken);
    assert.equal(rejected.data.provider.badge_status, 'Verification Declined');
    assert.equal(rejected.data.provider.badge_details.credential_points, 0);
  } finally { await f.close(); }
});
