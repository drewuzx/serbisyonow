'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
app.set('trust proxy', true);

const PORT = Number(process.env.PORT || 3000);
const rootDir = path.resolve(__dirname, '..');
const uploadDir = path.join(rootDir, 'uploads');
const configuredFrontendBaseUrl = cleanBaseUrl(process.env.FRONTEND_BASE_URL);
const configuredApiBaseUrl = cleanBaseUrl(process.env.API_PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL);
const frontendBaseUrl = configuredFrontendBaseUrl || 'http://127.0.0.1:5500';
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleAuthTickets = new Map();
const passwordResetTtlMinutes = Math.max(10, Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60));

for (const dir of [
  path.join(uploadDir, 'customer-ids'),
  path.join(uploadDir, 'provider-docs'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const folder = file.fieldname === 'docs' ? 'provider-docs' : 'customer-ids';
    cb(null, path.join(uploadDir, folder));
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname || '');
    const safeBase = path.basename(file.originalname || 'upload', ext)
      .replace(/[^a-z0-9_-]+/gi, '-')
      .slice(0, 40);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const UPLOAD_FOLDERS = new Set(['customer-ids', 'provider-docs']);

const FIELD_LABELS = {
  provider_id: 'Service provider',
  service: 'Service',
  scheduled_date: 'Preferred date',
  scheduled_time: 'Available time slot',
  address: 'Service address',
  fullName: 'Full name',
  full_name: 'Full name',
  idType: 'ID type',
  idAddress: 'Address on ID',
  currentPassword: 'Current password',
  newPassword: 'New password',
  email: 'Email address',
  password: 'Password',
  token: 'Reset token',
  role: 'Account type',
  available_date: 'Available date',
  start_time: 'Start time',
  end_time: 'End time',
  customer_id: 'Customer',
  message: 'Message',
};

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

app.get('/uploads/:folder/:filename', asyncRoute(async (req, res) => {
  const folder = String(req.params.folder || '').trim();
  const filename = String(req.params.filename || '').trim();
  if (!UPLOAD_FOLDERS.has(folder) || !filename || filename.includes('/') || filename.includes('\\')) {
    return res.status(404).type('text/plain').send('Uploaded file not found.');
  }

  const result = await db.query(
    `SELECT original_name, mime_type, size_bytes, content
     FROM uploaded_files
     WHERE folder = $1 AND filename = $2
     LIMIT 1`,
    [folder, filename]
  );

  const file = result.rows[0];
  if (!file) {
    return res.status(404).type('text/plain').send(
      'Uploaded file is not available. This file may have been uploaded before persistent upload storage was enabled.'
    );
  }

  res.type(file.mime_type || 'application/octet-stream');
  res.set('Cache-Control', 'private, max-age=3600');
  res.set('Content-Disposition', `inline; filename="${String(file.original_name || filename).replace(/["\r\n]/g, '')}"`);
  if (file.size_bytes) res.set('Content-Length', String(file.size_bytes));
  res.send(file.content);
}));

app.get('/', (_req, res) => {
  res.redirect('/pages/landing/index.html');
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, app: 'SerbisyoNow' });
});

app.use(express.static(rootDir));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function publicBaseUrl(req) {
  const host = req.get('host');
  if (!host) return configuredApiBaseUrl || `http://localhost:${PORT}`;
  return `${req.protocol}://${host}`;
}

function requestGoogleRedirectUri(req) {
  return cleanBaseUrl(process.env.GOOGLE_REDIRECT_URI)
    || `${configuredApiBaseUrl || publicBaseUrl(req)}/api/auth/google/callback`;
}

function requireFields(source, fields) {
  for (const field of fields) {
    if (!String(source[field] || '').trim()) {
      const error = new Error(`${FIELD_LABELS[field] || field.replaceAll('_', ' ')} is required.`);
      error.statusCode = 400;
      throw error;
    }
  }
}

function takeGoogleTicket(ticket) {
  const item = googleAuthTickets.get(ticket);
  if (!item) return null;
  googleAuthTickets.delete(ticket);
  if (Date.now() > item.expiresAt) return null;
  return item;
}

function createGoogleTicket(payload) {
  const ticket = crypto.randomBytes(24).toString('hex');
  googleAuthTickets.set(ticket, {
    ...payload,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return ticket;
}

function googleRegisterPath(role) {
  return role === 'provider'
    ? '/pages/auth/providerRegister.html'
    : '/pages/auth/customerRegister.html';
}

function requestFrontendBase(req) {
  const candidate = req.query.frontend || req.get('referer') || req.get('origin') || '';
  try {
    const parsed = new URL(candidate);
    return parsed.origin;
  } catch {
    return configuredFrontendBaseUrl || publicBaseUrl(req);
  }
}

function googleDashboardPath(role) {
  return role === 'provider'
    ? '/pages/provider/dashboard/dashboard.html'
    : '/pages/customer/dashboard/dashboard.html';
}

function registrationPassword(value) {
  const password = String(value || '');
  if (password.length < 8) {
    const error = new Error('Password must be at least 8 characters.');
    error.statusCode = 400;
    error.field = 'password';
    throw error;
  }
  return password;
}

function normalizeContactNumber(value) {
  const contact = String(value || '').trim();
  if (!/^\d{11}$/.test(contact)) {
    const error = new Error('Contact number must be exactly 11 digits.');
    error.statusCode = 400;
    error.field = 'contact';
    throw error;
  }
  return contact;
}

async function buildRegistrationPasswordHash(req) {
  return bcrypt.hash(registrationPassword(req.body.password), 12);
}

async function ensureUniqueAccountEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await db.query(`
    SELECT email FROM customers WHERE lower(email) = lower($1::text)
    UNION ALL
    SELECT email FROM providers WHERE lower(email) = lower($1::text)
    LIMIT 1
  `, [normalizedEmail]);

  if (existing.rowCount) {
    const error = new Error('This email address is already registered. Please use a different email.');
    error.statusCode = 409;
    error.field = 'email';
    throw error;
  }
}

function normalizeAccountRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'customer' || role === 'provider') return role;
  const error = new Error('Choose customer or provider reset.');
  error.statusCode = 400;
  error.field = 'role';
  throw error;
}

function accountTable(role) {
  return role === 'provider' ? 'providers' : 'customers';
}

function passwordResetLoginPath(role) {
  return role === 'provider'
    ? '/pages/auth/providerLogin.html'
    : '/pages/auth/customerLogin.html';
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function canExposeResetLink(req) {
  if (process.env.ALLOW_RESET_LINK_IN_RESPONSE === 'true') return true;
  if (process.env.NODE_ENV === 'production') return false;
  const host = String(req.hostname || '').toLowerCase();
  return ['localhost', '127.0.0.1', '::1'].includes(host);
}

function smtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const rawPass = String(process.env.SMTP_PASS || '').trim();
  const pass = /^smtp\.gmail\.com$/i.test(host) ? rawPass.replace(/\s+/g, '') : rawPass;
  return {
    host,
    user,
    pass,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    from: String(process.env.SMTP_FROM || user || 'SerbisyoNow <no-reply@serbisyonow.local>').trim(),
    configured: Boolean(host && user && pass),
  };
}

function resendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.RESEND_FROM || process.env.SMTP_FROM || 'SerbisyoNow <onboarding@resend.dev>').trim();
  return {
    apiKey,
    from,
    configured: Boolean(apiKey && from),
  };
}

function brevoConfig() {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  const senderEmail = String(process.env.BREVO_SENDER_EMAIL || '').trim();
  const senderName = String(process.env.BREVO_SENDER_NAME || 'SerbisyoNow').trim();
  return {
    apiKey,
    senderEmail,
    senderName,
    configured: Boolean(apiKey && senderEmail),
  };
}

function gmailApiConfig() {
  const clientId = String(process.env.GMAIL_API_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GMAIL_API_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GMAIL_API_REFRESH_TOKEN || '').trim();
  const from = String(process.env.GMAIL_API_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  return {
    clientId,
    clientSecret,
    refreshToken,
    from,
    configured: Boolean(clientId && clientSecret && refreshToken && from),
  };
}

function emailDeliveryConfigured() {
  return gmailApiConfig().configured
    || brevoConfig().configured
    || resendConfig().configured
    || smtpConfig().configured;
}

function smtpTimeoutMs(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 3000 ? value : fallback;
}

function smtpTransportOptions(config, override = {}) {
  return {
    host: config.host,
    port: override.port || config.port,
    secure: override.secure ?? config.secure,
    dnsTimeout: smtpTimeoutMs('SMTP_DNS_TIMEOUT_MS', 10000),
    connectionTimeout: smtpTimeoutMs('SMTP_CONNECTION_TIMEOUT_MS', 12000),
    greetingTimeout: smtpTimeoutMs('SMTP_GREETING_TIMEOUT_MS', 12000),
    socketTimeout: smtpTimeoutMs('SMTP_SOCKET_TIMEOUT_MS', 15000),
    requireTLS: (override.port || config.port) === 587,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  };
}

function smtpFallbackOptions(config) {
  const attempts = [smtpTransportOptions(config)];
  const isGmailSmtp = /(^|\.)gmail\.com$/i.test(config.host) || /^smtp\.gmail\.com$/i.test(config.host);
  if (isGmailSmtp && config.port !== 465) {
    attempts.push(smtpTransportOptions(config, { port: 465, secure: true }));
  }
  if (isGmailSmtp && config.port !== 587) {
    attempts.push(smtpTransportOptions(config, { port: 587, secure: false }));
  }
  return attempts;
}

function publicSmtpError(error) {
  const code = String(error?.code || '');
  const responseCode = Number(error?.responseCode || 0);

  if (code === 'MODULE_NOT_FOUND') {
    return 'Email package is missing. Run npm install, push the lockfile, and redeploy Render.';
  }

  if (code === 'EAUTH' || responseCode === 534 || responseCode === 535) {
    return 'Gmail rejected the SMTP login. Use the 16-character Google App Password from the same Gmail account, and make sure 2-Step Verification is enabled.';
  }

  if (responseCode === 550 || responseCode === 553) {
    return 'Gmail rejected the sender address. Make SMTP_FROM use the same Gmail as SMTP_USER.';
  }

  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'EDNS'].includes(code)) {
    return 'The server could not complete the Gmail SMTP connection. Try SMTP_PORT=465 with SMTP_SECURE=true, then restart or redeploy.';
  }

  return 'Gmail SMTP failed. Check the Render logs for the SMTP code, then verify SMTP_USER, SMTP_PASS, and SMTP_FROM.';
}

function publicResendError(status, data) {
  const message = String(data?.message || data?.error || '').toLowerCase();
  if (status === 401 || status === 403) {
    return 'Resend rejected the API key. Check RESEND_API_KEY in Render Environment.';
  }
  if (status === 422 && (message.includes('domain') || message.includes('from'))) {
    return 'Resend rejected the sender. Use a verified sender/domain for RESEND_FROM.';
  }
  if (status === 429) {
    return 'Resend rate limit reached. Wait and try again, or check your Resend account limits.';
  }
  return 'Resend email API failed. Check RESEND_API_KEY and RESEND_FROM.';
}

function publicBrevoError(status, data) {
  const message = String(data?.message || data?.error || '').toLowerCase();
  if (status === 401 || status === 403) {
    return 'Brevo rejected the API key. Check BREVO_API_KEY in Render Environment.';
  }
  if (status === 400 && (message.includes('sender') || message.includes('from'))) {
    return 'Brevo rejected the sender. Verify BREVO_SENDER_EMAIL in Brevo, then try again.';
  }
  if (status === 429) {
    return 'Brevo rate limit reached. Wait and try again, or check your Brevo free daily limit.';
  }
  return 'Brevo email API failed. Check BREVO_API_KEY and BREVO_SENDER_EMAIL.';
}

function publicGmailApiError(status, data, phase = 'send') {
  const message = String(data?.error_description || data?.error?.message || data?.error || '').toLowerCase();
  if (message.includes('invalid_grant')) {
    return 'Google rejected the Gmail API refresh token. Create a new refresh token with the Gmail send scope, then redeploy.';
  }
  if (status === 400 && phase === 'token') {
    return 'Google rejected the Gmail API token request. Check GMAIL_API_CLIENT_ID, GMAIL_API_CLIENT_SECRET, and GMAIL_API_REFRESH_TOKEN.';
  }
  if (status === 401 || status === 403) {
    return 'Gmail API permission failed. Enable Gmail API and use a refresh token created with the gmail.send scope.';
  }
  if (status === 429) {
    return 'Gmail API sending limit reached. Wait and try again later.';
  }
  return 'Gmail API email failed. Check the Gmail API env vars and Render logs.';
}

function isEmailLike(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function passwordResetUrl(req, token) {
  const base = configuredFrontendBaseUrl || requestFrontendBase(req) || publicBaseUrl(req);
  return `${base}/pages/auth/resetPassword.html?token=${encodeURIComponent(token)}`;
}

function passwordResetEmailMessage({ from, to, role, resetUrl }) {
  const accountLabel = role === 'provider' ? 'provider' : 'customer';
  return {
    from,
    to,
    subject: 'Reset your SerbisyoNow password',
    text: [
      `We received a password reset request for your SerbisyoNow ${accountLabel} account.`,
      '',
      `Open this link within ${passwordResetTtlMinutes} minutes:`,
      resetUrl,
      '',
      'If you did not request this, you can ignore this email.',
    ].join('\n'),
    html: `
      <p>We received a password reset request for your SerbisyoNow ${accountLabel} account.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in ${passwordResetTtlMinutes} minutes.</p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  };
}

function cleanEmailHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function base64UrlEncode(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function gmailRawMessage(message) {
  const boundary = `serbisyonow_${crypto.randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${cleanEmailHeader(message.from)}`,
    `To: ${cleanEmailHeader(message.to)}`,
    `Subject: ${cleanEmailHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.text,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    message.html,
    `--${boundary}--`,
    '',
  ];

  return base64UrlEncode([...headers, '', ...body].join('\r\n'));
}

async function gmailApiAccessToken(config) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || 'Gmail API token request failed.');
    error.code = 'GMAIL_API_TOKEN_ERROR';
    error.responseCode = response.status;
    error.publicMessage = publicGmailApiError(response.status, data, 'token');
    throw error;
  }

  return data.access_token;
}

async function sendPasswordResetWithGmailApi({ to, role, resetUrl }) {
  const config = gmailApiConfig();
  if (!config.configured) return { sent: false, reason: 'gmail_api_not_configured' };

  const message = passwordResetEmailMessage({
    from: config.from,
    to,
    role,
    resetUrl,
  });

  const accessToken = await gmailApiAccessToken(config);
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: gmailRawMessage(message) }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || data.error || 'Gmail API send failed.');
    error.code = 'GMAIL_API_SEND_ERROR';
    error.responseCode = response.status;
    error.publicMessage = publicGmailApiError(response.status, data, 'send');
    throw error;
  }

  return { sent: true, provider: 'gmail_api', id: data.id || null };
}

