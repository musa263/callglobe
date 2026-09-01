import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { createTokenConfig, TelnyxVoipClient } from '@telnyx/react-voice-commons-sdk';
import { api } from '../lib/api';
import { applyIncomingRingtone, loadIncomingRingtone } from '../lib/ringtone';
import { getVoicePushToken, persistVoiceSession, voipClient } from '../lib/voipClient';
import { registerVocivoSip } from '../lib/sipNative';
import { isVoiceSessionFresh } from '../lib/voiceRecovery';
import { shouldUseSipNative, voiceEdgeFromConfig, type VoiceEdgeConfig } from '../lib/voiceEdge';
import type { ActiveCall } from '../types';
import type { VoiceContextValue, VoiceLoginConfig, VoiceTokenResponse } from './contracts';
import { voiceLoginConfig } from './session';

type VoiceRegistrationInput = {
  activeCallRef: MutableRefObject<ActiveCall | null>;
  bootstrapSession?: VoiceLoginConfig | null;
  isAuthenticated: boolean;
  isPreview: boolean;
  loading: boolean;
  loginConfigRef: MutableRefObject<VoiceLoginConfig | null>;
  reportVoiceError: (operation: string, failure: unknown) => void;
  setError: Dispatch<SetStateAction<string | null>>;
  setPushRegistration: Dispatch<SetStateAction<VoiceContextValue['pushRegistration']>>;
};

