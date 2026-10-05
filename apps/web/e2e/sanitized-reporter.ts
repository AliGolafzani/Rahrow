import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import process from 'node:process';
import { formatAlertDiagnostic } from './temporary-alert-diagnostics.ts';

/** Never render assertion details, steps, call arguments, stdout, stderr or page snapshots. */
export default class SanitizedReporter implements Reporter {
  private unexpectedAttachment = false;
  onTestEnd(test: TestCase, result: TestResult) {
    if (result.attachments.length > 0) this.unexpectedAttachment = true;
    for (const annotation of test.annotations ?? []) {
      const diagnostic = formatAlertDiagnostic(annotation);
      if (diagnostic) process.stdout.write(`${diagnostic}\n`);
    }
    const line = test.location.line;
    const title = test.title.replace(/[^a-zA-Z0-9 :.,()/-]/g, '');
    const location = result.error?.stack?.match(/(?:auth\.spec|fixtures)\.ts:(\d+):(\d+)/)?.[0];
    const message = result.error?.message ?? '';
    const category = message.includes('Cannot find module') ? 'module-load' : message.includes('Browser auth fixture') ? 'fixture-setup' : message.includes('browserType.launch') ? 'browser-launch' : message.includes('require()') ? 'module-format' : message.includes('test timeout') ? 'timeout' : 'assertion';
    process.stdout.write(`${result.status.toUpperCase()}: ${title} (line ${line}; ${category}${location ? `; assertion ${location}` : ''})\n`);
  }
  onError() { process.stderr.write('Browser acceptance setup failed; private diagnostics suppressed.\n'); }
  async onEnd(result: FullResult) {
    const status = this.unexpectedAttachment ? 'failed' : result.status;
    process.stdout.write(`Browser acceptance: ${status}. ${this.unexpectedAttachment ? 'Unexpected artifact capture rejected.' : 'No sensitive artifacts retained.'}\n`);
    return { status };
  }
}
