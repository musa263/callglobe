import assert from 'node:assert/strict';

// Mount the actual App, including cookie-session restoration and provider
// selection. Only the network and SIP transport are fixtures; no real calls.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
const profile = { id: 'qa-employee', organization_id: 'qa-company', full_name: 'QA Employee', extension: '2000', role: 'user', account_type: 'business', organization_name: 'QA Company' };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors = [];
  const requests = [];
  let sessionValid = true;
  let carrierReady = false;
  const carrierNumbers = () => [0, 1, 2, 3, 4].map(index => ({ id: `carrier-${index}`, source: 'carrier',
    phone_number: `+96613511000${index}`, label: index ? `Company carrier ${index + 1}` : 'Company carrier main line',
    status: carrierReady ? 'ready' : 'pending_activation', receives_calls: false }));
  let releaseBootstrap;
  let holdBootstrap = true;
  let releaseSession;
  let holdSession = true;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('vocivo.session', JSON.stringify({ sub: 'qa-employee', name: 'QA Employee' }));
    window.tones = [];
    window.Audio = class {
      constructor() { this.playing = false; window.tones.push(this); }
      play() { this.playing = true; return Promise.resolve(); }
      pause() { this.playing = false; }
    };
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/auth/session') {
      if (holdSession) await new Promise((resolve) => { releaseSession = resolve; });
      return route.fulfill({ status: sessionValid ? 200 : 401, json: sessionValid ? { profile } : { error: 'Session expired.' } });
    }
    if (path === '/api/mobile/bootstrap' && holdBootstrap) await new Promise((resolve) => { releaseBootstrap = resolve; });
    const data = {
      '/api/mobile/bootstrap': { profile, account: { balance: 0, rates: [] }, numbers: carrierNumbers() },
      '/api/voice/config': { provider: 'sip', voice_edge: 'sip' },
      '/api/voice/route': { destination: 'sip:qa-colleague@test.invalid', destinationName: 'QA Colleague', routeToken: 'fixture' },
      '/api/voice/sip-credentials': { username: 'qa', password: 'fixture', domain: 'test.invalid', wsUri: 'wss://test.invalid', expires_in: 3600 },
    };
    return route.fulfill({ json: data[path] || {} });
  });
  await page.route('**/src/features/calling/engine/sipSession*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export async function connectSipUserAgent(input) {
        window.sipInput = input;
        window.receiveCall = () => {
          const listeners = new Set();
          const session = {
            id: 'incoming-qa', state: 'Initial', remoteIdentity: {displayName:'QA Colleague', uri:'sip:2001@test.invalid'},
            stateChange: {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
            emit(state) {this.state=state;[...listeners].forEach(f=>f(state));},
            accept: async () => session.emit('Established'),
            reject: async () => session.emit('Terminated'),
            bye: async () => session.emit('Terminated'),
          };
          window.incomingSession=session;input.onInvite(session);
        };
        // Sending REGISTER is not the registrar acknowledging it.
        return {userAgent:{isConnected:()=>true,configuration:{uri:{host:'test.invalid'}}},stop:async()=>{},refresh:async()=>{}};
      }
      export async function inviteSipTarget(ua, target, headers, handlers) {
        const listeners = new Set();
        const session = {
          id:'outgoing-qa',state:'Establishing',
          stateChange:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
          emit(state){this.state=state;[...listeners].forEach(f=>f(state));},
        };
        window.rejectOutgoing = () => {handlers.onReject(480,'Temporarily Unavailable');session.emit('Terminated');};
        return session;
      }
      export function attachSipMedia(session, elementId, onError) {window.blockAudio=()=>onError(new Error('autoplay blocked'));return ()=>{};}
      export function sipSessionId(session) {return session?.id || '';}
    `,
  }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('status').filter({ has: page.getByRole('heading', { name: /Welcome back|Your business line/ }) }).waitFor();
  await page.waitForFunction(() => document.querySelector('.opening-art svg')?.getBoundingClientRect().width > 0);
  await page.screenshot({ path: '/tmp/vocivo-loading-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: '/tmp/vocivo-loading-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(typeof releaseSession, 'function');
  holdSession = false;
  releaseSession();
  console.log('PASS: current branded loading screen renders without overflow on desktop and mobile');
  await page.getByRole('heading', { name: 'Make a call' }).waitFor();
  await page.waitForFunction(() => !!window.sipInput);
  assert.equal(await page.getByText('Ready for calls', { exact: true }).count(), 0);
  await page.evaluate(() => window.sipInput.onRegistration('Registered'));
  await page.getByText('Ready for calls', { exact: true }).waitFor();
  assert.equal(typeof releaseBootstrap, 'function');
  holdBootstrap = false;
  releaseBootstrap();
  console.log('PASS: authenticated phone renders before bootstrap completes; only REGISTER acknowledgement makes it ready');
  assert.ok(requests.includes('/api/voice/sip-credentials'));
  await page.getByRole('button', { name: /CALLING FROM Company carrier main line/ }).click();
  assert.equal(await page.locator('.caller-menu button').count(), 5);
  assert.equal(await page.locator('.caller-menu button').filter({ hasText: 'Pending activation' }).count(), 5);
  await page.locator('.caller-menu button').last().click();
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+12025550123');
  assert.equal(await page.getByRole('button', { name: 'Call now', exact: true }).isDisabled(), true);
  await page.getByRole('status').filter({ hasText: 'This carrier line is pending activation.' }).waitFor();
  assert.equal(requests.includes('/api/voice/route'), false);
  console.log('PASS: all five carrier DIDs survive App bootstrap; pending lines stay visible and cannot start external calls');
  carrierReady = true;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sipInput);
  await page.evaluate(() => window.sipInput.onRegistration('Registered'));
  await page.getByText('Ready for calls', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => 'token' in JSON.parse(localStorage.getItem('vocivo.session'))), false);
  console.log('PASS: full App starts and re-registers after reload without a stored bearer');
  await page.getByRole('button', { name: /CALLING FROM Company carrier main line/ }).waitFor();
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('+12025550123');
  assert.equal(await page.getByRole('button', { name: 'Call now', exact: true }).isEnabled(), true);
  await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill('');

  await page.evaluate(() => window.receiveCall());
  await page.getByText('QA Colleague', { exact: true }).waitFor();
  await page.waitForFunction(() => window.tones.some(t => t.playing));
  await page.evaluate(() => window.incomingSession.emit('Terminated'));
  await page.getByTitle('Answer call', { exact: true }).waitFor({ state: 'detached' });
  await page.waitForFunction(() => window.tones.every(t => !t.playing));
  console.log('PASS: incoming call rings; remote CANCEL stops ringtone and removes UI');

  await page.evaluate(() => window.receiveCall());
  await page.getByTitle('Answer call', { exact: true }).click();
  await page.waitForFunction(() => window.tones.every(t => !t.playing));
  await page.evaluate(() => window.blockAudio());
  await page.getByText('Resume audio', { exact: true }).waitFor();
  await page.evaluate(() => {
    const element = document.getElementById('remoteMedia');
    element.srcObject = new MediaStream();
    element.play = async () => { window.audioRetried = true; };
  });
  await page.getByText('Resume audio', { exact: true }).click();
  await page.waitForFunction(() => window.audioRetried);
  await page.getByTitle('Refresh browser audio', { exact: true }).waitFor();
  console.log('PASS: answering stops ringtone; blocked playback can be retried from Audio');
  for (const title of ['Hold call', 'Add caller', 'Transfer call']) {
    assert.equal(await page.getByTitle(title, { exact: true }).isDisabled(), true);
  }
  console.log('PASS: unsupported SIP controls are disabled instead of simulating success');
  await page.screenshot({ path: '/tmp/vocivo-full-app-qa.png', fullPage: true });
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.getByRole('button', { name: 'Extension', exact: true }).click();
  await page.getByRole('textbox', { name: 'Company extension', exact: true }).fill('2003');
  await page.getByRole('button', { name: 'Call extension', exact: true }).click();
  await page.waitForFunction(() => !!window.rejectOutgoing);
  await page.evaluate(() => window.rejectOutgoing());
  const notice = page.locator('.call-notice');
  await notice.waitFor();
  assert.equal(await notice.getAttribute('role'), 'status');
  assert.equal(await notice.innerText(), 'QA Colleague is unavailable right now. Please try again later.');
  assert.equal(await page.locator('.inline-error').count(), 0);
  await page.screenshot({ path: '/tmp/vocivo-unavailable-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: '/tmp/vocivo-unavailable-mobile.png', fullPage: true });
  console.log('PASS: SIP 480 shows a neutral, named unavailable notice without raw protocol details on desktop/mobile');

  sessionValid = false;
  requests.length = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(requests.includes('/api/voice/sip-credentials'), false);
  assert.deepEqual(errors, []);
  console.log('PASS: invalid cookie never starts SIP despite locally stored profile metadata');
} finally {
  await browser.close();
}
