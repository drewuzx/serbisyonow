'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { profileDescription, profilePersonalFields, changeProviderPassword, validateCredential, saveProviderCredentials } = require('./provider-profile');
const bcrypt = require('bcryptjs');
const { issueSession } = require('./account-sessions');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('description is optional, bounded and stored as plain text', () => {
  assert.equal(profileDescription(undefined), null);
  assert.equal(profileDescription('  Description  '), 'Description');
  assert.equal(profileDescription(''), '');
  assert.equal(profileDescription('<script>text</script>'), '<script>text</script>');
  for (const input of [null, {}, 'a'.repeat(2001)]) assert.throws(() => profileDescription(input), { statusCode: 400 });
});

test('personal fields preserve omitted values and validate calendar dates', () => {
  assert.deepEqual(profilePersonalFields({}), { gender: null, dob: null });
  assert.deepEqual(profilePersonalFields({ gender: 'Female', dob: '2000-02-29' }), { gender: 'Female', dob: '2000-02-29' });
  for (const dob of ['2001-02-29', '2000-02-30', '2000-13-01', '2099-01-01', '1899-01-01', 'January 1', {}, '']) assert.throws(() => profilePersonalFields({ dob }), { statusCode: 400 });
  for (const gender of ['', 'invalid', {}]) assert.throws(() => profilePersonalFields({ gender }), { statusCode: 400 });
});

test('provider password changes are authenticated, atomic and keep only the current session', async () => {
  const f = await startQrFixture();
  try {
    const oldPassword = 'Original-Test-Password';
    const newPassword = 'Updated-Test-Password';
    const originalHash = await bcrypt.hash(oldPassword, 4);
    await f.db.query('UPDATE providers SET password_hash = $1 WHERE id = 81', [originalHash]);
    const secondSession = await issueSession(f.db, 'provider', 81);
    const body = { currentPassword: oldPassword, newPassword, confirmPassword: newPassword };
    const change = (data = body, token = f.providerToken, id = 81) => f.request(`/api/provider/${id}/change-password`, 'PATCH', data, token);
    assert.equal((await change(body, null)).status, 401);
    assert.equal((await change(body, f.customerToken)).status, 403);
    assert.equal((await change(body, f.otherProviderToken)).status, 403);
    assert.equal((await change(body, f.providerToken, 82)).status, 403);
    for (const invalid of [{}, { currentPassword: {} }, { currentPassword: 'wrong' }, { newPassword: 'short', confirmPassword: 'short' }, { confirmPassword: 'different' }, { newPassword: oldPassword, confirmPassword: oldPassword }, { newPassword: 'x'.repeat(73), confirmPassword: 'x'.repeat(73) }, { newPassword: '\u00e9'.repeat(37), confirmPassword: '\u00e9'.repeat(37) }]) {
      assert.equal((await change({ ...body, ...invalid, ...(!Object.keys(invalid).length ? { currentPassword: '' } : {}) })).status, 400);
    }
    await f.db.query("INSERT INTO password_reset_tokens (account_type, account_id, email, token_hash, expires_at) VALUES ('provider', 81, 'provider81@fixture.invalid', 'old-link', NOW() + INTERVAL '1 hour')");
    const failingDb = { query: f.db.query, pool: { async connect() {
      const client = await f.db.pool.connect();
      return { release: () => client.release(), query(sql, values) {
        if (sql.startsWith('DELETE FROM account_sessions')) throw new Error('Simulated session cleanup failure');
        return client.query(sql, values);
      } };
    } } };
    await assert.rejects(changeProviderPassword(failingDb, { headers: { authorization: `Bearer ${f.providerToken}` }, params: { id: 81 }, body }), /Simulated session cleanup failure/);
    assert.equal((await f.db.query('SELECT password_hash FROM providers WHERE id = 81')).rows[0].password_hash, originalHash);
    assert.equal((await f.request('/api/auth/provider/session', 'GET', undefined, secondSession)).status, 200);
    const result = await change({ ...body, id: 82 });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    const hash = (await f.db.query('SELECT password_hash FROM providers WHERE id = 81')).rows[0].password_hash;
    assert.notEqual(hash, newPassword);
    assert.equal(await bcrypt.compare(newPassword, hash), true);
    assert.equal((await f.request('/api/auth/provider/session', 'GET', undefined, f.providerToken)).status, 200);
    assert.equal((await f.request('/api/auth/provider/session', 'GET', undefined, secondSession)).status, 401);
    assert.equal((await f.request('/api/auth/provider/session', 'GET', undefined, f.otherProviderToken)).status, 200);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM password_reset_tokens WHERE account_id = 81')).rows[0].n, 0);
    assert.equal((await f.request('/api/auth/provider/login', 'POST', { email: 'provider81@fixture.invalid', password: oldPassword }, null)).status, 401);
    assert.equal((await f.request('/api/auth/provider/login', 'POST', { email: 'provider81@fixture.invalid', password: newPassword }, null)).status, 200);
    await f.db.query("UPDATE providers SET auth_provider = 'google' WHERE id = 81");
    assert.equal((await change({ ...body, currentPassword: newPassword, newPassword: 'Another-Password', confirmPassword: 'Another-Password' })).status, 409);
  } finally { await f.close(); }
});

