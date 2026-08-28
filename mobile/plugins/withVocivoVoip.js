const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withAppDelegate,
  withDangerousMod,
  withMainActivity,
  withPodfile,
  withProjectBuildGradle,
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
    if (!source.includes('private var vocivoPushBackgroundTasks')) {
      source = source.replace(
        '  private var vocivoVoipRegistry: PKPushRegistry?\n',
        '  private var vocivoVoipRegistry: PKPushRegistry?\n  private var vocivoPushBackgroundTasks: [String: UIBackgroundTaskIdentifier] = [:]\n  private var vocivoCompletedPushes = Set<String>()\n'
      );
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
    const vocivoMethods = /\n  \/\/ MARK: - Vocivo VoIP Push Notifications[\s\S]*?\n  public func pushRegistry\(\n    _ registry: PKPushRegistry,\n    didInvalidatePushTokenFor type: PKPushType\n  \) \{[\s\S]*?\n  \}\n/;
    source = source.replace(vocivoMethods, '');
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
    guard UserDefaults.standard.bool(forKey: "vocivoSignedIn") else {
      completion()
      return
    }
    let callUUID = values["callUUID"] as? String ?? UUID().uuidString.lowercased()
    let callerNumber = values["callerNumber"] as? String ?? values["extension"] as? String ?? "private"
    let callerName = values["callerName"] as? String ?? "Unknown caller"
    let hasVideo = values["hasVideo"] as? Bool ?? false

    let finishPush: () -> Void = { [weak self] in
      DispatchQueue.main.async {
        guard let self, !self.vocivoCompletedPushes.contains(callUUID) else { return }
        self.vocivoCompletedPushes.insert(callUUID)
        RNVoipPushNotificationManager.removeCompletionHandler(callUUID)
        completion()
        if let task = self.vocivoPushBackgroundTasks.removeValue(forKey: callUUID), task != .invalid {
          UIApplication.shared.endBackgroundTask(task)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in
          self?.vocivoCompletedPushes.remove(callUUID)
        }
      }
    }
    let task = UIApplication.shared.beginBackgroundTask(withName: "VocivoIncomingCall") {
      finishPush()
    }
    vocivoPushBackgroundTasks[callUUID] = task
    RNVoipPushNotificationManager.addCompletionHandler(callUUID, completionHandler: finishPush)
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
      withCompletionHandler: finishPush
    )
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
      finishPush()
    }
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