async function sendPasswordResetWithResend({ to, role, resetUrl }) {
  const config = resendConfig();
  if (!config.configured) return { sent: false, reason: 'resend_not_configured' };

  const message = passwordResetEmailMessage({
    from: config.from,
    to,
    role,
    resetUrl,
  });

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Resend email API failed.');
    error.code = 'RESEND_API_ERROR';
    error.responseCode = response.status;
    error.publicMessage = publicResendError(response.status, data);
    throw error;
  }

  return { sent: true, provider: 'resend', id: data.id || null };
}

async function sendPasswordResetWithBrevo({ to, role, resetUrl }) {
  const config = brevoConfig();
  if (!config.configured) return { sent: false, reason: 'brevo_not_configured' };

  const message = passwordResetEmailMessage({
    from: `${config.senderName} <${config.senderEmail}>`,
    to,
    role,
    resetUrl,
  });

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: {
        name: config.senderName,
        email: config.senderEmail,
      },
      to: [{ email: message.to }],
      subject: message.subject,
      htmlContent: message.html,
      textContent: message.text,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error || 'Brevo email API failed.');
    error.code = 'BREVO_API_ERROR';
    error.responseCode = response.status;
    error.publicMessage = publicBrevoError(response.status, data);
    throw error;
  }

  return { sent: true, provider: 'brevo', id: data.messageId || null };
}

async function sendPasswordResetWithSmtp({ to, role, resetUrl }) {
  const config = smtpConfig();
  if (!config.configured) return { sent: false, reason: 'smtp_not_configured' };

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (error) {
    error.message = 'Email sending needs nodemailer installed. Run npm install and redeploy.';
    throw error;
  }

  const message = passwordResetEmailMessage({
    from: config.from,
    to,
    role,
    resetUrl,
  });

  let lastError;
  for (const options of smtpFallbackOptions(config)) {
    try {
      const transporter = nodemailer.createTransport(options);
      await transporter.sendMail(message);
      return { sent: true };
    } catch (error) {
      lastError = error;
      const responseCode = Number(error?.responseCode || 0);
      if (String(error?.code || '') === 'EAUTH' || responseCode === 534 || responseCode === 535) break;
    }
  }

  if (lastError) {
    lastError.publicMessage = publicSmtpError(lastError);
    throw lastError;
  }

  return { sent: false };
}

async function sendPasswordResetEmail(args) {
  if (gmailApiConfig().configured) return sendPasswordResetWithGmailApi(args);
  if (brevoConfig().configured) return sendPasswordResetWithBrevo(args);
  if (resendConfig().configured) return sendPasswordResetWithResend(args);
  if (smtpConfig().configured) return sendPasswordResetWithSmtp(args);
  return { sent: false, reason: 'not_configured' };
}

function clampScore(value) {
  const score = Number.parseInt(value, 10);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function extractAssessmentScore(experienceText) {
  const match = String(experienceText || '').match(/assessment\s*score\s*:\s*(\d{1,3})\s*%/i);
  return clampScore(match?.[1]);
}

function hasAssessmentSubmission(experienceText) {
  const text = String(experienceText || '');
  return /assessment\s*score\s*:\s*\d{1,3}\s*%/i.test(text) && /answers\s*:/i.test(text);
}

function parseExperienceYears(label) {
  const value = String(label || '').toLowerCase();
  if (value.includes('less') || value.includes('below')) return { min: 0, max: 1 };
  if (value.includes('5+')) return { min: 5, max: 99 };

  const numbers = value.match(/\d+/g)?.map(Number) || [];
  if (numbers.length >= 2) return { min: numbers[0], max: numbers[1] };
  if (numbers.length === 1) return { min: numbers[0], max: numbers[0] };
  return { min: 0, max: 0 };
}

function calculateProviderBadge(scoreValue, experienceYears) {
  const score = clampScore(scoreValue);
  const years = parseExperienceYears(experienceYears);

  if (score >= 80 && years.min >= 3) return 'Top-Tier Verified';
  if (score >= 70 && years.max >= 2) return 'Skilled Verified';
  if (score >= 60) return 'Basic Verified';
  return 'Needs Reassessment';
}

function providerTierFromBadge(badge) {
  const value = String(badge || '').toLowerCase();
  if (value.includes('top')) return 'top';
  if (value.includes('skilled')) return 'skilled';
  return 'basic';
}

const LOCATION_POINTS = [
  { tokens: ['balibago'], lat: 15.1667, lng: 120.5886 },
  { tokens: ['malabanias'], lat: 15.1585, lng: 120.5889 },
  { tokens: ['pampang'], lat: 15.1592, lng: 120.6173 },
  { tokens: ['sto. entierro', 'santo entierro', 'entierro'], lat: 15.1487, lng: 120.5908 },
  { tokens: ['clark'], lat: 15.1859, lng: 120.5390 },
  { tokens: ['cutcut'], lat: 15.1450, lng: 120.5939 },
  { tokens: ['pulungbulu'], lat: 15.1337, lng: 120.5903 },
  { tokens: ['lourdes'], lat: 15.1426, lng: 120.5987 },
  { tokens: ['sapangbato'], lat: 15.1930, lng: 120.5044 },
  { tokens: ['angeles'], lat: 15.1450, lng: 120.5887 },
  { tokens: ['san fernando'], lat: 15.0342, lng: 120.6844 },
  { tokens: ['mabalacat'], lat: 15.2230, lng: 120.5792 },
  { tokens: ['pampanga'], lat: 15.0794, lng: 120.6200 },
];

function inferGeoPoint(address) {
  const value = String(address || '').toLowerCase();
  const match = LOCATION_POINTS.find((point) => point.tokens.some((token) => value.includes(token)));
  if (match) return { lat: match.lat, lng: match.lng, source: match.tokens[0] };

  let hash = 0;
  for (const char of value || 'angeles') hash = ((hash << 5) - hash) + char.charCodeAt(0);
  const offsetA = ((Math.abs(hash) % 800) - 400) / 100000;
  const offsetB = ((Math.abs(hash >> 3) % 800) - 400) / 100000;
  return { lat: 15.1450 + offsetA, lng: 120.5887 + offsetB, source: 'estimated' };
}

function geoPointFromRow(row) {
  const lat = Number(row?.latitude);
  const lng = Number(row?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng, source: 'saved-gps' };
  }
  return inferGeoPoint(row?.address);
}

function uploadedFileFolder(file) {
  return file?.fieldname === 'docs' ? 'provider-docs' : 'customer-ids';
}

function requestUploadedFiles(req) {
  return Object.values(req.files || {}).flat().filter(Boolean);
}

async function persistUploadedFile(file, owner = {}) {
  const folder = uploadedFileFolder(file);
  if (!UPLOAD_FOLDERS.has(folder) || !file?.filename || !file?.path) return;

  const content = await fs.promises.readFile(file.path);
  await db.query(`
    INSERT INTO uploaded_files
      (folder, filename, original_name, mime_type, size_bytes, content, owner_role, owner_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (folder, filename) DO UPDATE
    SET original_name = EXCLUDED.original_name,
        mime_type = EXCLUDED.mime_type,
        size_bytes = EXCLUDED.size_bytes,
        content = EXCLUDED.content,
        owner_role = COALESCE(EXCLUDED.owner_role, uploaded_files.owner_role),
        owner_id = COALESCE(EXCLUDED.owner_id, uploaded_files.owner_id),
        updated_at = NOW()
  `, [
    folder,
    file.filename,
    file.originalname || file.filename,
    file.mimetype || 'application/octet-stream',
    Number(file.size || content.length),
    content,
    owner.role || null,
    owner.id || null,
  ]);
}

async function persistRequestUploads(req, owner = {}) {
  const files = requestUploadedFiles(req);
  if (!files.length) return;
  await Promise.all(files.map((file) => persistUploadedFile(file, owner)));
}

async function backfillUploadFolderFromDisk(folder) {
  const folderPath = path.join(uploadDir, folder);
  let names = [];
  try {
    names = await fs.promises.readdir(folderPath);
  } catch {
    return;
  }

  await Promise.all(names.map(async (filename) => {
    const filePath = path.join(folderPath, filename);
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat?.isFile()) return;
    const content = await fs.promises.readFile(filePath);
    await db.query(`
      INSERT INTO uploaded_files
        (folder, filename, original_name, mime_type, size_bytes, content)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (folder, filename) DO NOTHING
    `, [
      folder,
      filename,
      filename,
      mimeTypeFromFilename(filename),
      stat.size,
      content,
    ]);
  }));
}

async function backfillUploadedFilesFromDisk() {
  await Promise.all([...UPLOAD_FOLDERS].map((folder) => backfillUploadFolderFromDisk(folder)));
}

