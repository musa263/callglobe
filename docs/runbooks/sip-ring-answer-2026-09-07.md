# Silent caller ringback and unanswerable incoming calls

Reported behavior: the receiver rings, the caller hears no ringback, and the
call closes without connecting. This repair targets the shared SIP delivery
path used by the web and mobile clients.

## Confirmed code defects

1. `services/sip/kamailio/kamailio.cfg::DELIVER_EXTENSION` suspended every
   transaction and appended receiver branches without `t_continue`. In the
   deployed Kamailio 5.8.4 source, `t_suspend` sets `T_ASYNC_SUSPENDED` and
   `t_reply.c` discards replies while that flag remains set. Both clients
   correctly wait for `180 Ringing` before playing caller ringback; losing
   that response silences the caller. Losing `200 OK` prevents answer delivery.
2. The WebRTC media rules used `RTCP-MUX`, which the running rtpengine logged
   as an unknown flag. The corrected rules explicitly offer and require RTCP
   multiplexing and select `UDP/TLS/RTP/SAVPF` for WebRTC destinations.

The repair relays registered contacts immediately, suspends only when none
exist, and resumes each waiting transaction before delivery. The queue keeps
separate IDs/deadlines for concurrent callers, with bounded retention. The
registrar and delivery path share an AOR lock to close registration races.
TSILO still appends additional devices to active transactions. Push uses the
canonical destination AOR, not the contact URI substituted by registrar lookup.

## Production evidence and limits

- [Call trace](https://github.com/musa263/vocivo/actions/runs/34094908687) and
  [filtered service logs](https://github.com/musa263/vocivo/actions/runs/34095559084)
  show an internal SIP INVITE at approximately 07:10:57 UTC on September 7.
  TSILO reported no contact for that lookup. A later registration was outside
  that call's 45-second window. A push notification alone does not establish
  receipt of the SIP INVITE.
- Those logs also contain the rejected `RTCP-MUX` flag and registration
  challenge/retry failures. Authentication remediation is separate; do not
  remove replay or tenant checks to make registration succeed.
- No authenticated production `/api/voice/config` response was available in
  this task. The observed transaction is on the SIP edge; do not infer that
  every customer's installed client has selected the same edge.
- The source route and credential APIs both resolve the extension's SIP
  username. No directory-link defect was reproduced. FreeSWITCH/PSTN routing
  is not involved in this direct extension-to-extension delivery path.

Version-matched source references:
[transaction suspension](https://github.com/kamailio/kamailio/blob/5.8.4/src/modules/tm/t_suspend.c),
[reply processing](https://github.com/kamailio/kamailio/blob/5.8.4/src/modules/tm/t_reply.c),
[late branching](https://github.com/kamailio/kamailio/blob/5.8.4/src/modules/tm/t_append_branches.c).

## Validation and release

Completed: 377 frontend tests, 134 mobile unit tests, 44 mobile integration
tests, type checks, production web build, six browser SIP scenarios, and eight
browser startup scenarios. The [Linux protocol gate](https://github.com/musa263/vocivo/actions/runs/34097518375)
passed the baseline reproduction and repaired delivery scenarios, including
receivers registering after 9, 20, and 40 seconds.

Run `bash verify.sh` from root, plus the browser calling/startup tests listed
in `CONTRIBUTING.md`. These exercise the existing web and mobile call logic
without customer calls. No native application code changed in this repair.

Run `python3 services/sip/tests/validate_edge.py` on Linux with Docker. It
parses the complete pinned configuration, verifies ingress, reproduces the
previous lost-180 behavior, and tests the repaired delivery routes with local
SIP peers. Coverage includes answer/ACK/BYE, late registration, multi-device
forking, concurrent callers, cancellation, and expiry. The media/admission
fixtures do not prove live RTP, authenticated WebSocket delivery, or PushKit/FCM.

Deploy only after reviewing this change alongside any concurrent authentication
changes. Use the existing SIP workflow with a retained configuration backup;
Vercel or a mobile rebuild alone cannot apply a Kamailio routing fix. Confirm
fresh web/mobile registrations and authorized internal test calls in both
directions, then verify background/killed-state answer and two-way audio on
physical devices. Recheck ACK/BYE and media cleanup beyond the old failure
interval. If behavior regresses, restore the recorded prior edge configuration.

Do not mark the production incident resolved until those acceptance checks pass.
