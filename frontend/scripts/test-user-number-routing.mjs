import assert from 'node:assert/strict';
import { defaultPbxConfig, organizationSettingsFrom, pbxForOrganization, PbxConfigConflictError } from '../api/_lib/features/organizations/pbx-config-store.ts';
import { defaultPlans, featureCatalog } from '../api/_lib/features/organizations/saas-store.ts';
import { defaultUserProfile } from '../api/_lib/features/calling/call-preferences.ts';
import { createNumberRoutingHandler } from '../api/_lib/features/numbers/routes/admin-number-routing.ts';
import { createAdminPbxHandler } from '../api/_lib/features/organizations/routes/admin-pbx.ts';

// Real console and route handlers; persistence and authentication use isolated fixtures.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5184';
const browser = await chromium.launch({ headless: process.env.VOCIVO_TEST_HEADED !== '1' });
const errors = [];
try {
  for (const role of ['company_admin', 'superadmin']) {
    let config = defaultPbxConfig(), serial = 0;
    config.organizations[0].name = 'QA Company'; config.company.name = 'QA Company';
    config.company.defaultCallerId = '+12025550101';
    config.organizations.push({ ...config.organizations[0], id: 'other', name: 'Other tenant', slug: 'other' });
    config.organizationSettings.other = organizationSettingsFrom(config);
    const users = ['Alice', 'Bob'].map((name, index) => ({ id: 'u' + index, name, extension: String(2000 + index), organizationId: 'primary', status: 'active', role: 'user', department: 'Operations', email: name.toLowerCase() + '@example.invalid', webLoginEnabled: true, mobile: '' }));
    config.userProfiles = Object.fromEntries(users.map(user => [user.id, defaultUserProfile()]));
    config.numberAssignments = {
      '+12025550101': { organizationId: 'primary', source: 'owned', label: 'Reception', destinationType: 'main' },
      '+12025550102': { organizationId: 'primary', source: 'owned', label: 'Direct line', destinationType: 'main' },
      '+442079460018': { organizationId: 'other', source: 'owned', label: 'Foreign private line', destinationType: 'main' },
    };
    config.callHandling.queues = [{ id: 'support', name: 'Support', extension: '3000', members: ['u0'], strategy: 'simultaneous', maxWait: 30, fallback: '' }];
    const access = { superadmin: role === 'superadmin', session: role === 'superadmin' ? { sub: 'vocivo-owner', role } : { sub: 'vocivo-account:a', accountId: 'a', organizationId: 'primary', role } };
    const savePbxConfig = async (update, options) => {
      if (options?.expectedUpdatedAt && options.expectedUpdatedAt !== config.updatedAt) throw new PbxConfigConflictError();
      config = { ...config, ...(typeof update === 'function' ? update(config) : update), updatedAt: new Date(Date.now() + ++serial).toISOString() };
      return structuredClone(config);
    };
    const common = { requireAdmin: async () => access, readPbxConfig: async () => structuredClone(config), savePbxConfig, requireFeature: async () => ({ superadmin: true }) };
    const numbers = createNumberRoutingHandler({ ...common, readExtensionDirectory: async () => users, acquireTenantMutation: async () => async () => true });
    const pbx = createAdminPbxHandler({ ...common, listExtensions: async org => users.filter(user => user.organizationId === org) });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const writes = [];
    await context.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url()), organizationId = url.searchParams.get('organizationId');
      const body = req.method() === 'GET' ? undefined : req.postDataJSON();
      if (body) writes.push({ path: url.pathname, body });
      const handler = url.pathname === '/api/admin/number-routing' ? numbers : url.pathname === '/api/admin/pbx' ? pbx : null;
      if (handler) {
        let status = 200, json;
        const response = { setHeader() {}, status(code) { status = code; return response; }, json(value) { json = value; return response; } };
        await handler({ method: req.method(), query: organizationId ? { organizationId } : {}, body }, response);
        return route.fulfill({ status, json });
      }
      let result = {};
      if (url.pathname === '/api/admin/saas') {
        const plans = defaultPlans();
        result = { platform: { name: 'Vocivo Communications' }, plans, featureCatalog, organizations: config.organizations.filter(item => role === 'superadmin' || item.id === 'primary').map(item => ({ ...item,
          admins: [], plan: plans[0], usage: { seats: 2, phoneNumbers: 2 }, subscription: { status: 'active', planId: plans[0].id }, entitlements: Object.fromEntries(featureCatalog.map(feature => [feature.id, true])),
        })) };
      } else if (url.pathname === '/api/admin/extensions') {
        if (body) { const user = users.find(user => user.id === body.id); Object.assign(user, body); result = { extension: user }; }
        else result = { extensions: users };
      } else if (url.pathname === '/api/admin/numbers') result = { numbers: [], orders: [], messagingProfiles: [] };
      else if (url.pathname === '/api/admin/events') result = { events: [] };
      else if (url.pathname === '/api/admin/api-keys') result = { keys: [] };
      else if (url.pathname === '/api/admin/voices') result = { voices: [] };
      else if (url.pathname === '/api/voice/settings') result = { config: { enabled: false, departments: [], voice: '', companyName: 'QA Company' } };
      await route.fulfill({ json: result });
    });
    await context.route('**/__user-numbers-qa', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><title>Vocivo local number-routing QA</title></head><body><div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import RefreshRuntime from '/@react-refresh'; import '/src/styles/global.css';
      RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
      const {default: AdminConsole}=await import('/src/features/admin/AdminConsole.jsx');
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(AdminConsole,{profile:{role:'${role}'}}));
    </script></body></html>` }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const nav = name => page.locator('.admin-console > aside').getByRole('button', { name, exact: true });
    await page.goto(`${origin}/__user-numbers-qa`);
    await nav('Users').click();
    await page.getByRole('columnheader', { name: 'Inbound numbers', exact: true }).waitFor();
    const row = name => page.getByRole('row').filter({ hasText: name + '@example.invalid' });
    for (const [index, name] of ['alice', 'bob'].entries()) {
      await row(name).getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(await page.getByLabel('Assigned DID').count(), 0);
      assert.equal(await page.getByLabel('Outgoing line', { exact: true }).count(), 0);
      await page.getByRole('dialog').getByRole('button', { name: 'Numbers', exact: true }).click();
      const number = '+1202555010' + (index + 1);
      await page.getByLabel('Outbound caller ID', { exact: true }).selectOption(number);
      await page.getByRole('checkbox', { name: 'Assign ' + number, exact: true }).check();
      assert.equal(await page.getByRole('dialog').getByText('Foreign private line', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Save numbers', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Number assignments saved.' }).waitFor();
      if (index === 1) {
        await page.screenshot({ path: '/tmp/vocivo-user-numbers-' + role + '.png', fullPage: true });
        // An ordinary identity save uses fresh number fields, not the stale editor profile.
        await page.getByRole('dialog').getByRole('button', { name: 'General', exact: true }).click();
        await page.getByLabel('Department', { exact: true }).fill('Sales');
        await page.getByRole('button', { name: 'Save user', exact: true }).click();
      } else await page.getByRole('dialog').getByTitle('Close', { exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await row(name).getByRole('cell').filter({ hasText: number }).first().waitFor();
      assert.equal(config.userProfiles['u' + index].outboundCallerId, number);
      assert.equal(config.numberAssignments[number].destinationId, 'u' + index);
    }
    await page.screenshot({ path: '/tmp/vocivo-users-assignments-' + role + '.png', fullPage: true });
    await nav('Phone numbers').click();
    await page.getByRole('button', { name: 'Route +12025550102', exact: true }).click();
    await page.getByRole('combobox', { name: 'New destination', exact: true }).selectOption('queue:support');
    await page.getByRole('button', { name: 'Save route', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Inbound destination saved.' }).waitFor();
    await page.getByRole('cell', { name: 'Queue - Support', exact: true }).waitFor();
    assert.equal(config.numberAssignments['+12025550102'].destinationType, 'queue');
    await page.screenshot({ path: '/tmp/vocivo-number-routes-' + role + '.png', fullPage: true });
    await nav('Users').click();
    await row('bob').getByText('No direct number', { exact: true }).waitFor();
    assert.equal(config.userProfiles.u1.outboundCallerId, '+12025550102');
    await row('alice').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Numbers', exact: true }).click();
    await page.getByRole('combobox', { name: 'Outbound caller ID', exact: true }).waitFor();
    config.numberAssignments['+12025550101'].destinationType = 'main';
    await page.getByRole('button', { name: 'Save numbers', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Number assignments changed' }).waitFor();
    assert.equal(config.numberAssignments['+12025550101'].destinationType, 'main');
    await page.getByRole('button', { name: 'Reload numbers', exact: true }).click();
    await page.getByRole('alert').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('input[aria-label="Assign +12025550101"]')?.checked === false);
    assert.equal(await page.getByRole('checkbox', { name: 'Assign +12025550101', exact: true }).isChecked(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '/tmp/vocivo-user-numbers-narrow-' + role + '.png', fullPage: true });
    assert.equal(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'number editor does not overflow');
    assert.equal(config.numberAssignments['+442079460018'].destinationType, 'main');
    assert.equal(writes.filter(item => item.path === '/api/admin/number-routing' && item.body.action === 'user').length, 3);
    await page.getByRole('dialog').getByTitle('Close', { exact: true }).click();
    await page.setViewportSize({ width: 1600, height: 1000 });
    await nav('Phone numbers').click();
    await page.getByRole('button', { name: 'Remove +12025550102 from company', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(config.numberAssignments['+12025550102'].disabled, undefined);
    await page.getByRole('button', { name: 'Remove +12025550102 from company', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove number', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(config.numberAssignments['+12025550102'].disabled, true);
    assert.equal(config.userProfiles.u1.outboundCallerId, '');
    await context.close();
    console.log('PASS: ' + role + ' real console, distinct user lines, general-save preservation, shared routes, stale-edit rejection, narrow layout and confirmed removal.');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
