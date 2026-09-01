const { withAppDelegate } = require('expo/config-plugins');

// Placeholder for the Vocivo SIP + CallKit native module (Linphone/PJSIP).
// Production TestFlight keeps Telnyx PushKit from withTelnyxVoip until this
// module is linked and VOCIVO_VOICE_EDGE=sip is proven on web.
module.exports = function withVocivoSip(config) {
  return withAppDelegate(config, (appConfig) => appConfig);
};
