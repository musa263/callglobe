# ADR 0002: Telnyx as PSTN edge, internal native bridge

- Status: Accepted
- Date: 2026-08-31

## Context

Vocivo clients still need Telnyx WebRTC, CallKit, and push. Every SDK outbound call parks on a credential connection, so the server uses Call Control Dial to reach PSTN numbers and internal SIP aliases (including multi-device fork). Custom answer-then-bridge for internal added extra Call Control orchestration and a second Vocivo bridge that can race Telnyx.

A full cutover to Elastic SIP Trunking, or a second client SIP connection without park, would change CallKit/push and is out of scope for this change.

## Decision

1. Keep Telnyx WebRTC + Call Control park for all client-originated calls.
2. Keep the PSTN parked path as delay-answer plus Vocivo `answer` then `bridge`.
3. For internal parked calls, Dial with `link_to`, `bridge_intent`, and `bridge_on_answer`, and skip the second Vocivo `bridge`. Still answer the parked caller when the destination answers so media is not left parked.
4. Preserve `bridgeOnAnswer` on the call pair. Fork-initiated webhooks must not reset it to false.
5. Do not replace CallKit, PushKit, or the credential connection in this phase.

## Consequences

- Internal talk still uses Call Control legs (required for SIP alias fork). Ring remains unanswered until the destination answers.
- PSTN behavior is unchanged.
- Later phases can move PSTN to a Vocivo SIP trunk toward Telnyx, then replace client WebRTC, without mixing those cuts into this change.
