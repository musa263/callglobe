import React from 'react';
import type * as ManagedSdk from '@telnyx/react-voice-commons-sdk';

let sdk: typeof ManagedSdk | undefined;
let client: ReturnType<typeof ManagedSdk.createTelnyxVoipClient> | undefined;

/** Only the explicitly selected managed path may load or initialize the SDK. */
function managedSdk(): typeof ManagedSdk {
  sdk ||= require('@telnyx/react-voice-commons-sdk') as typeof ManagedSdk;
  return sdk;
}

export function getManagedVoiceClient() {
  client ||= managedSdk().createTelnyxVoipClient({ enableAppStateManagement: true, debug: __DEV__, useTrickleIce: true });
  return client;
}

export function existingManagedVoiceClient() { return client; }

export const createManagedTokenConfig: typeof ManagedSdk.createTokenConfig = (...args) => managedSdk().createTokenConfig(...args);
export function isManagedPushLaunch() { return managedSdk().TelnyxVoipClient.isLaunchedFromPushNotification(); }

/** Mounted beside Vocivo's provider so engine selection never remounts live UI. */
export function ManagedVoiceRuntime() {
  const Runtime = managedSdk().TelnyxVoiceApp;
  return <Runtime voipClient={getManagedVoiceClient()} enableAutoReconnect debug={__DEV__}>{null}</Runtime>;
}
