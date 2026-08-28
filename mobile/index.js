import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

if (Platform.OS === 'android') {
  const { getMessaging, setBackgroundMessageHandler } = require('@react-native-firebase/messaging');
  setBackgroundMessageHandler(getMessaging(), async (message) => {
    const { handleAndroidRemoteMessage } = require('./src/lib/voipClient');
    await handleAndroidRemoteMessage(message);
  });
}

registerRootComponent(require('./App').default);
