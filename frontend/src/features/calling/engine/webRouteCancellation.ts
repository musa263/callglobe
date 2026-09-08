type Entry = { routeId: string; retryAt: number };
type Dependencies = {
  owner: string;
  currentOwner(): string | null;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  send(routeId: string): Promise<{ canceled?: boolean }>;
  now?: () => number;
};

/** Per-tab, account-bound outbox. No credentials or phone numbers are persisted. */
export function createWebRouteCancellation({ owner, currentOwner, storage, send, now = Date.now }: Dependencies) {
  const key = `vocivo.telnyx-cancellations.v1:${owner}`;
  let flushing: Promise<void> | undefined;
  const read = (): Entry[] => {
    const entries = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(entries)) throw new Error('Call cancellation storage is invalid.');
    return entries;
  };
  const write = (entries: Entry[]) => storage.setItem(key, JSON.stringify(entries));
  const flush = () => {
    if (flushing) return flushing;
    flushing = (async () => {
      let failure: unknown;
      for (const entry of read()) {
        if (currentOwner() !== owner) break;
        if (entry.retryAt > now()) continue;
        try {
          const result = await send(entry.routeId);
          if (result.canceled !== true) throw new Error('Call cancellation is still pending.');
          write(read().filter(item => item.routeId !== entry.routeId));
        } catch (error) {
          failure = error;
          const retry = Number((error as { retryAfterMs?: number })?.retryAfterMs);
          const delay = Number.isFinite(retry) && retry > 0 ? Math.min(60_000, retry) : 5_000;
          write(read().map(item => item.routeId === entry.routeId ? { ...item, retryAt: now() + delay } : item));
        }
      }
      if (failure) throw failure;
    })().finally(() => { flushing = undefined; });
    return flushing;
  };
  return {
    flush,
    cancel(routeId: string) {
      // Persist synchronously before the caller discards its route reference.
      const entries = read();
      if (!entries.some(item => item.routeId === routeId)) {
        if (entries.length >= 64) throw new Error('Call cancellation storage is full. Reconnect to finish pending calls.');
        write([...entries, { routeId, retryAt: 0 }]);
      }
      return flush();
    },
  };
}
