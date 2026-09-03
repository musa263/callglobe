/**
 * Keeps a SIP registration alive across a phone's ordinary life: the socket to
 * the edge drops when the app goes to the background, when Wi-Fi hands over to
 * cellular, when a lift door closes. SIP.js itself never reconnects and never
 * re-REGISTERs after a reconnect, so without this a phone that changed
 * networks once silently stopped ringing until the app was restarted.
 *
 * Pure logic, so it is tested without a socket: the stack hands in the four
 * things it can do (is the transport up, reconnect it, send REGISTER, is the
 * registration current) and this decides when to do them.
 */

export type RegistrationKeeperDeps = {
  isConnected: () => boolean;
  reconnect: () => Promise<void>;
  /** Sends REGISTER. Rejects on failure; the keeper reports the reason. */
  register: () => Promise<void>;
  isRegistered: () => boolean;
  /**
   * Reports a state the UI should show: `Reconnecting` while the socket is
   * being brought back (calls stay up), `Unregistered` when the registrar
   * refused us or a REGISTER could not be sent.
   */
  notify: (state: 'Unregistered' | 'Reconnecting', reason: string) => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  /** A rejection that means "a REGISTER is already in flight", not a failure. */
  isPending?: (error: unknown) => boolean;
};

/**
 * How long to wait before the n-th attempt to get the socket back: 1s, 2s, 4s,
 * 8s, 16s, then every 30s for as long as the registration is wanted. A phone
 * that lost coverage in a lift is back within the first few; one that is off
 * the network for an hour keeps trying quietly rather than giving up.
 */
export function reconnectDelayMs(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 5)));
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createRegistrationKeeper(deps: RegistrationKeeperDeps) {
  const schedule = deps.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const isPending = deps.isPending ?? (() => false);
  // Whether a registration is still wanted. `stop()` clears it, and after
  // that a dropped socket is left dropped instead of being brought back.
  let wanted = false;
  let attempt = 0;
  let timerArmed = false;

  const register = async (why: string) => {
    try {
      await deps.register();
    } catch (error) {
      // A REGISTER already in flight reports its own outcome through the
      // registerer's state; anything else is worth a word in the UI.
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
    /** The transport came up (first time or after a drop). */
    onConnect: () => {
      attempt = 0;
      if (!wanted || deps.isRegistered()) return;
      void register('reconnected').catch(() => undefined);
    },

    /** The transport went down. `error` is set when the network or server dropped it. */
    onDisconnect: (error?: unknown) => {
      if (!wanted) return;
      deps.notify('Reconnecting', error ? `connection lost: ${describe(error)}` : 'connection closed');
      scheduleReconnect();
    },

    /** Call once the transport has been started. Registers if onConnect has not already. */
    start: async () => {
      wanted = true;
      attempt = 0;
      if (!deps.isRegistered()) await register('register');
    },

    stop: () => {
      wanted = false;
    },

    /**
     * After the app comes to the front or the network changes: straight back
     * on, rather than waiting for the back-off timer.
     */
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

    /** For tests and diagnostics. */
    get wanted() {
      return wanted;
    },
  };
}

export type RegistrationKeeper = ReturnType<typeof createRegistrationKeeper>;
