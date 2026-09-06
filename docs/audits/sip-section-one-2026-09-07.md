# Section 1 SIP audit — 2026-09-07

Scope: repository inspection of Kamailio ingress and transaction routing, browser/mobile SIP.js integration, and installed SIP.js transaction/authentication code. This is not a wire-level compliance certification.

## Change made

Kamailio previously skipped its entire sanity check on port 8080. All transports now run mask 1383 (the previous 1511 minus Content-Length bit 128), with the existing URI mask 7. Non-WebSocket ingress separately runs bit 128. This preserves the documented native client workaround while restoring required-header, CSeq, version/scheme, Expires and URI checks on WebSocket requests. Removed the extra error reply after sanity failure because the module sends its own reply by default.

Existing authentication changes in the working tree were preserved.

## Findings still requiring implementation and packet verification

1. Header checking is not complete structural validation. Audit Via parameters, From/To tags, Call-ID syntax, duplicate singleton headers, CSeq bounds, and Contact cardinality/parameters. Contact is conditional: an INVITE needs it, but a REGISTER binding query may omit it. URI mask 7 does not include Contact. Max-Forwards is currently processed before sanity checking; verify malformed and missing values separately from a hop count of zero.
2. `CHALLENGE`, `AUTH`, and `ROUTE_CHECK` call synchronous `http_client_query`. Loading async workers does not make those calls non-blocking. An asynchronous conversion must preserve transaction-scoped state across callbacks and handle CANCEL, timeout, duplicate requests and late HTTP completion before being deployed.
3. REGISTER establishes a transaction before authentication. Initial INVITE challenge/authentication paths need verification that retransmitted UDP requests cannot repeat external work or produce inconsistent challenges before a transaction exists.
4. SIP.js already handles 401 and 407 through its authentication guard, with a bounded stale-nonce retry. Preserve that behavior; do not add an unconditional application retry loop. Verify wrong-password and repeated-stale challenges at the wire boundary.
5. SIP.js delivers provisional responses and final failures through delegates; Kamailio relays responses and uses failure routes. Explicitly exercise 100/180/183, 200, 3xx, 401/407, 486, 503 and 603. Redirects must retain destination authorization. Verify 2xx ACK separately from non-2xx transaction ACK.

## Timer ownership and acceptance criteria

SIP.js owns client and server transactions over reliable WebSocket transport. Kamailio TM owns proxy transactions, including UDP retransmission. FreeSWITCH owns the terminating SIP legs. Do not add competing application timers that retransmit SIP messages.

| Timer | Role | Verification required |
| --- | --- | --- |
| A | INVITE client request retransmission on unreliable transport | Exponential backoff from T1; stop on provisional response |
| B | INVITE client transaction timeout | 64 × T1 while Calling |
| C | Proxy INVITE timeout | Verify proxy policy against RFC 3261 section 16; greater than three minutes where applicable |
| D | INVITE client completed-state retention | At least 32 seconds on unreliable transport; zero on reliable transport |
| E | Non-INVITE client retransmission | Backoff capped at T2; continue at T2 after provisional response |
| F | Non-INVITE client timeout | 64 × T1 |
| G | INVITE server non-2xx response retransmission | Backoff capped at T2 on unreliable transport |
| H | INVITE server wait for non-2xx ACK | 64 × T1 |
| I | INVITE server confirmed-state retention | T4 on unreliable transport; zero on reliable transport |
| J | Non-INVITE server completed-state retention | 64 × T1 on unreliable transport; zero on reliable transport |
| K | Non-INVITE client completed-state retention | T4 on unreliable transport; zero on reliable transport |

Installed SIP.js defines B/F/H as 64 × T1 and D/I/J/K as zero for reliable transport. Kamailio config sets `fr_timer=30000` and `fr_inv_timer=120000`; extension delivery also uses a bounded 45-second lifetime. These settings must be mapped to the deployed TM implementation before claiming RFC timer compliance. In particular, do not equate `fr_inv_timer=120000` with a compliant Timer C without resolving the proxy policy distinction. Successful INVITE 2xx retransmission/ACK handling and the later RFC transaction extensions also need loss tests.

## Validation

Passed the three existing `sip-config.test.ts` structural regression tests. These do not execute Kamailio or validate the new sanity behavior. Neither Kamailio nor Docker is installed in this workspace. Before deployment, run the pinned 5.8.4 image's configuration parser and exercise valid and malformed UDP/TCP/WebSocket messages, native REGISTER digest retries, CANCEL during authorization, lost requests/responses/ACKs, and service timeouts. No deployment was performed.

References: [RFC 3261](https://www.rfc-editor.org/rfc/rfc3261.html), [Kamailio sanity module](https://www.kamailio.org/docs/modules/5.7.x/modules/sanity.html). The latter documents the existing mask semantics; runtime verification must use the pinned 5.8.4 image.

## Follow-up: executable validation gate

Added `services/sip/tests/validate_edge.py` and the `SIP protocol validation`
workflow. The runner first invokes the complete configuration-only entrypoint
in the Compose-pinned image, then tests a loopback-only listener built from the
actual ingress rules through OPTIONS. It has 29 UDP/TCP/WebSocket packet cases
plus healthy-listener checks. No production routes or credentials are used.

Local execution exits with an explicit Docker prerequisite error. Runtime
results are still pending; adding the gate does not establish a passing result.
