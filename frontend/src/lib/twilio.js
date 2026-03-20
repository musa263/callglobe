// src/lib/twilio.js
// Twilio Voice SDK wrapper for making/receiving calls via WebRTC

import { Device } from '@twilio/voice-sdk';

let device = null;
let currentCall = null;

// ============================================================
// INITIALIZE TWILIO DEVICE
// ============================================================
export async function initTwilioDevice({ getToken, onReady, onError, onCallUpdate, onIncoming }) {
  try {
    // Fetch access token from our backend
    const token = await getToken();
    if (!token) {
      onError?.('Failed to get Twilio access token');
      return null;
    }

    device = new Device(token, {
      codecPreferences: ['opus', 'pcmu'],
      enableRingingState: true,
    });

    // Device ready
    device.on('registered', () => {
      console.log('Twilio Device registered');
      onReady?.();
    });

    // Device errors
    device.on('error', (error) => {
      console.error('Twilio Device error:', error);
      onError?.(error.message || 'Twilio connection error');
    });

    // Token about to expire — refresh it
    device.on('tokenWillExpire', async () => {
      console.log('Twilio token expiring, refreshing...');
      try {
        const newToken = await getToken();
        if (newToken) {
          device.updateToken(newToken);
        }
      } catch (err) {
        console.error('Failed to refresh token:', err);
      }
    });

    // Incoming call (if we support inbound later)
    device.on('incoming', (call) => {
      console.log('Incoming call from:', call.parameters.From);
      currentCall = call;
      onIncoming?.(call);
    });

    // Register the device
    await device.register();

    return device;
  } catch (err) {
    console.error('Failed to init Twilio device:', err);
    onError?.(err.message || 'Failed to initialize calling');
    return null;
  }
}

// ============================================================
// MAKE A CALL
// ============================================================
export async function makeCall(destinationNumber, params = {}) {
  if (!device) {
    throw new Error('Twilio device not initialized');
  }

  const callParams = {
    destination: destinationNumber,
    ...params,
  };

  currentCall = await device.connect({ params: callParams });

  // Attach call event listeners
  currentCall.on('accept', () => {
    console.log('Call accepted/connected');
  });

  currentCall.on('disconnect', () => {
    console.log('Call disconnected');
    currentCall = null;
  });

  currentCall.on('cancel', () => {
    console.log('Call canceled');
    currentCall = null;
  });

  currentCall.on('reject', () => {
    console.log('Call rejected');
    currentCall = null;
  });

  currentCall.on('error', (error) => {
    console.error('Call error:', error);
  });

  return currentCall;
}

// ============================================================
// CALL CONTROLS
// ============================================================
export function hangupCall() {
  if (currentCall) {
    currentCall.disconnect();
    currentCall = null;
  }
}

export function muteCall(mute = true) {
  if (currentCall) {
    currentCall.mute(mute);
  }
}

export function sendDTMF(digit) {
  if (currentCall) {
    currentCall.sendDigits(digit);
  }
}

// ============================================================
// CLEANUP
// ============================================================
export function destroyTwilioDevice() {
  if (currentCall) {
    currentCall.disconnect();
    currentCall = null;
  }
  if (device) {
    device.destroy();
    device = null;
  }
}

export function getDevice() {
  return device;
}

export function getCurrentCall() {
  return currentCall;
}
