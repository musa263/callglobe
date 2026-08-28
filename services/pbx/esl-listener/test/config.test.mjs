import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.mjs';

test('directory configuration receives the shared webhook signing secret', () => {
  const previous = {
    ESL_PASSWORD: process.env.ESL_PASSWORD,
    VOCIVO_DIRECTORY_SNAPSHOT_URL: process.env.VOCIVO_DIRECTORY_SNAPSHOT_URL,
    VOCIVO_WEBHOOK_SECRET: process.env.VOCIVO_WEBHOOK_SECRET,
    PBX_PUBLIC_IP: process.env.PBX_PUBLIC_IP,
    PSTN_GATEWAY_NAME: process.env.PSTN_GATEWAY_NAME,
  };

  process.env.ESL_PASSWORD = 'test-esl-password';
  process.env.VOCIVO_DIRECTORY_SNAPSHOT_URL = 'https://vocivo.example.test/api/voice/pbx-directory';
  process.env.VOCIVO_WEBHOOK_SECRET = 'a'.repeat(32);
  process.env.PBX_PUBLIC_IP = '203.0.113.10';
  process.env.PSTN_GATEWAY_NAME = 'carrier-a';

  try {
    const config = loadConfig();
    assert.equal(config.directory.webhookSecret, 'a'.repeat(32));
    assert.deepEqual(config.directory.dialplanVariables, { PBX_PUBLIC_IP: '203.0.113.10', PSTN_GATEWAY_NAME: 'carrier-a' });
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
