import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.route('**/api/**', route => route.fulfill({ json: { users: [
    { id: 'alex', name: 'Alex Chen', extension: '2001', presence: 'online' },
    { id: 'jordan', name: 'Jordan Morgan', extension: '2002', presence: 'busy' },
    { id: 'sam', name: 'Sam Ali', extension: '2003', presence: 'offline' },
  ] } }));
  await page.route('**/__dialpad-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vocivo local dial pad QA</title><link rel="stylesheet" href="/src/styles/global.css"></head><body><div id="root"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    const {Dialer}=await import('/src/features/calling/components/Dialer.jsx');
    window.calls=[];
    const voice={ready:true,statusLabel:'Ready for calls',startCall:async(...args)=>window.calls.push(args),startInternalCall:async(...args)=>window.calls.push(args)};
    const props={rates:[],selectedNumber:{phone_number:'+966135110000',source:'carrier',status:'ready'},voice,accountType:'business',profile:{id:'self',organization_id:'qa-company',extension:'2000',dialing_country:'SA'},numberState:{dialing:{callerId:'+966135110000',country:'SA'}}};
    window.root=ReactDOM.createRoot(document.getElementById('root'));
    window.renderDialer=(patch={})=>window.root.render(React.createElement(React.Fragment,null,React.createElement('header',{style:{padding:'16px 24px',fontWeight:700}},'Vocivo'),React.createElement(Dialer,{...props,...patch})));
    window.renderDialer();
  </script></body></html>` }));
  await page.goto(`${origin}/__dialpad-qa`);
  await page.getByRole('textbox', { name: 'Number to call' }).fill('0535548337');
  assert.equal(await page.getByRole('button', { name: /Choose.*(country|caller)/i }).count(), 0);
  assert.equal(await page.getByText('+966135110000', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Call now', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), ['+966535548337', '+966135110000']);
  await page.getByRole('textbox', { name: 'Number to call' }).fill('+442079460018');
  await page.getByRole('button', { name: 'Call now', exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls.at(-1)[0]), '+442079460018');
  await page.getByRole('button', { name: 'Company colleagues', exact: true }).click();
  for (const name of ['Online', 'Busy', 'Offline']) await page.getByRole('img', { name, exact: true }).waitFor();
  await page.getByRole('button', { name: /Alex Chen/ }).click();
  await page.getByRole('button', { name: 'Call extension', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls.at(-1)), ['', '2001', 'Alex Chen']);
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole('textbox', { name: 'Number to call' }).fill('');
    await page.screenshot({ path: `/tmp/vocivo-dialpad-${name}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' horizontal overflow');
    const box = await page.getByRole('button', { name: 'Call now', exact: true }).boundingBox();
    assert.ok(box && box.y + box.height <= height, name + ' call button below viewport');
  }
  await page.evaluate(() => window.renderDialer({ selectedNumber: null }));
  await page.getByRole('textbox', { name: 'Number to call' }).fill('+442079460018');
  assert.equal(await page.getByRole('button', { name: 'Call now', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('PASS: original dial pad UI, assigned line, trunk country, explicit prefix, colleague presence, tenant-unassigned block, desktop/mobile layout. Fixtures only; no live calls.');
} finally { await browser.close(); }
