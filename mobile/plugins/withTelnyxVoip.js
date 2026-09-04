const fs = require('fs');
const path = require('path');
const { IOSConfig, withAndroidManifest, withAppBuildGradle, withAppDelegate, withDangerousMod, withMainActivity, withXcodeProject } = require('expo/config-plugins');

const ringtoneNames = ['vocivo_classic', 'vocivo_chime', 'vocivo_pulse', 'vocivo_wave', 'vocivo_signal', 'vocivo_softbell'];

function findSwiftTypeBody(source, typeName) {
  const declaration = new RegExp(`(?:public\\s+)?class\\s+${typeName}\\b[^\\{]*\\{`, 'm').exec(source);
  if (!declaration) throw new Error(`Unable to locate the Swift ${typeName} declaration.`);
  const open = declaration.index + declaration[0].lastIndexOf('{');
  let depth = 1;
  let quote = null;
  let escaped = false;
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth === 0) return { open, close: index };
  }
  throw new Error(`Unable to locate the closing brace for Swift ${typeName}.`);
}

function insertInSwiftType(source, typeName, marker, insertion) {
  if (source.includes(marker)) return source;
  const body = findSwiftTypeBody(source, typeName);
  return `${source.slice(0, body.close)}${insertion}\n${source.slice(body.close)}`;
}