export function useVoiceRegistration({
  activeCallRef,
  bootstrapSession,
  isAuthenticated,
  isPreview,
  loading,
  loginConfigRef,
  reportVoiceError,
  setError,
  setPushRegistration,
}: VoiceRegistrationInput) {
  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated || isPreview) {
      loginConfigRef.current = null;
      voipClient.logout().catch((failure) => reportVoiceError('logout', failure));
      setPushRegistration('unavailable');
      return;
    }

    let canceled = false;
    let tokenTimer: ReturnType<typeof setInterval> | undefined;
    let sessionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let activeRegistrationTimer: ReturnType<typeof setTimeout> | undefined;
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;

    const connect = async () => {
      try {
        const launchedFromPush = await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (canceled) return;
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        const pushBootstrap = launchedFromPush && bootstrapSession && isVoiceSessionFresh(bootstrapSession, 30_000)
          ? bootstrapSession
          : null;
        const initialSession = pushBootstrap
          || voiceLoginConfig(await api.post<VoiceTokenResponse>('/api/telnyx/token', {}), ringtone);
        if (canceled) return;
        loginConfigRef.current = initialSession;
        await persistVoiceSession(initialSession);
        const pushNotificationDeviceToken = await getVoicePushToken();
        if (canceled) return;
        if (pushNotificationDeviceToken) {
          await api.post('/api/voice/devices', {
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            token: pushNotificationDeviceToken,
            environment: __DEV__ ? 'sandbox' : 'production',
            bundleId: 'app.vocivo.mobile',
          }).catch((failure) => reportVoiceError('register Vocivo wakeup token', failure));
        }
        const edgeConfig = await api.get<VoiceEdgeConfig>('/api/voice/config').catch(() => null);
        if (canceled) return;
        if (shouldUseSipNative(voiceEdgeFromConfig(edgeConfig), NativeModules)) {
          const sip = await api.post<{
            username: string;
            password: string;
            domain: string;
            wsUri?: string;
          }>('/api/voice/sip-credentials', {});
          await registerVocivoSip({
            username: sip.username,
            password: sip.password,
            domain: sip.domain,
            wsUri: sip.wsUri,
            displayName: sip.username,
          }).catch((failure) => reportVoiceError('register Vocivo SIP', failure));
        }
        if (canceled) return;
        let registeredToken = pushNotificationDeviceToken;
        let registrationBusy = false;
        let sessionRefreshBusy = false;

        const login = async (pushToken?: string, session = loginConfigRef.current) => {
          if (!session) throw new Error('The calling session is unavailable.');
          let lastError: unknown;
          for (let attempt = 0; attempt < 3 && !canceled; attempt += 1) {
            try {
              await voipClient.loginWithToken(createTokenConfig(session.token, {
                debug: __DEV__,
                pushNotificationDeviceToken: pushToken,
                pushWhenActive: true,
                enableMissedCallNotifications: true,
                incomingCallRingtone: ringtone,
                useTrickleIce: true,
                ...(session.iceServers ? { iceServers: session.iceServers } : {}),
              }));
              return;
            } catch (loginError) {
              lastError = loginError;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
          throw lastError instanceof Error ? lastError : new Error('Unable to connect to calling service.');
        };

        const scheduleSessionRefresh = (session: VoiceLoginConfig) => {
          if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
          // Refresh two minutes ahead of expiry; short-lived tokens refresh at
          // half-life, never sooner than 15 seconds out to avoid a hot loop.
          const untilExpiry = session.expiresAt - Date.now();
          const delay = Math.max(15_000, untilExpiry - 120_000, untilExpiry / 2);
          sessionRefreshTimer = setTimeout(() => {
            refreshSession().catch((failure) => reportVoiceError('scheduled session refresh', failure));
          }, delay);
        };

        const refreshSession = async () => {
          if (canceled || sessionRefreshBusy) return;
          if (activeCallRef.current) {
            if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
            sessionRefreshTimer = setTimeout(() => {
              refreshSession().catch((failure) => reportVoiceError('deferred session refresh', failure));
            }, 60_000);
            return;
          }
          sessionRefreshBusy = true;
          try {
            const fresh = voiceLoginConfig(
              await api.post<VoiceTokenResponse>('/api/telnyx/token', {}),
              ringtone,
            );
            await persistVoiceSession(fresh);
            await login(registeredToken, fresh);
            loginConfigRef.current = fresh;
            scheduleSessionRefresh(fresh);
          } catch (refreshError) {
            if (!canceled) setError(refreshError instanceof Error ? refreshError.message : 'Calling session refresh failed.');
            if (!canceled) {
              if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
              sessionRefreshTimer = setTimeout(() => {
                refreshSession().catch((failure) => reportVoiceError('session refresh retry', failure));
              }, 60_000);
            }
          } finally {
            sessionRefreshBusy = false;
          }
        };

        const registerLatestDevice = async () => {
          if (canceled || registrationBusy) return;
          const token = await getVoicePushToken();
          if (!token || token === registeredToken) return;
          registrationBusy = true;
          setPushRegistration('registering');
          try {
            await login(token);
            registeredToken = token;
            if (!canceled) setPushRegistration('registered');
          } catch (failure) {
            reportVoiceError('register refreshed push token', failure);
            if (!canceled) setPushRegistration('unavailable');
          } finally {
            registrationBusy = false;
          }
        };

        if (!launchedFromPush) await login(pushNotificationDeviceToken);
        if (canceled) return;
        scheduleSessionRefresh(initialSession);
        setPushRegistration(pushNotificationDeviceToken ? 'registered' : 'registering');
        if (!pushNotificationDeviceToken) {
          tokenTimer = setInterval(() => {
            registerLatestDevice().then(() => {
              if (!registeredToken || !tokenTimer) return;
              clearInterval(tokenTimer);
              tokenTimer = undefined;
            }).catch((failure) => reportVoiceError('refresh push registration token', failure));
          }, 2000);
        }
        appStateSubscription = AppState.addEventListener('change', (state) => {
          if (state !== 'active' || canceled) return;
          if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
          activeRegistrationTimer = setTimeout(() => {
            const operation = isVoiceSessionFresh(loginConfigRef.current, 30_000)
              ? registerLatestDevice()
              : refreshSession();
            operation.catch((failure) => reportVoiceError('foreground voice session validation', failure));
          }, 250);
        });
      } catch (voiceError) {
        setPushRegistration('unavailable');
        if (!canceled) setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
      }
    };

    connect();
    return () => {
      canceled = true;
      if (tokenTimer) clearInterval(tokenTimer);
      if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
      if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
      appStateSubscription?.remove();
    };
  }, [activeCallRef, bootstrapSession, isAuthenticated, isPreview, loading, loginConfigRef, reportVoiceError, setError, setPushRegistration]);
}