function mimeTypeFromFilename(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function distanceKm(a, b) {
  const toRad = (value) => Number(value) * Math.PI / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const deltaLat = toRad(b.lat - a.lat);
  const deltaLng = toRad(b.lng - a.lng);
  const h = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isLiveTrackableStatus(status) {
  return ['upcoming', 'ongoing'].includes(String(status || '').toLowerCase());
}

function formatOsrmInstruction(step) {
  const maneuver = step?.maneuver || {};
  const type = String(maneuver.type || '');
  const modifier = String(maneuver.modifier || '').replace(/_/g, ' ');
  const road = String(step?.name || '').trim() || 'the road';
  if (type === 'depart') return `Head ${modifier || 'out'} on ${road}`;
  if (type === 'arrive') return `Arrive at the customer pin`;
  if (type === 'roundabout' || type === 'rotary') return `Enter the roundabout and continue on ${road}`;
  if (type.startsWith('turn') || type === 'new name' || type === 'continue') {
    return `${modifier ? `Turn ${modifier}` : 'Continue'} onto ${road}`;
  }
  if (type === 'merge' || type === 'on ramp' || type === 'off ramp' || type === 'fork') {
    return `${modifier ? `${type} ${modifier}` : type} onto ${road}`;
  }
  return `${type.replace(/_/g, ' ') || 'Continue'} on ${road}`;
}

async function fetchDrivingDirections(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'SerbisyoNow/1.0' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(data.message || 'Unable to build driving directions.');
  }
  const route = data.routes[0];
  const steps = (route.legs || []).flatMap((leg) => (leg.steps || []).map((step) => ({
    instruction: formatOsrmInstruction(step),
    distance_m: Number(step.distance || 0),
    duration_s: Number(step.duration || 0),
    name: step.name || '',
    maneuver: step.maneuver?.type || '',
  })));
  return {
    distance_m: Number(route.distance || 0),
    duration_s: Number(route.duration || 0),
    geometry: route.geometry || null,
    steps,
  };
}

function customerRow(row) {
  return {
    role: 'customer',
    id: row.id,
    full_name: row.full_name,
    fullName: row.full_name,
    address: row.address,
    gender: row.gender,
    contact: row.contact,
    dob: row.dob,
    email: row.email,
    id_type: row.id_type,
    id_address: row.id_address,
    id_front_file: row.id_front_file,
    id_back_file: row.id_back_file,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    location_accuracy_m: row.location_accuracy_m === null || row.location_accuracy_m === undefined ? null : Number(row.location_accuracy_m),
    location_updated_at: row.location_updated_at || null,
    is_verified: row.is_verified,
    verification_status: row.verification_status,
    created_at: row.created_at,
  };
}

function providerRow(row) {
  const assessmentScore = row.assessment_score === undefined
    ? extractAssessmentScore(row.experience)
    : Number(row.assessment_score || 0);
  const badgeStatus = calculateProviderBadge(assessmentScore, row.experience_years);

  return {
    role: 'provider',
    id: row.id,
    full_name: row.full_name,
    fullName: row.full_name,
    address: row.address,
    gender: row.gender,
    contact: row.contact,
    dob: row.dob,
    email: row.email,
    category: row.category,
    service: row.service,
    experience: row.experience,
    experience_years: row.experience_years,
    experience_certification: row.experience_certification,
    documents_files: row.documents_files || [],
    id_front_file: row.id_front_file,
    id_back_file: row.id_back_file,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    location_accuracy_m: row.location_accuracy_m === null || row.location_accuracy_m === undefined ? null : Number(row.location_accuracy_m),
    location_updated_at: row.location_updated_at || null,
    assessment_score: assessmentScore,
    badge_status: badgeStatus,
    is_verified: row.is_verified,
    verification_status: row.verification_status,
    created_at: row.created_at,
  };
}

async function ensureAdminSupportTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS service_categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      services TEXT[] NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      account_type TEXT NOT NULL CHECK (account_type IN ('customer', 'provider')),
      account_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
      ON password_reset_tokens (token_hash);

    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_account
      ON password_reset_tokens (account_type, account_id);

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id SERIAL PRIMARY KEY,
      folder TEXT NOT NULL CHECK (folder IN ('customer-ids', 'provider-docs')),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      content BYTEA NOT NULL,
      owner_role TEXT CHECK (owner_role IN ('customer', 'provider')),
      owner_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (folder, filename)
    );

    CREATE INDEX IF NOT EXISTS idx_uploaded_files_lookup
      ON uploaded_files (folder, filename);

    CREATE TABLE IF NOT EXISTS admin_feedback (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL DEFAULT 'feedback'
        CHECK (type IN ('complaint', 'feedback')),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      submitted_by TEXT NOT NULL DEFAULT 'User',
      related_party TEXT,
      status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'review', 'resolved', 'logged')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customer_bookings (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      service TEXT NOT NULL,
      scheduled_date DATE NOT NULL DEFAULT CURRENT_DATE,
      scheduled_time TEXT NOT NULL DEFAULT '09:00 AM',
      address TEXT NOT NULL DEFAULT '',
      latitude NUMERIC(10,7),
      longitude NUMERIC(10,7),
      location_accuracy_m NUMERIC(10,2),
      location_updated_at TIMESTAMPTZ,
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'upcoming', 'ongoing', 'completed', 'cancelled')),
      provider_closed BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE customer_bookings
      ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
      ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS provider_closed BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password',
      ADD COLUMN IF NOT EXISTS google_sub TEXT;

    ALTER TABLE providers
      ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
      ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password',
      ADD COLUMN IF NOT EXISTS google_sub TEXT;

    ALTER TABLE admin_feedback
      ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES customer_bookings(id) ON DELETE SET NULL;

    CREATE TABLE IF NOT EXISTS customer_messages (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      sender_role TEXT NOT NULL DEFAULT 'provider'
        CHECK (sender_role IN ('customer', 'provider')),
      message TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customer_favorites (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (customer_id, provider_id)
    );

    CREATE TABLE IF NOT EXISTS customer_reviews (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
      provider_id INTEGER REFERENCES providers(id) ON DELETE SET NULL,
      booking_id INTEGER REFERENCES customer_bookings(id) ON DELETE SET NULL,
      rating INTEGER NOT NULL DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
      comment TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS provider_services (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      starting_price NUMERIC(10,2) NOT NULL DEFAULT 0,
      max_price NUMERIC(10,2) NOT NULL DEFAULT 0,
      accepts_cash BOOLEAN NOT NULL DEFAULT TRUE,
      accepts_gcash BOOLEAN NOT NULL DEFAULT FALSE,
      accepts_other BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS provider_availability (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
      available_date DATE NOT NULL,
      start_time TEXT NOT NULL DEFAULT '09:00 AM',
      end_time TEXT NOT NULL DEFAULT '05:00 PM',
      is_available BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (provider_id, available_date, start_time)
    );

    CREATE TABLE IF NOT EXISTS provider_skill_assessments (
      id SERIAL PRIMARY KEY,
      provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
      badge TEXT NOT NULL DEFAULT 'Basic Verified',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`
    UPDATE providers
    SET category = CASE
      WHEN category IN ('Home Repair') THEN 'Repair Services'
      WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
      WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
      ELSE category
    END;

    UPDATE provider_services
    SET category = CASE
      WHEN category IN ('Home Repair') THEN 'Repair Services'
      WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
      WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
      ELSE category
    END;

    UPDATE provider_skill_assessments
    SET category = CASE
      WHEN category IN ('Home Repair') THEN 'Repair Services'
      WHEN category IN ('Home Installation', 'Home Installations') THEN 'Installation Services'
      WHEN category IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance') THEN 'Outdoor and Property Maintenance'
      ELSE category
    END;

    DELETE FROM service_categories
    WHERE name = 'Home Repair'
      AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Repair Services');
    DELETE FROM service_categories
    WHERE name = 'Home Installations'
      AND EXISTS (SELECT 1 FROM service_categories WHERE name IN ('Home Installation', 'Installation Services'));
    DELETE FROM service_categories
    WHERE name IN ('Home Installation', 'Home Installations')
      AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Installation Services');
    DELETE FROM service_categories
    WHERE name IN ('Outdoor & Property', 'Outdoor Maintenance')
      AND EXISTS (SELECT 1 FROM service_categories WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor and Property Maintenance'));
    DELETE FROM service_categories
    WHERE name = 'Outdoor Maintenance'
      AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Outdoor & Property');
    DELETE FROM service_categories
    WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance')
      AND EXISTS (SELECT 1 FROM service_categories WHERE name = 'Outdoor and Property Maintenance');

    UPDATE service_categories
    SET name = 'Repair Services'
    WHERE name = 'Home Repair';
    UPDATE service_categories
    SET name = 'Installation Services'
    WHERE name IN ('Home Installation', 'Home Installations');
    UPDATE service_categories
    SET name = 'Outdoor and Property Maintenance'
    WHERE name IN ('Outdoor & Property Maintenance', 'Outdoor & Property', 'Outdoor Maintenance');

    INSERT INTO service_categories (name, description, services)
    VALUES
      ('Repair Services', 'Services related to fixing or maintaining household facilities.', ARRAY['Plumbing services','Electrical repair','Appliance repair','Carpentry','Roof repair','Furniture repair','Painting services','Door and window repair']),
      ('Cleaning', 'Services focused on cleaning and sanitation of homes.', ARRAY['General house cleaning','Deep cleaning','Bathroom cleaning','Kitchen cleaning','Sofa and upholstery cleaning','Carpet cleaning','Window cleaning','Laundry Services']),
      ('Personal Care', 'Services related to health, relaxation, and personal care.', ARRAY['Massage therapy','Home spa services','Haircut','Nail Care','Eyelash Care','Grooming']),
      ('Appliance Maintenance', 'Services focused on maintaining household appliances.', ARRAY['Aircon','Refrigerator','Washing Machine','Microwave','TV / Electronics','Small Appliances']),
      ('Installation Services', 'Services that improve or upgrade household facilities.', ARRAY['Furniture assembly','Cabinet installation','Curtain or blinds installation','Lighting installation','CCTV installation','Internet or router setup','Appliance Installation']),
      ('Outdoor and Property Maintenance', 'Services related to the maintenance of outdoor spaces.', ARRAY['Gardening services','Lawn mowing','Landscape maintenance','Tree trimming','Fence repair'])
    ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        services = EXCLUDED.services,
        is_active = TRUE,
        updated_at = NOW()
  `);

  await backfillUploadedFilesFromDisk();
  await backfillProviderProfileData();
}

async function backfillProviderProfileData() {
  const providers = await db.query('SELECT * FROM providers ORDER BY id ASC');
  for (const provider of providers.rows) {
    await ensureProviderProfileService(provider);
    await db.query(`
      INSERT INTO provider_skill_assessments (provider_id, category, score, badge)
      SELECT $1, $2, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM provider_skill_assessments WHERE provider_id = $1)
    `, [
      provider.id,
      provider.category || 'General',
      extractAssessmentScore(provider.experience),
      calculateProviderBadge(extractAssessmentScore(provider.experience), provider.experience_years),
    ]);
  }
}

function categoryRow(row) {
  const services = [
    ...(Array.isArray(row.services) ? row.services : []),
    ...(Array.isArray(row.provider_services) ? row.provider_services : []),
  ].filter(Boolean);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    services: [...new Set(services)],
    is_active: row.is_display_active ?? row.is_active,
    provider_count: Number(row.provider_count || 0),
    created_at: row.created_at,
  };
}

async function upsertServiceCategory(name, service = '') {
  const categoryName = String(name || '').trim();
  const serviceName = String(service || '').trim();
  if (!categoryName) return;
  const description = `${categoryName} services offered by registered providers.`;
  await db.query(`
    INSERT INTO service_categories (name, description, services)
    VALUES ($1, $2, CASE WHEN $3 = '' THEN ARRAY[]::TEXT[] ELSE ARRAY[$3]::TEXT[] END)
    ON CONFLICT (name) DO UPDATE
    SET services = (
          SELECT ARRAY(
            SELECT DISTINCT item
            FROM unnest(service_categories.services || EXCLUDED.services) AS item
            WHERE item <> ''
            ORDER BY item
          )
        ),
        updated_at = NOW()
  `, [categoryName, description, serviceName]);
}

async function ensureProviderProfileService(provider) {
  if (!provider?.id) return;
  const title = String(provider.service || provider.category || '').trim();
  const category = String(provider.category || 'General').trim();
  if (!title) return;

  await db.query(`
    INSERT INTO provider_services
      (provider_id, title, description, category, starting_price, max_price, accepts_cash, accepts_gcash, is_active)
    SELECT $1, $2, $3, $4, 0, 0, TRUE, TRUE, TRUE
    WHERE NOT EXISTS (
      SELECT 1
      FROM provider_services
      WHERE provider_id = $1 AND lower(title) = lower($2)
    )
  `, [
    provider.id,
    title,
    `Available ${title} service near ${provider.address || 'Angeles City'}.`,
    category,
  ]);
  await upsertServiceCategory(category, title);
}

function feedbackRow(row) {
  return {
    id: row.id,
    type: row.type,
    subject: row.subject,
    message: row.message,
    submitted_by: row.submitted_by,
    related_party: row.related_party,
    status: row.status,
    created_at: row.created_at,
  };
}

function customerBookingRow(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    provider_category: row.provider_category,
    service: row.service,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    address: row.address,
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    location_accuracy_m: row.location_accuracy_m === null || row.location_accuracy_m === undefined ? null : Number(row.location_accuracy_m),
    location_updated_at: row.location_updated_at || null,
    provider_latitude: row.provider_latitude === null || row.provider_latitude === undefined ? null : Number(row.provider_latitude),
    provider_longitude: row.provider_longitude === null || row.provider_longitude === undefined ? null : Number(row.provider_longitude),
    provider_location_accuracy_m: row.provider_location_accuracy_m === null || row.provider_location_accuracy_m === undefined ? null : Number(row.provider_location_accuracy_m),
    provider_location_updated_at: row.provider_location_updated_at || null,
    amount: Number(row.amount || 0),
    payment_method: row.payment_method || 'cash',
    status: row.status,
    provider_closed: Boolean(row.provider_closed),
    created_at: row.created_at,
  };
}

function customerMessageRow(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    sender_role: row.sender_role,
    message: row.message,
    is_read: row.is_read,
    created_at: row.created_at,
  };
}

function customerReviewRow(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    service: row.service,
    rating: row.rating,
    comment: row.comment,
    created_at: row.created_at,
  };
}

async function getCollaborativeRecommendations(customerId, limit = 8) {
  const result = await db.query(`
    WITH my_interactions AS (
      SELECT provider_id FROM customer_favorites WHERE customer_id = $1 AND provider_id IS NOT NULL
      UNION
      SELECT provider_id FROM customer_bookings WHERE customer_id = $1 AND provider_id IS NOT NULL
      UNION
      SELECT provider_id FROM customer_reviews WHERE customer_id = $1 AND provider_id IS NOT NULL
    ),
    my_categories AS (
      SELECT DISTINCT lower(COALESCE(NULLIF(p.category, ''), NULLIF(p.service, ''))) AS category
      FROM providers p
      JOIN my_interactions mi ON mi.provider_id = p.id
      WHERE COALESCE(NULLIF(p.category, ''), NULLIF(p.service, '')) IS NOT NULL
    ),
    similar_customers AS (
      SELECT DISTINCT customer_id
      FROM (
        SELECT customer_id, provider_id FROM customer_favorites
        UNION ALL
        SELECT customer_id, provider_id FROM customer_bookings
        UNION ALL
        SELECT customer_id, provider_id FROM customer_reviews
      ) interactions
      WHERE customer_id <> $1
        AND provider_id IN (SELECT provider_id FROM my_interactions)
    ),
    collaborative_hits AS (
      SELECT provider_id, SUM(weight)::numeric AS collaborative_score
      FROM (
        SELECT provider_id, 4 AS weight FROM customer_favorites WHERE customer_id IN (SELECT customer_id FROM similar_customers)
        UNION ALL
        SELECT provider_id, 5 AS weight FROM customer_bookings WHERE customer_id IN (SELECT customer_id FROM similar_customers)
        UNION ALL
        SELECT provider_id, 3 AS weight FROM customer_reviews WHERE customer_id IN (SELECT customer_id FROM similar_customers)
      ) hits
      WHERE provider_id IS NOT NULL
      GROUP BY provider_id
    ),
    provider_stats AS (
      SELECT
        p.id AS provider_id,
        COALESCE(AVG(r.rating), 4.8) AS rating,
        COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END)::int AS completed_jobs,
        COUNT(DISTINCT f.id)::int AS favorite_count,
        COALESCE(MIN(s.starting_price), 350) AS starting_price
      FROM providers p
      LEFT JOIN customer_reviews r ON r.provider_id = p.id
      LEFT JOIN customer_bookings b ON b.provider_id = p.id
      LEFT JOIN customer_favorites f ON f.provider_id = p.id
      LEFT JOIN provider_services s ON s.provider_id = p.id AND s.is_active = TRUE
      GROUP BY p.id
    ),
    availability_counts AS (
      SELECT provider_id, COUNT(*)::int AS available_slots
      FROM provider_availability
      WHERE available_date >= CURRENT_DATE AND is_available = TRUE
      GROUP BY provider_id
    )
    SELECT
      p.*,
      ps.rating,
      ps.completed_jobs,
      ps.favorite_count,
      ps.starting_price,
      COALESCE(ac.available_slots, 0) AS available_slots,
      COALESCE(ch.collaborative_score, 0) AS collaborative_score,
      EXISTS (SELECT 1 FROM my_interactions mi WHERE mi.provider_id = p.id) AS is_previous_interaction,
      COALESCE(psa.score, extract_score.score, 0)::int AS assessment_score,
      CASE
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 'Top-Tier Verified'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 'Skilled Verified'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 60 THEN 'Basic Verified'
        ELSE 'Needs Reassessment'
      END AS assessment_badge,
      CASE
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 'top'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 'skilled'
        ELSE 'basic'
      END AS verified_tier,
      (
        COALESCE(ch.collaborative_score, 0) * 10
        + CASE WHEN EXISTS (SELECT 1 FROM my_interactions mi WHERE mi.provider_id = p.id) THEN 12 ELSE 0 END
        + CASE WHEN lower(COALESCE(NULLIF(p.category, ''), NULLIF(p.service, ''))) IN (SELECT category FROM my_categories) THEN 24 ELSE 0 END
        + ps.rating * 8
        + ps.completed_jobs
        + ps.favorite_count * 2
        + COALESCE(ac.available_slots, 0) * 3
        + CASE WHEN p.is_verified THEN 20 ELSE 0 END
      ) AS recommendation_score,
      CASE
        WHEN COALESCE(ch.collaborative_score, 0) > 0 THEN 'Customers with similar bookings and favorites interacted with this provider.'
        WHEN EXISTS (SELECT 1 FROM my_interactions mi WHERE mi.provider_id = p.id) THEN 'Based on your previous bookings, favorites, or reviews.'
        WHEN lower(COALESCE(NULLIF(p.category, ''), NULLIF(p.service, ''))) IN (SELECT category FROM my_categories) THEN 'Matches your previous service category choices.'
        ELSE 'Popular verified provider based on system activity.'
      END AS recommendation_reason
    FROM providers p
    JOIN provider_stats ps ON ps.provider_id = p.id
    LEFT JOIN collaborative_hits ch ON ch.provider_id = p.id
    LEFT JOIN availability_counts ac ON ac.provider_id = p.id
    LEFT JOIN LATERAL (
      SELECT score, badge
      FROM provider_skill_assessments
      WHERE provider_id = p.id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) psa ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(substring(p.experience FROM 'Assessment score: ([0-9]{1,3})%'), '')::int, 0) AS score
    ) extract_score ON TRUE
    WHERE (lower(COALESCE(p.verification_status, '')) = 'verified' OR p.is_verified IS TRUE)
    ORDER BY recommendation_score DESC, ps.rating DESC, ps.completed_jobs DESC, p.created_at DESC
    LIMIT $2
  `, [customerId, limit]);

  return result.rows.map((row) => ({
    ...providerRow(row),
    rating: Number(row.rating || 4.8),
    completed_jobs: Number(row.completed_jobs || 0),
    favorite_count: Number(row.favorite_count || 0),
    starting_price: Number(row.starting_price || 350),
    available_slots: Number(row.available_slots || 0),
    is_previous_interaction: Boolean(row.is_previous_interaction),
    verified_tier: row.verified_tier,
    assessment_score: Number(row.assessment_score || 0),
    badge_status: row.assessment_badge,
    collaborative_score: Number(row.collaborative_score || 0),
    recommendation_score: Number(row.recommendation_score || 0),
    recommendation_reason: row.recommendation_reason,
  }));
}

function providerServiceRow(row) {
  return {
    id: row.id,
    provider_id: row.provider_id,
    title: row.title,
    description: row.description,
    category: row.category,
    starting_price: Number(row.starting_price || 0),
    max_price: Number(row.max_price || 0),
    accepts_cash: row.accepts_cash,
    accepts_gcash: row.accepts_gcash,
    accepts_other: row.accepts_other,
    is_active: row.is_active,
    created_at: row.created_at,
  };
}

