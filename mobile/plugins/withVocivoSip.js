const { withAppDelegate } = require('expo/config-plugins');

// Native Vocivo SIP + CallKit (see modules/vocivo-sip).
// Inbound DIDs stay on Telnyx Call Control / PushKit. This plugin must not
// replace Telnyx's PKPushRegistry. Autolinking loads VocivoSip.
module.exports = function withVocivoSip(config) {
  return withAppDelegate(config, (appConfig) => appConfig);
};
