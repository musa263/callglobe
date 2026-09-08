# Global Heritage Go Telecom temporary cutover preflight

Root console access is now confirmed after the owner completed the password
reset. Preparation of the requested temporary test is underway. No existing
3CX service, trunk, DID destination, public IP or DNS has been changed by this
diagnostic work.

## Verified evidence

- DigitalOcean shows company-owned `ghsl-3cx-01` (droplet `598175810`, FRA1)
  with public IPv4 `64.226.96.144` and the self-hosted 3CX installation.
- The 3CX Go trunk uses IP authentication without REGISTER, carrier
  `185.139.121.42:5060` UDP, main number `0135117680`, five simultaneous calls,
  and both inbound and outbound calling enabled.
- Global Heritage's Vocivo record contains all five Go DIDs and caller IDs.
  Destinations remain unassigned as requested. Saving this pending record does
  not provision a FreeSWITCH gateway, carrier ACL or runtime DID route.
- Vocivo's SIP hostname resolves to `168.144.183.82`. The deployed FreeSWITCH
  carrier profile and outbound routes currently use Telnyx.
- Bounded OPTIONS probes from that edge returned SIP 200 from
  `64.226.96.144:5060`. Go did not respond to two attempts. The socket source
  differed from the expected customer IP. This does not prove carrier rejection,
  call authorization or two-way audio.
- The original DigitalOcean firewall had nine rules: inbound TCP 443, 5001,
  5060–5062, 5090; inbound UDP 5060, 5090, 9000–10999; outbound all TCP/UDP.
  SSH was blocked and the browser droplet console remained connecting.
- With explicit approval, TCP 22 was temporarily allowed from
  `168.144.183.82/32`. SSH through the edge reached the customer host, but
  `root` with the existing operations key returned `Permission denied (publickey)`.
- That temporary rule was removed after testing. DigitalOcean confirmed the
  original nine rules were restored. No SIP service was stopped or reconfigured.

Runs: [initial probe](https://github.com/musa263/vocivo/actions/runs/34141089383),
[restricted SSH probe](https://github.com/musa263/vocivo/actions/runs/34141615463).
These report diagnostic execution, not carrier acceptance.

## Authenticated host preflight (2026-09-08 Dubai)

- Root shell on `ghsl-3cx-01` is authenticated through the DigitalOcean recovery
  console. No new SSH credential or firewall exception was added.
- The checksum-verified probe at revision `f98dfef` received SIP **200 OK**
  from Go `185.139.121.42:5060`, with actual socket source `64.226.96.144`.
  This confirms signaling reachability from the intended IP, not authorization
  of INVITEs or working audio.
- Debian 12 has Python 3 and curl, no installed Docker, and approximately
  71 GiB free. 3CX owns public UDP/TCP 5060 and TCP 5061. No bound RTP socket
  in the proposed test range was observed in the preflight UDP inventory.
- The actual SIP unit is `3CXPhoneSystem01.service`. Reverse dependencies include
  `3CXCallFlow01.service`, `3CXIVR01.service`, and `3CXQueueManager01.service`;
  restoring only the SIP unit would be an insufficient restoration check.
- Local Docker validation of the pinned FreeSWITCH image passed SIP 100/200,
  ACK, tone and echo RTP, and automatic BYE after 35.1 seconds. The simulated
  handset received 1,512 packets, including 50 tone and 1,462 echo packets.
  This was isolated loopback traffic, with no carrier or phone called.
- An initial local attempt exposed FreeSWITCH throttling at a one-session-per-
  second setting; the test allows five session starts per second while keeping
  at most two concurrent sessions. The corrected wire test passed.

The standalone test does not close portal activation gates.

## Carrier outbound attempt

The pinned harness was staged on the authenticated host and started on the
spare SIP port 5062 with RTP 9900–9919. 3CX retained 5060 throughout. One
explicitly authorized outbound attempt reached the carrier and ended with SIP
486 / `USER_BUSY` after about 15 seconds, with no answer and zero media packets.
The owner then explained that the handset was roaming. This does not establish
the reason for the busy response, and it is not an audio acceptance pass.
The container and its isolated daemon were stopped after the test; private
diagnostic files remain in `/opt/vocivo-carrier-test`. No 3CX configuration,
public IP, DNS, cloud firewall rule or SIP service was changed. No inbound
cutover or carrier REGISTER was performed.

The owner requested a web test instead. The live web phone offered only the
existing managed main line; Go remained a draft. The requested web attempt
failed with the reconnect-session banner. No Go audio acceptance follows from
that attempt. The owner subsequently directed removal of the old managed line,
prohibited number purchases and clarified that tenants must bring their own
trunks and DIDs. Those inventory/routing changes are the next implementation
scope; do not mark the saved Go draft active from the above probe alone.

## Remaining acceptance gates

1. Root console access is satisfied; retain it through restoration.
2. Complete host firewall and active-call checks before interruption.
   Capture configuration and exact restoration commands.
3. Prepare an isolated Vocivo test service and bounded automatic rollback before
   interrupting 3CX. Keep the public IP attached to its existing droplet.
4. Provision the temporary Go signaling/media route for Global Heritage only.
   Keep permanent destinations configurable; do not copy the 3CX ring group or
   provision an unscoped global gateway.
5. Test authorized inbound/outbound calls, caller ID, two-way RTP and teardown.
6. Restore 3CX bindings/routes, remove temporary test/access configuration and
   verify the original service before closing the interruption window.

The probe's three unit tests, workflow YAML/shell checks and `bash verify.sh`
passed. None establishes the pending real-carrier acceptance gate.

DigitalOcean's [console requirements](https://docs.digitalocean.com/products/droplets/how-to/connect-with-console/)
confirm that cloud and host firewalls must permit the SSH daemon's port.