test('credential content must match an allowed extension', () => {
  const file = (name, buffer, fieldname = 'docs') => ({ originalname: name, buffer, fieldname });
  assert.equal(validateCredential(file('sample.pdf', Buffer.from('%PDF-1.4\n'))).mime, 'application/pdf');
  assert.throws(() => validateCredential(file('script.html', Buffer.from('<script>'))), { statusCode: 400 });
  assert.throws(() => validateCredential(file('fake.png', Buffer.from('not a PNG'))), { statusCode: 400 });
  assert.throws(() => validateCredential(file('empty.pdf', Buffer.alloc(0))), { statusCode: 400 });
  assert.throws(() => validateCredential(file('large.pdf', Buffer.alloc(10 * 1024 * 1024 + 1))), { statusCode: 400 });
  assert.throws(() => validateCredential(file('id.docx', Buffer.from('word'), 'idFront')), { statusCode: 400 });
});

test('profile and credentials API: ownership, persistence, review, validation and rollback', async () => {
  const f = await startQrFixture();
  try {
    const body = { full_name: 'Profile Test Provider', contact: '09123456789', address: 'Test address', category: 'Cleaning Services', service: 'General House Cleaning', description: 'Detailed cleaning services.\nWork photos available.', gender: 'Prefer not to say', dob: '1995-06-15' };
    const profile = (payload, token = f.providerToken) => f.request('/api/provider/81/profile', 'PATCH', payload, token);
    assert.equal((await profile(body, null)).status, 401);
    assert.equal((await profile(body, f.otherProviderToken)).status, 403);
    assert.equal((await profile(body, f.customerToken)).status, 403);
    assert.equal((await profile({ ...body, description: 'x'.repeat(2001) })).status, 400);
    assert.equal((await profile(body)).data.user.description, body.description);
    assert.equal((await profile({ ...body, dob: '1995-02-30' })).status, 400);
    assert.equal((await profile({ ...body, gender: 'invalid' })).status, 400);
    const ignoredChanges = await profile({ ...body, email: 'changed@fixture.invalid', is_verified: true, badge_status: 'Top-Rated', password_hash: 'fake' });
    assert.equal(ignoredChanges.data.user.email, 'provider81@fixture.invalid');
    assert.equal(ignoredChanges.data.user.gender, body.gender);
    assert.equal(ignoredChanges.data.user.dob.slice(0, 10), body.dob);
    assert.equal((await f.db.query('SELECT password_hash FROM providers WHERE id = 81')).rows[0].password_hash, 'fixture');
    const legacyBody = { ...body }; delete legacyBody.gender; delete legacyBody.dob;
    assert.equal((await profile(legacyBody)).data.user.gender, body.gender);
    const withoutDescription = { ...body }; delete withoutDescription.description;
    assert.equal((await profile(withoutDescription)).data.user.description, body.description);
    assert.equal((await f.request('/api/provider/81/dashboard', 'GET', undefined, f.providerToken)).data.provider.description, body.description);
    assert.equal((await f.request('/api/auth/provider/status/81')).data.user.description, body.description);
    assert.equal((await f.db.query('SELECT experience FROM providers WHERE id = 81')).rows[0].experience, '');

    const form = (name = 'work.png', content = f.image, field = 'docs', type = 'image/png') => {
      const data = new FormData(); data.append(field, new Blob([content], { type }), name); return data;
    };
    const upload = (data, token = f.providerToken) => f.request('/api/provider/81/credentials', 'PATCH', data, token);
    assert.equal((await upload(form(), null)).status, 401);
    assert.equal((await upload(form(), f.otherProviderToken)).status, 403);
    assert.equal((await upload(new FormData())).status, 400);
    assert.equal((await upload(form('bad.html', '<script>'))).status, 400);
    assert.equal((await upload(form('fake.png', 'not an image'))).status, 400);
    assert.equal((await upload(form('empty.png', Buffer.alloc(0)))).status, 400);
    assert.equal((await upload(form('large.png', Buffer.alloc(10 * 1024 * 1024 + 1)))).status, 400);
    assert.equal((await upload(form('wrong.png', f.image, 'unexpected'))).status, 400);
    const many = new FormData();
    for (let i = 0; i < 11; i++) many.append('docs', new Blob([f.image], { type: 'image/png' }), `work-${i}.png`);
    assert.equal((await upload(many)).status, 400);
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM uploaded_files')).rows[0].count, 0);

    const data = form();
    data.append('idFront', new Blob([f.image], { type: 'image/png' }), 'front.png');
    data.append('idBack', new Blob([f.image], { type: 'image/png' }), 'back.png');
    const first = await upload(data);
    assert.equal(first.status, 200);
    assert.equal(first.data.user.is_verified, false);
    assert.equal(first.data.user.verification_status, 'pending');
    assert.equal(first.data.user.description, body.description);
    const filename = first.data.user.documents_files[0];
    const stored = (await f.db.query('SELECT * FROM uploaded_files WHERE filename = $1', [filename])).rows[0];
    assert.equal(stored.owner_id, 81);
    assert.equal(stored.owner_role, 'provider');
    assert.deepEqual(stored.content, f.image);
    const download = await f.request(`/uploads/provider-docs/${filename}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(download.data, f.image);
    assert.equal((await upload(form('certificate.pdf', '%PDF-1.4\n', 'docs', 'application/pdf'))).data.user.documents_files.length, 2);
    const current = (await f.request('/api/provider/81/dashboard', 'GET', undefined, f.providerToken)).data.provider;
    assert.equal(current.id_front_file, first.data.user.id_front_file);
    assert.equal(current.documents_files.length, 2);
    const adminToken = await issueSession(f.db, 'admin', 1);
    const adminList = await f.request('/api/admin/providers?status=all', 'GET', undefined, adminToken);
    assert.ok(adminList.data.providers.find(provider => provider.id === 81).documents_files.includes(filename));

    const count = (await f.db.query('SELECT count(*)::int AS count FROM uploaded_files')).rows[0].count;
    const failingDb = { pool: { async connect() {
      const client = await f.db.pool.connect();
      return { release: () => client.release(), query(sql, values) {
        if (sql.startsWith('UPDATE providers')) throw new Error('Simulated database failure');
        return client.query(sql, values);
      } };
    } } };
    await assert.rejects(saveProviderCredentials(failingDb, 81, [{ fieldname: 'docs', originalname: 'rollback.png', buffer: f.image }]), /Simulated database failure/);
    assert.equal((await f.db.query('SELECT count(*)::int AS count FROM uploaded_files')).rows[0].count, count);
    assert.equal((await profile({ ...body, description: '' })).data.user.description, '');
  } finally { await f.close(); }
});
