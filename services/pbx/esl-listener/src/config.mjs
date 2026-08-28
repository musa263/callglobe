import fs from 'node:fs';
import { isIP } from 'node:net';

function integer(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${name} must use HTTPS.`);
  }
  return url.toString();
}

function enabled(name) {
  return ['1', 'true', 'yes', 'on'].includes((process.env[name] || '').toLowerCase());
}

function json(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function readableFile(name) {
  const path = required(name);
  fs.accessSync(path, fs.constants.R_OK);
  return path;
}

export function loadConfig() {
  const apnsEnabled = enabled('APNS_ENABLED');
  const fcmEnabled = enabled('FCM_ENABLED');
  const webhookSecret = process.env.VOCIVO_WEBHOOK_SECRET?.trim() || '';
  const eventWebhookUrl = optionalUrl('VOCIVO_EVENT_WEBHOOK_URL');
  const deviceResolverUrl = optionalUrl('VOCIVO_DEVICE_RESOLVER_URL');
  const directorySnapshotUrl = optionalUrl('VOCIVO_DIRECTORY_SNAPSHOT_URL');
  const pbxPublicIp = required('PBX_PUBLIC_IP');
  const pstnGatewayName = required('PSTN_GATEWAY_NAME');
  if (!isIP(pbxPublicIp)) throw new Error('PBX_PUBLIC_IP must be an IPv4 or IPv6 address.');
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(pstnGatewayName)) throw new Error('PSTN_GATEWAY_NAME contains invalid characters.');
  if ((eventWebhookUrl || deviceResolverUrl || directorySnapshotUrl) && webhookSecret.length < 32) {
    throw new Error('VOCIVO_WEBHOOK_SECRET must be at least 32 characters when webhooks are enabled.');
  }

  return {
    esl: {
      host: process.env.ESL_HOST?.trim() || '127.0.0.1',
      port: integer('ESL_PORT', 8021, 1, 65535),
      password: required('ESL_PASSWORD'),
      reconnectMinimumMs: integer('ESL_RECONNECT_MIN_MS', 500, 100, 30_000),
      reconnectMaximumMs: integer('ESL_RECONNECT_MAX_MS', 15_000, 500, 120_000),
    },
    healthPort: integer('HEALTH_PORT', 8088, 1, 65535),
    webhookSecret,
    eventWebhookUrl,
    deviceResolverUrl,
    directory: {
      snapshotUrl: directorySnapshotUrl,
      refreshMs: integer('VOCIVO_DIRECTORY_REFRESH_MS', 60_000, 10_000, 3_600_000),
      webhookSecret,
      dialplanPath: process.env.VOCIVO_INTERNAL_DIALPLAN_PATH?.trim() || '/run/vocivo/dialplan/vocivo.xml',
      dialplanVariables: {
        PBX_PUBLIC_IP: pbxPublicIp,
        PSTN_GATEWAY_NAME: pstnGatewayName,
      },
    },
    testDevices: json('PUSH_TEST_DEVICES_JSON', []),
    apns: apnsEnabled ? {
      enabled: true,
      teamId: required('APNS_TEAM_ID'),
      keyId: required('APNS_KEY_ID'),
      bundleId: required('APNS_BUNDLE_ID'),
      keyPath: readableFile('APNS_KEY_PATH'),
      environment: process.env.APNS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
      maxConcurrency: integer('APNS_MAX_CONCURRENCY', 32, 1, 100),
      maxQueue: integer('APNS_MAX_QUEUE', 5000, 0, 100_000),
    } : { enabled: false },
    fcm: fcmEnabled ? {
      enabled: true,
      serviceAccountPath: readableFile('FCM_SERVICE_ACCOUNT_PATH'),
    } : { enabled: false },
  };
}
