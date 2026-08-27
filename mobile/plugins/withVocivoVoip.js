const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAndroidManifest,
  withAppDelegate,
  withDangerousMod,
  withMainActivity,
  withXcodeProject,
} = require('expo/config-plugins');

const ringtoneNames = ['vocivo_classic', 'vocivo_chime', 'vocivo_pulse', 'vocivo_wave', 'vocivo_signal', 'vocivo_softbell'];

function ensureSwiftImport(source, moduleName) {
  const importLine = `import ${moduleName}\n`;
  if (source.includes(importLine)) return source;
  if (source.includes('import Expo\n')) return source.replace('import Expo\n', `import Expo\n${importLine}`);
  return `${importLine}${source}`;
}

function withVocivoAppDelegate(config) {
  return withAppDelegate(config, (appConfig) => {
    if (appConfig.modResults.language !== 'swift') throw new Error('Vocivo requires a Swift AppDelegate for VoIP integration.');
    let source = appConfig.modResults.contents;
    source = source.replace('import TelnyxVoiceCommons\n', '');
    source = ensureSwiftImport(source, 'PushKit');
    source = source.replace('import RNCallKeep\n', '');
    source = source.replace('import RNVoipPushNotification\n', '');
    source = source.replace('public class AppDelegate: ExpoAppDelegate {', 'public class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {');
    if (!source.includes('private var vocivoVoipRegistry')) {
      source = source.replace('  var window: UIWindow?\n', '  var window: UIWindow?\n  private var vocivoVoipRegistry: PKPushRegistry?\n');
    }

    const initialization = `    let savedCallSettings = UserDefaults.standard.dictionary(forKey: "RNCallKeepSettings")
    let ringtoneSound = savedCallSettings?["ringtoneSound"] as? String ?? "vocivo_classic.wav"
    RNCallKeep.setup([
      "appName": "Vocivo",
      "handleType": "generic",
      "supportsVideo": true,
      "maximumCallGroups": 2,
      "maximumCallsPerCallGroup": 5,
      "includesCallsInRecents": false,
      "ringtoneSound": ringtoneSound
    ])

    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)`
    if (!source.includes('RNCallKeep.setup([')) {
      if (source.includes('    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)')) {
        source = source.replace('    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)', initialization);
      } else {
        source = source.replace(
          /    return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/,
          `${initialization}\n    vocivoVoipRegistry?.delegate = self\n    vocivoVoipRegistry?.desiredPushTypes = [.voIP]\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`
        );
      }
    }

    const oldMethods = /\n  \/\/ MARK: - Telnyx VoIP Push Notifications[\s\S]*?\n  public func pushRegistry\(\n    _ registry: PKPushRegistry,\n    didInvalidatePushTokenFor type: PKPushType\n  \) \{[\s\S]*?\n  \}\n/;
    source = source.replace(oldMethods, '');
    if (!source.includes('// MARK: - Vocivo VoIP Push Notifications')) {
      const methods = `

  // MARK: - Vocivo VoIP Push Notifications
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    let values = payload.dictionaryPayload
    let callUUID = values["callUUID"] as? String ?? UUID().uuidString.lowercased()
    let callerNumber = values["callerNumber"] as? String ?? values["extension"] as? String ?? "private"
    let callerName = values["callerName"] as? String ?? "Unknown caller"
    let hasVideo = values["hasVideo"] as? Bool ?? false

    RNVoipPushNotificationManager.addCompletionHandler(callUUID, completionHandler: completion)
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)
    RNCallKeep.reportNewIncomingCall(
      callUUID,
      handle: callerNumber,
      handleType: "generic",
      hasVideo: hasVideo,
      localizedCallerName: callerName,
      supportsHolding: true,
      supportsDTMF: true,
      supportsGrouping: true,
      supportsUngrouping: true,
      fromPushKit: true,
      payload: values,
      withCompletionHandler: nil
    )
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    UserDefaults.standard.removeObject(forKey: "voip_push_token")
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

function withIosVoipBridge(config) {
  return withXcodeProject(config, (projectConfig) => {
    const { platformProjectRoot, projectRoot } = projectConfig.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const headerName = `${projectName}-Bridging-Header.h`;
    const headerPath = path.join(platformProjectRoot, projectName, headerName);
    fs.writeFileSync(headerPath, `#import <RNCallKeep/RNCallKeep.h>\n#import <RNVoipPushNotification/RNVoipPushNotificationManager.h>\n`);
    projectConfig.modResults.updateBuildProperty(
      'SWIFT_OBJC_BRIDGING_HEADER',
      `"${projectName}/${headerName}"`,
      undefined,
      projectName
    );
    return projectConfig;
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
        projectConfig.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath: relativePath,
          groupName: projectName,
          project: projectConfig.modResults,
          isBuildFile: true,
          verbose: false,
        });
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
    ringtoneNames.forEach((name) => fs.copyFileSync(
      path.join(projectRoot, 'assets', 'ringtones', `${name}.wav`),
      path.join(destination, `${name}.wav`)
    ));
    return appConfig;
  }]);
}

function withoutTelnyxAndroid(config) {
  config = withMainActivity(config, (appConfig) => {
    let source = appConfig.modResults.contents;
    source = source.replace(/import com\.telnyx\.react_voice_commons\.TelnyxMainActivity\n/, '');
    source = source.replace(/class MainActivity\s*:\s*TelnyxMainActivity\(\)/, 'class MainActivity : ReactActivity()');
    appConfig.modResults.contents = source;
    return appConfig;
  });
  config = withAndroidManifest(config, (appConfig) => {
    const application = appConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Unable to locate the Android application manifest.');
    application.service = (application.service || []).filter((entry) => entry.$?.['android:name'] !== '.AppFirebaseMessagingService');
    application.receiver = (application.receiver || []).filter((entry) => entry.$?.['android:name'] !== '.AppNotificationActionReceiver');
    return appConfig;
  });
  return withDangerousMod(config, ['android', async (appConfig) => {
    const packageName = appConfig.android?.package;
    if (!packageName) return appConfig;
    const sourceRoot = path.join(appConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', packageName.replaceAll('.', path.sep));
    for (const filename of ['AppFirebaseMessagingService.kt', 'AppNotificationActionReceiver.kt']) {
      const target = path.join(sourceRoot, filename);
      if (fs.existsSync(target)) fs.unlinkSync(target);
    }
    return appConfig;
  }]);
}

module.exports = function withVocivoVoip(config) {
  config = withVocivoAppDelegate(config);
  config = withIosVoipBridge(config);
  config = withIosRingtones(config);
  config = withoutTelnyxAndroid(config);
  config = withAndroidRingtones(config);
  return config;
};
