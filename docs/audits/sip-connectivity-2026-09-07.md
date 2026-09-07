# SIP connectivity recovery — 2026-09-07

The reported mobile screen displays a reconnecting error. Its dialed number is
not a SIP registration identity or Call-ID. No timestamp/account reproduction
was supplied, so this audit does not identify that specific failed attempt.

## Infrastructure evidence

The read-only [droplet report](https://github.com/musa263/vocivo/actions/runs/34109311430)
shows HTTP/1.1 and Upgrade/Connection headers, a WSS read timeout of 86400 seconds,
and inactive UFW. The last 5000 Nginx error lines contain zero matching upstream
timeout, failed-connect, connection-limit, file-limit, rate-limit, or TLS-handshake
errors. The last two hours of bounded Kamailio logs contain successful registrations
and authentication rejections; counts are not unique clients. Cloud firewall rules
were not available through this workflow. No firewall policy was changed.

A public TLS/WSS connection to `/ws` answered OPTIONS with SIP 200 at connection
and again after 90 seconds, then closed normally. This is evidence from the Mac's
network, not an iOS/Android cellular reproduction or a many-hour endurance test.

## Confirmed client and diagnostic defects

- Explicit refresh trusted stale local Connected/Registered flags and could do
  nothing after migration. It now sends REGISTER to validate the contact.
- Mobile foreground refresh skipped cached SIP/ICE expiry checks. It now shares
  secure bootstrap, while idle network changes debounce and renew configuration.
- A forced renewal could be lost behind a cached bootstrap. Concurrent forced
  renewals now retain one follow-up operation and remain bound to the login epoch.
- Final mobile 401/403 failures retried the old password. They now trigger bounded
  HTTPS credential recovery. Normal challenges, nonce verification, replay
  prevention, tenant binding and current-account access checks remain enforced.
- The reconnecting error text could survive confirmed registration. Only that
  obsolete message is cleared on success; other call errors remain visible.
- Web online/foreground recovery did not refresh overdue configuration. Idle
  recovery now renews with debouncing; active calls keep their stack.
- The call-trace pipeline aborted when filtering removed all service log lines.
  It now labels unavailable/empty sections and continues to subsequent services.

Stored SIP passwords last seven days. Client configuration expires sooner when
its one-hour TURN grant does; renewal uses 80% of that configuration lifetime.
Suspended background JavaScript timers cannot be relied on to run on schedule.

## Acceptance limits

Unit and mounted integration regressions cover refresh, rejection backoff,
concurrent renewal, logout invalidation, active-call preservation and error
cleanup. The browser harness covers lifecycle races and event-burst recovery.
`bash verify.sh` verifies application code, not physical network recovery.

A08 physical acceptance remains open: retest the affected account on web and on
physical iOS/Android across Wi-Fi/cellular, foreground/background/killed state,
renewal after suspension, and active-call two-way audio. Record build, timestamp,
engine and redacted SIP Call-ID. Mobile fixes require a mobile release.