function providerBookingRow(row) {
  const bookingLat = row.booking_latitude === null || row.booking_latitude === undefined ? null : Number(row.booking_latitude);
  const bookingLng = row.booking_longitude === null || row.booking_longitude === undefined ? null : Number(row.booking_longitude);
  const customerLat = row.customer_latitude === null || row.customer_latitude === undefined ? null : Number(row.customer_latitude);
  const customerLng = row.customer_longitude === null || row.customer_longitude === undefined ? null : Number(row.customer_longitude);
  const hasBookingGps = Number.isFinite(bookingLat) && Number.isFinite(bookingLng);
  const hasCustomerGps = Number.isFinite(customerLat) && Number.isFinite(customerLng);
  const estimatedPoint = hasBookingGps || hasCustomerGps ? null : estimateLocationPoint(row.address || '');
  const displayLat = hasBookingGps ? bookingLat : hasCustomerGps ? customerLat : estimatedPoint?.lat;
  const displayLng = hasBookingGps ? bookingLng : hasCustomerGps ? customerLng : estimatedPoint?.lng;
  const locationSource = hasBookingGps ? 'booking-gps' : hasCustomerGps ? 'customer-gps' : estimatedPoint ? 'estimated-address' : 'none';
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_contact: row.customer_contact,
    customer_latitude: Number.isFinite(displayLat) ? displayLat : null,
    customer_longitude: Number.isFinite(displayLng) ? displayLng : null,
    customer_location_source: locationSource,
    customer_location_estimate_source: estimatedPoint?.source || null,
    customer_location_accuracy_m: row.booking_location_accuracy_m === null || row.booking_location_accuracy_m === undefined
      ? (row.customer_location_accuracy_m === null || row.customer_location_accuracy_m === undefined ? null : Number(row.customer_location_accuracy_m))
      : Number(row.booking_location_accuracy_m),
    customer_location_updated_at: row.booking_location_updated_at || row.customer_location_updated_at || null,
    booking_latitude: bookingLat,
    booking_longitude: bookingLng,
    booking_location_accuracy_m: row.booking_location_accuracy_m === null || row.booking_location_accuracy_m === undefined ? null : Number(row.booking_location_accuracy_m),
    booking_location_updated_at: row.booking_location_updated_at || null,
    provider_id: row.provider_id,
    service: row.service,
    scheduled_date: row.scheduled_date,
    scheduled_time: row.scheduled_time,
    address: row.address,
    amount: Number(row.amount || 0),
    payment_method: row.payment_method || 'cash',
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function sumCompletedEarningsSince(rows, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.reduce((acc, row) => {
    if (row.status !== 'completed') return acc;
    const stamp = new Date(row.updated_at || row.scheduled_date || row.created_at).getTime();
    if (!Number.isFinite(stamp) || stamp < cutoff) return acc;
    return {
      amount: acc.amount + Number(row.amount || 0),
      jobs: acc.jobs + 1,
    };
  }, { amount: 0, jobs: 0 });
}

function bookingResponseRate(rows, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const pool = rows.filter((row) => {
    const stamp = new Date(row.created_at || row.scheduled_date).getTime();
    return Number.isFinite(stamp) && stamp >= cutoff;
  });
  const source = pool.length ? pool : rows;
  if (!source.length) return 0;
  const acted = source.filter((row) => String(row.status || '').toLowerCase() !== 'pending').length;
  return Math.round((acted / source.length) * 100);
}

function averageProviderReplyLabel(messages) {
  const firstCustomer = new Map();
  const firstReply = new Map();
  const sorted = [...messages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const row of sorted) {
    const id = String(row.customer_id || '');
    if (!id) continue;
    const stamp = new Date(row.created_at).getTime();
    if (!Number.isFinite(stamp)) continue;
    if (row.sender_role === 'customer' && !firstCustomer.has(id)) firstCustomer.set(id, stamp);
    if (row.sender_role === 'provider' && firstCustomer.has(id) && !firstReply.has(id) && stamp >= firstCustomer.get(id)) {
      firstReply.set(id, stamp);
    }
  }
  const diffs = [];
  for (const [id, start] of firstCustomer) {
    if (!firstReply.has(id)) continue;
    diffs.push((firstReply.get(id) - start) / 60000);
  }
  if (!diffs.length) return '—';
  const avg = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  if (avg < 1) return '< 1 min';
  if (avg < 60) return `${Math.round(avg)} mins`;
  const hours = avg / 60;
  if (hours < 24) return `${hours.toFixed(1)} hrs`;
  return `${Math.round(hours / 24)} days`;
}

function providerMessageRow(row) {
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    sender_role: row.sender_role,
    message: row.message,
    is_read: row.is_read,
    created_at: row.created_at,
  };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, database: 'connected' });
}));

app.get('/api/auth/google/start', (req, res) => {
  const role = String(req.query.role || 'customer').toLowerCase() === 'provider' ? 'provider' : 'customer';
  const requestFrontendBaseUrl = requestFrontendBase(req);
  if (!googleClientId || !googleClientSecret) {
    return res.redirect(`${requestFrontendBaseUrl}/pages/auth/googleAuthBridge.html?error=google_not_configured&role=${role}`);
  }

  const googleRedirectUri = requestGoogleRedirectUri(req);
  const state = Buffer.from(JSON.stringify({
    role,
    frontendBaseUrl: requestFrontendBaseUrl,
    nonce: crypto.randomBytes(12).toString('hex'),
  })).toString('base64url');
  const params = new URLSearchParams({
    client_id: googleClientId,
    redirect_uri: googleRedirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/api/auth/google/callback', asyncRoute(async (req, res) => {
  const code = String(req.query.code || '');
  if (!code) return res.redirect(`${configuredFrontendBaseUrl || publicBaseUrl(req)}/pages/auth/googleAuthBridge.html?error=missing_code`);

  let state = {};
  try {
    state = JSON.parse(Buffer.from(String(req.query.state || ''), 'base64url').toString('utf8'));
  } catch {
    state = {};
  }
  const role = state.role === 'provider' ? 'provider' : 'customer';
  const callbackFrontendBaseUrl = state.frontendBaseUrl || configuredFrontendBaseUrl || publicBaseUrl(req);
  const googleRedirectUri = requestGoogleRedirectUri(req);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: googleClientId,
      client_secret: googleClientSecret,
      redirect_uri: googleRedirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    return res.redirect(`${callbackFrontendBaseUrl}/pages/auth/googleAuthBridge.html?error=google_token_failed`);
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profileData = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profileData.email) {
    return res.redirect(`${callbackFrontendBaseUrl}/pages/auth/googleAuthBridge.html?error=google_profile_failed`);
  }

  const profile = {
    email: String(profileData.email || '').toLowerCase(),
    fullName: profileData.name || profileData.email,
    picture: profileData.picture || '',
    googleSub: profileData.sub || '',
  };
  const ticket = createGoogleTicket({ role, profile });
  res.redirect(`${callbackFrontendBaseUrl}/pages/auth/googleAuthBridge.html?ticket=${ticket}&role=${role}`);
}));

app.post('/api/auth/google/complete', asyncRoute(async (req, res) => {
  requireFields(req.body, ['ticket']);
  const ticketData = takeGoogleTicket(req.body.ticket);
  if (!ticketData) return res.status(400).json({ message: 'Google login expired. Please try again.' });

  const { role, profile } = ticketData;
  const [customer, provider] = await Promise.all([
    db.query('SELECT * FROM customers WHERE lower(email) = lower($1::text)', [profile.email]),
    db.query('SELECT * FROM providers WHERE lower(email) = lower($1::text)', [profile.email]),
  ]);

  const requestedAccount = role === 'provider' ? provider.rows[0] : customer.rows[0];
  if (requestedAccount) {
    return res.json({
      action: 'login',
      role,
      redirect: googleDashboardPath(role),
      user: role === 'provider' ? providerRow(requestedAccount) : customerRow(requestedAccount),
    });
  }

  const otherRole = role === 'provider' ? 'customer' : 'provider';
  const otherAccountExists = role === 'provider' ? customer.rowCount : provider.rowCount;
  if (otherAccountExists) {
    return res.status(409).json({
      message: `This Gmail is registered as a ${otherRole}. Please use ${otherRole} Google login.`,
    });
  }

  res.status(200).json({
    action: 'register',
    role,
    redirect: googleRegisterPath(role),
    profile,
  });
}));

app.post('/api/auth/google/account-status', asyncRoute(async (req, res) => {
  requireFields(req.body, ['role', 'email']);
  const role = String(req.body.role || '').toLowerCase() === 'provider' ? 'provider' : 'customer';
  const email = String(req.body.email || '').trim().toLowerCase();
  const googleSub = String(req.body.googleSub || '').trim();
  const matchClause = googleSub
    ? '(google_sub = $1 OR lower(email) = lower($2::text))'
    : 'lower(email) = lower($1::text)';
  const matchParams = googleSub ? [googleSub, email] : [email];

  const [customer, provider] = await Promise.all([
    db.query(`SELECT * FROM customers WHERE ${matchClause} LIMIT 1`, matchParams),
    db.query(`SELECT * FROM providers WHERE ${matchClause} LIMIT 1`, matchParams),
  ]);

  const requestedAccount = role === 'provider' ? provider.rows[0] : customer.rows[0];
  if (requestedAccount) {
    return res.json({
      action: 'login',
      role,
      redirect: googleDashboardPath(role),
      user: role === 'provider' ? providerRow(requestedAccount) : customerRow(requestedAccount),
    });
  }

  const otherRole = role === 'provider' ? 'customer' : 'provider';
  const otherAccountExists = role === 'provider' ? customer.rowCount : provider.rowCount;
  if (otherAccountExists) {
    return res.status(409).json({
      message: `This Gmail is registered as a ${otherRole}. Please use ${otherRole} Google login.`,
    });
  }

  res.json({ action: 'register', role });
}));

app.post('/api/auth/password-reset/request', asyncRoute(async (req, res) => {
  requireFields(req.body, ['role', 'email']);
  const role = normalizeAccountRole(req.body.role);
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!isEmailLike(email)) {
    return res.status(400).json({ message: 'Please enter a valid email address.', field: 'email' });
  }

  const mailReady = emailDeliveryConfigured();
  const exposeResetLink = canExposeResetLink(req);
  if (!mailReady && !exposeResetLink) {
    return res.status(503).json({
      message: 'Password reset email is not configured yet. Please contact the system admin.',
    });
  }

  await db.query(`
    DELETE FROM password_reset_tokens
    WHERE used_at IS NOT NULL
       OR expires_at < NOW() - INTERVAL '1 day'
  `);

  const result = await db.query(
    `SELECT id, full_name, email
     FROM ${accountTable(role)}
     WHERE lower(email) = lower($1::text)
     LIMIT 1`,
    [email]
  );

  const account = result.rows[0];
  let resetUrl = '';
  let emailSent = false;

  if (account) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    resetUrl = passwordResetUrl(req, rawToken);
    await db.query(
      `INSERT INTO password_reset_tokens
        (account_type, account_id, email, token_hash, expires_at)
       VALUES ($1, $2, lower($3), $4, NOW() + ($5::text || ' minutes')::interval)`,
      [role, account.id, account.email, hashPasswordResetToken(rawToken), passwordResetTtlMinutes]
    );

    if (mailReady) {
      try {
        const mailResult = await sendPasswordResetEmail({
          to: account.email,
          role,
          resetUrl,
        });
        emailSent = mailResult.sent;
      } catch (error) {
        console.error('Password reset email failed:', error);
        if (!exposeResetLink) {
          return res.status(503).json({
            message: 'Password reset email could not be sent. Please try again later.',
            detail: error.publicMessage || publicSmtpError(error),
            smtp_code: error.code || null,
            smtp_response_code: error.responseCode || null,
          });
        }
      }
    }
  }

  res.json({
    ok: true,
    message: 'If this email is registered, a password reset link has been prepared.',
    expires_in_minutes: passwordResetTtlMinutes,
    email_sent: emailSent,
    ...(account && exposeResetLink ? { reset_url: resetUrl } : {}),
  });
}));

app.post('/api/auth/password-reset/complete', asyncRoute(async (req, res) => {
  requireFields(req.body, ['token', 'password']);
  const token = String(req.body.token || '').trim();
  const password = String(req.body.password || '');

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.', field: 'password' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const tokenResult = await db.query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE token_hash = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING account_type, account_id, email`,
    [hashPasswordResetToken(token)]
  );

  const resetToken = tokenResult.rows[0];
  if (!resetToken) {
    return res.status(400).json({
      message: 'This reset link is invalid or expired. Please request a new one.',
    });
  }

  const result = await db.query(
    `UPDATE ${accountTable(resetToken.account_type)}
     SET password_hash = $1,
         auth_provider = 'password',
         updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [passwordHash, resetToken.account_id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ message: 'Account not found. Please request a new reset link.' });
  }

  res.json({
    ok: true,
    role: resetToken.account_type,
    redirect: passwordResetLoginPath(resetToken.account_type),
  });
}));

app.post('/api/auth/customer/register', upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  const isGoogleAuth = req.body.authProvider === 'google';
  requireFields(req.body, [
    'fullName', 'address', 'gender', 'contact', 'dob', 'email', 'password',
  ]);
  await ensureUniqueAccountEmail(req.body.email);
  await persistRequestUploads(req);

  const contact = normalizeContactNumber(req.body.contact);
  const passwordHash = await buildRegistrationPasswordHash(req);
  const result = await db.query(
    `INSERT INTO customers
      (full_name, address, gender, contact, dob, email, password_hash, id_type, id_address, id_front_file, id_back_file, auth_provider, google_sub)
     VALUES ($1, $2, $3, $4, $5, lower($6), $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      req.body.fullName.trim(),
      req.body.address.trim(),
      req.body.gender,
      contact,
      req.body.dob,
      req.body.email.trim(),
      passwordHash,
      req.body.idType || null,
      req.body.idAddress || null,
      req.files?.idFront?.[0]?.filename || null,
      req.files?.idBack?.[0]?.filename || null,
      isGoogleAuth ? 'google' : 'password',
      isGoogleAuth ? req.body.googleSub || null : null,
    ]
  );

  res.status(201).json({ user: customerRow(result.rows[0]) });
}));

app.post('/api/auth/customer/login', asyncRoute(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const result = await db.query('SELECT * FROM customers WHERE lower(email) = lower($1::text)', [req.body.email.trim()]);
  const customer = result.rows[0];

  if (!customer) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  const passwordMatches = customer.password_hash
    ? await bcrypt.compare(req.body.password, customer.password_hash)
    : false;

  if (!passwordMatches) {
    if (String(customer.auth_provider || '').toLowerCase() === 'google') {
      return res.status(401).json({
        code: 'GOOGLE_CUSTOMER_PASSWORD_UNAVAILABLE',
        message: 'This customer account is linked to Google login. Use the Google button, or use Forgot Password to create a new email/password login.',
      });
    }
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  res.json({ user: customerRow(customer) });
}));

app.get('/api/auth/customer/status/:id', asyncRoute(async (req, res) => {
  const result = await db.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ user: customerRow(result.rows[0]) });
}));

app.patch('/api/customer/:id/location', asyncRoute(async (req, res) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ message: 'Valid GPS coordinates are required.' });
  }
  const result = await db.query(`
    UPDATE customers
    SET latitude = $2,
        longitude = $3,
        location_accuracy_m = $4,
        location_updated_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, latitude, longitude, Number.isFinite(accuracy) ? accuracy : null]);
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ user: customerRow(result.rows[0]) });
}));

app.patch('/api/auth/customer/update', asyncRoute(async (req, res) => {
  requireFields(req.body, ['id', 'full_name', 'contact', 'address', 'gender', 'dob']);
  const contact = normalizeContactNumber(req.body.contact);
  const result = await db.query(
    `UPDATE customers
     SET full_name = $2, contact = $3, address = $4, gender = $5, dob = $6, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      req.body.id,
      req.body.full_name.trim(),
      contact,
      req.body.address.trim(),
      req.body.gender,
      req.body.dob,
    ]
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ user: customerRow(result.rows[0]) });
}));

