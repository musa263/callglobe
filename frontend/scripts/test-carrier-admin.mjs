import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5191';
const browser = await chromium.launch({ headless: true });
const errors = [], writes = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message));
  const trunk = { id: '12345678-1234-1234-1234-123456789012', organizationId: 'primary', revision: 1, name: 'Company carrier', provider: 'Example carrier',
    accountReference: 'AC-TEST', server: '192.0.2.20', port: 5060, transport: 'UDP', publicIp: '198.51.100.10', authentication: 'ip',
    channelLimit: 5, inboundEnabled: true, outboundEnabled: true, mainNumber: '0135110000',
    numbers: [0, 1, 2, 3, 4].map(i => ({ inboundNumber: `013511000${i}`, callerId: `+96613511000${i}`, destinationType: 'unassigned', destinationId: '' })),
    connectionStatus: 'pending_activation', connectionMessage: 'Carrier connection is awaiting deployment.' };
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { trunks: [trunk], callingMode: 'carrier' } });
    const body = request.postDataJSON();
    writes.push(body);
    if (request.method() === 'PUT') Object.assign(trunk, body, { revision: trunk.revision + 1 });
    return route.fulfill({ json: { trunk, removed: true } });
  });
  await page.route('**/__carrier-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="root"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import RefreshRuntime from '/@react-refresh'; import '/src/styles/global.css';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    const { NumbersPage } = await import('/src/features/admin/numbers/NumbersPage.jsx');
    const config = { company: { name: 'QA Company', callingMode: 'carrier' }, callHandling: {ringGroups:[], queues:[], ivrs:[]} };
    const api = async (path, options={}) => { const response=await fetch(path, {method: options.method || 'GET', headers:{'Content-Type':'application/json'}, body:options.body?JSON.stringify(options.body):undefined}); return response.json(); };
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(NumbersPage,{config, api, extensions:[{id:'e1',extension:'2000',name:'Reception'}], data:{callingMode:'carrier',numbers:[{}],legacyNumbers:[{id:'old',phoneNumber:'+12025550000'}]},onRefresh:async()=>{}}));
    </script></body></html>` }));
  await page.goto(`${origin}/__carrier-qa`);
  await page.getByRole('article', { name: 'Company carrier trunk details' }).waitFor();
  for (let i = 0; i < 5; i++) await page.getByRole('cell', { name: `+96613511000${i}`, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Buy|Purchase|Search numbers/ }).count(), 0);
  await page.getByRole('button', { name: 'Use these carrier numbers' }).click();
  await page.getByRole('status').filter({ hasText: 'numbers selected' }).waitFor();
  assert.equal(writes.at(-1).action, 'use-carrier-numbers');
  await page.getByRole('button', { name: 'Edit trunk' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('dialog').locator('label').filter({ has: page.getByText('Destination 1', { exact: true }) }).locator('select').selectOption('extension:e1');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await page.getByRole('cell', { name: '2000 · Reception', exact: true }).waitFor();
  assert.equal(writes.at(-1).numbers[0].destinationId, 'e1');
  assert(writes.at(-1).numbers.slice(1).every(number => number.destinationType === 'unassigned'));
  await page.getByRole('button', { name: 'Remove +12025550000 from company' }).click();
  await page.getByRole('button', { name: 'Remove number', exact: true }).click();
  await page.getByRole('button', { name: 'Remove number', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(writes.at(-1).action, 'remove-company-number');
  assert.equal(writes.at(-1).phoneNumber, '+12025550000');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/vocivo-byoc-admin.png', fullPage: true });
  console.log('PASS: all five DIDs visible, per-number destination editing, explicit carrier selection, company removal, no purchase controls.');
} finally { await browser.close(); }
