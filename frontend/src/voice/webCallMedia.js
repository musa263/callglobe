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

export function samplesHaveSpeechEnergy(samples, threshold = 8) {
  if (!samples?.length) return false;
  let min = 255;
  let max = 0;
  for (const value of samples) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return max - min > threshold;
}

export async function remoteInboundAudioStarted(call, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  const readPeer = () => call?.peer?.instance;
  let baseline = 0;
  try {
    if (readPeer()?.getStats) baseline = audioRtpCounts(await readPeer().getStats()).inbound;
  } catch {
    baseline = 0;
  }
  while (Date.now() < deadline) {
    const peer = readPeer();
    if (!peer?.getStats) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      continue;
    }
    try {
      const current = audioRtpCounts(await peer.getStats()).inbound;
      if (current - baseline >= 3) return true;
    } catch {
      // Keep waiting for the first remote packets.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
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
