import assert from 'node:assert/strict';

// Real React hook and timers; only HTTP and SIP transport are fixtures.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const failures = [];
  const httpFailures = [];
  let credentialRequests = 0;
  let rejectBootstrap = false;
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.status() >= 400) httpFailures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  await page.route(`${origin}/sip-recovery-test`, route => route.fulfill({
    contentType: 'text/html',
    body: `<div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { useSipVoice } from '/src/features/calling/hooks/useSipVoice.js';
      function Phone() {
        window.voice = useSipVoice('fixture-profile', true, {name:'Fixture'});
        return React.createElement('pre', null, JSON.stringify({ready:voice.ready,status:voice.statusLabel,error:voice.error}));
      }
      window.root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(Phone));
    </script>`,
  }));
  await page.route('**/api/**', route => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/api/voice/sip-credentials' && request.method() === 'POST') {
      credentialRequests++;
      return route.fulfill({ status: rejectBootstrap ? 403 : 200, json: rejectBootstrap
        ? { error: 'Calling is not enabled for this account.' }
        : { username: 'fixture', password: 'fixture', domain: 'test.invalid', wsUri: 'wss://test.invalid', expires_in: 604800,
            deviceId: 'fixture-device-0001', credentialId: `fixture-credential-${credentialRequests}` } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/src/features/calling/engine/sipSession*', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.connections = [];
      export async function connectSipUserAgent(input) {
        const connection = {input,stopped:false,refreshes:0,
          userAgent:{isConnected:()=>true},
          stop:async()=>{connection.stopped=true},
          refresh:async()=>{connection.refreshes++}};
        window.connections.push(connection);
        return connection;
      }
      export function attachSipMedia() { return () => {}; }
      export function sipSessionId(session) { return session?.id || ''; }
      export async function inviteSipTarget() { throw new Error('No calls allowed in registration tests'); }
    `,
  }));
  await page.addInitScript(() => {
    window.Audio = class { play() { return Promise.resolve(); } pause() {} };
  });
  await page.goto(`${origin}/sip-recovery-test`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.connections?.length === 1).catch(error => {
    throw new Error(`${error.message}\n${JSON.stringify({ failures, httpFailures })}`);
  });
  await page.clock.install();
  const phone = () => page.locator('pre').textContent().then(JSON.parse);
  const emit = (state, reason) => page.evaluate(({state, reason}) => {
    window.connections.at(-1).input.onRegistration(state, reason);
  }, { state, reason });
  const settle = () => page.waitForTimeout(50);

  assert.equal((await phone()).ready, false, 'connected socket is not registered');
  await emit('Unregistered', '401 Unauthorized');
  await settle();
  assert.match((await phone()).error, /registration.*rejected/i);
  assert.equal((await phone()).status, 'Calling unavailable');
  await page.clock.runFor(2000);
  await emit('Unregistered', '401 Unauthorized');
  await page.clock.runFor(1000);
  await page.waitForFunction(() => window.connections.length === 2);
  assert.equal(credentialRequests, 2, 'auth retry replaces seven-day expiry without duplicate timers');
  assert.equal(await page.evaluate(() => window.connections[0].stopped), true);
  assert.equal((await phone()).ready, false, 'credential refresh is not registration success');
  console.log('PASS: final 401 is visible and refreshes credentials once despite armed expiry');

  await emit('Unregistered', '403 Forbidden');
  await page.clock.runFor(3000);
  assert.equal(credentialRequests, 2, 'persistent rejection backs off across hook restarts');
  await page.clock.runFor(3000);
  await page.waitForFunction(() => window.connections.length === 3);
  await emit('Unregistered', '403 Forbidden');
  await emit('Registered');
  await settle();
  assert.deepEqual(await phone(), { ready: true, status: 'Ready for calls', error: '' });
  await page.clock.runFor(12000);
  assert.equal(credentialRequests, 3, 'REGISTER acknowledgement cancels pending auth refresh');
  console.log('PASS: persistent rejection backs off; only Registered restores ready and clears failure');

  await emit('Reconnecting', 'connection lost');
  await settle();
  assert.equal((await phone()).ready, false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  assert.equal(await page.evaluate(() => window.connections.at(-1).refreshes), 1);
  await emit('Registered');

  await page.evaluate(() => {
    const listeners = new Set();
    const invitation = { id:'fixture-incoming',state:'Initial',remoteIdentity:{uri:'sip:fixture@test.invalid'},
      stateChange:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
      reject:async()=>{},
      emit(state){this.state=state;[...listeners].forEach(f=>f(state));}};
    window.invitation = invitation;
    window.connections.at(-1).input.onInvite(invitation);
  });
  await emit('Unregistered', '401 Unauthorized');
  await page.clock.runFor(3000);
  assert.equal(credentialRequests, 3, 'credential replacement must not hang up an incoming call');
  await page.evaluate(() => window.invitation.emit('Terminated'));
  await page.clock.runFor(60000);
  await page.waitForFunction(() => window.connections.length === 4);
  console.log('PASS: credential replacement waits until the current call has ended');

  rejectBootstrap = true;
  await emit('Unregistered', '401 Unauthorized');
  await page.clock.runFor(6000);
  await page.waitForFunction(() => window.voice.error === 'Calling is not enabled for this account.');
  assert.equal((await phone()).ready, false, 'HTTP authorization rejection remains fail closed');
  rejectBootstrap = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForFunction(() => window.connections.length === 5);
  console.log('PASS: bootstrap authorization failure is visible; online retries missing connection');

  await emit('Unregistered', '401 Unauthorized');
  const requestsBeforeUnmount = credentialRequests;
  await page.evaluate(() => window.root.unmount());
  await page.clock.runFor(7 * 24 * 60 * 60 * 1000);
  assert.equal(credentialRequests, requestsBeforeUnmount, 'unmount removes expiry and retry timers');
  assert.deepEqual(failures, []);
  console.log('PASS: unmount cancels all renewal timers; no unhandled browser errors');
} finally {
  await browser.close();
}
