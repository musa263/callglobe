import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createAiTransferHandler } from './routes/voice-ai-transfer.js';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';

function fixture(overrides: Parameters<typeof createAiTransferHandler>[0] = {}) {
  const config = defaultPbxConfig();
  config.ai = { ...config.ai, enabled: true, transferEnabled: true, assistantId: 'assistant-a' };
  const actions: string[] = [];
  let claims = 0;
  let releases = 0;
  const handler = createAiTransferHandler({
    verifyAiTransferToken: () => ({callControlId:'call', organizationId:'primary', assistantId:'assistant-a', inboundNumber:'+15555550100', expiresAt:Date.now()}),
    findExtension: async () => ({id:'extension', extension:'1001', organizationId:'primary', sipUsername:'sam', name:'Sam', status:'active'} as any),
    readPbxConfig: async () => config,
    readBusinessVoiceConfig: async () => ({companyName:'Test'} as any),
    claimReplayKey: async () => {claims++; return true;},
    releaseReplayKey: async () => {releases++; return true;},
    listExtensionSipUsernames: async () => ['sam'],
    callAction: async (_id, action) => {
      actions.push(action);
      if (action === 'playback_start') throw new Error('playback unavailable');
      return {} as any;
    },
    dialCall: async () => {actions.push('dial'); return {} as any;},
    sendIncomingCallWebPush: async () => undefined as any,
    ...overrides,
  });
  async function send(extension: unknown = '1001') {
    let status = 0;
    const response = {status(code: number) {status=code;return this;},json() {return this;}} as unknown as VercelResponse;
    await handler({method:'POST',headers:{'x-telnyx-call-control-id':'call'},query:{token:'test'},body:{extension}} as unknown as VercelRequest,response);
    return status;
  }
  return {config,actions,send,counts:()=>({claims,releases})};
}

test('signed AI transfer still obeys current tenant permission and assistant binding', async () => {
  for (const change of [{enabled:false}, {transferEnabled:false}, {assistantId:'replacement'}]) {
    const f=fixture(); Object.assign(f.config.ai,change);
    assert.equal(await f.send(),403);
    assert.equal(f.counts().claims,0);
    assert.deepEqual(f.actions,[]);
  }
});

test('AI transfer rejects malformed destinations instead of silently rewriting them', async () => {
  const f=fixture();
  for (const input of ['call1001','10-01',1001,'1001 or 1002']) assert.equal(await f.send(input),400);
  assert.deepEqual(f.actions,[]);
});

test('failed ringback after stopping AI resumes speech before releasing claim', async () => {
  const previous=process.env.VITE_APP_URL;process.env.VITE_APP_URL='https://vocivo.test';
  try {
    const f=fixture();
    assert.equal(await f.send(),500);
    assert.deepEqual(f.actions,['ai_assistant_stop','playback_start','playback_stop','ai_assistant_start']);
    assert.equal(f.counts().releases,1);
  } finally {
    if (previous === undefined) delete process.env.VITE_APP_URL; else process.env.VITE_APP_URL=previous;
  }
});

test('a transfer lookup failure never stops playback it does not own', async () => {
  const f=fixture({readPbxConfig:async()=>{throw new Error('database unavailable');}});
  assert.equal(await f.send(),500);
  assert.deepEqual(f.actions,[]);
});

test('a cross-tenant extension result is refused before carrier actions', async () => {
  const f=fixture({findExtension:async()=>({id:'extension',organizationId:'other',status:'active',sipUsername:'other'} as any)});
  assert.equal(await f.send(),404);
  assert.deepEqual(f.actions,[]);
});

test('an uncertain dial retains its claim and does not interrupt a possible connected leg', async () => {
  const previous=process.env.VITE_APP_URL;process.env.VITE_APP_URL='https://vocivo.test';
  try {
    const actions:string[]=[];
    const f=fixture({callAction:async(_id,action)=>{actions.push(action);return {} as any;},dialCall:async()=>{throw new Error('response lost');}});
    assert.equal(await f.send(),500);
    assert.equal(f.counts().releases,0);
    assert.deepEqual(actions,['ai_assistant_stop','playback_start']);
  } finally {
    if (previous === undefined) delete process.env.VITE_APP_URL;else process.env.VITE_APP_URL=previous;
  }
});