function withTelnyxAppDelegate(config) {
  return withAppDelegate(config, (appConfig) => {
    if (appConfig.modResults.language !== 'swift') throw new Error('Vocivo requires a Swift AppDelegate for Telnyx VoIP integration.');
    let source = appConfig.modResults.contents;
    if (!source.includes('// VOCIVO_VOIP_IMPORTS')) {
      const importMatch = /^import Expo$/m.exec(source);
      if (!importMatch) throw new Error('Unable to locate the Expo import in AppDelegate.');
      const insertionPoint = importMatch.index + importMatch[0].length;
      const imports = [
        '// VOCIVO_VOIP_IMPORTS',
        ...(!source.includes('import PushKit') ? ['import PushKit'] : []),
        ...(!source.includes('import TelnyxVoiceCommons') ? ['import TelnyxVoiceCommons'] : []),
      ].join('\n');
      source = `${source.slice(0, insertionPoint)}\n${imports}${source.slice(insertionPoint)}`;
    }
    source = source.replace(
      /(public\s+class\s+AppDelegate\s*:\s*ExpoAppDelegate)([^\{]*)(\{)/,
      (match, declaration, conformances, brace) => conformances.includes('PKPushRegistryDelegate')
        ? match
        : `${declaration}${conformances.trimEnd()}, PKPushRegistryDelegate ${brace}`,
    );
    if (!source.includes('// VOCIVO_VOIP_REGISTRY')) {
      if (source.includes('private var vocivoVoipRegistry: PKPushRegistry?')) {
        source = source.replace('  private var vocivoVoipRegistry: PKPushRegistry?', '  // VOCIVO_VOIP_REGISTRY\n  private var vocivoVoipRegistry: PKPushRegistry?');
      } else {
        const body = findSwiftTypeBody(source, 'AppDelegate');
        source = `${source.slice(0, body.open + 1)}\n  // VOCIVO_VOIP_REGISTRY\n  private var vocivoVoipRegistry: PKPushRegistry?${source.slice(body.open + 1)}`;
      }
    }
    const pushRegistration = `// VOCIVO_VOIP_BOOTSTRAP
    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)
    vocivoVoipRegistry?.delegate = self
    vocivoVoipRegistry?.desiredPushTypes = [.voIP]`;
    if (!source.includes('// VOCIVO_VOIP_BOOTSTRAP')) {
      if (source.includes('vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)')) {
        source = source.replace('    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)', '    // VOCIVO_VOIP_BOOTSTRAP\n    vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)');
      } else {
        const returnPattern = /return\s+super\.application\(application,\s*didFinishLaunchingWithOptions:\s*launchOptions\)/;
        if (!returnPattern.test(source)) throw new Error('Unable to locate the AppDelegate launch return statement.');
        source = source.replace(returnPattern, `${pushRegistration}\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`);
      }
    }
    const methods = `

  // VOCIVO_VOIP_DELEGATE_METHODS
  // MARK: - Telnyx VoIP Push Notifications
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didUpdate pushCredentials: PKPushCredentials,
    for type: PKPushType
  ) {
    TelnyxVoipPushHandler.shared.handleVoipTokenUpdate(pushCredentials, type: type)
    VocivoSipCallManager.shared.pushRegistry(registry, didUpdate: pushCredentials, for: type)
  }

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didReceiveIncomingPushWith payload: PKPushPayload,
    for type: PKPushType,
    completion: @escaping () -> Void
  ) {
    if payload.dictionaryPayload["vocivo"] != nil {
      VocivoSipCallManager.shared.pushRegistry(registry, didReceiveIncomingPushWith: payload, for: type, completion: completion)
      return
    }
    guard UserDefaults.standard.bool(forKey: "vocivo_voice_signed_in") else {
      completion()
      return
    }
    TelnyxVoipPushHandler.shared.handleVoipPush(payload, type: type, completion: completion)
  }
  public func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    UserDefaults.standard.removeObject(forKey: "voip_push_token")
    UserDefaults.standard.removeObject(forKey: "telnyx_voip_push_token")
    VocivoSipCallManager.shared.pushRegistry(registry, didInvalidatePushTokenFor: type)
  }
`;
    if (!source.includes('// VOCIVO_VOIP_DELEGATE_METHODS') && source.includes('didReceiveIncomingPushWith payload: PKPushPayload')) {
      source = source.replace('  // MARK: - Telnyx VoIP Push Notifications', '  // VOCIVO_VOIP_DELEGATE_METHODS\n  // MARK: - Telnyx VoIP Push Notifications');
    }
    source = insertInSwiftType(source, 'AppDelegate', '// VOCIVO_VOIP_DELEGATE_METHODS', methods);
    // Upgrade an already-generated AppDelegate as well as a clean prebuild.
    if (!source.includes('VocivoSipCallManager.shared.pushRegistry(registry, didUpdate:')) {
      source = source.replace(
        'TelnyxVoipPushHandler.shared.handleVoipTokenUpdate(pushCredentials, type: type)',
        'TelnyxVoipPushHandler.shared.handleVoipTokenUpdate(pushCredentials, type: type)\n    VocivoSipCallManager.shared.pushRegistry(registry, didUpdate: pushCredentials, for: type)',
      );
    }
    if (!source.includes('if payload.dictionaryPayload["vocivo"] != nil')) {
      source = source.replace(
        'guard UserDefaults.standard.bool(forKey: "vocivo_voice_signed_in") else {',
        'if payload.dictionaryPayload["vocivo"] != nil {\n      VocivoSipCallManager.shared.pushRegistry(registry, didReceiveIncomingPushWith: payload, for: type, completion: completion)\n      return\n    }\n    guard UserDefaults.standard.bool(forKey: "vocivo_voice_signed_in") else {',
      );
    }
    if (!source.includes('VocivoSipCallManager.shared.pushRegistry(registry, didInvalidatePushTokenFor:')) {
      source = source.replace(
        'UserDefaults.standard.removeObject(forKey: "telnyx_voip_push_token")',
        'UserDefaults.standard.removeObject(forKey: "telnyx_voip_push_token")\n    VocivoSipCallManager.shared.pushRegistry(registry, didInvalidatePushTokenFor: type)',
      );
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

function withProductionAndroidHardening(config) {
  return withDangerousMod(config, ['android', async (appConfig) => {
    const root = appConfig.modRequest.platformProjectRoot;
    const propertiesPath = path.join(root, 'gradle.properties');
    let properties = fs.readFileSync(propertiesPath, 'utf8');
    if (/^android\.enableMinifyInReleaseBuilds=/m.test(properties)) {
      properties = properties.replace(/^android\.enableMinifyInReleaseBuilds=.*$/m, 'android.enableMinifyInReleaseBuilds=true');
    } else {
      properties = `${properties.trimEnd()}\n\n# VOCIVO_RELEASE_HARDENING\nandroid.enableMinifyInReleaseBuilds=true\n`;
    }
    fs.writeFileSync(propertiesPath, properties);

    const rulesPath = path.join(root, 'app', 'proguard-rules.pro');
    let rules = fs.readFileSync(rulesPath, 'utf8');
    if (!rules.includes('# VOCIVO_RELEASE_LOG_STRIPPING')) {
      rules = `${rules.trimEnd()}\n\n# VOCIVO_RELEASE_LOG_STRIPPING\n-assumenosideeffects class android.util.Log {\n    public static *** v(...);\n    public static *** d(...);\n    public static *** i(...);\n    public static *** w(...);\n}\n`;
      fs.writeFileSync(rulesPath, rules);
    }
    return appConfig;
  }]);
}

function withTelnyxMainActivity(config) {
  return withMainActivity(config, (appConfig) => {
    if (appConfig.modResults.language !== 'kt') throw new Error('Vocivo requires a Kotlin MainActivity for Telnyx VoIP integration.');
    let source = appConfig.modResults.contents;
    if (!source.includes('import com.telnyx.react_voice_commons.TelnyxMainActivity')) {
      const packageLine = source.match(/^package .+$/m)?.[0];
      if (!packageLine) throw new Error('Unable to locate the Android application package.');
      source = source.replace(packageLine, `${packageLine}\n\nimport com.telnyx.react_voice_commons.TelnyxMainActivity`);
    }
    if (!/class MainActivity\s*:\s*ReactActivity\(\)/.test(source) && !/class MainActivity\s*:\s*TelnyxMainActivity\(\)/.test(source)) {
      throw new Error('Unable to locate the Android MainActivity superclass.');
    }
    source = source.replace(/class MainActivity\s*:\s*ReactActivity\(\)/, 'class MainActivity : TelnyxMainActivity()');
    appConfig.modResults.contents = source;
    return appConfig;
  });
}

function withTelnyxAndroidComponents(config) {
  config = withAppBuildGradle(config, (appConfig) => {
    if (!appConfig.modResults.contents.includes('com.google.firebase:firebase-messaging')) {
      appConfig.modResults.contents = appConfig.modResults.contents.replace(
        'dependencies {',
        'dependencies {\n    implementation("com.google.firebase:firebase-messaging:23.1.2")'
      );
    }
    return appConfig;
  });
  config = withDangerousMod(config, ['android', async (appConfig) => {
    const packageName = appConfig.android?.package;
    if (!packageName) throw new Error('Vocivo requires an Android package name.');
    const packagePath = packageName.replaceAll('.', path.sep);
    const sourceRoot = path.join(appConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', packagePath);
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, 'AppFirebaseMessagingService.kt'), `package ${packageName}\n\nimport android.content.Context\nimport com.google.firebase.messaging.RemoteMessage\nimport com.telnyx.react_voice_commons.TelnyxFirebaseMessagingService\n\nclass AppFirebaseMessagingService : TelnyxFirebaseMessagingService() {\n    override fun onMessageReceived(remoteMessage: RemoteMessage) {\n        val signedIn = getSharedPreferences("vocivo_auth", Context.MODE_PRIVATE)\n            .getBoolean("voice_signed_in", false)\n        if (!signedIn) return\n        super.onMessageReceived(remoteMessage)\n    }\n\n    override fun handleTokenRefresh(token: String) {\n        super.handleTokenRefresh(token)\n        getSharedPreferences("vocivo_push", Context.MODE_PRIVATE)\n            .edit()\n            .putString("fcm_token", token)\n            .apply()\n    }\n}\n`);
    fs.writeFileSync(path.join(sourceRoot, 'AppNotificationActionReceiver.kt'), `package ${packageName}\n\nimport com.telnyx.react_voice_commons.TelnyxNotificationActionReceiver\n\nclass AppNotificationActionReceiver : TelnyxNotificationActionReceiver()\n`);
    return appConfig;
  }]);
  return withAndroidManifest(config, (appConfig) => {
    const manifest = appConfig.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) throw new Error('Unable to locate the Android application manifest.');
    application.$ = application.$ || {};
    application.$['android:allowBackup'] = 'false';
    application.$['android:fullBackupContent'] = 'false';
    application.$['android:usesCleartextTraffic'] = 'false';
    application.service = application.service || [];
    if (!application.service.some((entry) => entry.$?.['android:name'] === '.AppFirebaseMessagingService')) {
      application.service.push({
        $: {
          'android:name': '.AppFirebaseMessagingService',
          'android:enabled': 'true',
          'android:exported': 'false',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
      });
    }
    application.receiver = application.receiver || [];
    if (!application.receiver.some((entry) => entry.$?.['android:name'] === '.AppNotificationActionReceiver')) {
      application.receiver.push({
        $: {
          'android:name': '.AppNotificationActionReceiver',
          'android:enabled': 'true',
          'android:exported': 'false',
        },
      });
    }
    return appConfig;
  });
}

module.exports = function withTelnyxVoip(config) {
  config = withTelnyxAppDelegate(config);
  config = withIosRingtones(config);
  config = withTelnyxMainActivity(config);
  config = withTelnyxAndroidComponents(config);
  config = withProductionAndroidHardening(config);
  config = withAndroidRingtones(config);
  return config;
};
