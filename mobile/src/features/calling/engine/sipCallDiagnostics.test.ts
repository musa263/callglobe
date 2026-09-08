import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { reportSipAnswerFailure } from './sipCallDiagnostics';

test('answer diagnostics contain only call correlation and bounded phase metadata', () => {
  const entries: unknown[][] = [];
  const original = console.error;
  console.error = (...args) => { entries.push(args); };
  try {
    reportSipAnswerFailure('call-123', 'accept_rejected', true, true);
    reportSipAnswerFailure('sip:private-caller@example.invalid', 'answer_timeout', false, false);
    assert.deepEqual(entries, [
      ['[Vocivo SIP answer failure]', { callId: 'call-123', phase: 'accept_rejected', invited: true, started: true }],
      ['[Vocivo SIP answer failure]', { callId: 'unavailable', phase: 'answer_timeout', invited: false, started: false }],
    ]);
  } finally { console.error = original; }
});

test('release Babel transform preserves answer diagnostics while stripping ordinary debug output', () => {
  const require = createRequire(import.meta.url);
  const { transformSync } = require('@babel/core');
  const plugin = require('../../../../plugins/stripProductionConsole');
  const source = readFileSync(new URL('./sipCallDiagnostics.ts', import.meta.url), 'utf8');
  const result = transformSync(source + '\nconsole.warn("debug-only");', {
    configFile: false, babelrc: false, envName: 'production',
    parserOpts: { plugins: ['typescript'] }, plugins: [plugin],
  });
  assert.match(result.code, /console\.error/);
  assert.doesNotMatch(result.code, /debug-only/);
});
