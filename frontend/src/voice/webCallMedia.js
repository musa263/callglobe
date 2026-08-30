const MIN_CONVERSATION_RTP_PACKETS = 12;

function audioRtpCounts(stats) {
  let inbound = 0;
  let outbound = 0;
  stats.forEach((record) => {
    const audio = !record.kind || record.kind === 'audio';
    if (record.type === 'inbound-rtp' && audio) inbound += Number(record.packetsReceived || 0);
    if (record.type === 'outbound-rtp' && audio) outbound += Number(record.packetsSent || 0);
  });
  return { inbound, outbound };
}

export async function waitForWebCallMedia(call, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let baseline = { inbound: 0, outbound: 0 };
  const readPeer = () => call?.peer?.instance;
  if (!readPeer()?.getStats) return false;
  try {
    baseline = audioRtpCounts(await readPeer().getStats());
  } catch {
    baseline = { inbound: 0, outbound: 0 };
  }

  while (Date.now() < deadline) {
    const peer = readPeer();
    if (!peer?.getStats) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      const current = audioRtpCounts(await peer.getStats());
      if (
        current.inbound - baseline.inbound >= MIN_CONVERSATION_RTP_PACKETS
        && current.outbound - baseline.outbound >= MIN_CONVERSATION_RTP_PACKETS
      ) {
        return true;
      }
    } catch {
      // Keep waiting for conversation RTP.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
