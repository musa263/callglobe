// src/hooks/useTwilio.js
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  initTwilioDevice,
  makeCall as twilioMakeCall,
  hangupCall as twilioHangup,
  muteCall as twilioMute,
  sendDTMF as twilioDTMF,
  destroyTwilioDevice,
} from '../lib/twilio';
import { invokeAuthenticatedFunction } from '../lib/supabase';

let currentCallToken = null;

async function fetchTwilioToken() {
  const payload = await invokeAuthenticatedFunction('twilio-token', {
    unauthenticatedMessage: 'You must be signed in to place calls.',
  });

  const { token, call_token: callToken } = payload;
  if (!token) {
    throw new Error('Twilio access token missing from server response.');
  }
  if (!callToken) {
    throw new Error('Call authorization token missing from server response.');
  }

  currentCallToken = callToken;

  return token;
}

export function useTwilio(userId) {
  const [isReady, setIsReady] = useState(false);
  const [callState, setCallState] = useState(null);
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const callStartRef = useRef(null);
  const callRef = useRef(null);
  const resetTimeoutRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, []);

  const handleCallEnd = useCallback(() => {
    clearTimers();
    setCallState('ended');
    callRef.current = null;

    resetTimeoutRef.current = setTimeout(() => {
      setCallState(null);
      setCallDuration(0);
      setIsMuted(false);
      callStartRef.current = null;
    }, 500);
  }, [clearTimers]);

  const attachCallEvents = useCallback((call) => {
    callRef.current = call;

    call.on('ringing', () => {
      setCallState('ringing');
    });

    call.on('accept', () => {
      setCallState('connected');
      callStartRef.current = Date.now();
      clearTimers();
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
      }, 1000);
    });

    call.on('disconnect', handleCallEnd);
    call.on('cancel', handleCallEnd);
    call.on('reject', handleCallEnd);
    call.on('error', (callError) => {
      console.error('Call error:', callError);
      setError(callError.message || 'Call failed');
      handleCallEnd();
    });
  }, [clearTimers, handleCallEnd]);

  useEffect(() => {
    if (!userId) {
      currentCallToken = null;
      setIsReady(false);
      setCallState(null);
      setCallDuration(0);
      setIsMuted(false);
      setError(null);
      return undefined;
    }

    setIsReady(false);
    setError(null);

    initTwilioDevice({
      getToken: fetchTwilioToken,
      onReady: () => {
        setIsReady(true);
        setError(null);
      },
      onError: (deviceError) => {
        console.error('Twilio error:', deviceError);
        setIsReady(false);
        setError(typeof deviceError === 'string' ? deviceError : 'Connection error');
      },
      onIncoming: (call) => {
        console.log('Incoming call:', call);
      },
    });

    return () => {
      clearTimers();
      currentCallToken = null;
      destroyTwilioDevice();
      callRef.current = null;
      callStartRef.current = null;
    };
  }, [clearTimers, userId]);

  const startCall = useCallback(async (fullNumber, countryCode) => {
    if (!isReady || !userId) {
      setError('Calling is not ready yet.');
      return false;
    }

    if (callRef.current) {
      setError('A call is already in progress.');
      return false;
    }

    try {
      setCallState('initiating');
      setCallDuration(0);
      setError(null);

      const call = await twilioMakeCall(fullNumber, {
        call_token: currentCallToken,
        country_code: countryCode,
      });

      attachCallEvents(call);
      return true;
    } catch (err) {
      console.error('Call failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to initiate call.');
      setCallState(null);
      return false;
    }
  }, [attachCallEvents, isReady, userId]);

  const endCall = useCallback(() => {
    twilioHangup();
    clearTimers();
  }, [clearTimers]);

  const toggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    twilioMute(nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const sendDigit = useCallback((digit) => {
    twilioDTMF(digit);
  }, []);

  return {
    isReady,
    callState,
    callDuration,
    isMuted,
    error,
    startCall,
    endCall,
    toggleMute,
    sendDigit,
    isInCall: Boolean(callState && callState !== 'ended'),
  };
}
