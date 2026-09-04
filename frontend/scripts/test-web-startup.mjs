import assert from 'node:assert/strict';

// Mount the actual App, including cookie-session restoration and provider
// selection. Only the network and SIP transport are fixtures; no real calls.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
const profile = { id: 'qa-employee', organization_id: 'qa-company', full_name: 'QA Employee', extension: '2000', role: 'user', account_type: 'business', organization_name: 'QA Company' };
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors = [];
  const requests = [];
  let sessionValid = true;
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
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === '/api/auth/session') return route.fulfill({ status: sessionValid ? 200 : 401, json: sessionValid ? { profile } : { error: 'Session expired.' } });
    const data = {
      '/api/mobile/bootstrap': { profile, account: { balance: 0, rates: [] }, numbers: [] },
      '/api/voice/config': { provider: 'sip', voice_edge: 'sip' },
      '/api/voice/sip-credentials': { username: 'qa', password: 'fixture', domain: 'test.invalid', wsUri: 'wss://test.invalid', expires_in: 3600 },
    };
    return route.fulfill({ json: data[path] || {} });
  });
  await page.route('**/src/voice/sipSession*', (route) => route.fulfill({
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
        input.onRegistration('Registered');
        return {userAgent:{},stop:async()=>{},refresh:async()=>{}};
      }
      export async function inviteSipTarget() {throw new Error('No real calls in startup QA');}
      export function attachSipMedia(session, elementId, onError) {window.blockAudio=()=>onError(new Error('autoplay blocked'));return ()=>{};}
      export function sipSessionId(session) {return session?.id || '';}
    `,
  }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByText('Ready for calls', { exact: true }).waitFor();
  assert.ok(requests.includes('/api/voice/sip-credentials'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Ready for calls', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => 'token' in JSON.parse(localStorage.getItem('vocivo.session'))), false);
  console.log('PASS: full App starts and re-registers after reload without a stored bearer');

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
  await page.screenshot({ path: '/tmp/vocivo-full-app-qa.png', fullPage: true });

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
