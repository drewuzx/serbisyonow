'use strict';

const { assessmentQuestionBanks, fallbackQuestionBank } = require('../shared/js/providerAssessmentBank');
const { fail } = require('./booking-payments');

const RULES = Object.freeze({ assessment_weight: 70, credentials_weight: 20, ratings_weight: 10, passing_assessment: 60, basic_points: 60, skilled_points: 80, top_points: 90, top_completed_services: 5, top_reviews: 5, top_average_rating: 4.5 });
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = value => Math.floor((value + 1e-9) * 100) / 100;

function providerBadge(data = {}) {
  const score = Math.max(0, Math.min(100, number(data.assessment_score)));
  const verified = data.is_verified === true && data.verification_status === 'verified';
  const documents = Array.isArray(data.documents_files) ? data.documents_files.filter(Boolean).length : 0;
  const documentsApproved = verified && documents > 0;
  const reviews = Math.max(0, Math.floor(number(data.review_count)));
  const completed = Math.max(0, Math.floor(number(data.completed_jobs)));
  const average = reviews ? Math.max(0, Math.min(5, number(data.rating))) : null;
  const assessmentPoints = score * RULES.assessment_weight / 100;
  const credentialPoints = documentsApproved ? RULES.credentials_weight : 0;
  const ratingPoints = average === null ? 0 : average / 5 * RULES.ratings_weight;
  const total = assessmentPoints + credentialPoints + ratingPoints;
  const requirements = [
    { key: 'assessment', label: 'Assessment score of at least 60%', met: score >= RULES.passing_assessment },
    { key: 'verification', label: 'Admin verification approved', met: verified },
    { key: 'score', label: 'Badge score of at least 90 points', met: total >= RULES.top_points },
    { key: 'completed', label: 'At least 5 completed services', met: completed >= RULES.top_completed_services },
    { key: 'reviews', label: 'At least 5 completed-service reviews', met: reviews >= RULES.top_reviews },
    { key: 'rating', label: 'Average customer rating of at least 4.5/5', met: average !== null && average >= RULES.top_average_rating },
  ];
  let badge = 'Not Yet Qualified';
  if (score < RULES.passing_assessment) badge = 'Needs Reassessment';
  else if (!verified) badge = data.verification_status === 'rejected' ? 'Verification Declined' : 'Pending Verification';
  else if (requirements.every(item => item.met)) badge = 'Top-Rated';
  else if (total >= RULES.skilled_points) badge = 'Skilled Verified';
  else if (total >= RULES.basic_points) badge = 'Basic Verified';
  return {
    badge, tier: badge === 'Top-Rated' ? 'top' : badge === 'Skilled Verified' ? 'skilled' : badge === 'Basic Verified' ? 'basic' : 'unqualified',
    total_points: round(total), assessment_score: score, assessment_points: round(assessmentPoints), credential_points: credentialPoints,
    rating_points: round(ratingPoints), admin_verified: verified, document_count: documents, documents_approved: documentsApproved,
    review_count: reviews, completed_jobs: completed, average_rating: average === null ? null : round(average),
    top_rated_requirements: requirements, rules: RULES,
  };
}

async function loadProviderBadgeData(db, rows) {
  const ids = [...new Set(rows.map(row => Number(row.id)).filter(Number.isSafeInteger))];
  if (!ids.length) return rows;
  const result = await db.query(`
    SELECT p.id, p.is_verified, p.verification_status, p.documents_files,
      COALESCE(a.score, NULLIF(substring(p.experience FROM 'Assessment score: ([0-9]{1,3})%'), '')::int, 0) AS assessment_score,
      a.created_at AS assessed_at, jobs.completed_jobs, reviews.review_count, reviews.rating
    FROM providers p
    LEFT JOIN LATERAL (
      SELECT score, created_at FROM provider_skill_assessments WHERE provider_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1
    ) a ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS completed_jobs FROM customer_bookings WHERE provider_id = p.id AND status = 'completed'
    ) jobs ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS review_count, AVG(r.rating)::numeric AS rating
      FROM (SELECT DISTINCT ON (r.booking_id) r.booking_id, r.rating FROM customer_reviews r
        JOIN customer_bookings b ON b.id = r.booking_id AND b.provider_id = r.provider_id AND b.customer_id = r.customer_id
        WHERE r.provider_id = p.id AND b.status = 'completed' AND r.rating BETWEEN 1 AND 5
        ORDER BY r.booking_id, r.created_at DESC, r.id DESC) r
    ) reviews ON TRUE
    WHERE p.id = ANY($1::int[])
  `, [ids]);
  const stats = new Map(result.rows.map(row => [Number(row.id), row]));
  return rows.map(row => {
    const data = { ...row, ...stats.get(Number(row.id)) };
    const details = providerBadge(data);
    return { ...row, assessment_score: details.assessment_score, badge_status: details.badge, verified_tier: details.tier,
      badge_details: details, rating: details.average_rating, review_count: details.review_count, completed_jobs: details.completed_jobs,
      assessed_at: data.assessed_at || null };
  });
}

function gradeAssessment(category, submitted) {
  const aliases = { 'Cleaning Services': 'Cleaning', Repairs: 'Repair Services', 'Home Repairs': 'Repair Services', 'Appliance Repair': 'Appliance Maintenance', Installation: 'Installation Services', 'Home Installation': 'Installation Services', 'Outdoor Maintenance': 'Outdoor and Property Maintenance' };
  const bank = assessmentQuestionBanks[aliases[category] || category] || fallbackQuestionBank;
  if (!Array.isArray(submitted) || submitted.length !== Math.min(10, bank.length)) fail(400, 'Complete every assessment question before submitting.');
  const seen = new Set();
  const answers = submitted.map(answer => {
    const question = bank.find(item => item.q === answer?.question);
    if (!question || seen.has(question.q) || !question.o.includes(answer.answer)) fail(400, 'Assessment answers do not match the provider category. Please retake the assessment.');
    seen.add(question.q);
    return { question: question.q, answer: answer.answer, correct: question.a };
  });
  const score = Math.round(answers.filter(item => item.answer === item.correct).length / answers.length * 100);
  return { score, answers, experience: `Assessment score: ${score}%. Answers: ${JSON.stringify(answers)}` };
}

module.exports = { RULES, providerBadge, loadProviderBadgeData, gradeAssessment };
