import http from 'node:http';
import { normalizeEslEvent, shouldPushIncomingCall } from './call-events.mjs';
import { loadConfig } from './config.mjs';
import { EslClient } from './esl-client.mjs';
import { DirectoryService } from './directory-service.mjs';
import { PushDispatcher } from './push-dispatcher.mjs';
import { postSignedJson } from './signed-http.mjs';

const config = loadConfig();
const esl = new EslClient(config.esl);
const pushes = new PushDispatcher(config);
const directory = new DirectoryService(config.directory, log);
const seenPushes = new Map();
const metrics = {
  startedAt: new Date().toISOString(),
  eventsReceived: 0,
  eventWebhookFailures: 0,
  pushesAttempted: 0,
  pushesDelivered: 0,
  pushFailures: 0,
  lastEventAt: null,
  lastReadyAt: null,
};

function log(level, message, detail = {}) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...detail })}\n`);
}

function rememberPush(callId) {
  const now = Date.now();
  for (const [id, expiresAt] of seenPushes) if (expiresAt <= now) seenPushes.delete(id);
  if (seenPushes.has(callId)) return false;
  seenPushes.set(callId, now + 5 * 60_000);
  return true;
}

async function processEvent(raw) {
  const call = normalizeEslEvent(raw);
  if (!call) return;
  metrics.eventsReceived += 1;
  metrics.lastEventAt = new Date().toISOString();
  if (config.eventWebhookUrl) {
    postSignedJson(config.eventWebhookUrl, call, config.webhookSecret).catch((error) => {
      metrics.eventWebhookFailures += 1;
      log('error', 'Call-event webhook failed.', { eventId: call.eventId, error: error.message });
    });
  }
  if (!shouldPushIncomingCall(call) || !rememberPush(call.callId)) return;
  metrics.pushesAttempted += 1;
  const result = await pushes.dispatchIncoming(call);
  metrics.pushesDelivered += result.delivered;
  metrics.pushFailures += result.failed;
  log(result.failed ? 'warn' : 'info', 'Incoming-call push fan-out completed.', {
    callId: call.callId,
    organizationId: call.organizationId,
    extension: call.targetExtension,
    devices: result.deviceCount,
    delivered: result.delivered,
    skipped: result.skipped,
    failed: result.failed,
    errors: result.errors,
  });
}

esl.on('ready', () => {
  metrics.lastReadyAt = new Date().toISOString();
  log('info', 'Authenticated to FreeSWITCH ESL.');
});
esl.on('event', (event) => processEvent(event).catch((error) => {
  metrics.pushFailures += 1;
  log('error', 'ESL event processing failed.', { error: error.message });
}));
esl.on('transportError', (error) => log('warn', 'ESL transport error.', { error: error.message }));
esl.on('disconnected', () => log('warn', 'ESL disconnected; reconnect scheduled.'));
esl.on('error', (error) => log('error', 'ESL protocol error.', { error: error.message }));

async function readBody(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer((request, response) => {
  if (request.url === '/directory' && request.method === 'POST') {
    readBody(request).then((body) => directory.xmlFor(body)).then((value) => {
      response.writeHead(200, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' });
      response.end(value);
    }).catch((error) => {
      log('error', 'PBX directory lookup failed.', { error: error.message });
      response.writeHead(503, { 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' });
      response.end('<?xml version="1.0" encoding="UTF-8"?><document type="freeswitch/xml"><section name="result"><result status="not found"/></section></document>');
    });
    return;
  }
  if (request.url === '/healthz') {
    const healthy = esl.connected && directory.ready;
    response.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ok: healthy, eslConnected: esl.connected, directoryReady: directory.ready, directoryRevision: directory.revision, ...metrics }));
    return;
  }
  if (request.url === '/readyz') {
    const ready = esl.connected && directory.ready;
    response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ ready }));
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(config.healthPort, '127.0.0.1', () => {
  log('info', 'Vocivo ESL listener started.', { healthPort: config.healthPort });
  esl.start();
  directory.start();
});

function shutdown(signal) {
  log('info', 'Shutting down ESL listener.', { signal });
  esl.stop();
  directory.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
