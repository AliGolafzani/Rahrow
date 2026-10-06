import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMobileInput, isCanonicalMobile, activeChallenge } from '../src/lib/auth/state.ts';
import { requestOtp } from '../src/lib/auth/client.ts';
import { requested } from './auth-fixtures.mjs';

const { Response } = globalThis;

const accepted = [
  ['09121234567', '+989121234567'],
  ['+989121234567', '+989121234567'],
  ['+12025550123', '+12025550123'],
  [' 09121234567 ', '+989121234567'],
  ['\t +989121234567 \r\n', '+989121234567'],
  ['  +123456789012345  ', '+123456789012345'],
  ['+1', '+1'],
];

for (const [index, [input, canonical]] of accepted.entries()) {
  test(`mobile entry accepted fixture ${index + 1} normalizes before request and retains canonical resend target`, async t => {
    const bodies = [];
    t.mock.method(globalThis, 'fetch', async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return Response.json(requested, { status: 202 });
    });
    const normalized = normalizeMobileInput(input);
    assert.equal(normalized === canonical, true);
    assert.equal(isCanonicalMobile(normalized), true);
    const result = await requestOtp({ mobile: normalized });
    assert.equal(result.ok, true);
    const challenge = activeChallenge(result.value, normalized, 0);
    assert.equal(challenge.mobile === canonical, true);
    assert.equal((await requestOtp({ mobile: challenge.mobile })).ok, true);
    assert.equal(bodies.length, 2);
    assert.equal(bodies.every(body => body.mobile === canonical), true);
  });
}

test('mobile entry rejects malformed local input and never coerces or converts digits', () => {
  for (const value of [null, undefined, 9121234567, true, [], ['09121234567'],
    { toString: () => '09121234567' }, '', ' \t\n',
    '0912 1234567', '09\t121234567', '+98 9121234567', '0912-1234567', '(0912)1234567',
    '+98(912)1234567', '+98-9121234567', '0912123456', '091212345678', '08121234567',
    '9121234567', '00989121234567', '989121234567', '۰۹۱۲۱۲۳۴۵۶۷', '٠٩١٢١٢٣٤٥٦٧',
    '09۱21234567', '+۹۸۹۱۲۱۲۳۴۵۶۷', '+٩٨٩١٢١٢٣٤٥٦٧', '+0123', '+1234567890123456']) {
    assert.equal(normalizeMobileInput(value), null);
  }
});

test('canonical invariant and API client still reject local or untrimmed UI input without sending', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls += 1; throw new Error('Unexpected request'); });
  for (const value of ['09121234567', ' +989121234567 ', '۰۹۱۲۱۲۳۴۵۶۷', '٠٩١٢١٢٣٤٥٦٧']) {
    assert.equal(isCanonicalMobile(value), false);
    const result = await requestOtp({ mobile: value });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'AUTH_INVALID_INPUT');
  }
  assert.equal(calls, 0);
});