function withIosBundleScriptPathFix(config) {
  return withXcodeProject(config, (projectConfig) => {
    const phases = projectConfig.modResults.hash.project.objects.PBXShellScriptBuildPhase || {};
    const phase = Object.values(phases).find((entry) => (
      entry
      && typeof entry === 'object'
      && String(entry.name || '').includes('Bundle React Native code and images')
    ));
    if (!phase) throw new Error('Unable to locate the React Native bundle build phase.');

    const script = `if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then
  source "$PODS_ROOT/../.xcode.env"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

export PROJECT_ROOT="$PROJECT_DIR/.."

if [[ "$CONFIGURATION" = *Debug* ]]; then
  export SKIP_BUNDLING=1
fi
if [[ -z "$ENTRY_FILE" ]]; then
  export ENTRY_FILE="$("$NODE_BINARY" -e "require('expo/scripts/resolveAppEntry')" "$PROJECT_ROOT" ios absolute | tail -n 1)"
fi
if [[ -z "$CLI_PATH" ]]; then
  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
fi
if [[ -z "$BUNDLE_COMMAND" ]]; then
  export BUNDLE_COMMAND="export:embed"
fi

if [[ -f "$PODS_ROOT/../.xcode.env.updates" ]]; then
  source "$PODS_ROOT/../.xcode.env.updates"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

REACT_NATIVE_XCODE_SCRIPT="$("$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'")"
bash "$REACT_NATIVE_XCODE_SCRIPT"
`;
    phase.shellScript = JSON.stringify(script);
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

function withXcode26FmtWorkaround(config) {
  return withPodfile(config, (appConfig) => {
    const marker = '# fmt 11.0.2 enables a consteval path rejected by Apple Clang in Xcode 26.';
    const constantsMarker = '# Expo Constants invokes its script through `bash -c`, which splits project';
    const anchor = '    )\n  end\nend\n';
    if (!appConfig.modResults.contents.includes(marker)) {
      const replacement = `    )

    ${marker}
    # React Native 0.84 updates fmt; remove this after that upgrade.
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base)
      content = File.read(fmt_base)
      patch_marker = '// Vocivo Xcode 26 fmt workaround'
      unless content.include?(patch_marker)
        needle = "#if FMT_USE_CONSTEVAL\\n#  define FMT_CONSTEVAL consteval"
        replacement = "\#{patch_marker}\\n#undef FMT_USE_CONSTEVAL\\n#define FMT_USE_CONSTEVAL 0\\n\#{needle}"
        raise 'fmt/base.h structure changed; update the Xcode 26 workaround.' unless content.include?(needle)
        File.chmod(0644, fmt_base)
        File.write(fmt_base, content.sub(needle, replacement))
      end
    end
  end
end
`;
      if (!appConfig.modResults.contents.includes(anchor)) throw new Error('Unable to install the Xcode 26 fmt workaround.');
      appConfig.modResults.contents = appConfig.modResults.contents.replace(anchor, replacement);
    }

    if (!appConfig.modResults.contents.includes(constantsMarker)) {
      const postInstallEnd = '  end\nend\n';
      const insertAt = appConfig.modResults.contents.lastIndexOf(postInstallEnd);
      if (insertAt === -1) throw new Error('Unable to install the Expo Constants path workaround.');
      const constantsWorkaround = `    # Expo Constants invokes its script through \`bash -c\`, which splits project
    # paths containing spaces. Execute the script directly with a quoted path.
    constants_target = installer.pods_project.targets.find { |target| target.name == 'EXConstants' }
    constants_target&.shell_script_build_phases&.each do |phase|
      next unless phase.name == '[CP-User] Generate app.config for prebuilt Constants.manifest'
      phase.shell_script = 'bash "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"'
    end
`;
      appConfig.modResults.contents = `${appConfig.modResults.contents.slice(0, insertAt)}${constantsWorkaround}${appConfig.modResults.contents.slice(insertAt)}`;
    }
    return appConfig;
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

function withReactNativeMainActivity(config) {
  return withMainActivity(config, (appConfig) => {
    let source = appConfig.modResults.contents;
    source = source.replace(/import com\.telnyx\.react_voice_commons\.TelnyxMainActivity\n/, '');
    source = source.replace(/class MainActivity\s*:\s*TelnyxMainActivity\(\)/, 'class MainActivity : ReactActivity()');
    appConfig.modResults.contents = source;
    return appConfig;
  });
}

function withAndroidFirebase(config) {
  const googleServicesVersion = require('@react-native-firebase/app/package.json').sdkVersions.android.gmsGoogleServicesGradle;
  config.android = { ...config.android, googleServicesFile: config.android?.googleServicesFile || './google-services.json' };
  config = withProjectBuildGradle(config, (appConfig) => {
    if (appConfig.modResults.language !== 'groovy') throw new Error('Vocivo requires a Groovy Android project build file.');
    if (!appConfig.modResults.contents.includes('com.google.gms:google-services')) {
      appConfig.modResults.contents = appConfig.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n        classpath 'com.google.gms:google-services:${googleServicesVersion}'`
      );
    }
    return appConfig;
  });
  config = withAppBuildGradle(config, (appConfig) => {
    if (appConfig.modResults.language !== 'groovy') throw new Error('Vocivo requires a Groovy Android app build file.');
    if (!/apply\s+plugin:\s+['"]com\.google\.gms\.google-services['"]/.test(appConfig.modResults.contents)) {
      appConfig.modResults.contents += "\napply plugin: 'com.google.gms.google-services'\n";
    }
    return appConfig;
  });
  config = withDangerousMod(config, ['android', async (appConfig) => {
    const configured = appConfig.android?.googleServicesFile || './google-services.json';
    const source = path.resolve(appConfig.modRequest.projectRoot, configured);
    if (!fs.existsSync(source)) {
      throw new Error(`Vocivo Android background calling requires ${source}. Download google-services.json for app.vocivo.mobile from Firebase before building.`);
    }
    fs.copyFileSync(source, path.join(appConfig.modRequest.platformProjectRoot, 'app', 'google-services.json'));
    return appConfig;
  }]);
  return withAndroidManifest(config, (appConfig) => {
    const manifest = appConfig.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error('Unable to locate the Android application manifest.');
    const permissions = manifest['uses-permission'] || [];
    for (const name of ['android.permission.USE_FULL_SCREEN_INTENT', 'android.permission.VIBRATE']) {
      if (!permissions.some((entry) => entry.$?.['android:name'] === name)) permissions.push({ $: { 'android:name': name } });
    }
    manifest['uses-permission'] = permissions;
    const services = application.service || [];
    const firebaseServices = [
      {
        $: { 'android:name': 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingHeadlessService', 'android:exported': 'false' },
      },
      {
        $: { 'android:name': 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingService', 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
      },
    ];
    application.service = [
      ...services.filter((entry) => !firebaseServices.some((service) => service.$['android:name'] === entry.$?.['android:name'])),
      ...firebaseServices,
    ];
    const receiverName = 'io.invertase.firebase.messaging.ReactNativeFirebaseMessagingReceiver';
    const receivers = application.receiver || [];
    application.receiver = [
      ...receivers.filter((entry) => entry.$?.['android:name'] !== receiverName),
      {
        $: {
          'android:name': receiverName,
          'android:exported': 'true',
          'android:permission': 'com.google.android.c2dm.permission.SEND',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.android.c2dm.intent.RECEIVE' } }] }],
      },
    ];
    return appConfig;
  });
}

function withAndroidCallKeepService(config) {
  return withAndroidManifest(config, (appConfig) => {
    const application = appConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Unable to locate the Android application manifest.');

    const services = application.service || [];
    const serviceName = 'io.wazo.callkeep.VoiceConnectionService';
    const backgroundServiceName = 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService';
    const callKeepService = {
      $: {
        'android:name': serviceName,
        'android:label': 'Vocivo',
        'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
        'android:foregroundServiceType': 'phoneCall|microphone',
        'android:exported': 'true',
      },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }],
      }],
    };
    const backgroundService = {
      $: {
        'android:name': backgroundServiceName,
        'android:exported': 'false',
      },
    };

    application.service = [
      ...services.filter((entry) => ![serviceName, backgroundServiceName].includes(entry.$?.['android:name'])),
      callKeepService,
      backgroundService,
    ];
    return appConfig;
  });
}

module.exports = function withVocivoVoip(config) {
  config = withVocivoAppDelegate(config);
  config = withIosVoipBridge(config);
  config = withIosBundleScriptPathFix(config);
  config = withIosRingtones(config);
  config = withXcode26FmtWorkaround(config);
  config = withReactNativeMainActivity(config);
  config = withAndroidFirebase(config);
  config = withAndroidCallKeepService(config);
  config = withAndroidRingtones(config);
  return config;
};
