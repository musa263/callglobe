export function setSipMuted(session, muted) {
  const pc = session?.sessionDescriptionHandler?.peerConnection;
  pc?.getSenders()?.forEach((sender) => {
    if (sender.track?.kind === 'audio') sender.track.enabled = !muted;
  });
  pc?.getReceivers()?.forEach((receiver) => {
    if (receiver.track?.kind === 'audio') receiver.track.enabled = true;
  });
}

export async function setSipHeld(session, held) {
  if (!session?.invite) return;
  await session.invite({
    sessionDescriptionHandlerOptions: {
      constraints: { audio: true, video: false },
      hold: Boolean(held),
    },
  });
}

export function conferenceSipUri(conferenceId, domain) {
  const id = String(conferenceId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  if (!id || !domain) throw new Error('A conference destination is required.');
  return `sip:conf-${id}@${domain}`;
}

export async function referSipSession(session, targetUri) {
  if (!session) throw new Error('There is no live SIP call to transfer.');
  const sip = await import('sip.js');
  const uri = sip.UserAgent.makeURI(targetUri);
  if (!uri) throw new Error('The transfer destination is invalid.');
  const Referrer = sip.Referrer;
  if (!Referrer) throw new Error('SIP transfer is unavailable in this client.');
  const referrer = new Referrer(session, uri);
  await referrer.refer();
}
