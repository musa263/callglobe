/**
 * Keeps the browser phone's SIP registration alive: the socket to the edge
 * drops when a laptop sleeps, changes Wi-Fi or loses its connection for a
 * moment. SIP.js itself never reconnects (reconnectionAttempts defaults to 0)
 * and never re-REGISTERs after a reconnect, so without this the web phone
 * showed "Ready for calls" while calls to it rang nobody.
 *
 * Pure logic, so it is tested without a socket. The same design as
 * mobile/src/voice/sipRegistrationKeeper.ts.
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
 *   isPending?: (error: unknown) => boolean,
 * }} deps
 */
export function createRegistrationKeeper(deps) {
  const schedule = deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const isPending = deps.isPending ?? (() => false);
  let wanted = false;
  let attempt = 0;
  let timerArmed = false;

  const register = async (why) => {
    try {
      await deps.register();
    } catch (error) {
      if (isPending(error)) return;
      deps.notify('Unregistered', `${why}: ${describe(error)}`);
      throw error;
    }
  };

  const scheduleReconnect = () => {
    if (!wanted || timerArmed) return;
    timerArmed = true;
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    schedule(() => {
      timerArmed = false;
      if (!wanted || deps.isConnected()) return;
      deps.reconnect().catch(() => scheduleReconnect());
    }, delay);
  };

  return {
    onConnect: () => {
      attempt = 0;
      if (!wanted || deps.isRegistered()) return;
      register('reconnected').catch(() => undefined);
    },
    onDisconnect: (error) => {
      if (!wanted) return;
      deps.notify('Reconnecting', error ? `connection lost: ${describe(error)}` : 'connection closed');
      scheduleReconnect();
    },
    start: async () => {
      wanted = true;
      attempt = 0;
      if (!deps.isRegistered()) await register('register');
    },
    stop: () => {
      wanted = false;
    },
    refresh: async () => {
      if (!wanted) return;
      if (!deps.isConnected()) {
        attempt = 0;
        try {
          await deps.reconnect();
        } catch (error) {
          deps.notify('Reconnecting', `connection failed: ${describe(error)}`);
          scheduleReconnect();
        }
        return;
      }
      if (!deps.isRegistered()) await register('refresh').catch(() => undefined);
    },
    get wanted() {
      return wanted;
    },
  };
}
