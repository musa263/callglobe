import { createSign } from 'node:crypto';
import fs from 'node:fs';
import http2 from 'node:http2';
import { buildIncomingCallEnvelope } from './push-payloads.mjs';
import { postSignedJson } from './signed-http.mjs';

const base64Url = (value) => Buffer.from(value).toString('base64url');

export class ConcurrencyGate {
  #limit;
  #maxQueue;
  #active = 0;
  #waiting = [];

  constructor(limit, maxQueue = 5000) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be a positive integer.');
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error('Concurrency queue limit must be a non-negative integer.');
    this.#limit = limit;
    this.#maxQueue = maxQueue;
  }

  async run(operation) {
    if (this.#active >= this.#limit) {
      if (this.#waiting.length >= this.#maxQueue) throw new Error('Push delivery queue is full.');
      await new Promise((resolve) => this.#waiting.push(resolve));
    }
    this.#active += 1;
    try { return await operation(); }
    finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }
}

function parseServiceAccount(path) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!value.client_email || !value.private_key || !value.project_id) {
    throw new Error('The Firebase service-account file is missing required fields.');
  }
  return value;
}

class ApnsVoipClient {
  #config;
  #privateKey;
  #jwt = null;
  #client = null;
  #connecting = null;
  #gate;

  constructor(config) {
    this.#config = config;
    this.#privateKey = fs.readFileSync(config.keyPath, 'utf8');
    this.#gate = new ConcurrencyGate(config.maxConcurrency, config.maxQueue);
  }

