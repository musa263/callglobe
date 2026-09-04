import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { createTokenConfig, TelnyxVoipClient } from '@telnyx/react-voice-commons-sdk';
import { api } from '../lib/api';
import { applyIncomingRingtone, loadIncomingRingtone } from '../lib/ringtone';
import { getVoicePushToken, persistVoiceSession, voipClient } from '../lib/voipClient';
import { refreshVocivoSip, registerVocivoSip } from '../lib/sipNative';
import { sipEngine, telnyxEngine } from './engines';
import { voice } from './voiceClientFacade';
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
      voice.logout().catch((failure) => reportVoiceError('logout', failure));
      setPushRegistration('unavailable');
      return;
    }

    let canceled = false;
    let tokenTimer: ReturnType<typeof setInterval> | undefined;
    let sessionRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let activeRegistrationTimer: ReturnType<typeof setTimeout> | undefined;
    let networkRefreshTimer: ReturnType<typeof setTimeout> | undefined;
    let sipCredentialTimer: ReturnType<typeof setTimeout> | undefined;
    let startupRetryTimer: ReturnType<typeof setTimeout> | undefined;
    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | undefined;
    let networkSubscription: (() => void) | undefined;

    const connect = async () => {
      try {
        const edgeConfig = await api.get<VoiceEdgeConfig>('/api/voice/config');
        if (canceled) return;
        const onSipEdge = voiceEdgeFromConfig(edgeConfig) === 'sip';
        if (onSipEdge && !shouldUseSipNative('sip', NativeModules)) {
          throw new Error('This build does not include Vocivo SIP calling. Install the latest app build.');
        }
        const launchedFromPush = !onSipEdge && await TelnyxVoipClient.isLaunchedFromPushNotification();
        if (canceled) return;
        const ringtone = await loadIncomingRingtone();
        await applyIncomingRingtone(ringtone);
        const pushBootstrap = launchedFromPush && bootstrapSession && isVoiceSessionFresh(bootstrapSession, 30_000)
          ? bootstrapSession
          : null;
        const initialSession = onSipEdge ? null : pushBootstrap
          || voiceLoginConfig(await api.post<VoiceTokenResponse>('/api/telnyx/token', {}), ringtone);
        if (canceled) return;
        loginConfigRef.current = initialSession;
        if (initialSession) await persistVoiceSession(initialSession);
        const pushNotificationDeviceToken = await getVoicePushToken();
        if (canceled) return;
        let storedPushToken: string | undefined;
        if (pushNotificationDeviceToken) {
          try {
            await api.post('/api/voice/devices', {
              platform: Platform.OS === 'ios' ? 'ios' : 'android',
              token: pushNotificationDeviceToken,
              environment: __DEV__ ? 'sandbox' : 'production',
              bundleId: 'app.vocivo.mobile',
            });
            storedPushToken = pushNotificationDeviceToken;
          } catch (failure) {
            reportVoiceError('register Vocivo wakeup token', failure);
          }
        }
        if (canceled) return;
        // Which engine carries the call. Until this point the app has been
        // registering with a carrier and with Vocivo's own edge both; from here
        // exactly one of them is the client the UI talks to.
        // The SIP password has a life of its own, and re-registering with an
        // expired one is refused: the registrar drops the phone and calls stop
        // arriving with nothing on screen to say so. Ask for a new one at four
        // fifths of its life, and register again with it.
        const registerOnSipEdge = async () => {
          const sip = await api.post<{
            username: string;
            password: string;
            domain: string;
            wsUri?: string;
            expires_in?: number;
            ice_servers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
          }>('/api/voice/sip-credentials', { client: 'mobile' });
          if (canceled) return;
          await registerVocivoSip({
            username: sip.username,
            password: sip.password,
            domain: sip.domain,
            wsUri: sip.wsUri,
            displayName: sip.username,
            iceServers: sip.ice_servers,
          });
          scheduleSipCredentialRefresh(Number(sip.expires_in));
        };

        const scheduleSipCredentialRefresh = (expiresInSeconds: number) => {
          if (sipCredentialTimer) clearTimeout(sipCredentialTimer);
          const lifetime = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds * 1000 : 60 * 60 * 1000;
          const delay = Math.min(Math.max(5 * 60_000, lifetime * 0.8), 2 ** 31 - 1);
          sipCredentialTimer = setTimeout(() => {
            refreshSipCredentials().catch((failure) => reportVoiceError('scheduled SIP credential refresh', failure));
          }, delay);
        };

        const refreshSipCredentials = async () => {
          if (canceled || !onSipEdge) return;
          // Registering again re-offers the phone's contact, which a call in
          // progress does not need disturbed.
          if (activeCallRef.current) {
            if (sipCredentialTimer) clearTimeout(sipCredentialTimer);
            sipCredentialTimer = setTimeout(() => {
              refreshSipCredentials().catch((failure) => reportVoiceError('deferred SIP credential refresh', failure));
            }, 60_000);
            return;
          }
          try {
            await registerOnSipEdge();
          } catch (failure) {
            reportVoiceError('renew Vocivo SIP credentials', failure);
            if (canceled) return;
            if (sipCredentialTimer) clearTimeout(sipCredentialTimer);
            sipCredentialTimer = setTimeout(() => {
              refreshSipCredentials().catch((error) => reportVoiceError('SIP credential refresh retry', error));
            }, 60_000);
          }
        };

        if (onSipEdge) {
          const engine = sipEngine();
          voice.use(engine.name, engine.client, engine.platform);
          await registerOnSipEdge();
        } else {
          const engine = telnyxEngine();
          voice.use(engine.name, engine.client, engine.platform);
        }
        if (canceled) return;
        let registeredToken = storedPushToken;
        let registrationBusy = false;
        let sessionRefreshBusy = false;

        const login = async (pushToken?: string, session = loginConfigRef.current) => {
          // On the SIP edge the phone is already registered with Vocivo's own
          // Kamailio. Logging into the carrier as well would keep a second
          // signalling socket open, and route the calls it carries back through
          // the carrier — which is the whole thing this move is undoing.
          if (onSipEdge) return;
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
            if (onSipEdge) return;
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
          if (canceled) return;
          if (!token || token === registeredToken) return;
          registrationBusy = true;
          setPushRegistration('registering');
          try {
            await api.post('/api/voice/devices', {
              platform: Platform.OS === 'ios' ? 'ios' : 'android', token,
              environment: __DEV__ ? 'sandbox' : 'production', bundleId: 'app.vocivo.mobile',
            });
            if (canceled) return;
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
        if (initialSession) scheduleSessionRefresh(initialSession);
        setPushRegistration(registeredToken ? 'registered' : 'registering');
        if (!registeredToken) {
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
            if (onSipEdge) {
              // The socket to Vocivo's edge rarely survives a spell in the
              // background; make sure the phone is registered again before
              // the person tries to dial.
              refreshVocivoSip().catch((failure) => reportVoiceError('foreground SIP refresh', failure));
              registerLatestDevice().catch((failure) => reportVoiceError('foreground SIP push token refresh', failure));
              return;
            }
            const operation = isVoiceSessionFresh(loginConfigRef.current, 30_000)
              ? registerLatestDevice()
              : refreshSession();
            operation.catch((failure) => reportVoiceError('foreground voice session validation', failure));
          }, 250);
        });
        if (onSipEdge) {
          // Wi-Fi to cellular and back changes the phone's address; the old
          // socket is dead even when the OS has not said so yet.
          let lastNetworkKey = '';
          networkSubscription = NetInfo.addEventListener((netState) => {
            if (canceled) return;
            const key = `${netState.type}:${netState.isConnected === true}`;
            if (!lastNetworkKey) { lastNetworkKey = key; return; }
            if (key === lastNetworkKey || netState.isConnected !== true) { lastNetworkKey = key; return; }
            lastNetworkKey = key;
            if (networkRefreshTimer) clearTimeout(networkRefreshTimer);
            networkRefreshTimer = setTimeout(() => {
              refreshVocivoSip().catch((failure) => reportVoiceError('network change SIP refresh', failure));
            }, 1_000);
          });
        }
      } catch (voiceError) {
        reportVoiceError('initialize configured voice engine', voiceError);
        if (!canceled) {
          setPushRegistration('unavailable');
          setError(voiceError instanceof Error ? voiceError.message : 'Unable to connect to calling service.');
          startupRetryTimer = setTimeout(connect, 5_000);
        }
      }
    };

    connect();
    return () => {
      canceled = true;
      if (tokenTimer) clearInterval(tokenTimer);
      if (sessionRefreshTimer) clearTimeout(sessionRefreshTimer);
      if (activeRegistrationTimer) clearTimeout(activeRegistrationTimer);
      if (networkRefreshTimer) clearTimeout(networkRefreshTimer);
      if (sipCredentialTimer) clearTimeout(sipCredentialTimer);
      if (startupRetryTimer) clearTimeout(startupRetryTimer);
      appStateSubscription?.remove();
      networkSubscription?.();
    };
  }, [activeCallRef, bootstrapSession, isAuthenticated, isPreview, loading, loginConfigRef, reportVoiceError, setError, setPushRegistration]);
}
