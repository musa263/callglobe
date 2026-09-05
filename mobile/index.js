import { registerRootComponent } from 'expo';
import { AppRegistry, NativeModules } from 'react-native';
import { createSipVoiceClient, ensureSipRegistration } from './src/lib/sipNative';

// Install native action listeners before any HTTP session or visual bootstrap.
if (NativeModules.VocivoSip) createSipVoiceClient();
AppRegistry.registerHeadlessTask('VocivoSipWake', () => async () => {
  await ensureSipRegistration();
});
registerRootComponent(require('./App').default);
