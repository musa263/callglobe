# Vocivo SIP Trunk Connectivity

## Current production topology

- Web application and HTTPS control API: `https://vocivo.vercel.app`
- Control-plane hosting: Vercel Functions
- Media and PSTN carrier: Telnyx unless `PBX_SERVICE_URL` is configured
- Data store: PostgreSQL through `DATABASE_URL` or `POSTGRES_URL`
- Dedicated Vocivo SIP ingress IP: not allocated yet

`vocivo.vercel.app` is an HTTPS application endpoint, not a SIP proxy. Do not give it to a carrier as a SIP signaling or RTP destination. Vercel's standard addresses are dynamic, and Vercel Static IPs are outbound egress addresses rather than a public SIP listener.

## Production SIP edge

Deploy `services/pbx` on a dedicated Linux host with a reserved public IP. DigitalOcean is suitable for this role. The recommended public details to provide to a trunk partner are created during that deployment:

- SIP FQDN: `sip.vocivo.com` or another owned hostname
- Signaling: SIP TLS on TCP 5061; UDP/TCP 5060 only when the partner requires it
- Media: SRTP/RTP on an explicitly configured UDP range, currently 10000-20000
- Authentication: IP allowlist and mutual credentials; TLS certificates where supported
- Codecs: Opus for app extensions; PCMU/PCMA for carrier interoperability
- DTMF: RFC 2833 / RFC 4733
- Number format: E.164

Do not publish a placeholder IP. Allocate the DigitalOcean Reserved IP, bind it to the PBX host, configure DNS, and then use that actual value in the carrier order.

## Recommended split

Keep the React application and ordinary API routes on Vercel. Run the long-lived SIP registrar, SBC, Asterisk media plane, RTP relay, and call recording workers on DigitalOcean. This preserves the current deployment while giving SIP trunks a stable network edge.

Before accepting commercial traffic, add a second PBX node, health-based IP failover, SIP firewall rules, TLS/SRTP, encrypted backups, metrics, log retention, and carrier failover. Validate emergency-calling and lawful-intercept obligations for every sales country.
