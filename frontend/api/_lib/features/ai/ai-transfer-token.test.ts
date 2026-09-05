import assert from 'node:assert/strict';
import test from 'node:test';
import { createAiTransferToken, verifyAiTransferToken } from './ai-transfer-token.js';

process.env.AUTH_SECRET ||= 'test-auth-secret-for-ai-transfer';

test('AI transfer tokens bind one tenant and one carrier call', () => {
  const token = createAiTransferToken({
    callControlId: 'v3:test-call', organizationId: 'primary', inboundNumber: '+18447161777',
    callerNumber: '+15168889967', callerName: 'Test Caller', assistantId: 'assistant-test',
  });
  assert.deepEqual(verifyAiTransferToken(token), {
    callControlId: 'v3:test-call', organizationId: 'primary', inboundNumber: '+18447161777',
    callerNumber: '+15168889967', callerName: 'Test Caller', assistantId: 'assistant-test',
    expiresAt: verifyAiTransferToken(token)?.expiresAt,
  });
  assert.equal(verifyAiTransferToken(`${token}tampered`), null);
});

test('AI transfer tokens expire closed', () => {
  const token = createAiTransferToken({
    callControlId: 'v3:expired', organizationId: 'primary', inboundNumber: '+18447161777', assistantId: 'assistant-test',
  }, -1);
  assert.equal(verifyAiTransferToken(token), null);
});