  #token() {
    const now = Math.floor(Date.now() / 1000);
    if (this.#jwt && now - this.#jwt.issuedAt < 45 * 60) return this.#jwt.value;
    const header = base64Url(JSON.stringify({ alg: 'ES256', kid: this.#config.keyId }));
    const payload = base64Url(JSON.stringify({ iss: this.#config.teamId, iat: now }));
    const signer = createSign('SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    const signature = signer.sign({ key: this.#privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    this.#jwt = { value: `${header}.${payload}.${signature}`, issuedAt: now };
    return this.#jwt.value;
  }

  #invalidate(client) {
    if (this.#client === client) this.#client = null;
    if (!client.closed && !client.destroyed) client.close();
  }

  async #connection() {
    if (this.#client && !this.#client.closed && !this.#client.destroyed) return this.#client;
    this.#connecting ||= new Promise((resolve, reject) => {
      const authority = this.#config.environment === 'sandbox'
        ? 'https://api.sandbox.push.apple.com'
        : 'https://api.push.apple.com';
      const client = http2.connect(authority);
      const failed = (error) => {
        this.#invalidate(client);
        reject(error);
      };
      client.once('connect', () => {
        client.off('error', failed);
        client.on('error', () => this.#invalidate(client));
        client.on('goaway', () => this.#invalidate(client));
        this.#client = client;
        resolve(client);
      });
      client.once('error', failed);
    }).finally(() => { this.#connecting = null; });
    return this.#connecting;
  }

  async #sendOnce(device, envelope) {
    const client = await this.#connection();
    if (client.closed || client.destroyed) throw Object.assign(new Error('APNs HTTP/2 connection is unavailable.'), { retryable: true });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve(value);
      };
      let request;
      try {
        request = client.request({
          ':method': 'POST',
          ':path': `/3/device/${device.token}`,
          authorization: `bearer ${this.#token()}`,
          ...envelope.apns.headers,
        });
      } catch (error) {
        this.#invalidate(client);
        return finish(Object.assign(error instanceof Error ? error : new Error('APNs request failed.'), { retryable: true }));
      }
      let responseBody = '';
      let status = 0;
      request.setEncoding('utf8');
      request.on('response', (headers) => { status = Number(headers[':status'] || 0); });
      request.on('data', (chunk) => { responseBody += chunk; });
      request.on('end', () => {
        if (status >= 200 && status < 300) return finish(null, { provider: 'apns', status });
        let reason = responseBody;
        try { reason = JSON.parse(responseBody).reason || responseBody; } catch { /* APNs can return an empty body. */ }
        finish(new Error(`APNs rejected the VoIP push (${status || 'no status'}: ${reason || 'unknown reason'}).`));
      });
      request.on('error', (error) => {
        this.#invalidate(client);
        finish(Object.assign(error, { retryable: true }));
      });
      request.setTimeout(5000, () => request.destroy(Object.assign(new Error('APNs request timed out.'), { retryable: true })));
      request.end(JSON.stringify(envelope.apns.payload));
    });
  }

  async send(device, envelope) {
    return this.#gate.run(async () => {
      try { return await this.#sendOnce(device, envelope); }
      catch (error) {
        if (!error?.retryable) throw error;
        return this.#sendOnce(device, envelope);
      }
    });
  }

  close() {
    if (this.#client && !this.#client.closed && !this.#client.destroyed) this.#client.close();
    this.#client = null;
  }
}

class FcmClient {
  #account;
  #token = null;

  constructor(config) {
    this.#account = parseServiceAccount(config.serviceAccountPath);
  }

  async #accessToken() {
    const now = Math.floor(Date.now() / 1000);
    if (this.#token && this.#token.expiresAt > now + 60) return this.#token.value;
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64Url(JSON.stringify({
      iss: this.#account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    const assertion = `${header}.${payload}.${signer.sign(this.#account.private_key).toString('base64url')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json();
    if (!response.ok || !result.access_token) throw new Error(`Firebase authentication failed with HTTP ${response.status}.`);
    this.#token = { value: result.access_token, expiresAt: now + Number(result.expires_in || 3600) };
    return this.#token.value;
  }

  async send(device, envelope) {
    const accessToken = await this.#accessToken();
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.#account.project_id)}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { ...envelope.fcm.message, token: device.token } }),
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`FCM rejected the incoming-call push with HTTP ${response.status}.`);
    return { provider: 'fcm', status: response.status, name: result.name };
  }
}

function validDevice(device) {
  return device && ['ios', 'android'].includes(device.platform) && typeof device.token === 'string' && device.token.length >= 32;
}

export class PushDispatcher {
  #config;
  #apns;
  #fcm;

  constructor(config) {
    this.#config = config;
    this.#apns = config.apns.enabled ? new ApnsVoipClient(config.apns) : null;
    this.#fcm = config.fcm.enabled ? new FcmClient(config.fcm) : null;
  }

  async resolveDevices(call) {
    const resolved = this.#config.deviceResolverUrl
      ? await postSignedJson(this.#config.deviceResolverUrl, {
          schema: 'vocivo.device-query.v1',
          organizationId: call.organizationId,
          extension: call.targetExtension,
          callId: call.callId,
        }, this.#config.webhookSecret)
      : null;
    const devices = Array.isArray(resolved?.devices) ? resolved.devices : this.#config.testDevices;
    return devices.filter(validDevice);
  }

  async dispatchIncoming(call) {
    const devices = await this.resolveDevices(call);
    const envelope = buildIncomingCallEnvelope(call, { bundleId: this.#config.apns.bundleId });
    const deliveries = devices.map(async (device) => {
      if (device.platform === 'ios') {
        if (!this.#apns) return { provider: 'apns', skipped: true, reason: 'disabled' };
        return this.#apns.send(device, envelope);
      }
      if (!this.#fcm) return { provider: 'fcm', skipped: true, reason: 'disabled' };
      return this.#fcm.send(device, envelope);
    });
    const results = await Promise.allSettled(deliveries);
    return {
      envelope,
      deviceCount: devices.length,
      delivered: results.filter((result) => result.status === 'fulfilled' && !result.value.skipped).length,
      skipped: results.filter((result) => result.status === 'fulfilled' && result.value.skipped).length,
      failed: results.filter((result) => result.status === 'rejected').length,
      errors: results.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : 'Push failed.'] : []),
    };
  }

  close() {
    this.#apns?.close();
  }
}
