import { performance } from 'node:perf_hooks';

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length);
  return value || fallback;
}

const url = option('url', 'https://vocivo.vercel.app/api/health');
const requests = Math.max(1, Number(option('requests', '5000')));
const concurrency = Math.max(1, Math.min(requests, Number(option('concurrency', '100'))));
const timeoutMs = Math.max(500, Number(option('timeout', '10000')));
const durations = [];
const statuses = new Map();
let cursor = 0;
let failures = 0;

async function runRequest() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'vocivo-capacity-check/1.0' },
      signal: controller.signal,
    });
    await response.arrayBuffer();
    statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
    if (!response.ok) failures += 1;
  } catch {
    failures += 1;
    statuses.set('transport', (statuses.get('transport') || 0) + 1);
  } finally {
    clearTimeout(timeout);
    durations.push(performance.now() - started);
  }
}

async function worker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= requests) return;
    await runRequest();
  }
}

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const elapsedMs = performance.now() - started;
const sorted = durations.toSorted((a, b) => a - b);
const report = {
  url,
  requests,
  concurrency,
  successful: requests - failures,
  failures,
  statusCodes: Object.fromEntries([...statuses.entries()].map(([key, value]) => [String(key), value])),
  elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
  requestsPerSecond: Number((requests / (elapsedMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(sorted, 0.5).toFixed(1)),
    p95: Number(percentile(sorted, 0.95).toFixed(1)),
    p99: Number(percentile(sorted, 0.99).toFixed(1)),
    max: Number((sorted.at(-1) || 0).toFixed(1)),
  },
};

console.log(JSON.stringify(report, null, 2));
if (failures) process.exitCode = 1;
