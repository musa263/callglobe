import assert from 'node:assert/strict';

// Run against Vite with Playwright installed, or point PLAYWRIGHT_MODULE at an
// existing installation. No carrier requests or real calls leave this harness.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(90_000);
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.route('**/src/voice/sipSession*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export async function connectSipUserAgent(input) {
        window.sipInput = input;
        input.onRegistration('Registered');
        return { userAgent: { isConnected: () => true, configuration: { uri: { host: 'test.invalid' } } }, stop: async () => {}, refresh: async () => {} };
      }
      export async function inviteSipTarget(ua, target, headers, handlers) {
        window.invites++;
        window.inviteHandlers = handlers;
        return window.lastSession = window.makeSession(false);
      }
      export function attachSipMedia() { return () => {}; }
      export function sipSessionId(session) { return session?.id || ''; }
    `,
  }));
  await page.route('**/__sip-qa', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><title>Vocivo SIP lifecycle QA</title></head><body>
      <h1>Vocivo SIP lifecycle QA</h1><div id="root"></div><audio id="remoteMedia"></audio>
      <script type="module">
        import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import {useSipVoice} from '/src/hooks/useSipVoice.js';
        window.invites = 0;
        window.commands = [];
        window.sessions = [];
        window.makeSession = (incoming) => {
          const listeners = new Set();
          const pc = new EventTarget();
          Object.assign(pc, {iceConnectionState:'connected',connectionState:'connected',getSenders:()=>[],getReceivers:()=>[],close(){this.connectionState='closed'}});
          const session = {
            sessionDescriptionHandler: {peerConnection: pc},
            id: String(window.sessions.length), state: incoming ? 'Initial' : 'Establishing',
            remoteIdentity: {displayName:'Colleague',uri:'sip:2001@test.invalid'},
            stateChange: {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},
            emit(state) { this.state=state; [...listeners].forEach(f=>f(state)); },
            get listenerCount() {return listeners.size},
            accept: async () => {await new Promise(resolve=>window.finishAnswer=resolve);session.emit('Established')},
            bye: async () => {window.commands.push('BYE');session.emit('Terminated')},
            reject: async () => {window.commands.push('REJECT');session.emit('Terminated')},
          };
          if (!incoming) session.cancel=async()=>{window.commands.push('CANCEL');session.emit('Terminated')};
          window.sessions.push(session);
          return session;
        };
        window.tones = [];
        window.Audio = class {
          constructor(){this.playing=false;window.tones.push(this)}
          play(){this.playing=true;return Promise.resolve()}
          pause(){this.playing=false}
        };
        window.fetch = async (path) => {
          if (path === '/api/voice/route' && window.holdRoute) await new Promise(resolve=>window.finishRoute=resolve);
          return {ok:true,json:async()=>path==='/api/voice/sip-credentials'
            ? {username:'user',password:'test',domain:'test.invalid',wsUri:'wss://test.invalid',expires_in:3600}
            : {destination:'sip:colleague@test.invalid',routeToken:'test'}};
        };
        function Probe() {
          const voice=useSipVoice('cookie-session',true,{name:'QA'});
          window.voice=voice;
          return React.createElement(React.Fragment,null,
            React.createElement('button',{onClick:()=>voice.startInternalCall('colleague','2001','Colleague')},'Call extension'),
            React.createElement('button',{onClick:()=>voice.answer()},'Answer'),
            React.createElement('button',{onClick:voice.hangup},'End call'),
            React.createElement('pre',null,JSON.stringify({ready:voice.ready,incoming:voice.incoming,state:voice.state,starting:voice.callStarting,call:!!voice.call})),
          );
        }
        window.root=ReactDOM.createRoot(document.getElementById('root'));
        window.root.render(React.createElement(Probe));
      </script></body></html>`,
  }));
  await page.goto(`${origin}/__sip-qa`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.voice?.ready).catch(async (error) => {
    console.error(await page.evaluate(() => ({ text: document.body.innerText, status: window.voice?.statusLabel, error: window.voice?.error, mockConnected: !!window.sipInput })));
    throw error;
  });

  await page.evaluate(() => window.sipInput.onInvite(window.lastSession = window.makeSession(true)));
  await page.waitForFunction(() => window.voice.incoming);
  await page.evaluate(() => window.lastSession.emit('Terminated'));
  await page.waitForFunction(() => !window.voice.incoming && !window.voice.call);
  assert.equal(await page.evaluate(() => window.lastSession.listenerCount), 0);
  console.log('PASS: remote CANCEL removes incoming UI and all call listeners');

  await page.evaluate(() => window.sipInput.onInvite(window.lastSession = window.makeSession(true)));
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.waitForFunction(() => !!window.finishAnswer);
  await page.evaluate(() => { window.lastSession.emit('Terminated'); window.finishAnswer(); });
  await page.waitForFunction(() => !window.voice.incoming && !window.voice.call);
  console.log('PASS: late Answer completion cannot resurrect a canceled call');

  await page.evaluate(() => { window.holdRoute = true; });
  await page.getByRole('button', { name: 'Call extension', exact: true }).click();
  await page.waitForFunction(() => window.voice.callStarting && !!window.finishRoute);
  assert.equal(await page.evaluate(() => window.tones.some(t => t.playing)), false);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.evaluate(() => window.finishRoute());
  await page.waitForFunction(() => !window.voice.callStarting && !window.voice.call);
  assert.equal(await page.evaluate(() => window.invites), 0);
  console.log('PASS: cancel during route reservation sends no late INVITE');

  await page.evaluate(() => { window.holdRoute = false; });
  await page.getByRole('button', { name: 'Call extension', exact: true }).click();
  await page.waitForFunction(() => window.invites === 1 && !window.voice.callStarting);
  assert.equal(await page.evaluate(() => window.tones.some(t => t.playing)), false);
  await page.evaluate(() => window.inviteHandlers.onProgress(100));
  assert.equal(await page.evaluate(() => window.tones.some(t => t.playing)), false);
  await page.evaluate(() => window.inviteHandlers.onProgress(180));
  await page.waitForFunction(() => window.voice.state === 'ringing' && window.tones.some(t => t.playing));
  console.log('PASS: only a real SIP 180 response starts outgoing ringback');
  await page.evaluate(() => window.lastSession.emit('Established'));
  await page.waitForFunction(() => window.voice.state === 'active');
  assert.equal(await page.evaluate(async () => {
    try { await window.voice.toggleHold(); return false; }
    catch { return window.voice.state === 'active'; }
  }), true, 'unsupported hold must fail without changing live call state');
  assert.equal(await page.evaluate(() => window.tones.some(t => t.playing)), false);
  await page.getByRole('button', { name: 'End call', exact: true }).click();
  await page.waitForFunction(() => !window.voice.call);
  assert.deepEqual(await page.evaluate(() => window.commands), ['BYE']);
  assert.equal(await page.evaluate(() => window.sessions.every(session => session.listenerCount === 0)), true);
  console.log('PASS: established hangup sends exactly one BYE and removes listeners');

  await page.getByRole('button', { name: 'Call extension', exact: true }).click();
  await page.waitForFunction(() => window.invites === 2 && !window.voice.callStarting);
  await page.evaluate(() => {
    window.lastSession.emit('Established');
    // Simulate the dangerous case: the socket vanished and BYE cannot settle.
    window.lastSession.bye = () => new Promise(() => {});
    window.sipInput.onTransport(false);
  });
  await page.waitForFunction(() => !window.voice.call && !window.voice.connected, null, { timeout: 16_000 });
  assert.equal(await page.evaluate(() => window.lastSession.listenerCount), 0);
  assert.equal(await page.evaluate(() => window.lastSession.sessionDescriptionHandler.peerConnection.connectionState), 'closed');
  await page.evaluate(() => window.sipInput.onTransport(true));
  assert.equal(await page.evaluate(() => !!window.voice.call), false);
  console.log('PASS: dropped signaling clears the live call UI, timer source and media without awaiting BYE');
  await page.screenshot({ path: process.env.VOCIVO_TEST_SCREENSHOT || '/tmp/vocivo-sip-ui-qa.png' });
  await page.evaluate(() => window.root.unmount());
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