app.patch('/api/auth/customer/verification/resubmit', upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  requireFields(req.body, ['id', 'idType', 'idAddress']);
  await persistRequestUploads(req);
  const result = await db.query(
    `UPDATE customers
     SET id_type = $2,
         id_address = $3,
         id_front_file = COALESCE($4, id_front_file),
         id_back_file = COALESCE($5, id_back_file),
         is_verified = FALSE,
         verification_status = 'pending',
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      req.body.id,
      req.body.idType,
      req.body.idAddress.trim(),
      req.files?.idFront?.[0]?.filename || null,
      req.files?.idBack?.[0]?.filename || null,
    ]
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ user: customerRow(result.rows[0]) });
}));

app.patch('/api/auth/customer/change-password', asyncRoute(async (req, res) => {
  requireFields(req.body, ['id', 'currentPassword', 'newPassword']);
  const result = await db.query('SELECT * FROM customers WHERE id = $1', [req.body.id]);
  const customer = result.rows[0];
  if (!customer || !await bcrypt.compare(req.body.currentPassword, customer.password_hash)) {
    return res.status(401).json({ message: 'Current password is incorrect.' });
  }
  const passwordHash = await bcrypt.hash(registrationPassword(req.body.newPassword), 12);
  await db.query('UPDATE customers SET password_hash = $2, updated_at = NOW() WHERE id = $1', [req.body.id, passwordHash]);
  res.json({ ok: true });
}));

app.get('/api/customer/:id/dashboard', asyncRoute(async (req, res) => {
  const customerId = req.params.id;
  const [categories, providers, bookings, messages, favorites, reviews, recommendations] = await Promise.all([
    db.query(`
      SELECT c.*, COUNT(p.id)::int AS provider_count
      FROM service_categories c
      LEFT JOIN providers p ON lower(p.category) = lower(c.name)
        AND (lower(COALESCE(p.verification_status, '')) = 'verified' OR p.is_verified IS TRUE)
      WHERE c.is_active = TRUE
      GROUP BY c.id
      ORDER BY c.name ASC
    `),
    db.query(`
      SELECT * FROM providers
      WHERE lower(COALESCE(verification_status, '')) = 'verified' OR is_verified IS TRUE
      ORDER BY created_at DESC
    `),
    db.query(`
      SELECT
        b.*,
        p.full_name AS provider_name,
        p.category AS provider_category,
        p.latitude AS provider_latitude,
        p.longitude AS provider_longitude,
        p.location_accuracy_m AS provider_location_accuracy_m,
        p.location_updated_at AS provider_location_updated_at
      FROM customer_bookings b
      LEFT JOIN providers p ON p.id = b.provider_id
      WHERE b.customer_id = $1
      ORDER BY b.scheduled_date DESC, b.id DESC
    `, [customerId]),
    db.query(`
      SELECT m.*, p.full_name AS provider_name
      FROM customer_messages m
      LEFT JOIN providers p ON p.id = m.provider_id
      WHERE m.customer_id = $1
      ORDER BY m.created_at DESC
      LIMIT 20
    `, [customerId]),
    db.query(`
      SELECT f.id, f.customer_id, f.provider_id, f.created_at, p.*
      FROM customer_favorites f
      JOIN providers p ON p.id = f.provider_id
      WHERE f.customer_id = $1
      ORDER BY f.created_at DESC
    `, [customerId]),
    db.query(`
      SELECT r.*, p.full_name AS provider_name, p.service
      FROM customer_reviews r
      LEFT JOIN providers p ON p.id = r.provider_id
      WHERE r.customer_id = $1
      ORDER BY r.created_at DESC
    `, [customerId]),
    getCollaborativeRecommendations(customerId, 8),
  ]);

  res.json({
    categories: categories.rows.map(categoryRow),
    providers: providers.rows.map(providerRow),
    recommendations,
    bookings: bookings.rows.map(customerBookingRow),
    messages: messages.rows.map(customerMessageRow),
    favorites: favorites.rows.map((row) => ({ favorite_id: row.id, ...providerRow(row) })),
    reviews: reviews.rows.map(customerReviewRow),
  });
}));

app.get('/api/customer/:id/recommendations', asyncRoute(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 8), 20);
  res.json({
    algorithm: {
      collaborative_filtering: 'Finds customers who interacted with the same providers, then recommends verified providers those similar customers booked, favorited, or reviewed.',
      signals: ['same provider interactions', 'same service categories', 'favorites', 'completed bookings', 'reviews', 'availability'],
    },
    providers: await getCollaborativeRecommendations(req.params.id, limit),
  });
}));

app.get('/api/customer/:id/location-map', asyncRoute(async (req, res) => {
  const customerResult = await db.query('SELECT id, address, latitude, longitude, location_accuracy_m, location_updated_at FROM customers WHERE id = $1', [req.params.id]);
  if (!customerResult.rowCount) return res.status(404).json({ message: 'Customer not found.' });

  const customerAddress = String(req.query.location || customerResult.rows[0].address || '').trim();
  const gpsLat = Number(req.query.lat);
  const gpsLng = Number(req.query.lng);
  const customerPoint = Number.isFinite(gpsLat) && Number.isFinite(gpsLng)
    ? { lat: gpsLat, lng: gpsLng, source: 'device-gps' }
    : geoPointFromRow({ ...customerResult.rows[0], address: customerAddress });

  const q = String(req.query.q || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim().toLowerCase();
  const sort = String(req.query.sort || 'recommended').trim().toLowerCase();
  const params = [];
  const where = [`(lower(COALESCE(p.verification_status, '')) = 'verified' OR p.is_verified IS TRUE)`];
  if (q) {
    params.push(`%${q}%`);
    where.push(`(
      lower(p.full_name) LIKE $${params.length}
      OR lower(p.category) LIKE $${params.length}
      OR lower(p.service) LIKE $${params.length}
      OR lower(p.address) LIKE $${params.length}
      OR lower(COALESCE(s.title, '')) LIKE $${params.length}
      OR lower(COALESCE(s.description, '')) LIKE $${params.length}
    )`);
  }
  if (category) {
    params.push(`%${category}%`);
    where.push(`(
      lower(p.category) LIKE $${params.length}
      OR lower(p.service) LIKE $${params.length}
      OR lower(COALESCE(s.category, '')) LIKE $${params.length}
      OR lower(COALESCE(s.title, '')) LIKE $${params.length}
    )`);
  }

  const result = await db.query(`
    SELECT
      p.*,
      COALESCE(AVG(r.rating), 4.8) AS rating,
      COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END)::int AS completed_jobs,
      COALESCE(MIN(s.starting_price), 350) AS starting_price,
      COUNT(DISTINCT av.id)::int AS available_slots,
      COALESCE(psa.score, extract_score.score, 0)::int AS assessment_score,
      CASE
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 'top'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 'skilled'
        ELSE 'basic'
      END AS verified_tier
    FROM providers p
    LEFT JOIN provider_services s ON s.provider_id = p.id AND s.is_active = TRUE
    LEFT JOIN customer_reviews r ON r.provider_id = p.id
    LEFT JOIN customer_bookings b ON b.provider_id = p.id
    LEFT JOIN provider_availability av ON av.provider_id = p.id AND av.available_date >= CURRENT_DATE AND av.is_available = TRUE
    LEFT JOIN LATERAL (
      SELECT score
      FROM provider_skill_assessments
      WHERE provider_id = p.id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) psa ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(substring(p.experience FROM 'Assessment score: ([0-9]{1,3})%'), '')::int, 0) AS score
    ) extract_score ON TRUE
    WHERE ${where.join(' AND ')}
    GROUP BY p.id, psa.score, extract_score.score
    LIMIT 40
  `, params);

  const providers = result.rows.map((row) => {
    const point = geoPointFromRow(row);
    const distance = distanceKm(customerPoint, point);
    const sameArea = String(row.address || '').toLowerCase().split(/\W+/)
      .some((token) => token.length > 2 && customerAddress.toLowerCase().includes(token));
    const isAccurate = customerPoint.source !== 'estimated' && point.source === 'saved-gps';
    return {
      ...providerRow(row),
      rating: Number(row.rating || 4.8),
      completed_jobs: Number(row.completed_jobs || 0),
      starting_price: Number(row.starting_price || 350),
      available_slots: Number(row.available_slots || 0),
      assessment_score: Number(row.assessment_score || 0),
      verified_tier: row.verified_tier,
      map_lat: point.lat,
      map_lng: point.lng,
      location_source: point.source,
      distance_km: Number(distance.toFixed(2)),
      location_accuracy: isAccurate ? 'accurate' : 'estimated',
      location_match: isAccurate
        ? (distance <= 1 ? 'very near' : distance <= 5 ? 'nearby' : 'within service range')
        : sameArea ? 'estimated same area' : 'estimated location',
    };
  }).sort((a, b) => a.distance_km - b.distance_km || b.rating - a.rating);

  res.json({
    algorithm: {
      location_based: 'Compares customer GPS/address coordinates against registered provider addresses and returns closest verified providers first.',
      accuracy_rule: 'Saved GPS coordinates are treated as accurate. Typed addresses are only fallback estimates and are labeled as estimated.',
    },
    customer_location: {
      address: customerAddress,
      lat: customerPoint.lat,
      lng: customerPoint.lng,
      source: customerPoint.source,
      accuracy_m: customerResult.rows[0].location_accuracy_m === null || customerResult.rows[0].location_accuracy_m === undefined
        ? null
        : Number(customerResult.rows[0].location_accuracy_m),
      updated_at: customerResult.rows[0].location_updated_at || null,
    },
    providers,
  });
}));

app.get('/api/customer/:id/bookings', asyncRoute(async (req, res) => {
  const result = await db.query(`
    SELECT
      b.*,
      p.full_name AS provider_name,
      p.category AS provider_category,
      p.latitude AS provider_latitude,
      p.longitude AS provider_longitude,
      p.location_accuracy_m AS provider_location_accuracy_m,
      p.location_updated_at AS provider_location_updated_at
    FROM customer_bookings b
    LEFT JOIN providers p ON p.id = b.provider_id
    WHERE b.customer_id = $1
    ORDER BY b.scheduled_date DESC, b.id DESC
  `, [req.params.id]);
  res.json({ bookings: result.rows.map(customerBookingRow) });
}));

app.patch('/api/customer/:id/bookings/:bookingId/cancel', asyncRoute(async (req, res) => {
  const result = await db.query(`
    UPDATE customer_bookings
    SET status = 'cancelled', updated_at = NOW()
    WHERE customer_id = $1
      AND id = $2
      AND status IN ('pending', 'upcoming', 'ongoing')
    RETURNING *
  `, [req.params.id, req.params.bookingId]);
  if (!result.rowCount) {
    return res.status(404).json({ message: 'Active booking not found or already closed.' });
  }

  const booking = result.rows[0];
  await db.query(`
    UPDATE provider_availability
    SET is_available = TRUE
    WHERE provider_id = $1
      AND available_date = $2
      AND start_time = $3
  `, [booking.provider_id, booking.scheduled_date, booking.scheduled_time]);

  res.json({ booking: customerBookingRow(booking) });
}));

app.get('/api/directions', asyncRoute(async (req, res) => {
  const from_lat = Number(req.query.from_lat);
  const from_lng = Number(req.query.from_lng);
  const to_lat = Number(req.query.to_lat);
  const to_lng = Number(req.query.to_lng);
  if (![from_lat, from_lng, to_lat, to_lng].every(Number.isFinite)) {
    return res.status(400).json({ message: 'from_lat, from_lng, to_lat, and to_lng are required.' });
  }
  try {
    const directions = await fetchDrivingDirections(
      { lat: from_lat, lng: from_lng },
      { lat: to_lat, lng: to_lng },
    );
    res.json({ directions });
  } catch (error) {
    res.status(502).json({ message: error.message || 'Unable to build driving directions.' });
  }
}));

app.get('/api/customer/:id/bookings/:bookingId/track', asyncRoute(async (req, res) => {
  const result = await db.query(`
    SELECT
      b.*,
      p.full_name AS provider_name,
      p.category AS provider_category,
      p.contact AS provider_contact,
      p.latitude AS provider_latitude,
      p.longitude AS provider_longitude,
      p.location_accuracy_m AS provider_location_accuracy_m,
      p.location_updated_at AS provider_location_updated_at
    FROM customer_bookings b
    LEFT JOIN providers p ON p.id = b.provider_id
    WHERE b.id = $1 AND b.customer_id = $2
  `, [req.params.bookingId, req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: 'Booking not found.' });

  const booking = customerBookingRow(result.rows[0]);
  const trackingEnabled = isLiveTrackableStatus(booking.status);
  const customerLat = Number(booking.latitude);
  const customerLng = Number(booking.longitude);
  const providerLat = Number(booking.provider_latitude);
  const providerLng = Number(booking.provider_longitude);
  const hasCustomerPin = Number.isFinite(customerLat) && Number.isFinite(customerLng);
  const hasProviderGps = Number.isFinite(providerLat) && Number.isFinite(providerLng);
  const wantDirections = ['1', 'true', 'yes'].includes(String(req.query.directions || '').toLowerCase());
  let directions = null;
  if (wantDirections && trackingEnabled && hasCustomerPin && hasProviderGps) {
    try {
      directions = await fetchDrivingDirections(
        { lat: providerLat, lng: providerLng },
        { lat: customerLat, lng: customerLng },
      );
    } catch (error) {
      directions = { error: error.message || 'Directions unavailable.' };
    }
  }

  res.json({
    booking,
    tracking_enabled: trackingEnabled,
    customer_pin: hasCustomerPin ? { lat: customerLat, lng: customerLng, address: booking.address } : null,
    provider_location: hasProviderGps ? {
      lat: providerLat,
      lng: providerLng,
      accuracy_m: booking.provider_location_accuracy_m,
      updated_at: booking.provider_location_updated_at,
      name: booking.provider_name,
    } : null,
    directions,
    message: trackingEnabled
      ? (hasProviderGps ? 'Live provider location is available.' : 'Waiting for the service provider to share live GPS.')
      : 'Live tracking starts after the provider accepts the booking.',
  });
}));

app.get('/api/customer/:id/messages', asyncRoute(async (req, res) => {
  const result = await db.query(`
    SELECT m.*, p.full_name AS provider_name
    FROM customer_messages m
    LEFT JOIN providers p ON p.id = m.provider_id
    WHERE m.customer_id = $1
    ORDER BY m.created_at DESC
  `, [req.params.id]);
  res.json({ messages: result.rows.map(customerMessageRow) });
}));

app.patch('/api/customer/:id/messages/:providerId/read', asyncRoute(async (req, res) => {
  await db.query(`
    UPDATE customer_messages
    SET is_read = TRUE
    WHERE customer_id = $1
      AND provider_id = $2
      AND sender_role = 'provider'
  `, [req.params.id, req.params.providerId]);
  res.json({ ok: true });
}));

app.post('/api/customer/:id/messages', asyncRoute(async (req, res) => {
  requireFields(req.body, ['provider_id', 'message']);
  const result = await db.query(`
    INSERT INTO customer_messages (customer_id, provider_id, sender_role, message, is_read)
    VALUES ($1, $2, 'customer', $3, FALSE)
    RETURNING *
  `, [req.params.id, req.body.provider_id, req.body.message.trim()]);

  const enriched = await db.query(`
    SELECT m.*, p.full_name AS provider_name
    FROM customer_messages m
    LEFT JOIN providers p ON p.id = m.provider_id
    WHERE m.id = $1
  `, [result.rows[0].id]);

  res.status(201).json({ message: customerMessageRow(enriched.rows[0]) });
}));

app.get('/api/customer/:id/favorites', asyncRoute(async (req, res) => {
  const result = await db.query(`
    SELECT f.id AS favorite_id, p.*
    FROM customer_favorites f
    JOIN providers p ON p.id = f.provider_id
    WHERE f.customer_id = $1
    ORDER BY f.created_at DESC
  `, [req.params.id]);
  res.json({ favorites: result.rows.map((row) => ({ favorite_id: row.favorite_id, ...providerRow(row) })) });
}));

app.post('/api/customer/:id/favorites', asyncRoute(async (req, res) => {
  requireFields(req.body, ['provider_id']);
  const result = await db.query(`
    INSERT INTO customer_favorites (customer_id, provider_id)
    VALUES ($1, $2)
    ON CONFLICT (customer_id, provider_id) DO UPDATE SET created_at = customer_favorites.created_at
    RETURNING id
  `, [req.params.id, req.body.provider_id]);
  res.status(201).json({ ok: true, favorite_id: result.rows[0]?.id || null });
}));

app.delete('/api/customer/:id/favorites/:providerId', asyncRoute(async (req, res) => {
  const result = await db.query(`
    DELETE FROM customer_favorites
    WHERE customer_id = $1 AND provider_id = $2
    RETURNING id
  `, [req.params.id, req.params.providerId]);
  res.json({ ok: true, removed: result.rowCount > 0 });
}));

app.post('/api/customer/:id/reviews', asyncRoute(async (req, res) => {
  requireFields(req.body, ['provider_id', 'booking_id', 'rating']);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
  }
  const booking = await db.query(`
    SELECT id, provider_id
    FROM customer_bookings
    WHERE id = $1 AND customer_id = $2 AND provider_id = $3 AND status = 'completed'
  `, [req.body.booking_id, req.params.id, req.body.provider_id]);
  if (!booking.rowCount) return res.status(400).json({ message: 'Only completed bookings can be reviewed.' });
  const existingReview = await db.query(
    'SELECT id FROM customer_reviews WHERE customer_id = $1 AND booking_id = $2 LIMIT 1',
    [req.params.id, req.body.booking_id]
  );
  if (existingReview.rowCount) return res.status(409).json({ message: 'This booking has already been reviewed.' });

  try {
    const result = await db.query(`
      INSERT INTO customer_reviews (customer_id, provider_id, booking_id, rating, comment)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [req.params.id, req.body.provider_id, req.body.booking_id, rating, String(req.body.comment || '').trim()]);
    res.status(201).json({ review: customerReviewRow(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'This booking has already been reviewed.' });
    throw error;
  }
}));

