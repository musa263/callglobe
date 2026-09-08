import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5191';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { saved: true } });
  });
  await page.route('**/__company-user-form', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="root"></div><script type="module">
    import React from '/node_modules/.vite/deps/react.js'; import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import RefreshRuntime from '/@react-refresh'; import '/src/styles/global.css'; import '/src/features/admin/admin.css'; import '/src/features/admin/admin-additions.css';
    RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;
    const { UserEditor } = await import('/src/features/admin/users/UserEditor.jsx');
    const { emptyUser, defaultProfile } = await import('/src/features/admin/configuration.js');
    function Harness() {
      const [draft,setDraft]=React.useState({...emptyUser}), [profile,setProfile]=React.useState({...defaultProfile}), [saved,setSaved]=React.useState(false);
      const save=async event=>{event.preventDefault(); await fetch('/api/admin/extensions?organizationId=qa-company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});setSaved(true);};
      return React.createElement('div',{className:'admin-console'},saved?React.createElement('p',{role:'status'},'User saved'):React.createElement(UserEditor,{draft,profile,organization:{accountType:'business',extensionStart:2000,extensionEnd:2019},onDraft:setDraft,onProfile:setProfile,onSave:save,onClose:()=>{},onProvision:()=>{},busy:false}));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Harness));
    </script></body></html>` }));
  await page.goto(`${origin}/__company-user-form`);
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Role', { exact: true }).inputValue(), 'user');
  await page.getByLabel('Display name', { exact: true }).fill('Example Employee');
  await page.getByLabel('Email', { exact: true }).fill('employee@example.invalid');
  await page.getByLabel('Temporary web sign-in password', { exact: false }).fill('TemporaryPass65');
  await page.screenshot({ path: '/tmp/vocivo-build65-create-user.png', fullPage: true });
  await page.getByRole('button', { name: 'Save user', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'User saved' }).waitFor();
  assert.equal(writes.length, 1); assert.equal(writes[0].role, 'user');
  assert.equal(writes[0].email, 'employee@example.invalid'); assert.equal(writes[0].loginPassword, 'TemporaryPass65');
  assert.deepEqual(errors, []);
  console.log('PASS: an ordinary employee exposes email/password web sign-in fields and saves without granting admin role.');
} finally { await browser.close(); }
