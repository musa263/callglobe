export type NetworkPresentation = {
  bars: number;
  label: string;
  status: 'Voice ready' | 'Connecting voice' | 'No connection';
};

export function networkPresentation(
  type: string,
  details: Record<string, unknown> | null,
  connected: boolean | null,
  _reachable: boolean | null,
  voiceReady: boolean,
): NetworkPresentation {
  // A connected Telnyx socket is stronger evidence than NetInfo's optional
  // reachability probe, which can be null or briefly false on healthy networks.
  if (voiceReady) {
    const base = networkQuality(type, details);
    return { ...base, bars: Math.max(base.bars, 3), status: 'Voice ready' };
  }
  if (connected === false) return { bars: 0, label: 'Offline', status: 'No connection' };
  const base = networkQuality(type, details);
  // Until both transport and voice registration are authoritative, keep the
  // status neutral. Reachability probes can be blocked by otherwise usable
  // Wi-Fi and carrier networks.
  return { ...base, status: 'Connecting voice' };
}

function networkQuality(type: string, details: Record<string, unknown> | null) {
  if (type === 'wifi') {
    const strength = typeof details?.strength === 'number' ? details.strength : 65;
    return { bars: strength >= 75 ? 4 : strength >= 50 ? 3 : strength >= 25 ? 2 : 1, label: 'Wi-Fi' };
  }
  if (type === 'cellular') {
    const generation = String(details?.cellularGeneration ?? '').toUpperCase();
    const bars = generation === '5G' ? 4 : generation === '4G' ? 3 : generation === '3G' ? 2 : 1;
    return { bars, label: generation || 'Mobile' };
  }
  return { bars: 2, label: 'Checking network' };
}
