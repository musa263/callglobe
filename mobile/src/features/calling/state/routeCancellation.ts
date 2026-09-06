import { SerialTaskQueue } from './callLifecycle';

export type PendingRouteCancellation = { session: string; routeId: string };
type Dependencies = {
  read(): Promise<PendingRouteCancellation[]>;
  write(entries: PendingRouteCancellation[]): Promise<void>;
  session(): Promise<string | null>;
  send(routeId: string, session: string): Promise<{ canceled: boolean }>;
};

/** Persist before sending; acknowledge before removing. Never replay as another login. */
export class RouteCancellationOutbox {
  private readonly writes = new SerialTaskQueue();
  private flushing?: Promise<void>;
  private readonly pending = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: Dependencies) {}

  async cancel(routeId: string) {
    const session = await this.dependencies.session();
    if (!session) throw new Error('Sign in to finish canceling the call.');
    return this.cancelForSession(session, routeId);
  }

  private async cancelForSession(session: string, routeId: string) {
    const key = `${session}:${routeId}`;
    const previous = this.pending.get(key);
    if (previous) return previous;
    const operation = this.persist(session, routeId).then(() => this.deliver(session, routeId));
    this.pending.set(key, operation);
    try { await operation; }
    finally { this.pending.delete(key); }
  }

  private persist(session: string, routeId: string) {
    return this.writes.run(async () => {
      const entries = await this.dependencies.read();
      if (entries.some(entry => entry.session === session && entry.routeId === routeId)) return;
      if (entries.length >= 64) throw new Error('Call cancellation retry storage is full.');
      await this.dependencies.write([...entries, { session, routeId }]);
    });
  }

  private async deliver(session: string, routeId: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (await this.dependencies.session() !== session) throw new Error('Calling session changed; cancellation remains queued.');
      try {
        const result = await this.dependencies.send(routeId, session);
        if (result.canceled !== true) throw new Error('Remote call cancellation was not acknowledged.');
        await this.writes.run(async () => {
          const entries = await this.dependencies.read();
          await this.dependencies.write(entries.filter(entry => entry.session !== session || entry.routeId !== routeId));
        });
        return;
      } catch (failure) {
        if (attempt === 1) throw failure;
      }
    }
  }

  flush() {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const session = await this.dependencies.session();
      if (!session) return;
      const entries = await this.writes.run(() => this.dependencies.read());
      for (const entry of entries) {
        if (entry.session !== session) continue;
        if (await this.dependencies.session() !== session) return;
        await this.cancelForSession(session, entry.routeId);
      }
    })().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }
}
