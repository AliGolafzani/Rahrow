import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { inspect } from 'node:util';
import test from 'node:test';
import {
  AuthSecurityError,
  OtpMac,
  TotpSecretCipher,
  assertCanonicalMobile,
  createSessionToken,
  digestSessionToken,
  generateOtpCode,
  hashAdminPassword,
  verifyAdminPassword,
} from '../dist/modules/auth/auth.security.js';

function ephemeralCipher() {
  const key = randomBytes(32);
  const cipher = new TotpSecretCipher({ activeKeyVersion: 'test-v1', keyLookup: (version) => (
    version === 'test-v1' ? key : undefined
  ) });
  return { cipher, key };
}

function flipByte(encoded) {
  const bytes = Buffer.from(encoded, 'base64url');
  bytes[0] ^= 1;
  return bytes.toString('base64url');
}

test('admin password hashing is versioned, randomly salted, asynchronous and verifies only matches', async () => {
  const password = randomBytes(24).toString('base64url');
  const pending = hashAdminPassword(password);
  assert.ok(pending instanceof Promise);
  const first = await pending;
  const second = await hashAdminPassword(password);
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$v1\$131072\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/u);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyAdminPassword(password, first), true);
  assert.equal(await verifyAdminPassword(`${password}x`, first), false);
});

test('password verifier rejects malformed or unbounded stored parameters before derivation', async () => {
  const salt = randomBytes(16).toString('base64url');
  const hash = randomBytes(64).toString('base64url');
  const encoding = `scrypt$v1$131072$8$1$${salt}$${hash}`;
  const invalid = [
    null, undefined, {}, '', 'x'.repeat(10000),
    encoding.replace('$v1$', '$v2$'),
    encoding.replace('$131072$', '$1073741824$'),
    encoding.replace('$131072$', '$1024$'),
    encoding.replace('$8$', '$999999$'),
    encoding.replace('$1$', '$2$'),
    `${encoding}$extra`, `${encoding}\n`,
    encoding.replace(salt, `${salt}=`),
    encoding.replace(salt, randomBytes(15).toString('base64url')),
    encoding.replace(hash, randomBytes(63).toString('base64url')),
  ];
  for (const candidate of invalid) {
    assert.equal(await verifyAdminPassword('non-secret-test-input', candidate), false);
  }
  for (const password of [null, undefined, '', 'a'.repeat(4097), '😀'.repeat(1025)]) {
    assert.equal(await verifyAdminPassword(password, encoding), false);
    await assert.rejects(hashAdminPassword(password), AuthSecurityError);
  }
});

test('canonical mobile validation never infers a country, normalizes or imposes eligibility rules', () => {
  for (const value of ['+1', '+15550000111', '+989120000000', '+123456789012345']) {
    assert.equal(assertCanonicalMobile(value), value);
  }
  for (const value of [
    null, undefined, 15550000111, '', '09120000000', '00989120000000', '+01234',
    ' +15550000111', '+15550000111 ', '+15550000111\n', '+1 5550000111',
    '+1-555-000-0111', '+۱۲۳۴۵', '+1234567890123456', '+',
  ]) {
    assert.throws(() => assertCanonicalMobile(value), AuthSecurityError);
  }
});

test('OTP uses CSPRNG six-digit strings and context-bound verification without plaintext storage', () => {
  const mac = new OtpMac(randomBytes(32));
  const targetDigest = mac.targetDigest('+15550000111');
  const context = { challengeId: randomUUID(), targetDigest };
  const code = generateOtpCode();
  const storedMac = mac.codeMac(context, code);
  assert.match(code, /^[0-9]{6}$/u);
  assert.match(storedMac, /^[0-9a-f]{64}$/u);
  assert.equal(mac.verifyCode(context, code, storedMac), true);
  assert.equal(mac.verifyCode(context, '000000' === code ? '000001' : '000000', storedMac), false);
  assert.equal(mac.verifyCode({ ...context, challengeId: randomUUID() }, code, storedMac), false);
  assert.equal(mac.verifyCode({ ...context, targetDigest: mac.targetDigest('+15550000222') }, code, storedMac), false);
  assert.equal(new OtpMac(randomBytes(32)).verifyCode(context, code, storedMac), false);
  // Leading zeroes are part of the code, never coerced to a number.
  const zeroMac = mac.codeMac(context, '000012');
  assert.equal(mac.verifyCode(context, '000012', zeroMac), true);
  assert.equal(mac.verifyCode(context, '12', zeroMac), false);
  for (let i = 0; i < 50; i += 1) assert.match(generateOtpCode(), /^[0-9]{6}$/u);
});

