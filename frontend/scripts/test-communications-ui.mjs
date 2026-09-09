import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
const profile = { id: 'qa-user', organization_id: 'qa-company', full_name: 'QA User', extension: '2003', role: 'user', account_type: 'business', dialing_country: 'US' };
const roomId = '826dfdd5-86d0-4ab1-97ac-07dfe9656033';
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('console', message => { if (message.type() === 'error') console.error('Browser:', message.text()); });
  page.on('requestfailed', request => console.error('Failed request:', request.url(), request.failure()?.errorText));
  const meetings = []; const requests = []; let audioRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem('vocivo.session', JSON.stringify({ sub: 'qa-user' }));
    localStorage.setItem('vocivo.history.qa-user', JSON.stringify([{ id: 'incoming', number: 'gencredx7a6b1c6', direction: 'incoming', duration: 0, date: '2026-09-08T19:51:43Z' }, { id: 'outgoing', number: '2003', name: 'QA User', internal: true, direction: 'outgoing', duration: 7, date: '2026-09-08T19:43:20Z' }]));
    window.videoListeners = new Map(); window.videoDisconnects = 0; window.videoInitializations = 0;
    window.pendingVideo = []; window.mediaTracks = [];
  });
  await page.route(/\/src\/features\/calling\/hooks\/useVoice(?:\.js)?(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/javascript', body: `export function useVoice(){return {ready:true,statusLabel:'Ready for calls',active:false,connected:false,endedCall:null,startCall:async()=>{},startInternalCall:async()=>{}};}` }));
  await page.route('**/node_modules/.vite/deps/@telnyx_video*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function initialize(){window.videoInitializations++; if(window.holdVideo) await new Promise(resolve=>{window.pendingVideo.push(resolve);window.releaseVideo=()=>window.pendingVideo.splice(0).forEach(done=>done())}); return {
      on:(event,fn)=>{window.videoListeners.set(event,fn);return()=>window.videoListeners.delete(event)},
      connect:async()=>window.videoListeners.get('connected')?.(),disconnect:async()=>{window.videoDisconnects++},
      getLocalParticipant:()=>({id:'self'}),addStream:async()=>{},addSubscription:async()=>{},getParticipantStream:()=>null,
      updateStream:async()=>{},updateClientToken:async()=>{}
    };}
  ` }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const method = route.request().method(); requests.push([method, url.pathname]);
    const body = route.request().postDataJSON();
    if (url.pathname === '/api/voice/meetings') {
      if (method === 'POST') { const item = { ...body, version: 1 }; meetings.push(item); return route.fulfill({ status: 201, json: { meeting: item } }); }
      if (method === 'PATCH') { const index = meetings.findIndex(item => item.id === body.id); meetings[index] = { ...body, version: body.version + 1 }; return route.fulfill({ json: { meeting: meetings[index] } }); }
      if (method === 'DELETE') { meetings.splice(meetings.findIndex(item => item.id === body.id), 1); return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: { meetings } });
    }
    if (url.pathname === '/api/voice/video') return route.fulfill({ json: { roomId, token: 'fixture-join-token', participantName: 'QA User' } });
    if (url.pathname === '/api/voice/voicemails' && url.searchParams.get('audio')) {
      audioRequests++; const wav = Buffer.alloc(160044); wav.write('RIFF'); wav.writeUInt32LE(160036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(160000, 40);
      return route.fulfill({ contentType: 'audio/wav', body: wav });
    }
    const data = {
      '/api/auth/session': { profile }, '/api/mobile/bootstrap': { profile, account: { balance: 25, rates: [] }, numbers: [] },
      '/api/telnyx/numbers': { numbers: [{ id: 'line', phone_number: '+12025550123', source: 'owned' }], dialing: { callerId: '+12025550123', country: 'US' } },
      '/api/voice/directory': { users: [{ id: 'mousa', extension: '2000', name: 'Mousa', sipUsername: 'gencredx7a6b1c6', presence: 'online' }, { id: 'self', extension: '2003', name: 'QA User', presence: 'online' }] },
      '/api/voice/voicemails': { voicemails: [{ id: 'voicemail-one', callerNumber: 'sip:gencredx7a6b1c6@example.test', callerName: 'Mousa', durationSeconds: 12, createdAt: '2026-09-08T19:51:43Z' }] },
    };
    return route.fulfill({ json: data[url.pathname] || {} });
  });
  await page.goto(origin);
  try { await page.getByRole('heading', { name: 'Dial Pad', exact: true }).waitFor(); }
  catch (error) { console.error(await page.locator('body').innerText(), requests); await page.screenshot({ path: '/tmp/vocivo-communications-startup-failure.png' }); throw error; }
  await page.getByRole('button', { name: 'Calls', exact: true }).first().click();
  await page.getByText('Mousa', { exact: true }).waitFor();
  assert.equal(await page.getByText('Extension 2000', { exact: true }).count(), 1);
  assert.ok(!(await page.locator('body').innerText()).includes('7616'));
  assert.ok(!(await page.locator('body').innerText()).includes('gencred'));
  await page.screenshot({ path: '/tmp/vocivo-history-fixed-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Call Mousa', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Number to call' }).inputValue(), '2000');
  await page.getByRole('button', { name: 'Schedule a call', exact: true }).click();
  await page.getByRole('button', { name: 'Schedule', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Customer review');
  await page.getByLabel('Phone number or extension', { exact: true }).fill('+442079460018');
  await page.getByRole('button', { name: 'Save meeting', exact: true }).click();
  await page.getByText('Customer review', { exact: true }).waitFor();
  assert.equal(meetings[0].destination, '+442079460018');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Customer review calendar event' }).click();
  assert.match((await download).suggestedFilename(), /^vocivo-.*\.ics$/);
  await page.getByRole('button', { name: 'Edit Customer review' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Customer follow-up');
  await page.getByRole('button', { name: 'Save meeting', exact: true }).click();
  await page.getByText('Customer follow-up', { exact: true }).waitFor(); assert.equal(meetings[0].version, 2);
  await page.screenshot({ path: '/tmp/vocivo-schedule-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Call Customer follow-up' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Number to call' }).inputValue(), '+442079460018');
  await page.getByRole('button', { name: 'Voicemail', exact: true }).click();
  await page.getByRole('button', { name: 'Play voicemail from Mousa' }).click();
  await page.locator('audio[controls]').waitFor(); assert.equal(audioRequests, 1);
  await page.getByRole('tab', { name: 'Video', exact: true }).click();
  await page.getByRole('heading', { name: 'Video calls' }).waitFor();
  await page.evaluate(() => { window.holdVideo = true; });
  await page.getByRole('button', { name: 'Start video meeting' }).click();
  await page.waitForFunction(() => typeof window.releaseVideo === 'function');
  await page.getByRole('button', { name: 'Leave video call' }).click();
  await page.evaluate(() => window.releaseVideo());
  await page.waitForFunction(() => window.videoDisconnects > 0);
  assert.equal(await page.evaluate(() => window.videoListeners.size), 0, 'late SDK bootstrap disposed on leave');
  await page.evaluate(() => {
    window.holdVideo = false;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const context = canvas.getContext('2d'); context.fillStyle = '#23aabe'; context.fillRect(0,0,160,90);
      const audio = new AudioContext(); const stream = canvas.captureStream(5);
      stream.addTrack(audio.createMediaStreamDestination().stream.getAudioTracks()[0]);
      window.mediaTracks.push(...stream.getTracks()); window.fixtureAudio = audio;
      return stream;
    } });
  });
  await page.getByRole('button', { name: 'Start video meeting' }).click();
  await page.getByRole('button', { name: 'Mute', exact: true }).click();
  assert.equal(await page.evaluate(() => window.mediaTracks.find(track => track.kind === 'audio').enabled), false);
  await page.getByRole('button', { name: 'Disable camera', exact: true }).click();
  assert.equal(await page.evaluate(() => window.mediaTracks.find(track => track.kind === 'video').enabled), false);
  await page.getByRole('button', { name: 'Leave video call' }).click();
  await page.waitForFunction(() => window.mediaTracks.every(track => track.readyState === 'ended'));
  assert.equal(await page.evaluate(() => window.videoListeners.size), 0);
  await page.evaluate(() => window.fixtureAudio.close());
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const tab of ['Recents', 'Voicemail', 'Schedule', 'Video']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} ${name} overflow`);
      await page.screenshot({ path: `/tmp/vocivo-${tab.toLowerCase()}-${name}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: mounted App history identity/redial, schedule save/edit/export/start, authenticated voicemail audio, video late-bootstrap cleanup, desktop/mobile views. Isolated fixtures, no live calls.');
} finally { await browser.close(); }