app.get('/api/customer/:id/reviews', asyncRoute(async (req, res) => {
  const result = await db.query(`
    SELECT r.*, p.full_name AS provider_name, p.service
    FROM customer_reviews r
    LEFT JOIN providers p ON p.id = r.provider_id
    WHERE r.customer_id = $1
    ORDER BY r.created_at DESC
  `, [req.params.id]);
  res.json({ reviews: result.rows.map(customerReviewRow) });
}));

app.post('/api/auth/provider/register', upload.fields([
  { name: 'docs', maxCount: 10 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  const isGoogleAuth = req.body.authProvider === 'google';
  requireFields(req.body, [
    'fullName', 'address', 'gender', 'contact', 'dob', 'email', 'password',
    'category', 'service', 'experience', 'experienceYears', 'experienceCertification',
  ]);
  if (!hasAssessmentSubmission(req.body.experience)) {
    return res.status(400).json({ message: 'Please complete the provider skill assessment before submitting.' });
  }
  await ensureUniqueAccountEmail(req.body.email);

  const contact = normalizeContactNumber(req.body.contact);
  const passwordHash = await buildRegistrationPasswordHash(req);
  const docs = (req.files?.docs || []).map((file) => file.filename);
  const result = await db.query(
    `INSERT INTO providers
      (full_name, address, gender, contact, dob, email, password_hash, category, service,
       experience, experience_years, experience_certification, documents_files, id_front_file, id_back_file, auth_provider, google_sub)
     VALUES ($1, $2, $3, $4, $5, lower($6), $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     RETURNING *`,
    [
      req.body.fullName.trim(),
      req.body.address.trim(),
      req.body.gender,
      contact,
      req.body.dob,
      req.body.email.trim(),
      passwordHash,
      req.body.category,
      req.body.service,
      req.body.experience.trim(),
      req.body.experienceYears,
      req.body.experienceCertification,
      docs,
      req.files?.idFront?.[0]?.filename || null,
      req.files?.idBack?.[0]?.filename || null,
      isGoogleAuth ? 'google' : 'password',
      isGoogleAuth ? req.body.googleSub || null : null,
    ]
  );

  const assessmentScore = extractAssessmentScore(req.body.experience);
  const badge = calculateProviderBadge(assessmentScore, req.body.experienceYears);
  await persistRequestUploads(req, { role: 'provider', id: result.rows[0].id });
  await db.query(`
    INSERT INTO provider_skill_assessments (provider_id, category, score, badge)
    VALUES ($1, $2, $3, $4)
  `, [result.rows[0].id, req.body.category || 'General', assessmentScore, badge]);
  await ensureProviderProfileService(result.rows[0]);

  res.status(201).json({ user: providerRow(result.rows[0]) });
}));

app.post('/api/auth/provider/login', asyncRoute(async (req, res) => {
  requireFields(req.body, ['email', 'password']);
  const result = await db.query('SELECT * FROM providers WHERE lower(email) = lower($1::text)', [req.body.email.trim()]);
  const provider = result.rows[0];

  if (!provider || !await bcrypt.compare(req.body.password, provider.password_hash)) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }

  res.json({ user: providerRow(provider) });
}));

app.get('/api/auth/provider/status/:id', asyncRoute(async (req, res) => {
  const result = await db.query('SELECT * FROM providers WHERE id = $1', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ message: 'Provider not found.' });
  res.json({ user: providerRow(result.rows[0]) });
}));

app.patch('/api/provider/:id/profile', asyncRoute(async (req, res) => {
  requireFields(req.body, ['full_name', 'contact', 'address', 'category', 'service']);
  const contact = normalizeContactNumber(req.body.contact);
  const result = await db.query(`
    UPDATE providers
    SET full_name = $2,
        contact = $3,
        address = $4,
        category = $5,
        service = $6,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    req.params.id,
    String(req.body.full_name || '').trim(),
    contact,
    String(req.body.address || '').trim(),
    String(req.body.category || '').trim(),
    String(req.body.service || '').trim(),
  ]);
  if (!result.rowCount) return res.status(404).json({ message: 'Provider not found.' });
  await ensureProviderProfileService(result.rows[0]);
  res.json({ user: providerRow(result.rows[0]) });
}));

app.post('/api/provider/:id/reassessment', asyncRoute(async (req, res) => {
  requireFields(req.body, ['category', 'score', 'answers']);
  const providerResult = await db.query('SELECT * FROM providers WHERE id = $1', [req.params.id]);
  const provider = providerResult.rows[0];
  if (!provider) return res.status(404).json({ message: 'Provider not found.' });

  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (!answers.length) {
    return res.status(400).json({ message: 'Assessment answers are required.' });
  }

  const score = clampScore(req.body.score);
  const category = String(req.body.category || provider.category || 'General').trim() || 'General';
  const badge = calculateProviderBadge(score, provider.experience_years);
  const experience = `Assessment score: ${score}%. Answers: ${JSON.stringify(answers)}`;

  const assessmentResult = await db.query(`
    INSERT INTO provider_skill_assessments (provider_id, category, score, badge)
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `, [req.params.id, category, score, badge]);

  const updatedProvider = await db.query(`
    UPDATE providers
    SET experience = $2,
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, experience]);

  res.json({
    assessment: {
      ...assessmentResult.rows[0],
      badge,
    },
    user: providerRow({
      ...updatedProvider.rows[0],
      assessment_score: score,
      assessment_badge: badge,
    }),
  });
}));

app.patch('/api/provider/:id/credentials', upload.fields([
  { name: 'docs', maxCount: 10 },
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
]), asyncRoute(async (req, res) => {
  const docs = (req.files?.docs || []).map((file) => file.filename);
  const idFront = req.files?.idFront?.[0]?.filename || null;
  const idBack = req.files?.idBack?.[0]?.filename || null;
  if (!docs.length && !idFront && !idBack) {
    return res.status(400).json({ message: 'Upload at least one credential file.' });
  }

  await persistRequestUploads(req, { role: 'provider', id: req.params.id });
  const result = await db.query(`
    UPDATE providers
    SET documents_files = (
          SELECT ARRAY(
            SELECT DISTINCT item
            FROM unnest(COALESCE(documents_files, ARRAY[]::TEXT[]) || $2::TEXT[]) AS item
            WHERE item <> ''
            ORDER BY item
          )
        ),
        id_front_file = COALESCE($3, id_front_file),
        id_back_file = COALESCE($4, id_back_file),
        is_verified = FALSE,
        verification_status = 'pending',
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, docs, idFront, idBack]);
  if (!result.rowCount) return res.status(404).json({ message: 'Provider not found.' });
  res.json({ user: providerRow(result.rows[0]) });
}));

app.patch('/api/provider/:id/location', asyncRoute(async (req, res) => {
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ message: 'Valid GPS coordinates are required.' });
  }
  const result = await db.query(`
    UPDATE providers
    SET latitude = $2,
        longitude = $3,
        location_accuracy_m = $4,
        location_updated_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, latitude, longitude, Number.isFinite(accuracy) ? accuracy : null]);
  if (!result.rowCount) return res.status(404).json({ message: 'Provider not found.' });
  res.json({ user: providerRow(result.rows[0]) });
}));

