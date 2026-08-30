import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForWebCallMedia } from './webCallMedia.js';

test('web timer waits for conversation RTP after ringback packets', async () => {
  let inbound = 9;
  let outbound = 9;
  const call = {
    peer: {
      instance: {
        getStats: async () => new Map([
          ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: inbound }],
          ['out', { type: 'outbound-rtp', kind: 'audio', packetsSent: outbound }],
        ]),
      },
    },
    remoteStream: { getAudioTracks: () => [{ readyState: 'live' }] },
  };
  setTimeout(() => { inbound = 24; outbound = 24; }, 80);
  assert.equal(await waitForWebCallMedia(call, 800), true);
});

test('live remote tracks without new RTP do not start the web timer', async () => {
  const call = {
    peer: {
      instance: {
        getStats: async () => new Map([
          ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: 4 }],
          ['out', { type: 'outbound-rtp', kind: 'audio', packetsSent: 4 }],
        ]),
      },
    },
    remoteStream: { getAudioTracks: () => [{ readyState: 'live' }] },
  };
  assert.equal(await waitForWebCallMedia(call, 250), false);
});
