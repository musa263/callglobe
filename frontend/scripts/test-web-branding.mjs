import assert from 'node:assert/strict';
import { defaultPbxConfig } from '../api/_lib/features/organizations/pbx-config-store.ts';
import { defaultPlans, featureCatalog } from '../api/_lib/features/organizations/saas-store.ts';

// Real application screens, fixture-only HTTP/SDKs. Never starts live media.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const config = defaultPbxConfig();
const plans = defaultPlans();
const organization = { ...config.organizations[0], name: 'QA Company', admins: [], plan: plans[0], usage: { seats: 1 },
  subscription: { status: 'active', planId: plans[0].id }, entitlements: Object.fromEntries(featureCatalog.map(item => [item.id, true])) };
const adminData = {
  '/api/admin/pbx': { config },
  '/api/admin/saas': { platform: { name: 'Vocivo Communications' }, organizations: [organization], plans, featureCatalog },
  '/api/admin/extensions': { extensions: [] },
  '/api/admin/numbers': { numbers: [], orders: [], messagingProfiles: [] },
  '/api/admin/api-keys': { keys: [] },
  '/api/admin/events': { events: [] },
};
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 820, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    let admin = false;
    let holdPbx = false;
    let holdExtensions = false;
    const pbxGate = deferred();
    const extensionsGate = deferred();
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(() => {
      if (sessionStorage.getItem('vocivo.brand-fixture-seeded')) return;
      sessionStorage.setItem('vocivo.brand-fixture-seeded', '1');
      localStorage.setItem('vocivo.session', JSON.stringify({ sub: 'fixture-user' }));
    });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      const profile = { id: 'fixture-user', organization_id: config.activeOrganizationId, full_name: 'QA User',
        role: admin ? 'superadmin' : 'user', account_type: admin ? 'platform' : 'individual', admin_only: admin };
      if (url.pathname === '/api/admin/pbx' && holdPbx) await pbxGate.promise;
      if (url.pathname === '/api/admin/extensions' && holdExtensions) await extensionsGate.promise;
      const data = {
        ...adminData,
        '/api/auth/session': { profile },
        '/api/mobile/bootstrap': { profile, numbers: [], account: { balance: 0, rates: [] } },
        '/api/voice/config': { provider: 'sip', voice_edge: 'sip' },
        '/api/voice/sip-credentials': { username: 'fixture', password: 'fixture', domain: 'test.invalid', wsUri: 'wss://test.invalid' },
      };
      await route.fulfill({ json: data[url.pathname] || {} });
    });
    await context.route('**/src/features/calling/engine/sipSession*', route => route.fulfill({ contentType: 'application/javascript', body: `
      export async function connectSipUserAgent(input) { return {stop:async()=>{},userAgent:{isConnected:()=>true}}; }
      export function attachSipMedia(){return ()=>{}}
      export function sipSessionId(){return ''}
      export function inviteSipTarget(){throw new Error('Calling is not permitted in branding fixtures')}
    ` }));
    await context.route('**/node_modules/.vite/deps/@telnyx_video.js*', route => route.fulfill({ contentType: 'application/javascript',
      body: `export async function initialize(){throw new Error('Video fixture: no room credentials')}` }));

    const verifyBrand = async label => {
      const header = page.locator('.vocivo-app-header');
      await header.waitFor();
      assert.equal(await header.count(), 1, label);
      assert.equal(await header.innerText(), 'Vocivo');
      const geometry = await header.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const image = element.querySelector('img');
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, imageLoaded: image.complete && image.naturalWidth > 0,
          viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.deepEqual(geometry, { x: 0, y: 0, width, height: 56, imageLoaded: true, viewport: width, overflow: false }, label);
      await page.screenshot({ path: `/tmp/vocivo-brand-${width}-${label}.png` });
    };
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Make a call', exact: true }).waitFor();
    await page.locator('.vocivo-wordmark img').evaluate(image => image.decode());
    const navigation = page.locator(width <= 620 ? '.mobile-nav' : '.side-nav nav');
    for (const [label, heading] of [['Dialer', 'Make a call'], ['Calls', 'Recent calls'], ['Top up', 'Top up balance'], ['Countries', 'Country codes'], ['Settings', 'Phone settings']]) {
      await navigation.getByRole('button', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      await verifyBrand(label.replaceAll(' ', '-'));
    }
    await page.evaluate(() => localStorage.removeItem('vocivo.session'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    await verifyBrand('Login');

    admin = true;
    holdPbx = true;
    holdExtensions = true;
    requests.length = 0;
    await page.evaluate(() => localStorage.setItem('vocivo.session', JSON.stringify({sub:'fixture-user'})));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('Loading Vocivo control plane', { exact: true }).waitFor();
    await verifyBrand('Admin-loading');
    assert(requests.includes('/api/admin/saas'), 'SaaS read must overlap the held PBX read');
    holdPbx = false;
    pbxGate.resolve();
    // All scoped reads must start while the first one is still unresolved.
    const expectedReads = ['/api/admin/extensions', '/api/admin/wallets', '/api/admin/overview', '/api/admin/trunks', '/api/admin/numbers', '/api/admin/voices', '/api/admin/api-keys', '/api/voice/settings', '/api/admin/events'];
    for (let attempt = 0; attempt < 50 && !expectedReads.every(path => requests.includes(path)); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    assert(expectedReads.every(path => requests.includes(path)), `Independent admin reads were serialized: ${requests.join(',')}`);
    holdExtensions = false;
    extensionsGate.resolve();
    await page.getByTitle('Refresh system').waitFor();
    assert.equal(await page.locator('.admin-brand').isVisible(), false, 'shared header replaces the crowded duplicate admin wordmark');
    const adminNav = page.locator('.admin-console > aside .nav-group');
    for (const name of ['Customers', 'Users', 'Settings']) {
      const button = adminNav.getByRole('button', { name, exact: true });
      if (await button.count()) await button.click();
      await page.locator('.admin-console > main .page').waitFor();
      await verifyBrand(`Admin-${name}`);
    }
    assert.equal(requests.includes('/api/voice/sip-credentials'), false, 'admin-only session must not start calling');
    await page.goto(`${origin}/enroll.html`, { waitUntil: 'domcontentloaded' });
    await page.getByText('This setup link is incomplete.', { exact: false }).waitFor();
    await verifyBrand('Enrollment');
    await page.goto(`${origin}/video.html`, { waitUntil: 'domcontentloaded' });
    await page.getByText('Video fixture: no room credentials', { exact: true }).waitFor();
    await verifyBrand('Video');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px top brand on phone, login, admin/loading, enrollment, video; parallel admin reads; no unhandled errors`);
    await context.close();
  }
} finally { await browser.close(); }
