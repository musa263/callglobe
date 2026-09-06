# Isolated mobile screen preview

This separate Expo entry mounts the real DialerScreen, RecentsScreen,
ActiveCallScreen and ConferenceScreen with fixture contexts. It does not initialize SIP, request
microphone access, authenticate, contact the production API or place calls.
The root mobile production entry does not import this project.

From this directory, with the main mobile dependencies already installed:

```sh
node ../../node_modules/expo/bin/cli start --localhost --dev-client --port 8092
```

Open the URL in a compatible Vocivo development client on a simulator. Native
dependencies must match the mobile app; this is not an Expo Go project. Use
`--lan` instead of `--localhost` for a device on the same trusted network.

- Dial Pad opens directly with the keypad. International prefixes remain editable.
- There are no Phone/Extension tabs. Enter 2001 or 2002 to match the fixture
  company directory; a full phone number automatically selects phone dialing.
- Jamie Roberts in Recents opens extension 2001 with the contact name.
- Start call opens a fixture active-call screen. Mute, hold and speaker change
  fixture state only. The duration is fixed at 12 seconds.
- The footer identifies the fixture and opens the extension scenario.
- Conference opens from the dialer's header icon. Participant
  types are detected automatically. Starting it returns a fixture response only.
- Wallet and company settings are outside this harness.
- The production BottomTabs component is included so the calling layouts are
  previewed with the real navigation height. Contacts, Messages and
  Settings display an explicit preview-only placeholder here; their production
  screens remain unchanged. Full-screen active calls hide tabs as in App.tsx.

This preview validates layout and interactions, not audio, background delivery,
CallKit, Android Telecom or real network recovery. Run the production app with
two authorized test devices for those release gates.

Automated screen tests live in `../voip/*.integration.test.tsx` and run via
`npm test` from the mobile root. These also use mocked services; their success
does not establish real-call reliability.
