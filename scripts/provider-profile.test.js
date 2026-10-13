'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { profileDescription, validateCredential, saveProviderCredentials } = require('./provider-profile');
const { startQrFixture } = require('./provider-qr-test-fixture');

test('description is optional, bounded and stored as plain text', () => {
  assert.equal(profileDescription(undefined), null);
  assert.equal(profileDescription('  Description  '), 'Description');
  assert.equal(profileDescription(''), '');
  assert.equal(profileDescription('<script>text</script>'), '<script>text</script>');
  for (const input of [null, {}, 'a'.repeat(2001)]) assert.throws(() => profileDescription(input), { statusCode: 400 });
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
    const body = { full_name: 'Profile Test Provider', contact: '09123456789', address: 'Test address', category: 'Cleaning Services', service: 'General House Cleaning', description: 'Detailed cleaning services.\nWork photos available.' };
    const profile = (payload, token = f.providerToken) => f.request('/api/provider/81/profile', 'PATCH', payload, token);
    assert.equal((await profile(body, null)).status, 401);
    assert.equal((await profile(body, f.otherProviderToken)).status, 403);
    assert.equal((await profile(body, f.customerToken)).status, 403);
    assert.equal((await profile({ ...body, description: 'x'.repeat(2001) })).status, 400);
    assert.equal((await profile(body)).data.user.description, body.description);
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
    const adminList = await f.request('/api/admin/providers?status=all');
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