test('OTP target, code and rate-limit HMACs have independent derivation and message domains', () => {
  const rootKey = randomBytes(32);
  const mac = new OtpMac(rootKey);
  const mobile = '+15550000111';
  const targetDigest = mac.targetDigest(mobile);
  const targetKey = Buffer.from(hkdfSync('sha256', rootKey, 'rahrow:auth:key-derivation:v1', 'rahrow:otp:target-digest:v1', 32));
  const codeKey = Buffer.from(hkdfSync('sha256', rootKey, 'rahrow:auth:key-derivation:v1', 'rahrow:otp:code-verification:v1', 32));
  const message = JSON.stringify(['rahrow:otp:target:v1', mobile]);
  assert.notDeepEqual(targetKey, codeKey);
  assert.equal(targetDigest, createHmac('sha256', targetKey).update(message).digest('hex'));
  assert.notEqual(targetDigest, createHmac('sha256', codeKey).update(message).digest('hex'));
  assert.notEqual(targetDigest, createHmac('sha256', rootKey).update(message).digest('hex'));
  assert.notEqual(targetDigest, mac.rateLimitDigest('otp', mobile));
  assert.notEqual(mac.rateLimitDigest('otp-issue', mobile), mac.rateLimitDigest('otp-verify', mobile));
  assert.notEqual(mac.rateLimitDigest('a', 'bc'), mac.rateLimitDigest('ab', 'c'));
  assert.equal(mac.targetDigest(mobile), new OtpMac(rootKey).targetDigest(mobile));
  assert.notEqual(mac.targetDigest(mobile), new OtpMac(randomBytes(32)).targetDigest(mobile));
  targetKey.fill(0);
  codeKey.fill(0);
});

test('OTP rejects missing keys, invalid targets, malformed codes, contexts and noncanonical MACs', () => {
  for (const key of [undefined, null, '', randomBytes(16), randomBytes(31), randomBytes(33)]) {
    assert.throws(() => new OtpMac(key), AuthSecurityError);
  }
  const mac = new OtpMac(randomBytes(32));
  const context = { challengeId: randomUUID(), targetDigest: mac.targetDigest('+15550000111') };
  const code = generateOtpCode();
  const storedMac = mac.codeMac(context, code);
  for (const value of [undefined, null, '', '12345', '1234567', '123456\n', 123456, '۱۲۳۴۵۶']) {
    assert.equal(mac.verifyCode(context, value, storedMac), false);
    assert.throws(() => mac.codeMac(context, value), AuthSecurityError);
  }
  for (const value of [undefined, null, '', storedMac.slice(1), `${storedMac}=`, `${storedMac}\n`, 'x'.repeat(10000)]) {
    assert.equal(mac.verifyCode(context, code, value), false);
  }
  for (const value of [null, undefined, {}, { ...context, challengeId: '' }, { ...context, targetDigest: code }]) {
    assert.equal(mac.verifyCode(value, code, storedMac), false);
    assert.throws(() => mac.codeMac(value, code), AuthSecurityError);
  }
  assert.throws(() => mac.targetDigest('09120000000'), AuthSecurityError);
  assert.throws(() => mac.rateLimitDigest('', 'bounded'), AuthSecurityError);
  assert.throws(() => mac.rateLimitDigest('otp', 'x'.repeat(513)), AuthSecurityError);
});

test('TOTP envelopes use fresh nonces, authenticated encryption and explicit external key-version lookup', () => {
  const { cipher, key } = ephemeralCipher();
  const userId = randomUUID();
  const secret = randomBytes(20);
  const originalSecret = Buffer.from(secret);
  const first = cipher.encrypt(userId, secret);
  const second = cipher.encrypt(userId, secret);
  assert.deepEqual(Object.keys(first).sort(), ['authenticationTag', 'ciphertext', 'keyVersion', 'nonce']);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(Buffer.from(first.nonce, 'base64url').length, 12);
  assert.equal(Buffer.from(first.authenticationTag, 'base64url').length, 16);
  assert.equal(first.keyVersion, 'test-v1');
  assert.deepEqual(secret, originalSecret);
  const plaintext = cipher.decrypt(userId, first);
  assert.deepEqual(plaintext, secret);
  plaintext.fill(0);
  assert.equal(JSON.stringify(first).includes(secret.toString('base64url')), false);
  assert.equal(JSON.stringify(first).includes(key.toString('base64url')), false);
  // The external root key is itself domain-separated before AES use.
  const rawDecipher = createDecipheriv('aes-256-gcm', key, Buffer.from(first.nonce, 'base64url'));
  rawDecipher.setAAD(Buffer.from(JSON.stringify(['rahrow:admin:totp-envelope:v1', userId, first.keyVersion])));
  rawDecipher.setAuthTag(Buffer.from(first.authenticationTag, 'base64url'));
  rawDecipher.update(Buffer.from(first.ciphertext, 'base64url'));
  assert.throws(() => rawDecipher.final());
});

test('TOTP decryption fails closed for tampering, wrong user/key, missing key and changed key-version metadata', () => {
  const { cipher, key } = ephemeralCipher();
  const userId = randomUUID();
  const envelope = cipher.encrypt(userId, randomBytes(20));
  for (const field of ['ciphertext', 'nonce', 'authenticationTag']) {
    assert.throws(() => cipher.decrypt(userId, { ...envelope, [field]: flipByte(envelope[field]) }), AuthSecurityError);
  }
  assert.throws(() => cipher.decrypt(randomUUID(), envelope), AuthSecurityError);
  assert.throws(() => ephemeralCipher().cipher.decrypt(userId, envelope), AuthSecurityError);
  const missing = new TotpSecretCipher({ activeKeyVersion: 'test-v1', keyLookup: () => undefined });
  assert.throws(() => missing.encrypt(userId, randomBytes(20)), AuthSecurityError);
  assert.throws(() => missing.decrypt(userId, envelope), AuthSecurityError);
  const aliases = new TotpSecretCipher({ activeKeyVersion: 'test-v1', keyLookup: () => key });
  assert.throws(() => aliases.decrypt(userId, { ...envelope, keyVersion: 'test-v2' }), AuthSecurityError);
});