app.get('/api/providers/search', asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const sort = String(req.query.sort || 'recommended');
  const availableOnly = ['true', '1', 'yes', 'available'].includes(String(req.query.available || '').toLowerCase());
  const customerId = req.query.customerId || null;

  const customer = customerId
    ? (await db.query('SELECT address FROM customers WHERE id = $1', [customerId])).rows[0]
    : null;
  const location = String(req.query.location || customer?.address || '').trim();

  const params = [];
  const where = [`(lower(COALESCE(p.verification_status, '')) = 'verified' OR p.is_verified IS TRUE)`];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(p.full_name) LIKE $${params.length}
      OR lower(p.category) LIKE $${params.length}
      OR lower(p.service) LIKE $${params.length}
      OR lower(p.address) LIKE $${params.length}
      OR lower(COALESCE(s.title, '')) LIKE $${params.length}
      OR lower(COALESCE(s.description, '')) LIKE $${params.length}
      OR lower(COALESCE(s.category, '')) LIKE $${params.length}
    )`);
  }
  if (category) {
    params.push(`%${category.toLowerCase()}%`);
    where.push(`(
      lower(p.category) LIKE $${params.length}
      OR lower(p.service) LIKE $${params.length}
      OR lower(COALESCE(s.category, '')) LIKE $${params.length}
      OR lower(COALESCE(s.title, '')) LIKE $${params.length}
    )`);
  }
  if (availableOnly) {
    where.push(`EXISTS (
      SELECT 1
      FROM provider_availability av
      WHERE av.provider_id = p.id
        AND av.available_date >= CURRENT_DATE
        AND av.is_available = TRUE
    )`);
  }

  params.push(location.toLowerCase());
  const locationParam = `$${params.length}`;

  const orderBy = sort === 'rating'
    ? 'rating DESC, completed_jobs DESC, proximity_score DESC, p.created_at DESC'
    : sort === 'nearest'
      ? 'proximity_score DESC, p.is_verified DESC, rating DESC, p.created_at DESC'
      : sort === 'top'
        ? "CASE WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 3 WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 2 ELSE 1 END DESC, rating DESC, completed_jobs DESC, proximity_score DESC, p.created_at DESC"
        : sort === 'highest'
          ? "CASE WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 THEN 4 WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 THEN 3 WHEN COALESCE(psa.score, extract_score.score, 0) >= 60 THEN 2 ELSE 1 END DESC, rating DESC, completed_jobs DESC, proximity_score DESC, p.created_at DESC"
          : sort === 'basic'
            ? "CASE WHEN COALESCE(psa.score, extract_score.score, 0) >= 60 THEN 2 ELSE 0 END DESC, rating DESC, completed_jobs DESC, proximity_score DESC, p.created_at DESC"
            : sort === 'available'
              ? 'available_slots DESC, recommendation_score DESC, rating DESC, p.created_at DESC'
              : 'recommendation_score DESC, p.is_verified DESC, rating DESC, completed_jobs DESC, p.created_at DESC';

  const result = await db.query(`
    SELECT
      p.*,
      COALESCE(AVG(r.rating), 4.8) AS rating,
      COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END)::int AS completed_jobs,
      COUNT(DISTINCT f.id)::int AS favorite_count,
      COALESCE(MIN(s.starting_price), 350) AS starting_price,
      (
        SELECT COUNT(*)::int
        FROM provider_availability av
        WHERE av.provider_id = p.id
          AND av.available_date >= CURRENT_DATE
          AND av.is_available = TRUE
      ) AS available_slots,
      COALESCE(psa.score, extract_score.score, 0)::int AS assessment_score,
      CASE
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 'Top-Tier Verified'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 'Skilled Verified'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 60 THEN 'Basic Verified'
        ELSE 'Needs Reassessment'
      END AS assessment_badge,
      CASE
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 80 AND lower(p.experience_years) ~ '(3|5|higher|\\+)' THEN 'top'
        WHEN COALESCE(psa.score, extract_score.score, 0) >= 70 AND lower(p.experience_years) ~ '(2|3|5|higher|\\+)' THEN 'skilled'
        ELSE 'basic'
      END AS verified_tier,
      CASE
        WHEN ${locationParam} <> '' AND lower(p.address) LIKE '%' || ${locationParam} || '%' THEN 3
        WHEN ${locationParam} <> '' AND EXISTS (
          SELECT 1 FROM regexp_split_to_table(${locationParam}, '\\s+') token
          WHERE length(token) > 2 AND lower(p.address) LIKE '%' || token || '%'
        ) THEN 2
        ELSE 1
      END AS proximity_score,
      (
        CASE WHEN p.is_verified THEN 30 ELSE 0 END
        + COALESCE(AVG(r.rating), 4.8) * 10
        + COUNT(DISTINCT CASE WHEN b.status = 'completed' THEN b.id END)
        + COUNT(DISTINCT f.id) * 2
        + (
          SELECT COUNT(*)::int
          FROM provider_availability av
          WHERE av.provider_id = p.id
            AND av.available_date >= CURRENT_DATE
            AND av.is_available = TRUE
        ) * 3
        + CASE
          WHEN ${locationParam} <> '' AND lower(p.address) LIKE '%' || ${locationParam} || '%' THEN 20
          WHEN ${locationParam} <> '' AND EXISTS (
            SELECT 1 FROM regexp_split_to_table(${locationParam}, '\\s+') token
            WHERE length(token) > 2 AND lower(p.address) LIKE '%' || token || '%'
          ) THEN 10
          ELSE 0
        END
      ) AS recommendation_score
    FROM providers p
    LEFT JOIN customer_reviews r ON r.provider_id = p.id
    LEFT JOIN customer_bookings b ON b.provider_id = p.id
    LEFT JOIN customer_favorites f ON f.provider_id = p.id
    LEFT JOIN provider_services s ON s.provider_id = p.id AND s.is_active = TRUE
    LEFT JOIN LATERAL (
      SELECT score, badge
      FROM provider_skill_assessments
      WHERE provider_id = p.id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) psa ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(NULLIF(substring(p.experience FROM 'Assessment score: ([0-9]{1,3})%'), '')::int, 0) AS score,
        'Needs Reassessment' AS badge
    ) extract_score ON TRUE
    WHERE ${where.join(' AND ')}
    GROUP BY p.id, psa.score, psa.badge, extract_score.score, extract_score.badge
    ORDER BY ${orderBy}
    LIMIT 30
  `, params);

  res.json({
    algorithm: {
      search_filtering: 'Filters providers by search text, category/service, verification status, and availability-ready records.',
      collaborative_filtering: 'Boosts providers with completed bookings and favorite interactions.',
      location_based: 'Boosts providers whose address matches the customer address or location tokens.',
      sorting: sort,
    },
    providers: result.rows.map((row) => ({
      ...providerRow(row),
      rating: Number(row.rating || 4.8),
      completed_jobs: Number(row.completed_jobs || 0),
      favorite_count: Number(row.favorite_count || 0),
      starting_price: Number(row.starting_price || 350),
      available_slots: Number(row.available_slots || 0),
      verified_tier: row.verified_tier,
      assessment_score: Number(row.assessment_score || 0),
      badge_status: row.assessment_badge,
      proximity_score: Number(row.proximity_score || 0),
      recommendation_score: Number(row.recommendation_score || 0),
    })),
  });
}));

app.get('/api/providers/nearby', asyncRoute(async (req, res) => {
  req.query.sort = 'nearest';
  req.query.location = req.query.location || req.query.address || '';
  const q = new URLSearchParams(req.query).toString();
  res.redirect(307, `/api/providers/search?${q}`);
}));

app.get('/api/customer/search/providers', asyncRoute(async (req, res) => {
  const q = new URLSearchParams(req.query).toString();
  res.redirect(307, `/api/providers/search?${q}`);
}));

app.get('/api/providers/:id/availability', asyncRoute(async (req, res) => {
  const date = String(req.query.date || '').trim();
  const params = [req.params.id];
  const where = ['provider_id = $1', 'available_date >= CURRENT_DATE', 'is_available = TRUE'];
  if (date) {
    params.push(date);
    where.push(`available_date = $${params.length}`);
  }

  const result = await db.query(`
    SELECT id, available_date, start_time, end_time, is_available
    FROM provider_availability
    WHERE ${where.join(' AND ')}
    ORDER BY available_date ASC, start_time ASC
    LIMIT 12
  `, params);

  res.json({
    algorithm: {
      booking_scheduling: 'Returns provider availability slots for the selected date. Customers can only submit a slot that is still open.',
      alternative_slots: 'If the selected slot is unavailable, the booking endpoint returns the next open slots for the same provider.',
    },
    availability: result.rows,
  });
}));

app.post('/api/customer/:id/bookings', asyncRoute(async (req, res) => {
  requireFields(req.body, ['provider_id', 'service', 'scheduled_date', 'scheduled_time', 'address']);
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const accuracy = Number(req.body.accuracy);
  const hasBookingGps = Number.isFinite(latitude) && Number.isFinite(longitude);

  const availability = await db.query(`
    SELECT id FROM provider_availability
    WHERE provider_id = $1
      AND available_date = $2
      AND start_time = $3
      AND is_available = TRUE
    LIMIT 1
  `, [req.body.provider_id, req.body.scheduled_date, req.body.scheduled_time]);

  if (!availability.rowCount) {
    const alternatives = await db.query(`
      SELECT available_date, start_time, end_time
      FROM provider_availability
      WHERE provider_id = $1 AND available_date >= CURRENT_DATE AND is_available = TRUE
      ORDER BY available_date ASC, start_time ASC
      LIMIT 5
    `, [req.body.provider_id]);
    return res.status(409).json({
      message: 'Selected schedule is not available.',
      alternatives: alternatives.rows,
      algorithm: 'Booking & Scheduling Algorithm',
    });
  }

  const result = await db.query(`
    INSERT INTO customer_bookings (
      customer_id,
      provider_id,
      service,
      scheduled_date,
      scheduled_time,
      address,
      latitude,
      longitude,
      location_accuracy_m,
      location_updated_at,
      amount,
      payment_method,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${hasBookingGps ? 'NOW()' : 'NULL'}, COALESCE($10, 0), COALESCE($11, 'cash'), 'pending')
    RETURNING *
  `, [
    req.params.id,
    req.body.provider_id,
    req.body.service.trim(),
    req.body.scheduled_date,
    req.body.scheduled_time,
    req.body.address.trim(),
    hasBookingGps ? latitude : null,
    hasBookingGps ? longitude : null,
    Number.isFinite(accuracy) ? accuracy : null,
    req.body.amount || 0,
    req.body.payment_method || 'cash',
  ]);

  await db.query(`
    UPDATE provider_availability
    SET is_available = FALSE
    WHERE provider_id = $1 AND available_date = $2 AND start_time = $3
  `, [req.body.provider_id, req.body.scheduled_date, req.body.scheduled_time]);

  res.status(201).json({ booking: customerBookingRow(result.rows[0]) });
}));

app.get('/api/provider/:id/dashboard', asyncRoute(async (req, res) => {
  const providerId = req.params.id;
  const [provider, services, bookings, messages, reviews, availability, assessment] = await Promise.all([
    db.query('SELECT * FROM providers WHERE id = $1', [providerId]),
    db.query('SELECT * FROM provider_services WHERE provider_id = $1 ORDER BY is_active DESC, created_at DESC', [providerId]),
    db.query(`
      SELECT
        b.*,
        b.latitude AS booking_latitude,
        b.longitude AS booking_longitude,
        b.location_accuracy_m AS booking_location_accuracy_m,
        b.location_updated_at AS booking_location_updated_at,
        c.full_name AS customer_name,
        c.contact AS customer_contact,
        c.latitude AS customer_latitude,
        c.longitude AS customer_longitude,
        c.location_accuracy_m AS customer_location_accuracy_m,
        c.location_updated_at AS customer_location_updated_at
      FROM customer_bookings b
      LEFT JOIN customers c ON c.id = b.customer_id
      WHERE b.provider_id = $1
      ORDER BY b.scheduled_date DESC, b.id DESC
    `, [providerId]),
    db.query(`
      SELECT m.*, c.full_name AS customer_name
      FROM customer_messages m
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.provider_id = $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `, [providerId]),
    db.query(`
      SELECT r.*, c.full_name AS customer_name, p.service
      FROM customer_reviews r
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN providers p ON p.id = r.provider_id
      WHERE r.provider_id = $1
      ORDER BY r.created_at DESC
    `, [providerId]),
    db.query(`
      SELECT * FROM provider_availability
      WHERE provider_id = $1 AND available_date >= CURRENT_DATE
      ORDER BY available_date ASC, start_time ASC
      LIMIT 20
    `, [providerId]),
    db.query('SELECT * FROM provider_skill_assessments WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 1', [providerId]),
  ]);

  if (!provider.rowCount) return res.status(404).json({ message: 'Provider not found.' });

  const bookingRows = bookings.rows;
  const completed = bookingRows.filter((row) => row.status === 'completed');
  const pending = bookingRows.filter((row) => row.status === 'pending');
  const ratingAvg = reviews.rows.length
    ? reviews.rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / reviews.rows.length
    : null;
  const earnings = completed.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const earnings30 = sumCompletedEarningsSince(bookingRows, 30);
  const earnings14 = sumCompletedEarningsSince(bookingRows, 14);
  const earnings7 = sumCompletedEarningsSince(bookingRows, 7);
  const providerRecord = provider.rows[0];
  const assessmentRecord = assessment.rows[0] || null;
  const assessmentScore = assessmentRecord?.score ?? extractAssessmentScore(providerRecord.experience);
  const computedBadge = calculateProviderBadge(assessmentScore, providerRecord.experience_years);

  res.json({
    provider: providerRow({
      ...providerRecord,
      assessment_score: assessmentScore,
      assessment_badge: computedBadge,
    }),
    metrics: {
      rating: ratingAvg === null ? null : Number(ratingAvg.toFixed(1)),
      review_count: reviews.rows.length,
      completed_jobs: completed.length,
      response_rate: bookingResponseRate(bookingRows),
      pending_requests: pending.length,
      total_earnings: earnings,
      earnings_last_30_days: earnings30.amount,
      earnings_last_14_days: earnings14.amount,
      earnings_last_7_days: earnings7.amount,
      jobs_last_30_days: earnings30.jobs,
      jobs_last_14_days: earnings14.jobs,
      jobs_last_7_days: earnings7.jobs,
      avg_response_time: averageProviderReplyLabel(messages.rows),
      badge_status: computedBadge,
    },
    services: services.rows.map(providerServiceRow),
    bookings: bookingRows
      .filter((row) => !row.provider_closed)
      .map(providerBookingRow),
    history_bookings: bookingRows.map(providerBookingRow),
    messages: messages.rows.map(providerMessageRow),
    reviews: reviews.rows.map((row) => ({
      id: row.id,
      customer_name: row.customer_name,
      service: row.service,
      rating: row.rating,
      comment: row.comment,
      created_at: row.created_at,
    })),
    availability: availability.rows,
    assessment: assessmentRecord ? { ...assessmentRecord, badge: computedBadge } : {
      provider_id: Number(providerId),
      category: providerRecord.category || 'General',
      score: assessmentScore,
      badge: computedBadge,
    },
  });
}));

app.post('/api/provider/:id/services', asyncRoute(async (req, res) => {
  requireFields(req.body, ['title', 'category']);
  const result = await db.query(`
    INSERT INTO provider_services
      (provider_id, title, description, category, starting_price, max_price, accepts_cash, accepts_gcash, accepts_other, is_active)
    VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, 0), COALESCE($7, TRUE), COALESCE($8, FALSE), COALESCE($9, FALSE), COALESCE($10, TRUE))
    RETURNING *
  `, [
    req.params.id,
    req.body.title.trim(),
    String(req.body.description || '').trim(),
    req.body.category.trim(),
    req.body.starting_price || 0,
    req.body.max_price || req.body.starting_price || 0,
    req.body.accepts_cash !== false,
    Boolean(req.body.accepts_gcash),
    Boolean(req.body.accepts_other),
    req.body.is_active !== false,
  ]);
  await upsertServiceCategory(req.body.category, req.body.title);
  res.status(201).json({ service: providerServiceRow(result.rows[0]) });
}));

app.patch('/api/provider/:providerId/services/:serviceId', asyncRoute(async (req, res) => {
  const result = await db.query(`
    UPDATE provider_services
    SET title = COALESCE($3, title),
        description = COALESCE($4, description),
        category = COALESCE($5, category),
        starting_price = COALESCE($6, starting_price),
        max_price = COALESCE($7, max_price),
        accepts_cash = COALESCE($8, accepts_cash),
        accepts_gcash = COALESCE($9, accepts_gcash),
        accepts_other = COALESCE($10, accepts_other),
        is_active = COALESCE($11, is_active),
        updated_at = NOW()
    WHERE provider_id = $1 AND id = $2
    RETURNING *
  `, [
    req.params.providerId,
    req.params.serviceId,
    req.body.title?.trim(),
    req.body.description?.trim(),
    req.body.category?.trim(),
    req.body.starting_price ?? null,
    req.body.max_price ?? null,
    req.body.accepts_cash ?? null,
    req.body.accepts_gcash ?? null,
    req.body.accepts_other ?? null,
    req.body.is_active ?? null,
  ]);
  if (!result.rowCount) return res.status(404).json({ message: 'Service not found.' });
  await upsertServiceCategory(result.rows[0].category, result.rows[0].title);
  res.json({ service: providerServiceRow(result.rows[0]) });
}));

app.delete('/api/provider/:providerId/services/:serviceId', asyncRoute(async (req, res) => {
  const result = await db.query('DELETE FROM provider_services WHERE provider_id = $1 AND id = $2 RETURNING id', [
    req.params.providerId,
    req.params.serviceId,
  ]);
  if (!result.rowCount) return res.status(404).json({ message: 'Service not found.' });
  res.json({ ok: true });
}));

app.post('/api/provider/:id/availability', asyncRoute(async (req, res) => {
  requireFields(req.body, ['available_date', 'start_time', 'end_time']);
  const result = await db.query(`
    INSERT INTO provider_availability (provider_id, available_date, start_time, end_time, is_available)
    VALUES ($1, $2, $3, $4, COALESCE($5, TRUE))
    ON CONFLICT (provider_id, available_date, start_time)
    DO UPDATE SET end_time = EXCLUDED.end_time, is_available = EXCLUDED.is_available
    RETURNING *
  `, [req.params.id, req.body.available_date, req.body.start_time, req.body.end_time, req.body.is_available !== false]);
  res.status(201).json({ availability: result.rows[0] });
}));

app.patch('/api/provider/:providerId/availability/:slotId', asyncRoute(async (req, res) => {
  const result = await db.query(`
    UPDATE provider_availability
    SET available_date = COALESCE($3, available_date),
        start_time = COALESCE($4, start_time),
        end_time = COALESCE($5, end_time),
        is_available = COALESCE($6, is_available)
    WHERE provider_id = $1 AND id = $2
    RETURNING *
  `, [
    req.params.providerId,
    req.params.slotId,
    req.body.available_date || null,
    req.body.start_time || null,
    req.body.end_time || null,
    typeof req.body.is_available === 'boolean' ? req.body.is_available : null,
  ]);
  if (!result.rowCount) return res.status(404).json({ message: 'Availability slot not found.' });
  res.json({ availability: result.rows[0] });
}));

app.delete('/api/provider/:providerId/availability/:slotId', asyncRoute(async (req, res) => {
  const result = await db.query(`
    DELETE FROM provider_availability
    WHERE provider_id = $1 AND id = $2
    RETURNING id
  `, [req.params.providerId, req.params.slotId]);
  if (!result.rowCount) return res.status(404).json({ message: 'Availability slot not found.' });
  res.json({ ok: true });
}));

app.patch('/api/provider/:providerId/bookings/:bookingId/status', asyncRoute(async (req, res) => {
  requireFields(req.body, ['status']);
  const status = String(req.body.status).toLowerCase();
  if (!['pending', 'upcoming', 'ongoing', 'completed', 'cancelled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid booking status.' });
  }
  const result = await db.query(`
    UPDATE customer_bookings
    SET status = $3, updated_at = NOW()
    WHERE provider_id = $1 AND id = $2
    RETURNING *
  `, [req.params.providerId, req.params.bookingId, status]);
  if (!result.rowCount) return res.status(404).json({ message: 'Booking not found.' });
  const booking = result.rows[0];
  if (status === 'cancelled') {
    await db.query(`
      UPDATE provider_availability
      SET is_available = TRUE
      WHERE provider_id = $1 AND available_date = $2 AND start_time = $3
    `, [booking.provider_id, booking.scheduled_date, booking.scheduled_time]);
  } else if (['upcoming', 'ongoing', 'completed'].includes(status)) {
    await db.query(`
      UPDATE provider_availability
      SET is_available = FALSE
      WHERE provider_id = $1 AND available_date = $2 AND start_time = $3
    `, [booking.provider_id, booking.scheduled_date, booking.scheduled_time]);
  }
  res.json({ booking: providerBookingRow(result.rows[0]) });
}));

app.patch('/api/provider/:providerId/bookings/:bookingId/close', asyncRoute(async (req, res) => {
  const result = await db.query(`
    UPDATE customer_bookings
    SET provider_closed = TRUE, updated_at = NOW()
    WHERE provider_id = $1 AND id = $2 AND status = 'completed'
    RETURNING *
  `, [req.params.providerId, req.params.bookingId]);
  if (!result.rowCount) return res.status(404).json({ message: 'Completed booking not found.' });
  res.json({ archived: true, booking: providerBookingRow(result.rows[0]) });
}));

app.post('/api/provider/:providerId/messages', asyncRoute(async (req, res) => {
  requireFields(req.body, ['customer_id', 'message']);
  const result = await db.query(`
    INSERT INTO customer_messages (customer_id, provider_id, sender_role, message, is_read)
    VALUES ($1, $2, 'provider', $3, FALSE)
    RETURNING *
  `, [req.body.customer_id, req.params.providerId, req.body.message.trim()]);
  res.status(201).json({ message: providerMessageRow(result.rows[0]) });
}));

app.patch('/api/provider/:providerId/messages/:customerId/read', asyncRoute(async (req, res) => {
  await db.query(`
    UPDATE customer_messages
    SET is_read = TRUE
    WHERE provider_id = $1
      AND customer_id = $2
      AND sender_role = 'customer'
  `, [req.params.providerId, req.params.customerId]);
  res.json({ ok: true });
}));

app.get('/api/provider/:id/:section', asyncRoute(async (req, res, next) => {
  const allowed = new Set(['services', 'requests', 'schedule', 'inbox', 'assessment', 'reviews', 'history', 'profile']);
  if (!allowed.has(req.params.section)) return next();
  res.redirect(307, `/api/provider/${req.params.id}/dashboard`);
}));

app.post('/api/auth/admin/login', asyncRoute(async (req, res) => {
  requireFields(req.body, ['username', 'password']);
  const result = await db.query('SELECT * FROM admins WHERE username = $1', [req.body.username.trim()]);
  const admin = result.rows[0];

  if (!admin || !await bcrypt.compare(req.body.password, admin.password_hash)) {
    return res.status(401).json({ message: 'Invalid username or password.' });
  }

  res.json({ user: { id: admin.id, username: admin.username, role: 'admin' } });
}));

app.get('/api/admin/customers', asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'pending');
  const params = [];
  let where = '';
  if (['pending', 'verified', 'rejected'].includes(status)) {
    params.push(status);
    where = 'WHERE p.verification_status = $1';
  }

  const result = await db.query(`SELECT * FROM customers ${where} ORDER BY created_at DESC`, params);
  res.json({ customers: result.rows.map(customerRow) });
}));

app.get('/api/admin/users', asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'all');
  const params = [];
  let where = '';
  if (['pending', 'verified', 'rejected'].includes(status)) {
    params.push(status);
    where = 'WHERE verification_status = $1';
  }

  const [customersResult, providersResult] = await Promise.all([
    db.query(`SELECT * FROM customers ${where}`, params),
    db.query(`SELECT * FROM providers ${where}`, params),
  ]);

  const users = [
    ...customersResult.rows.map(customerRow),
    ...providersResult.rows.map(providerRow),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ users });
}));

app.get('/api/admin/dashboard', asyncRoute(async (_req, res) => {
  const [customerCounts, providerCounts, categoryTrends, recentCustomers, recentProviders, feedbackCounts] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
      FROM customers
    `),
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE verification_status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE verification_status = 'verified')::int AS verified,
        COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today
      FROM providers
    `),
    db.query(`
      SELECT category AS name, COUNT(*)::int AS count
      FROM providers
      GROUP BY category
      ORDER BY count DESC, category ASC
      LIMIT 5
    `),
    db.query('SELECT full_name, created_at FROM customers ORDER BY created_at DESC LIMIT 4'),
    db.query('SELECT full_name, category, created_at, verification_status FROM providers ORDER BY created_at DESC LIMIT 4'),
    db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status IN ('open', 'review'))::int AS open
      FROM admin_feedback
      WHERE lower(subject) <> 'positive feedback'
    `),
  ]);

  const customers = customerCounts.rows[0];
  const providers = providerCounts.rows[0];
  const feedback = feedbackCounts.rows[0];
  const recentActivity = [
    ...recentCustomers.rows.map((row) => ({
      type: 'customer',
      title: 'Customer registered',
      detail: row.full_name,
      created_at: row.created_at,
    })),
    ...recentProviders.rows.map((row) => ({
      type: 'provider',
      title: 'Provider application submitted',
      detail: `${row.full_name} - ${row.category}`,
      status: row.verification_status,
      created_at: row.created_at,
    })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);

  res.json({
    metrics: {
      users: customers.total + providers.total,
      customers: customers.total,
      providers: providers.total,
      pending: customers.pending + providers.pending,
      verified: customers.verified + providers.verified,
      registered_today: customers.today + providers.today,
      open_feedback: feedback.open,
      total_feedback: feedback.total,
    },
    categoryTrends: categoryTrends.rows,
    recentActivity,
  });
}));

