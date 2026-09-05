# Video Rooms

`routes/voice-video.ts` validates room access and coordinates provider room/token
operations. `video-room-store.ts::saveVideoRoom` and `readVideoRoom` persist room
metadata; the caller must enforce access before returning it. The browser meeting
entry lives in `src/features/video/`, and mobile opens the meeting experience.

This is separate from SIP audio conferencing. Validate API types, room ownership
and participant behavior; provider video media requires a live device/browser test.
