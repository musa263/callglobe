// The Telnyx package currently publishes implementation .ts files as its type entry,
// which makes consumer type-checks traverse vendor internals. The high-level commons
// SDK only exposes these two native types to this app.
export class Call {
  readonly callId: string;
  readonly telnyxCallControlId: string | null;
  readonly telnyxLegId: string | null;
  readonly telnyxSessionId: string | null;
}

export class TelnyxRTC {}