test('TOTP key rotation reads retained old versions and encrypts exclusively with the selected version', () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);
  const keys = new Map([['test-v1', oldKey], ['test-v2', newKey]]);
  const oldCipher = new TotpSecretCipher({ activeKeyVersion: 'test-v1', keyLookup: (version) => keys.get(version) });
  const rotated = new TotpSecretCipher({ activeKeyVersion: 'test-v2', keyLookup: (version) => keys.get(version) });
  const userId = randomUUID();
  const secret = randomBytes(20);
  const oldEnvelope = oldCipher.encrypt(userId, secret);
  const newEnvelope = rotated.encrypt(userId, secret);
  assert.equal(newEnvelope.keyVersion, 'test-v2');
  assert.deepEqual(rotated.decrypt(userId, oldEnvelope), secret);
  assert.deepEqual(rotated.decrypt(userId, newEnvelope), secret);
  keys.delete('test-v1');
  assert.throws(() => rotated.decrypt(userId, oldEnvelope), AuthSecurityError);
});

test('TOTP envelope validation bounds sizes and rejects malformed encodings without exposing crypto details', () => {
  const { cipher } = ephemeralCipher();
  const userId = randomUUID();
  const envelope = cipher.encrypt(userId, randomBytes(20));
  for (const invalid of [
    null, undefined, {},
    { ...envelope, keyVersion: '' }, { ...envelope, keyVersion: 'test-v1\n' },
    { ...envelope, keyVersion: 'x'.repeat(65) },
    { ...envelope, ciphertext: '' }, { ...envelope, ciphertext: 'x'.repeat(20000) },
    { ...envelope, nonce: `${envelope.nonce}=` },
    { ...envelope, nonce: randomBytes(11).toString('base64url') },
    { ...envelope, authenticationTag: randomBytes(15).toString('base64url') },
    { ...envelope, authenticationTag: `${envelope.authenticationTag}\n` },
  ]) assert.throws(() => cipher.decrypt(userId, invalid), AuthSecurityError);
  for (const secret of [undefined, null, '', Buffer.alloc(0), randomBytes(1025)]) {
    assert.throws(() => cipher.encrypt(userId, secret), AuthSecurityError);
  }
  for (const config of [undefined, null, {}, { activeKeyVersion: 'test-v1' }]) {
    assert.throws(() => new TotpSecretCipher(config), AuthSecurityError);
  }
});

test('session tokens are 32 random bytes, canonical, digest-only in serialization and purpose-bound', () => {
  const tokens = Array.from({ length: 16 }, () => createSessionToken());
  assert.equal(new Set(tokens.map(({ token }) => token)).size, tokens.length);
  for (const session of tokens) {
    assert.match(session.token, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(Buffer.from(session.token, 'base64url').length, 32);
    assert.equal(digestSessionToken(session.token), session.digest);
    assert.notEqual(session.token, session.digest);
    assert.deepEqual(JSON.parse(JSON.stringify(session)), { digest: session.digest });
    assert.equal(inspect(session).includes(session.token), false);
  }
  assert.notEqual(tokens[0].digest, tokens[1].digest);
  for (const token of [
    null, undefined, '', `${tokens[0].token}=`, `${tokens[0].token}\n`,
    randomBytes(31).toString('base64url'), randomBytes(33).toString('base64url'), 'x'.repeat(10000),
  ]) assert.throws(() => digestSessionToken(token), AuthSecurityError);
});

test('private key holders and errors never serialize keys, codes, tokens, passwords or provider errors', async () => {
  const secret = randomBytes(32).toString('base64url');
  const key = randomBytes(32);
  const mac = new OtpMac(key);
  const cipher = new TotpSecretCipher({
    activeKeyVersion: 'test-v1', keyLookup: () => { throw new Error(secret); },
  });
  assert.equal(JSON.stringify(mac), '{}');
  assert.equal(JSON.stringify(cipher), '{}');
  assert.equal(inspect(mac).includes(key.toString('hex')), false);
  let error;
  try { cipher.encrypt(randomUUID(), randomBytes(20)); } catch (caught) { error = caught; }
  assert.ok(error instanceof AuthSecurityError);
  assert.equal(error.message, 'Authentication security operation failed.');
  assert.equal('cause' in error, false);
  assert.equal(JSON.stringify(error).includes(secret), false);
  assert.equal(inspect(error).includes(secret), false);
  await assert.rejects(hashAdminPassword(`${secret}${'x'.repeat(4096)}`), (caught) => {
    assert.equal(caught.message.includes(secret), false);
    return caught instanceof AuthSecurityError;
  });
});