app.get('/api/admin/providers', asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'all');
  const params = [];
  let where = '';
  if (['pending', 'verified', 'rejected'].includes(status)) {
    params.push(status);
    where = 'WHERE verification_status = $1';
  }

  const result = await db.query(`
    SELECT p.*, psa.score AS assessment_score, psa.badge AS assessment_badge
    FROM providers p
    LEFT JOIN LATERAL (
      SELECT score, badge
      FROM provider_skill_assessments
      WHERE provider_id = p.id
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 1
    ) psa ON TRUE
    ${where}
    ORDER BY p.created_at DESC
  `, params);
  res.json({ providers: result.rows.map(providerRow) });
}));

app.get('/api/categories', asyncRoute(async (_req, res) => {
  const result = await db.query(`
    SELECT name
    FROM service_categories
    WHERE is_active = TRUE
    ORDER BY name ASC
  `);
  res.json({ categories: result.rows.map((row) => row.name).filter(Boolean) });
}));

app.get('/api/admin/categories', asyncRoute(async (_req, res) => {
  const result = await db.query(`
    SELECT
      c.*,
      COUNT(DISTINCT p.id)::int AS provider_count,
      (c.is_active AND COUNT(DISTINCT p.id) > 0) AS is_display_active,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT ps.title) FILTER (WHERE ps.title IS NOT NULL AND ps.title <> ''), NULL) AS provider_services
    FROM service_categories c
    LEFT JOIN providers p ON lower(p.category) = lower(c.name)
    LEFT JOIN provider_services ps ON lower(ps.category) = lower(c.name) AND ps.is_active = TRUE
    GROUP BY c.id
    ORDER BY c.name ASC
  `);
  res.json({ categories: result.rows.map(categoryRow) });
}));

app.post('/api/admin/categories', asyncRoute(async (req, res) => {
  requireFields(req.body, ['name']);
  const services = String(req.body.services || '')
    .split(',')
    .map((service) => service.trim())
    .filter(Boolean);
  const categoryName = String(req.body.name).trim();
  const result = await db.query(`
    INSERT INTO service_categories (name, description, services, is_active)
    VALUES ($1, $2, $3, TRUE)
    ON CONFLICT (name) DO UPDATE
    SET description = EXCLUDED.description,
        services = (
          SELECT ARRAY(
            SELECT DISTINCT item
            FROM unnest(service_categories.services || EXCLUDED.services) AS item
            WHERE item <> ''
            ORDER BY item
          )
        ),
        updated_at = NOW()
    RETURNING *, 0::int AS provider_count, ARRAY[]::TEXT[] AS provider_services
  `, [
    categoryName,
    String(req.body.description || `${categoryName} services.`).trim(),
    services,
  ]);
  res.status(201).json({ category: categoryRow(result.rows[0]) });
}));

app.get('/api/admin/reports', asyncRoute(async (_req, res) => {
  const [userSummary, categorySummary, providerSummary] = await Promise.all([
    db.query(`
      SELECT role, status, COUNT(*)::int AS count
      FROM (
        SELECT 'customer' AS role, verification_status AS status FROM customers
        UNION ALL
        SELECT 'provider' AS role, verification_status AS status FROM providers
      ) users
      GROUP BY role, status
      ORDER BY role, status
    `),
    db.query(`
      SELECT COALESCE(NULLIF(category, ''), 'Uncategorized') AS name, COUNT(*)::int AS count
      FROM providers
      GROUP BY COALESCE(NULLIF(category, ''), 'Uncategorized')
      ORDER BY count DESC, name ASC
    `),
    db.query(`
      SELECT full_name, category, service, verification_status, created_at
      FROM providers
      ORDER BY is_verified DESC, created_at DESC
      LIMIT 6
    `),
  ]);

  res.json({
    userSummary: userSummary.rows,
    categorySummary: categorySummary.rows,
    topProviders: providerSummary.rows.map(providerRow),
  });
}));

app.get('/api/admin/feedback', asyncRoute(async (req, res) => {
  const status = String(req.query.status || 'all');
  const params = [];
  const whereClauses = ["lower(subject) <> 'positive feedback'"];
  if (['open', 'review', 'resolved', 'logged'].includes(status)) {
    params.push(status);
    whereClauses.push(`status = $${params.length}`);
  }
  const where = `WHERE ${whereClauses.join(' AND ')}`;

  const result = await db.query(`SELECT * FROM admin_feedback ${where} ORDER BY created_at DESC`, params);
  res.json({ feedback: result.rows.map(feedbackRow) });
}));

app.patch('/api/admin/customers/:id/verify', asyncRoute(async (req, res) => {
  const result = await db.query(
    `UPDATE customers
     SET is_verified = TRUE, verification_status = 'verified', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ customer: customerRow(result.rows[0]) });
}));

app.patch('/api/admin/customers/:id/reject', asyncRoute(async (req, res) => {
  const result = await db.query(
    `UPDATE customers
     SET is_verified = FALSE, verification_status = 'rejected', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Customer not found.' });
  res.json({ customer: customerRow(result.rows[0]) });
}));

app.patch('/api/admin/providers/:id/verify', asyncRoute(async (req, res) => {
  const providerLookup = await db.query('SELECT * FROM providers WHERE id = $1', [req.params.id]);
  if (!providerLookup.rowCount) return res.status(404).json({ message: 'Provider not found.' });

  const existingAssessment = await db.query(`
    SELECT * FROM provider_skill_assessments
    WHERE provider_id = $1
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `, [req.params.id]);

  const provider = providerLookup.rows[0];
  const assessmentScore = existingAssessment.rows[0]?.score ?? extractAssessmentScore(provider.experience);
  const badge = calculateProviderBadge(assessmentScore, provider.experience_years);
  if (badge === 'Needs Reassessment') {
    return res.status(400).json({
      message: 'Provider cannot be verified yet. Skill assessment must be at least 60%.',
      assessment_score: assessmentScore,
      badge,
    });
  }

  const result = await db.query(
    `UPDATE providers
     SET is_verified = TRUE, verification_status = 'verified', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  await db.query(`
    INSERT INTO provider_skill_assessments (provider_id, category, score, badge)
    SELECT $1, $2, $3, $4
    WHERE NOT EXISTS (SELECT 1 FROM provider_skill_assessments WHERE provider_id = $1)
  `, [req.params.id, result.rows[0].category || 'General', assessmentScore, badge]);
  await db.query(`
    UPDATE provider_skill_assessments
    SET score = $2, badge = $3, updated_at = NOW()
    WHERE provider_id = $1
  `, [req.params.id, assessmentScore, badge]);
  res.json({
    provider: providerRow({
      ...result.rows[0],
      assessment_score: assessmentScore,
      assessment_badge: badge,
    }),
  });
}));

app.post('/api/admin/feedback', asyncRoute(async (req, res) => {
  requireFields(req.body, ['type', 'subject', 'message', 'submitted_by']);
  const result = await db.query(`
    INSERT INTO admin_feedback (type, subject, message, submitted_by, related_party, status, customer_id, provider_id, booking_id)
    VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'open'), $7, $8, $9)
    RETURNING *
  `, [
    req.body.type,
    req.body.subject.trim(),
    req.body.message.trim(),
    req.body.submitted_by.trim(),
    req.body.related_party || null,
    req.body.status || 'open',
    req.body.customer_id || null,
    req.body.provider_id || null,
    req.body.booking_id || null,
  ]);
  res.status(201).json({ feedback: feedbackRow(result.rows[0]) });
}));

app.patch('/api/admin/feedback/:id/status', asyncRoute(async (req, res) => {
  requireFields(req.body, ['status']);
  const result = await db.query(`
    UPDATE admin_feedback
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, req.body.status]);
  if (!result.rowCount) return res.status(404).json({ message: 'Feedback not found.' });
  res.json({ feedback: feedbackRow(result.rows[0]) });
}));

app.patch('/api/admin/providers/:id/reject', asyncRoute(async (req, res) => {
  const result = await db.query(
    `UPDATE providers
     SET is_verified = FALSE, verification_status = 'rejected', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );
  if (!result.rowCount) return res.status(404).json({ message: 'Provider not found.' });
  res.json({ provider: providerRow(result.rows[0]) });
}));

app.delete('/api/admin/providers/:id', asyncRoute(async (req, res) => {
  const result = await db.query(
    `DELETE FROM providers
     WHERE id = $1 AND verification_status = 'rejected'
     RETURNING id`,
    [req.params.id]
  );
  if (!result.rowCount) {
    return res.status(400).json({ message: 'Only declined provider submissions can be deleted.' });
  }
  res.json({ ok: true });
}));

app.use((error, _req, res, _next) => {
  if (error.code === '23505') {
    return res.status(409).json({ message: 'That email or username is already registered.' });
  }
  console.error(error);
  const status = error.statusCode || 500;
  res.status(status).json({ message: status === 500 ? 'Server error.' : error.message });
});

ensureAdminSupportTables()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SerbisyoNow auth API running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize admin database tables.', error);
    process.exitCode = 1;
  });
