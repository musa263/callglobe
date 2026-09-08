import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser fixture error:', error.message); });
  let tokens = 0, cancellations = 0, statuses = 0, cancelAllowed = false;
  await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: '<script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><div id="root"></div><audio id="remoteMedia"></audio><script type="module" src="/scripts/fixtures/telnyx-harness.jsx"></script>' }));
  await page.route('**/*@telnyx_webrtc*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export class TelnyxRTC {
      constructor() { this.listeners = new Map(); window.clients ||= []; window.clients.push(this); }
      on(event, listener) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(listener); }
      off(event, listener) { this.listeners.get(event)?.delete(listener); }
      emit(event, data) { for (const listener of [...(this.listeners.get(event) || [])]) listener(data); }
      connect() { this.emit('telnyx.ready'); }
      disconnect() { this.disconnected = true; }
      newCall(options) {
        const track = { stop() { window.stoppedTracks = (window.stoppedTracks || 0) + 1; } };
        const call = { id: 'fixture-' + Math.random(), state: 'requesting', direction: 'outbound', options,
          peer: { instance: { getSenders: () => [{track}], getReceivers: () => [],
            getStats: async () => new Map(), close() { window.closedPeers = (window.closedPeers || 0) + 1; } } },
          hangup: () => { call.state = 'hangup'; this.emit('telnyx.notification', {type:'callUpdate', call}); },
        }; window.lastCall = call; return call;
      }
    }
  ` }));
  await page.addInitScript(() => {
    window.Audio = class { play() { return Promise.resolve(); } pause() {} };
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/telnyx/token') {
      tokens++;
      return route.fulfill({ status: tokens === 1 ? 503 : 200, json: tokens === 1 ? { error: 'temporary' } : { token: 'fixture', expires_in: 3600 } });
    }
    if (path === '/api/voice/route') return route.fulfill({ json: { callerId: '+15550000000', routeToken: 'fixture' } });
    if (path === '/api/voice/status') { statuses++; return route.fulfill({ json: { phase: 'ringing' } }); }
    if (path === '/api/voice/cancel') {
      cancellations++;
      return route.fulfill({ status: cancelAllowed ? 200 : 503, headers: { 'Retry-After': '2' }, json: { canceled: cancelAllowed } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.testVoice?.ready, { timeout: 15000 });
  assert.equal(tokens, 2, 'startup POST recovers without remounting');
  await page.evaluate(() => window.testVoice.startCall('+15550000001', '+15550000000'));
  await page.waitForFunction(() => !!window.testVoice.call);
  await page.waitForTimeout(2200);
  assert.ok(statuses <= 4, `ringing generated ${statuses} status requests in 2.2 seconds`);
  await page.waitForTimeout(18_500);
  assert.equal(await page.evaluate(() => window.testVoice.state), 'ringing');
  assert.equal(await page.evaluate(() => window.testVoice.error), '', 'ringing does not time out after the old 18-second polling budget');
  assert.ok(statuses <= 23);
  await page.evaluate(() => window.testVoice.hangup());
  await page.waitForFunction(() => window.testVoice.error.includes('cancellation is pending'));
  assert.ok(cancellations >= 1);
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('vocivo.telnyx-cancellations.v1:qa-account')).length), 1);
  cancelAllowed = true;
  await page.reload();
  await page.waitForFunction(() => sessionStorage.getItem('vocivo.telnyx-cancellations.v1:qa-account') === '[]', { timeout: 15000 });
  await page.waitForFunction(() => window.testVoice?.ready);
  await page.evaluate(() => window.testVoice.startCall('+15550000001', '+15550000000'));
  await page.evaluate(() => window.clients.at(-1).emit('telnyx.socket.close'));
  await page.waitForFunction(() => !window.testVoice.call && window.closedPeers > 0 && window.stoppedTracks > 0);
  await page.evaluate(() => {
    window.lastCall.state = 'active';
    window.clients.at(-1).emit('telnyx.notification', {type:'callUpdate', call:window.lastCall});
  });
  assert.equal(await page.evaluate(() => window.testVoice.call), null, 'late active cannot resurrect closed media');
  await page.evaluate(() => window.testEnable(false));
  await page.waitForFunction(() => window.clients.every(client => client.disconnected));
  assert.equal(await page.evaluate(() => window.clients.reduce((sum, client) => sum + [...client.listeners.values()].reduce((n, listeners) => n + listeners.size, 0), 0)), 0);
  assert.deepEqual(errors, []);
  console.log('PASS Telnyx hook: startup retry, bounded polling, durable cancellation/reload, socket media teardown, late-event rejection, listener cleanup.');
} finally { await browser.close(); }
