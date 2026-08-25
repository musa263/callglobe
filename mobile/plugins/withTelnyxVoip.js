const fs = require('fs');
const path = require('path');
const { IOSConfig, withAppDelegate, withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const ringtoneNames = ['vocivo_classic', 'vocivo_chime', 'vocivo_pulse'];

function insertOnce(source, marker, insertion) {
  return source.includes(insertion.trim()) ? source : source.replace(marker, `${marker}${insertion}`);
}

function patchTelnyxIosSdk(projectRoot) {
  const sdkRoot = path.join(projectRoot, 'node_modules', '@telnyx', 'react-voice-commons-sdk', 'ios');
  const bridgePath = path.join(sdkRoot, 'VoicePnBridge.swift');
  const externPath = path.join(sdkRoot, 'VoicePnBridge.m');
  const callKitPath = path.join(sdkRoot, 'CallKitBridge.swift');
  if (![bridgePath, externPath, callKitPath].every(fs.existsSync)) throw new Error('Unable to locate the Telnyx iOS SDK sources.');

  let callKit = fs.readFileSync(callKitPath, 'utf8');
  if (!callKit.includes('configuration.ringtoneSound')) {
    callKit = callKit.replace(
      'configuration.includesCallsInRecents = true',
      `configuration.includesCallsInRecents = true
            if let ringtone = UserDefaults.standard.string(forKey: "vocivo_incoming_ringtone"), !ringtone.isEmpty {
                configuration.ringtoneSound = "\\(ringtone).wav"
            }`
    );
  }
  if (!callKit.includes('public func updateIncomingRingtone')) {
    callKit = callKit.replace(
      '        private func installCallKitProvider() -> CXProvider {',
      `        public func updateIncomingRingtone(_ resourceName: String?) {
            if let resourceName, !resourceName.isEmpty {
                UserDefaults.standard.set(resourceName, forKey: "vocivo_incoming_ringtone")
            } else {
                UserDefaults.standard.removeObject(forKey: "vocivo_incoming_ringtone")
            }
            UserDefaults.standard.synchronize()
            callKitProvider?.invalidate()
            callKitProvider = nil
            _ = installCallKitProvider()
        }

        private func installCallKitProvider() -> CXProvider {`
    );
  }
  fs.writeFileSync(callKitPath, callKit);

  let bridge = fs.readFileSync(bridgePath, 'utf8');
  if (!bridge.includes('func setIncomingCallRingtone')) {
    bridge = bridge.replace(
      '    @objc\n    func setMissedCallNotificationsEnabled',
      `    @objc
    func setIncomingCallRingtone(_ resourceName: String?, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        DispatchQueue.main.async {
            TelnyxCallKitManager.shared.updateIncomingRingtone(resourceName)
            resolve(true)
        }
    }

    @objc
    func setMissedCallNotificationsEnabled`
    );
  }
  fs.writeFileSync(bridgePath, bridge);

  let extern = fs.readFileSync(externPath, 'utf8');
  if (!extern.includes('setIncomingCallRingtone')) {
    extern = extern.replace(
      'RCT_EXTERN_METHOD(setMissedCallNotificationsEnabled:',
      `RCT_EXTERN_METHOD(setIncomingCallRingtone:(NSString * _Nullable)resourceName
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setMissedCallNotificationsEnabled:`
    );
  }
  fs.writeFileSync(externPath, extern);
}

function withTelnyxAppDelegate(config) {
  return withAppDelegate(config, (appConfig) => {
    if (appConfig.modResults.language !== 'swift') throw new Error('Vocivo requires a Swift AppDelegate for Telnyx VoIP integration.');
    let source = appConfig.modResults.contents;
    source = insertOnce(source, 'import Expo\n', 'import PushKit\nimport TelnyxVoiceCommons\n');
    source = source.replace('public class AppDelegate: ExpoAppDelegate {', 'public class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {');
    if (!source.includes('TelnyxVoipPushHandler.initializeVoipRegistration()')) {
      source = source.replace(/return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/, 'TelnyxVoipPushHandler.initializeVoipRegistration()\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    }
    if (!source.includes('didUpdate pushCredentials: PKPushCredentials')) {
      const methods = `

  // MARK: - Telnyx VoIP Push Notifications
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    TelnyxVoipPushHandler.shared.handleVoipTokenUpdate(pushCredentials, type: type)
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    TelnyxVoipPushHandler.shared.handleVoipPush(payload, type: type, completion: completion)
  }
`;
      const nextClass = source.indexOf('\n}\n\nclass ReactNativeDelegate');
      if (nextClass === -1) throw new Error('Unable to locate the iOS AppDelegate class ending.');
      source = `${source.slice(0, nextClass)}${methods}${source.slice(nextClass)}`;
    }
    appConfig.modResults.contents = source;
    return appConfig;
  });
}

function withIosRingtones(config) {
  return withXcodeProject(config, (projectConfig) => {
    const { projectRoot, platformProjectRoot } = projectConfig.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const destination = path.join(platformProjectRoot, projectName, 'Ringtones');
    fs.mkdirSync(destination, { recursive: true });
    ringtoneNames.forEach((name) => {
      const filename = `${name}.wav`;
      const source = path.join(projectRoot, 'assets', 'ringtones', filename);
      const target = path.join(destination, filename);
      fs.copyFileSync(source, target);
      const relativePath = path.join(projectName, 'Ringtones', filename);
      if (!projectConfig.modResults.hasFile(relativePath)) {
        projectConfig.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({ filepath: relativePath, groupName: projectName, project: projectConfig.modResults, isBuildFile: true, verbose: false });
      }
    });
    return projectConfig;
  });
}

function withAndroidRingtones(config) {
  return withDangerousMod(config, ['android', async (appConfig) => {
    const { projectRoot, platformProjectRoot } = appConfig.modRequest;
    const destination = path.join(platformProjectRoot, 'app', 'src', 'main', 'res', 'raw');
    fs.mkdirSync(destination, { recursive: true });
    ringtoneNames.forEach((name) => fs.copyFileSync(path.join(projectRoot, 'assets', 'ringtones', `${name}.wav`), path.join(destination, `${name}.wav`)));
    return appConfig;
  }]);
}

module.exports = function withTelnyxVoip(config) {
  config = withTelnyxAppDelegate(config);
  config = withIosRingtones(config);
  config = withDangerousMod(config, ['ios', async (appConfig) => { patchTelnyxIosSdk(appConfig.modRequest.projectRoot); return appConfig; }]);
  config = withAndroidRingtones(config);
  return config;
};
