const terminating = new WeakMap();

/** SIP.js exposes different early-dialog operations for Inviter and Invitation. */
export function terminateSipSession(session) {
  if (!session || ['Terminating', 'Terminated'].includes(session.state)) return Promise.resolve();
  const pending = terminating.get(session);
  if (pending) return pending;
  const operation = Promise.resolve().then(() => {
    if (session.state === 'Established') return session.bye();
    if (['Initial', 'Establishing'].includes(session.state)) {
      return typeof session.cancel === 'function' ? session.cancel() : session.reject();
    }
  }).finally(() => terminating.delete(session));
  terminating.set(session, operation);
  return operation;
}

export function observeSipSession(session, onState) {
  const listener = (state) => {
    onState(state);
    if (state === 'Terminated') session.stateChange.removeListener(listener);
  };
  session.stateChange.addListener(listener);
  listener(session.state);
  return () => session.stateChange.removeListener(listener);
}
