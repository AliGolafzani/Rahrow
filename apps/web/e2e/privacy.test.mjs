import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { readFile } from 'node:fs/promises';
import SanitizedReporter from './sanitized-reporter.ts';

test('browser configuration disables all private artifact capture and automatic error context', async () => {
  const source = await readFile(new globalThis.URL('../playwright.config.ts', import.meta.url), 'utf8');
  for (const pattern of [/PLAYWRIGHT_NO_COPY_PROMPT = '1'/, /screenshot: 'off'/, /video: 'off'/,
    /trace: 'off'/, /preserveOutput: 'never'/, /stdout: 'ignore', stderr: 'ignore'/,
    /reporter: \[\['\.\/e2e\/sanitized-reporter\.ts'\]\]/]) assert.match(source, pattern);
});

test('browser reporter does not print synthetic codes, bearers, mobile or diagnostic payloads', async () => {
  const sentinel = 'synthetic-private-value-not-real-user-data';
  const reporter = new SanitizedReporter();
  const output = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = value => { output.push(String(value)); return true; };
  process.stderr.write = value => { output.push(String(value)); return true; };
  try {
    reporter.onTestEnd({ title: 'static acceptance case', location: { line: 1 } }, {
      status: 'failed', attachments: [], error: { message: sentinel, stack: `${sentinel}\n at auth.spec.ts:42:3` },
      stdout: [sentinel], stderr: [sentinel],
    });
    reporter.onError({ message: sentinel });
    await reporter.onEnd({ status: 'failed' });
  } finally { process.stdout.write = originalOut; process.stderr.write = originalErr; }
  assert.equal(output.join('').includes(sentinel), false);
  assert.match(output.join(''), /static acceptance case/);
  assert.match(output.join(''), /auth.spec.ts:42:3/);
});

test('unexpected browser attachments fail the privacy gate', async () => {
  const reporter = new SanitizedReporter();
  const original = process.stdout.write;
  process.stdout.write = () => true;
  try {
    reporter.onTestEnd({ title: 'static acceptance case', location: { line: 1 } }, {
      status: 'passed', attachments: [{ name: 'unexpected-artifact', contentType: 'text/plain' }],
    });
    assert.deepEqual(await reporter.onEnd({ status: 'passed' }), { status: 'failed' });
  } finally { process.stdout.write = original; }
});
