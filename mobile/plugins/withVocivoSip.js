const { withAppDelegate } = require('expo/config-plugins');

// Native Vocivo SIP + CallKit (see modules/vocivo-sip).
// Incoming Vocivo VoIP pushes reuse the Telnyx PKPushRegistry in AppDelegate.
module.exports = function withVocivoSip(config) {
  return withAppDelegate(config, (appConfig) => appConfig);
};
