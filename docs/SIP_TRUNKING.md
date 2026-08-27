# Vocivo SIP Trunk Connectivity

## Current production topology

- Web application and HTTPS control API: `https://vocivo.vercel.app`
- Control-plane hosting: Vercel Functions
- Media plane: Vocivo FreeSWITCH on DigitalOcean
- PSTN/DID/SMS carrier: Telnyx or GO Telecom; FreeSWITCH does not replace a licensed carrier
- Data store: PostgreSQL through `DATABASE_URL` or `POSTGRES_URL`
- Dedicated Vocivo SIP ingress IP: `68.183.244.215`

`vocivo.vercel.app` is an HTTPS application endpoint, not a SIP proxy. Do not give it to a carrier as a SIP signaling or RTP destination. Vercel's standard addresses are dynamic, and Vercel Static IPs are outbound egress addresses rather than a public SIP listener.

## Production SIP edge

`services/pbx` is deployed on a DigitalOcean Reserved IP with FreeSWITCH `mod_sofia`, optional `mod_verto`, a local ESL worker, and Caddy WSS termination. The current trunk details are:

- SIP FQDN: `sip.68.183.244.215.nip.io`
- Signaling IP: `68.183.244.215`
- Signaling: UDP/TCP `5060`, opened only to the carrier's published CIDRs
- Media: SRTP/RTP on UDP 20000-29999
- Authentication: IP allowlist and mutual credentials; TLS certificates where supported
- Codecs: Opus for app extensions; PCMU/PCMA for carrier interoperability
- DTMF: RFC 2833 / RFC 4733
- Number format: E.164

The carrier SIP gateway remains disabled and port `5060` remains blocked until the chosen carrier provides its signaling CIDRs and trunk credentials.

## Recommended split

Keep the React application and ordinary API routes on Vercel. Run the long-lived FreeSWITCH registrar/media plane, ESL worker and call-recording workers on DigitalOcean. Add Kamailio/OpenSIPS as the public SBC when the second PBX node is introduced. This preserves the SaaS control plane while giving SIP trunks a stable network edge.

Before accepting commercial traffic, add a second PBX node, health-based IP failover, SIP firewall rules, TLS/SRTP, encrypted backups, metrics, log retention, and carrier failover. Validate emergency-calling and lawful-intercept obligations for every sales country.
