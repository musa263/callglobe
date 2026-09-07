import type { IncomingResponse } from 'sip.js/lib/core';

/** Correlate REGISTER responses with the currently wanted credential generation. */
export function sipRegistrationRequestDelegate(context: {
  wanted: () => boolean;
  current: () => boolean;
  ready: () => boolean;
  registered: () => void;
  rejected: (status: number, reason: string) => void;
}) {
  return {
    onAccept: () => {
      // SIP.js validates Contact/expiry before this callback, but does not emit
      // Registered again after recovery if its local state was already Registered.
      // Only a current, usable final response may clear the app's recovery deadline.
      if (!context.wanted() || !context.current() || !context.ready()) return;
      context.registered();
    },
    onReject: (response: IncomingResponse) => {
      if (!context.wanted()) return;
      if (!context.current()) {
        context.rejected(503, 'Retrying registration with renewed credentials');
        return;
      }
      context.rejected(response.message.statusCode ?? 503, response.message.reasonPhrase || 'Registration rejected');
    },
  };
}
