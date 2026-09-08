import assert from 'node:assert/strict';

// Mount the provider selector; engine fixtures record activation, never connect.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.VOCIVO_TEST_ORIGIN || 'http://127.0.0.1:5183';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseFirst;
  let deny = false;
  let requests = 0;
  const firstRequest = new Promise(resolve => { releaseFirst = resolve; });
  await page.route('**/api/voice/config', async route => {
    requests++;
    if (requests === 1) {
      await firstRequest;
      return route.fulfill({ json: { voice_edge: 'telnyx' } });
    }
    return route.fulfill({ status: deny ? 403 : 200, json: deny ? { error: 'Calling is not enabled for this account.' } : { voice_edge: 'sip' } });
  });
  for (const [hook, engine] of [['useSipVoice', 'sip'], ['useTelnyxVoice', 'telnyx']]) {
    await page.route(`**/src/features/calling/hooks/${hook}*`, route => route.fulfill({ contentType: 'application/javascript', body: `
      import React from '/node_modules/.vite/deps/react.js';
      export function ${hook}(token, enabled) {
        React.useEffect(() => { if (enabled) window.activations.push('${engine}:' + token); }, [token, enabled]);
        return { ready: false, statusLabel: '${engine}', error: '' };
      }
    ` }));
  }
  await page.route('**/__voice-config-qa', route => route.fulfill({ contentType: 'text/html', body: `
    <div id="root"></div><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import { useVoice } from '/src/features/calling/hooks/useVoice.js';
      window.activations = [];
      function Phone() {
        const [input, setInput] = React.useState({owner:'A',token:null,enabled:false});
        window.setInput = setInput;
        window.voice = useVoice(input.token,input.enabled,{},input.owner);
        return React.createElement('pre',null,JSON.stringify(window.voice));
      }
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Phone));
    </script>
  ` }));
  await page.goto(`${origin}/__voice-config-qa`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.setInput);
  await page.waitForTimeout(100);
  assert.equal(requests, 1, 'configuration read starts before profile verification');
  assert.deepEqual(await page.evaluate(() => window.activations), []);
  await page.evaluate(() => window.setInput({owner:'B',token:'B',enabled:true}));
  await page.waitForFunction(() => window.activations.includes('sip:B'));
  releaseFirst();
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => window.activations), ['sip:B'], 'late account-A response cannot choose a provider for account B');
  console.log('PASS: config prefetch is session-scoped; unverified and stale responses cannot activate an engine');

  deny = true;
  await page.clock.install();
  await page.evaluate(() => window.setInput({owner:'C',token:'C',enabled:true}));
  await page.waitForFunction(() => window.voice.error === 'Calling is not enabled for this account.');
  const deniedRequests = requests;
  await page.clock.runFor(60_000);
  assert.equal(requests, deniedRequests, 'final config denial must not create a retry loop');
  assert.deepEqual(await page.evaluate(() => window.activations), ['sip:B']);
  assert.equal(await page.evaluate(() => window.voice.ready), false);
  console.log('PASS: 403 configuration denial stays visible and fail-closed without repeated requests');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
