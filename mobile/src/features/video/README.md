# Mobile Video

`screens/VideoMeetingScreen` hosts the meeting experience and coordinates its
navigation/lifecycle. Backend video authorizes rooms; browser video owns the
embedded meeting UI. Verify camera/microphone permissions, dismissal cleanup and
expired room access on a device. Run mobile typecheck after interface changes.
