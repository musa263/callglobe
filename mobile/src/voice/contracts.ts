import type { TelnyxConnectionState } from '@telnyx/react-voice-commons-sdk';
import type { ActiveCall, CallerNumber, CallRate, MergedConference } from '../types';

export type VoiceIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type VoiceTokenResponse = {
  token: string;
  expires_in?: number;
  ice_servers?: VoiceIceServer[];
};

export type VoiceLoginConfig = {
  token: string;
  expiresAt: number;
  iceServers?: VoiceIceServer[];
  ringtone: string;
};

export type VoiceContextValue = {
  connection: TelnyxConnectionState;
  activeCall: ActiveCall | null;
  waitingCall: ActiveCall | null;
  heldCall: ActiveCall | null;
  conference: MergedConference | null;
  duration: number;
  error: string | null;
  isReady: boolean;
  pushRegistration: 'not_required' | 'registering' | 'registered' | 'unavailable';
  refreshIncomingCalls: () => Promise<void>;
  startCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null, displayName?: string, photoUrl?: string) => Promise<void>;
  startSecondCall: (number: string, rate: CallRate, callerNumber?: CallerNumber | null) => Promise<void>;
  startSecondInternalCall: (sipUsername: string, extension: string, displayName: string, photoUrl?: string) => Promise<void>;
  startInternalCall: (sipUsername: string, extension: string, displayName: string, photoUrl?: string) => Promise<void>;
  transferCall: (targetExtensionId: string) => Promise<void>;
  answerWaitingCall: () => Promise<void>;
  rejectWaitingCall: () => Promise<void>;
  swapCalls: () => Promise<void>;
  mergeCalls: () => Promise<void>;
  removeConferenceParticipant: (participantId: string) => Promise<void>;
  endCall: () => Promise<void>;
  answerCall: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleHold: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  sendDtmf: (digit: string) => Promise<void>;
};
