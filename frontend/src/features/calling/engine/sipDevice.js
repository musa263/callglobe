export function createSipDeviceIdentity({ storage, locks, randomUUID, warn = console.warn }) {
  let pending;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      let candidate;
      try { candidate = storage?.getItem('vocivo.sip.device.v1'); }
      catch (error) { warn('SIP device storage unavailable', error); }
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(candidate || '')) candidate = randomUUID();
      // Duplicating a tab copies sessionStorage. An exclusive browser-managed
      // lease prevents the copy from rotating the original tab's password.
      if (locks) {
        while (!await new Promise((resolve, reject) => {
          locks.request(`vocivo.sip.device:${candidate}`, { ifAvailable: true }, lock => {
            resolve(Boolean(lock));
            if (lock) return new Promise(() => {}); // Released when this document closes.
          }).catch(reject);
        })) candidate = randomUUID();
      } else {
        // Without tab arbitration use a fresh document identity, never a
        // possibly copied slot. It remains stable for reconnects in this tab.
        candidate = randomUUID();
      }
      try { storage?.setItem('vocivo.sip.device.v1', candidate); }
      catch (error) { warn('SIP device storage unavailable', error); }
      return candidate;
    })().catch(error => { pending = undefined; throw error; });
    return pending;
  };
}

let identity;
export function browserSipDeviceId() {
  if (!identity) {
    let storage;
    try { storage = window.sessionStorage; }
    catch (error) { console.warn('SIP device storage unavailable', error); }
    identity = createSipDeviceIdentity({ storage, locks: navigator.locks, randomUUID: () => crypto.randomUUID() });
  }
  return identity();
}

export function revokeBrowserSipCredential(request, credentials) {
  if (!credentials?.deviceId || !credentials?.credentialId) return Promise.resolve();
  const query = new URLSearchParams({ deviceId: credentials.deviceId, credentialId: credentials.credentialId });
  return request(`/api/voice/sip-credentials?${query}`, { method: 'DELETE', keepalive: true });
}
