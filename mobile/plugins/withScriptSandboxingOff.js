const { withXcodeProject } = require('expo/config-plugins');

/**
 * Keeps Xcode's user-script sandboxing off for the app target.
 *
 * CocoaPods' "[CP] Copy Pods Resources" phase writes its manifest
 * (resources-to-copy-<target>.txt) into the Pods folder, and React Native's
 * bundle phase writes into the project too. With sandboxing on, both are
 * denied and the build stops at
 *
 *   Sandbox: bash(…) deny(1) file-write-create …/ios/Pods/resources-to-copy-Vocivo.txt
 *
 * CocoaPods turns it off in the Pods project for exactly this reason; the app
 * target has to agree. Accepting Xcode's "Update to recommended settings"
 * prompt turns it back on, which is how it arrived — and Expo's prebuild does
 * not set it either way, so it is pinned here rather than left to a default.
 */

module.exports = function withScriptSandboxingOff(config) {
  return withXcodeProject(config, (appConfig) => {
    appConfig.modResults.addBuildProperty('ENABLE_USER_SCRIPT_SANDBOXING', 'NO');
    return appConfig;
  });
};
