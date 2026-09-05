# Sounds

`sources.txt` names the music the edge plays and where it comes from. The WAV
files themselves are not in the repository: `Ops · Droplets → sync-config`
downloads each source on the droplet, converts it to 16 kHz mono WAV at the
gain given, and writes `<name>.wav` here before the configuration is swapped in.

- `hold-music.wav` — what a caller hears while a person is being found (every
  bridge, queue and transfer the API dialplan renders sets it as `ringback`).
- `speech-bed.wav` — the quiet bed mixed under the receptionist's voice for the
  whole call (`RECEPTIONIST_SPEECH_BED`; `displace_session … ml`).

To change a track, edit `sources.txt` and run sync-config. Keep the gain on the
bed well below the voice: −22 dB on a normally mastered track sits about twenty
decibels under speech.
