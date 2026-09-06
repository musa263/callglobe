import assert from 'node:assert/strict';
import { defaultPbxConfig, organizationSettingsFrom, pbxForOrganization } from '../api/_lib/features/organizations/pbx-config-store.ts';
import { defaultPlans, featureCatalog } from '../api/_lib/features/organizations/saas-store.ts';

// Mounts the real console in two tabs. All network calls use isolated fixtures;
// this must never touch production accounts, carrier APIs or a real database.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5191';
const config = defaultPbxConfig();
config.organizations.push({ ...config.organizations[0], id: 'second', name: 'Second Company', slug: 'second' });
config.organizationSettings.second = organizationSettingsFrom(pbxForOrganization(config, 'second'));
const plans = defaultPlans();
const organizations = config.organizations.map(item => ({
  ...item, admins: [], plan: plans[0], usage: { seats: 0, phoneNumbers: 0 },
  subscription: { status: 'active', planId: plans[0].id },
  entitlements: Object.fromEntries(featureCatalog.map(feature => [feature.id, true])),
}));
const writes = [], errors = [], requests = [];
const browser = await chromium.launch({ headless: process.env.VOCIVO_TEST_HEADED !== '1' });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const organizationId = url.searchParams.get('organizationId');
    requests.push({ path: url.pathname, organizationId, method: req.method() });
    if (req.method() !== 'GET') writes.push({ path: url.pathname, organizationId, body: req.postDataJSON() });
    let result = {};
    if (url.pathname === '/api/admin/pbx') {
      result = { config: pbxForOrganization(config, organizationId || 'primary') };
    } else if (url.pathname === '/api/admin/saas') {
      result = { platform: { name: 'Vocivo Communications' }, organizations, plans, featureCatalog };
    } else if (url.pathname === '/api/voice/settings') {
      result = { config: { enabled: false, companyName: organizationId === 'second' ? 'Second Company' : 'Global Heritage', greeting: `Menu ${organizationId}`, voice: '', departments: [] } };
    } else if (url.pathname === '/api/admin/ai') {
      result = { ai: req.postDataJSON() };
    } else if (url.pathname === '/api/admin/extensions') result = { extensions: [] };
    else if (url.pathname === '/api/admin/voices') result = { engine: 'vocivo', voices: [], provider: { healthy: true } };
    else if (url.pathname === '/api/admin/api-keys') result = { keys: [] };
    else if (url.pathname === '/api/admin/events') result = { events: [] };
    else if (url.pathname === '/api/admin/numbers') result = { numbers: [], orders: [], messagingProfiles: [] };
    await route.fulfill({ json: result });
  });
  await context.route('**/__admin-workspace-qa', route => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><html><head><title>Vocivo workspace regression</title></head><body><div id="root"></div>
    <script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import RefreshRuntime from '/@react-refresh';
      import '/src/styles/global.css';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      const {default: AdminConsole} = await import('/src/features/admin/AdminConsole.jsx');
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AdminConsole,{profile:{role:'superadmin'}}));
    </script></body></html>` }));
  const a = await context.newPage(), b = await context.newPage();
  const nav = (page, name) => page.locator('.admin-console > aside').getByRole('button', { name, exact: true });
  for (const page of [a, b]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/__admin-workspace-qa`);
    await nav(page, 'Customers').waitFor();
    await page.getByTitle('Refresh system').waitFor();
  }
  await nav(a, 'Voice & AI').click();
  await a.getByLabel('Assistant name', { exact: true }).fill('Global Heritage test receptionist');
  await nav(b, 'Customers').click();
  await b.getByRole('row').filter({ hasText: 'Second Company' }).getByRole('button', { name: 'Open phone system' }).click();
  await b.locator('.tenant strong').filter({ hasText: 'Second Company' }).waitFor();
  assert.equal(writes.length, 0, 'changing workspace must not write the shared PBX selection');
  await nav(b, 'Voice & AI').click();
  await b.getByLabel('Assistant name', { exact: true }).fill('Second test receptionist');
  await b.getByRole('button', { name: 'Save receptionist', exact: true }).click();
  await b.getByRole('button', { name: 'Save receptionist', exact: true }).waitFor({ state: 'visible' });
  await a.getByRole('button', { name: 'Save receptionist', exact: true }).click();
  await a.getByRole('button', { name: 'Apply routing', exact: true }).click();
  await a.getByTitle('Refresh system').click();
  await a.getByLabel('Company name', { exact: true }).waitFor();
  const saved = writes.filter(item => item.path === '/api/admin/ai');
  assert(saved.some(item => item.organizationId === 'primary' && item.body.name === 'Global Heritage test receptionist'));
  assert(saved.some(item => item.organizationId === 'second' && item.body.name === 'Second test receptionist'));
  assert(writes.some(item => item.path === '/api/voice/settings' && item.organizationId === 'primary' && item.body.companyName === 'Global Heritage'));
  for (const item of requests) {
    if (['/api/admin/extensions', '/api/admin/overview', '/api/admin/trunks', '/api/admin/numbers', '/api/admin/api-keys', '/api/voice/settings', '/api/admin/events'].includes(item.path)) {
      assert(['primary', 'second'].includes(item.organizationId), `${item.path} missing workspace`);
    }
  }
  assert.deepEqual(errors, []);
  assert.equal(config.activeOrganizationId, 'primary');
  await b.screenshot({ path: '/tmp/vocivo-admin-workspace-qa.png', fullPage: true });
  console.log('PASS: two superadmin tabs, isolated AI/menu saves, read-only selection, scoped refresh and tenant reads.');
} finally {
  await browser.close();
}
