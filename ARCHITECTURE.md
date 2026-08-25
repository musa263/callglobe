# Vocivo Architecture

Vocivo is a tenant-aware business phone system for iOS, Android, and the web. It uses a React Native mobile client, a React web client and admin console, Vercel Functions for the application backend, and Telnyx for regulated carrier services and real-time media transport.

## Runtime Components

### Mobile app

- React Native and Expo development builds
- Telnyx React Native Voice SDK for SIP/WebRTC calling
- iOS PushKit and CallKit for incoming calls outside the foreground
- Android FCM support once a Firebase configuration is supplied
- Secure, user-scoped credential and session storage

### Web app and admin console

- React 18 and Vite
- Telnyx WebRTC SDK for browser calling
- Tenant-scoped administration for users, extensions, numbers, routing, SIP trunks, AI, messaging, and voicemail
- Browser incoming calls require the signed-in page to remain open

### Vercel API

- Signed owner, extension, enrollment, and platform API sessions
- Tenant authorization for every private resource
- Call route reservation before any carrier action
- Telnyx webhook verification and call-state processing
- Encrypted application state in Vercel Blob

### Telnyx carrier layer

Telnyx remains responsible for services that require carrier infrastructure or regulated access: public telephone numbers, PSTN origination and termination, SIP/WebRTC media, SMS delivery, emergency calling configuration, push delivery to native voice clients, and carrier AI media.

Vocivo owns the product layer: organizations, extensions, internal dialing, access policy, routing rules, caller-ID authorization, provisioning, call handling, administration, and user experience.

## Voice Flows

### Public outbound call

1. The signed-in client reserves a tenant-scoped route with an authorized caller ID.
2. The Telnyx client leg is answered and receives carrier ringback.
3. The API dials the destination through Call Control.
4. The two legs bridge only after the destination answers.
5. Webhooks update the route and call-event stores.

### Public inbound call

1. Telnyx sends the signed call event to the Vercel webhook.
2. Vocivo resolves the purchased number's organization and destination.
3. The call enters direct ringing, an IVR, a ring group, a queue, or the AI receptionist.
4. Native extensions can ring through PushKit/CallKit while the app is backgrounded or closed.
5. No-answer routing can continue to another destination or voicemail.

### Internal extension call

1. A business user dials an extension without a country code or public number.
2. Vocivo verifies that both extensions belong to the same organization.
3. The call is routed over the managed SIP connection without a PSTN destination.

## Storage and Security

- Secrets live only in Vercel environment variables.
- Vercel Blob stores encrypted PBX, extension, route, message, voicemail, and event records.
- Caller IDs and purchased numbers are checked against the active organization.
- Enrollment links are short-lived and single-use.
- Extension sessions are revoked when an extension is removed or re-provisioned.
- Public webhooks use Telnyx Ed25519 verification when `TELNYX_PUBLIC_KEY` is configured.

Vocivo does not use Supabase or Twilio.
