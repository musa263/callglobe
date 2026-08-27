# Vocivo Incoming-Call Push Contract

FreeSWITCH emits call-leg events through ESL. The Node listener sends one push when an extension B-leg is created. Every device registered to that extension receives the call simultaneously.

## APNs VoIP Request

Required HTTP/2 headers:

```json
{
  "apns-push-type": "voip",
  "apns-topic": "app.vocivo.mobile.voip",
  "apns-priority": "10",
  "apns-expiration": "0",
  "apns-collapse-id": "CALLKIT-UUID"
}
```

Payload:

```json
{
  "aps": { "content-available": 1 },
  "type": "incoming_call",
  "schema": "vocivo.push.call.v1",
  "callUUID": "f17d7cd4-72c7-5a13-a746-8993f2e530cd",
  "callId": "freeswitch-channel-uuid",
  "sessionId": "sip-call-id",
  "organizationId": "global-heritage",
  "organizationName": "Global Heritage",
  "extension": "2001",
  "callerName": "Mousa Usman",
  "callerNumber": "2000",
  "photoUrl": "https://example.com/profiles/mousa.jpg",
  "hasVideo": false,
  "sentAt": "2026-08-27T10:00:00.000Z"
}
```

The iOS PushKit delegate must call `reportNewIncomingCall` immediately using `callUUID`, then connect to FreeSWITCH in parallel. A VoIP push is used only to initiate a real incoming call. Answer, cancel and hangup updates travel over SIP/ESL, not as fake VoIP pushes.

## FCM HTTP v1 Request

```json
{
  "message": {
    "token": "DEVICE_FCM_TOKEN",
    "data": {
      "type": "incoming_call",
      "schema": "vocivo.push.call.v1",
      "callUUID": "f17d7cd4-72c7-5a13-a746-8993f2e530cd",
      "callId": "freeswitch-channel-uuid",
      "sessionId": "sip-call-id",
      "organizationId": "global-heritage",
      "organizationName": "Global Heritage",
      "extension": "2001",
      "callerName": "Mousa Usman",
      "callerNumber": "2000",
      "photoUrl": "https://example.com/profiles/mousa.jpg",
      "hasVideo": "false",
      "sentAt": "2026-08-27T10:00:00.000Z"
    },
    "android": {
      "priority": "high",
      "ttl": "30s"
    }
  }
}
```

All FCM `data` values are strings. The Android service must validate the call with the Vocivo API before showing a full-screen incoming-call UI and must cancel that UI when SIP reports answer, reject, cancel or hangup.

## Security and Lifecycle

- Device tokens are encrypted at rest and scoped to organization plus extension.
- The ESL worker resolves tokens through a timestamped HMAC-signed endpoint.
- Tokens older than 45 days are ignored and refreshed whenever the app opens.
- Logout unregisters the current device before deleting the local session.
- Push payloads contain display metadata only, never SIP passwords or carrier credentials.
- APNs invalid-token and FCM unregistered-token responses must remove stale devices.
