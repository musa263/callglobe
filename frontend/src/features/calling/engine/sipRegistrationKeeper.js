/**
 * Keeps the browser phone's SIP registration alive: the socket to the edge
 * drops when a laptop sleeps, changes Wi-Fi or loses its connection for a
 * moment. SIP.js itself never reconnects (reconnectionAttempts defaults to 0)
 * and never re-REGISTERs after a reconnect, so without this the web phone
 * showed "Ready for calls" while calls to it rang nobody.
 *
 * Pure logic, so it is tested without a socket. The same design as
 * mobile/src/features/calling/engine/sipRegistrationKeeper.ts.
 */

/**
 * 1s, 2s, 4s, 8s, 16s, then every 30s for as long as the registration is
 * wanted.
 */
export function reconnectDelayMs(attempt) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 5)));
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {{
 *   isConnected: () => boolean,
 *   reconnect: () => Promise<void>,
 *   register: () => Promise<void>,
 *   isRegistered: () => boolean,
 *   notify: (state: 'Unregistered' | 'Reconnecting', reason: string) => void,
 *   schedule?: (callback: () => void, delayMs: number) => unknown,
 *   cancelSchedule?: (handle: unknown) => void,
 *   isPending?: (error: unknown) => boolean,
 * }} deps
 */
export function createRegistrationKeeper(deps) {
  const schedule = deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = deps.cancelSchedule ?? ((handle) => clearTimeout(handle));
  const isPending = deps.isPending ?? (() => false);
  let wanted = false;
  let attempt = 0;
  let timer = null;
  let generation = 0;
  let running = false;
  let needsRegistration = false;

  const clearRetry = () => {
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  };

  const scheduleRetry = () => {
    if (!wanted || timer !== null) return;
    const current = generation;
    timer = schedule(() => {
      if (current !== generation) return;
      timer = null;
      void recover('retry');
    }, reconnectDelayMs(attempt++));
  };

  const recover = async (why) => {
    if (!wanted || running) return;
    const current = generation;
    running = true;
    try {
      if (!deps.isConnected()) {
        needsRegistration = true;
        await deps.reconnect();
      }
      if (!wanted || current !== generation) return;
      if (needsRegistration || !deps.isRegistered()) {
        needsRegistration = false;
        await deps.register();
      }
      if (deps.isRegistered()) {
        attempt = 0;
        clearRetry();
      }
    } catch (error) {
      if (wanted && current === generation && !isPending(error)) {
        needsRegistration = true;
        deps.notify(deps.isConnected() ? 'Unregistered' : 'Reconnecting', `${why}: ${describe(error)}`);
      }
    } finally {
      running = false;
      if (wanted && current === generation && (needsRegistration || !deps.isConnected() || !deps.isRegistered())) scheduleRetry();
    }
  };

  return {
    onConnect: () => { void recover('reconnected'); },
    onRegistered: () => {
      needsRegistration = false;
      attempt = 0;
      clearRetry();
    },
    onUnregistered: () => {
      needsRegistration = true;
      scheduleRetry();
    },
    onDisconnect: (error) => {
      if (!wanted) return;
      needsRegistration = true;
      deps.notify('Reconnecting', error ? `connection lost: ${describe(error)}` : 'connection closed');
      scheduleRetry();
    },
    start: async () => {
      wanted = true;
      await recover('register');
    },
    stop: () => {
      wanted = false;
      generation += 1;
      clearRetry();
    },
    refresh: async () => {
      clearRetry();
      await recover('refresh');
    },
    get wanted() { return wanted; },
  };
}
