# Tenant-owned SIP trunks

Company admins add their carrier account and existing DIDs in **Phone numbers**
or **SIP trunks**, then select **Use these carrier numbers**. Every DID can stay
unassigned or have its own company extension, group, queue, IVR or main-line/AI
destination. Editing a published trunk applies the new destinations on save.
New companies default to carrier mode; existing companies adopt it explicitly.

Carrier mode lists imported numbers in web/mobile, skips Telnyx inventory and
Telnyx balance requests, and blocks purchases through company and keyed number
APIs. Existing platform entitlements, wallet and destination policy still apply.
SMS is not implied. Passwords are encrypted, omitted from company responses,
and exported only by deployment tooling. Blank keeps the saved password; changing
the username without a new password clears it. IP authentication removes it.

Publication claims canonical DIDs atomically and refuses another tenant/trunk's
claim. **Remove from company** disables the assignment, clears matching defaults
and extension preferences, and retains a tombstone against historical order
reconciliation. It does not release the carrier asset or stop its rental charges.

## Activation

A saved form does not establish a network connection. **Pending activation**
states the missing step. **Ready for call test** means a matching operator
deployment record exists, not that registration, reachability or audio passed.
Company request bodies cannot create deployment records.

1. Verify carrier authentication, approved source IPs, DID ownership, caller IDs,
   call directions, channel limit and codecs. Current outbound formatting is
   international with `+`; verify carrier acceptance before activation.
2. Confirm the actual public signaling/RTP egress IP. A portal field cannot move
   an address or create NAT/SBC routing. An existing PBX requires its authorized
   cutover/restoration procedure; never claim its address on another host.
3. From `frontend`, prepare the exact published revision using a private operator
   environment file containing database/encryption credentials:

   ```sh
   node --import tsx scripts/export-carrier-trunk.mjs \
     --env-file /protected/vocivo.env --organization COMPANY_ID \
     --trunk TRUNK_UUID --revision REVISION --public-ip ACTUAL_EDGE_IP \
     --inbound-sources CARRIER_SOURCE_IP
   ```

   This is a dry-run. Add `--write --output-dir /protected/carrier-export` to
   write private gateway XML and `deployment-candidate.json`. No activation is
   performed. Do not print or commit XML containing registration passwords.
4. Install the gateway XML under `/opt/vocivo/carriers` on that SIP host. Compose
   mounts it separately from source synchronization. The entrypoint copies it
   into the FreeSWITCH trunk profile. For a live rescan, install it in the mounted
   FreeSWITCH configuration directory and use `sofia profile trunk rescan reloadxml`.
   Drain calls before removing obsolete gateways. Names bind tenant, trunk and
   connection revision and must never be shared between tenants.
5. Add only verified carrier addresses to `VOCIVO_TRUNK_SOURCES`. Inbound enters
   Kamailio on 5060; FreeSWITCH's public trunk profile rejects new incoming calls.
   A registration carrier must separately deliver inbound to Kamailio. If it
   delivers to the REGISTER Contact, an authenticated SBC/profile arrangement is
   still needed before enabling inbound. TLS/registration require matching Sofia
   profile/certificate configuration and real provider tests.
6. Check `sofia status gateway GATEWAY_NAME`, REGISTER if applicable, and actual
   SIP/SDP/RTP. After validating the deployment, add the candidate to the API's
   server-only `VOCIVO_CARRIER_DEPLOYMENTS` JSON array and redeploy. Preserve other
   tenants' entries. Remove the entry to disable admission.
7. Verify inbound/outbound with a consenting external phone: caller ID, ringback,
   two-way speech, hold, DTMF, hangup and physical-client recovery. OPTIONS or a
   call timer does not prove these gates. Unassigned DIDs must be refused.

Connection edits invalidate activation. Destination/label edits retain the
connection revision. Signed call grants bind the full trunk revision and gateway;
the XML bridge rechecks current ownership. National inbound aliases require an
approved source and current assignment. Removed/unassigned carrier DIDs cannot
start the receptionist or use the legacy fallback.

## Rollout and verification

Deploy the API with no active BYOC deployment records first, then synchronize
the matching SIP stack. The authenticated XML binding handles outbound even with
`VOCIVO_SIP_INBOUND=0`. Missing/failed authorization returns 503; static outbound
must not fall back to Telnyx. Enable deployment records only after installing the
matching edge. Disable BYOC admission before rolling back to an old static bridge.

Run `bash verify.sh` and `SIP protocol validation`. Its Docker tenant-carriers job
uses production-generated XML and loopback peers to verify two gateway choices,
caller ID, actual RTP echo, capacity rejection/release and invalid-grant denial.
It makes no paid calls and does not prove live carriers, TLS/REGISTER, inbound
activation or physical devices. Hash limits are per FreeSWITCH process; use a
shared backend before distributing one trunk across multiple switches.

The browser fixture (all API calls intercepted) checks all five DIDs, destination
editing, selection, removal and absence of purchase controls. Start Vite on 5191,
then from `frontend` run:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/test-carrier-admin.mjs
```

Reference: [FreeSWITCH gateways](https://developer.signalwire.com/freeswitch/FreeSWITCH-Explained/Configuration/Sofia-SIP-Stack/Gateways-Configuration_7144069).

## September 8 production checkpoint

Release `a5b94f1` reached `main` and Vercel's existing Git integration deployed
the web/API. A separate manual Vercel redeploy was declined and was not retried.
The SIP host configuration has not been synchronized for this release.

In the authenticated Global Heritage company portal, the five Go Telecom DIDs
were published and the default caller ID verified as `+966135117680`.
`+18447161777` was detached from that company's inventory, caller IDs and inbound
assignment; it is no longer displayed in the company portal. This did not cancel
the number's carrier-account rental. No number was purchased. All five Go DID
destinations remain unassigned, as requested. No operator deployment record was
created for `64.226.96.144`; 3CX was unchanged, and Go remains pending activation.

The exact release passed `bash verify.sh` (436 backend/web, 154 mobile unit and
71 mobile integration tests). [SIP validation 34198307263](https://github.com/musa263/vocivo/actions/runs/34198307263)
passed both ingress and isolated tenant-carrier Docker jobs. The final live
browser check found the App's old source filter excluded carrier numbers; the
follow-up retains them, labels pending lines and prevents external admission.
The full-App browser regression covers pending and ready carrier inventory,
internal calling, session restoration, incoming ringing and audio recovery.
These checks do not establish Go carrier call/audio acceptance or a new mobile
binary release.
