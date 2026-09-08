# Global Heritage Go Telecom temporary cutover preflight

The requested temporary Vocivo test has **not started**. Server authentication
blocked preparation of a reversible SIP cutover. The existing 3CX service,
trunk, DID destinations, public IP and DNS were not changed.

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
These report diagnostic execution, not carrier acceptance. No INVITE, paid call,
REGISTER or service restart was performed.

## Remaining acceptance gates

1. Obtain an existing SSH username/key or authenticated root/sudo console.
2. Inspect actual service units, ports, host firewall, resources and active calls.
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
