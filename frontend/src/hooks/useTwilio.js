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
import { supabase } from '../lib/supabase';
import { createCallLog, updateCallLog } from '../lib/supabase';

// Fetch Twilio access token from our Supabase edge function
async function fetchTwilioToken(userId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/twilio-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ identity: userId }),
    }
  );

  if (!response.ok) {
    console.error('Token fetch failed:', response.status);
    return null;
  }

  const { token } = await response.json();
  return token;
}

export function useTwilio(userId) {
  const [isReady, setIsReady] = useState(false);
  const [callState, setCallState] = useState(null); // null, 'initiating', 'ringing', 'connected', 'ended'
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const callLogIdRef = useRef(null);
  const callStartRef = useRef(null);
  const callRef = useRef(null);

  // Initialize Twilio Device on mount
  useEffect(() => {
    if (!userId) return;

    initTwilioDevice({
      getToken: () => fetchTwilioToken(userId),
      onReady: () => {
        console.log('Twilio ready');
        setIsReady(true);
        setError(null);
      },
      onError: (err) => {
        console.error('Twilio error:', err);
        setError(typeof err === 'string' ? err : 'Connection error');
      },
      onIncoming: (call) => {
        // For future incoming call support
        console.log('Incoming call:', call);
      },
    });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      destroyTwilioDevice();
    };
  }, [userId]);

  // Attach call event listeners
  const attachCallEvents = useCallback((call) => {
    callRef.current = call;

    call.on('ringing', () => {
      console.log('Call ringing');
      setCallState('ringing');
    });

    call.on('accept', () => {
      console.log('Call connected');
      setCallState('connected');
      callStartRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setCallDuration(Math.floor((Date.now() - callStartRef.current) / 1000));
      }, 1000);
    });

    call.on('disconnect', () => {
      console.log('Call ended');
      handleCallEnd();
    });

    call.on('cancel', () => {
      console.log('Call canceled');
      handleCallEnd();
    });

    call.on('reject', () => {
      console.log('Call rejected');
      handleCallEnd();
    });

    call.on('error', (error) => {
      console.error('Call error:', error);
      setError(error.message || 'Call failed');
      handleCallEnd();
    });
  }, []);

  const handleCallEnd = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Update call log with final duration
    if (callLogIdRef.current && callStartRef.current) {
      const duration = Math.floor((Date.now() - callStartRef.current) / 1000);
      updateCallLog(callLogIdRef.current, {
        status: 'completed',
        duration_seconds: duration,
        ended_at: new Date().toISOString(),
      });
    }

    setCallState('ended');
    callRef.current = null;

    // Reset after a brief delay
    setTimeout(() => {
      setCallState(null);
      setCallDuration(0);
      setIsMuted(false);
      callLogIdRef.current = null;
      callStartRef.current = null;
    }, 500);
  }, []);

  // Make a call
  const startCall = useCallback(async (fullNumber, countryCode, ratePerMin) => {
    if (!isReady || !userId) {
      setError('Not ready to make calls');
      return false;
    }

    try {
      // Create call log in database first
      const { data: callLog, error: logError } = await createCallLog(
        userId,
        fullNumber,
        countryCode,
        ratePerMin
      );

      if (logError) {
        console.error('Failed to create call log:', logError);
      } else {
        callLogIdRef.current = callLog.id;
      }

      // Make the actual call via Twilio WebRTC
      setCallState('initiating');
      setCallDuration(0);
      setError(null);

      const call = await twilioMakeCall(fullNumber, import.meta.env.VITE_TWILIO_CALLER_ID, {
        user_id: userId,
        call_log_id: callLog?.id || '',
      });

      attachCallEvents(call);

      return true;
    } catch (err) {
      console.error('Call failed:', err);
      setError('Failed to initiate call');
      setCallState(null);
      return false;
    }
  }, [isReady, userId, attachCallEvents]);

  // Hang up
  const endCall = useCallback(() => {
    twilioHangup();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Toggle mute
  const toggleMute = useCallback(() => {
    const newMuted = !isMuted;
    twilioMute(newMuted);
    setIsMuted(newMuted);
  }, [isMuted]);

  // Send DTMF tone
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
    isInCall: callState && callState !== 'ended',
  };
}
