/** A bounded recovery window, independent of SIP's potentially stalled BYE. */
export function monitorSipCall(session, options) {
  const schedule = options.schedule || ((fn, ms) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); });
  let stopped = false;
  let online = options.isConnected();
  let pc;
  let timer;
  let probe;
  let signalDeadline;
  let mediaDeadline;
  let restarting = false;
  let attempted = false;
  const now = options.now || Date.now;
  const grace = options.graceMs ?? 12_000;
  const stop = () => {
    stopped = true;
    timer?.(); probe?.();
    pc?.removeEventListener('iceconnectionstatechange', check);
    pc?.removeEventListener('connectionstatechange', check);
    session.stateChange.removeListener(check);
  };
  const fail = (reason) => {
    if (stopped) return;
    stop();
    options.onFailure(reason);
  };
  const check = () => {
    if (stopped) return;
    timer?.();
    if (session.state === 'Terminated') { stop(); return; }
    const connection = session.sessionDescriptionHandler?.peerConnection;
    if (pc !== connection) {
      pc?.removeEventListener('iceconnectionstatechange', check);
      pc?.removeEventListener('connectionstatechange', check);
      pc = connection;
      pc?.addEventListener('iceconnectionstatechange', check);
      pc?.addEventListener('connectionstatechange', check);
    }
    const established = session.state === 'Established';
    const healthy = pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
    const failed = pc && (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState) || ['failed', 'closed'].includes(pc.connectionState));
    if (established && (!healthy || failed)) mediaDeadline ??= now() + grace;
    if (healthy && !failed) { mediaDeadline = undefined; attempted = false; }
    if (signalDeadline != null && now() >= signalDeadline) return fail('The calling connection was lost. Please call again.');
    if (mediaDeadline != null && now() >= mediaDeadline) return fail('Call audio could not reconnect. Please call again.');
    if (online && established && failed && pc?.connectionState !== 'closed' && !restarting && !attempted) {
      restarting = true;
      attempted = true;
      Promise.resolve().then(() => { if (!stopped) return options.restart(); })
        .catch((error) => { if (!stopped) options.onError(error); })
        .finally(() => { restarting = false; if (!stopped) check(); });
    }
    const deadlines = [signalDeadline, mediaDeadline].filter((value) => value != null);
    if (deadlines.length) timer = schedule(check, Math.max(1, Math.min(...deadlines) - now()));
  };
  const poll = () => { check(); if (!stopped) probe = schedule(poll, 1000); };
  session.stateChange.addListener(check);
  if (!online) signalDeadline = now() + grace;
  poll();
  return {
    stop,
    transport(connected) {
      if (stopped) return;
      online = connected;
      if (connected) signalDeadline = undefined;
      else signalDeadline ??= now() + grace;
      check();
    },
  };
}

/** SIP.js generates a new ICE offer and sends it inside the existing dialog. */
export function restartSipMedia(session) {
  if (session.state !== 'Established') return Promise.reject(new Error('The call is no longer connected.'));
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      session.stateChange.removeListener(onState);
      if (error) reject(error); else resolve();
    };
    const onState = (state) => { if (state === 'Terminated') finish(new Error('Call ended during media recovery.')); };
    const timer = setTimeout(() => finish(new Error('Media renegotiation timed out.')), 10_000);
    session.stateChange.addListener(onState);
    Promise.resolve().then(() => {
      if (done) return;
      session.sessionDescriptionHandler?.peerConnection?.restartIce?.();
      return session.invite({
        sessionDescriptionHandlerOptions: { offerOptions: { iceRestart: true } },
        requestDelegate: {
          onAccept: () => finish(),
          onReject: () => finish(new Error('Media renegotiation was rejected.')),
        },
      });
    }).catch(finish);
  });
}
