const fs = require('fs');
const path = require('path');
const { IOSConfig, withAndroidManifest, withAppBuildGradle, withAppDelegate, withDangerousMod, withMainActivity, withXcodeProject } = require('expo/config-plugins');

const ringtoneNames = ['vocivo_classic', 'vocivo_chime', 'vocivo_pulse', 'vocivo_wave', 'vocivo_signal', 'vocivo_softbell'];

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
            let storedRingtone = UserDefaults.standard.string(forKey: "vocivo_incoming_ringtone")
            if storedRingtone == resourceName {
                if callKitProvider == nil { _ = installCallKitProvider() }
                return
            }
            if let resourceName, !resourceName.isEmpty {
                UserDefaults.standard.set(resourceName, forKey: "vocivo_incoming_ringtone")
            } else {
                UserDefaults.standard.removeObject(forKey: "vocivo_incoming_ringtone")
            }
            UserDefaults.standard.synchronize()
            guard Array(activeCalls.values).isEmpty else { return }
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
  if (!bridge.includes('func setVocivoVoiceSignedIn')) {
    bridge = bridge.replace(
      '    @objc\n    func setIncomingCallRingtone',
      `    @objc
    func setVocivoVoiceSignedIn(_ signedIn: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        UserDefaults.standard.set(signedIn, forKey: "vocivo_voice_signed_in")
        if !signedIn {
            UserDefaults.standard.removeObject(forKey: "pending_voip_push")
            UserDefaults.standard.removeObject(forKey: "pending_voip_action")
        }
        UserDefaults.standard.synchronize()
        resolve(true)
    }

    @objc
    func setIncomingCallRingtone`
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
  if (!extern.includes('setVocivoVoiceSignedIn')) {
    extern = extern.replace(
      'RCT_EXTERN_METHOD(setIncomingCallRingtone:',
      `RCT_EXTERN_METHOD(setVocivoVoiceSignedIn:(BOOL)signedIn
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(setIncomingCallRingtone:`
    );
  }
  fs.writeFileSync(externPath, extern);
}

function patchTelnyxAndroidSdk(projectRoot) {
  const sdkSourceRoot = path.join(projectRoot, 'node_modules', '@telnyx', 'react-voice-commons-sdk', 'android', 'src', 'main', 'java', 'com', 'telnyx', 'react_voice_commons');
  const bridgePath = path.join(sdkSourceRoot, 'VoicePnBridgeModule.kt');
  const activityPath = path.join(sdkSourceRoot, 'TelnyxMainActivity.kt');
  if (![bridgePath, activityPath].every(fs.existsSync)) throw new Error('Unable to locate the Telnyx Android SDK sources.');

  let activity = fs.readFileSync(activityPath, 'utf8');
  activity = activity.replace('override fun onNewIntent(intent: Intent?)', 'override fun onNewIntent(intent: Intent)');
  fs.writeFileSync(activityPath, activity);

  let bridge = fs.readFileSync(bridgePath, 'utf8');
  if (!bridge.includes('com.google.firebase.messaging.FirebaseMessaging')) {
    bridge = bridge.replace('import android.content.Context', 'import android.content.Context\nimport com.google.firebase.messaging.FirebaseMessaging');
  }
  if (!bridge.includes('fun setVocivoVoiceSignedIn')) {
    bridge = bridge.replace(
      '    @ReactMethod\n    fun setIncomingCallRingtone',
      `    @ReactMethod
    fun setVocivoVoiceSignedIn(signedIn: Boolean, promise: Promise) {
        try {
            reactApplicationContext
                .getSharedPreferences("vocivo_auth", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("voice_signed_in", signedIn)
                .apply()
            if (!signedIn) {
                VoicePnManager.clearPendingPushAction(reactApplicationContext)
                VoicePnManager.clearPendingCallAction(reactApplicationContext)
                TelnyxNotificationHelper.hideNotificationFromContext(reactApplicationContext)
                TelnyxNotificationHelper.hideOngoingCallNotificationFromContext(reactApplicationContext)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_VOCIVO_SIGNED_IN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setIncomingCallRingtone`
    );
  }
  if (!bridge.includes('fun getFirebaseToken')) {
    bridge = bridge.replace(
      '    @ReactMethod\n    fun setVocivoVoiceSignedIn',
      `    @ReactMethod
    fun getFirebaseToken(promise: Promise) {
        val preferences = reactApplicationContext.getSharedPreferences("vocivo_push", Context.MODE_PRIVATE)
        val stored = preferences.getString("fcm_token", null)
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                if (!stored.isNullOrBlank()) promise.resolve(stored)
                else promise.reject("GET_FCM_TOKEN_ERROR", task.exception?.message, task.exception)
                return@addOnCompleteListener
            }
            val token = task.result
            preferences.edit().putString("fcm_token", token).apply()
            promise.resolve(token)
        }
    }

    @ReactMethod
    fun setVocivoVoiceSignedIn`
    );
  }
  fs.writeFileSync(bridgePath, bridge);
}

function withTelnyxAppDelegate(config) {
  return withAppDelegate(config, (appConfig) => {
    if (appConfig.modResults.language !== 'swift') throw new Error('Vocivo requires a Swift AppDelegate for Telnyx VoIP integration.');
    let source = appConfig.modResults.contents;
    source = insertOnce(source, 'import Expo\n', 'import PushKit\nimport TelnyxVoiceCommons\n');
    source = source.replace('public class AppDelegate: ExpoAppDelegate {', 'public class AppDelegate: ExpoAppDelegate, PKPushRegistryDelegate {');
    if (!source.includes('private var vocivoVoipRegistry')) {
      source = source.replace('  var window: UIWindow?\n', '  var window: UIWindow?\n  private var vocivoVoipRegistry: PKPushRegistry?\n');
    }
    const pushRegistration = `vocivoVoipRegistry = PKPushRegistry(queue: DispatchQueue.main)
    vocivoVoipRegistry?.delegate = self
    vocivoVoipRegistry?.desiredPushTypes = [.voIP]`;
    if (source.includes('TelnyxVoipPushHandler.initializeVoipRegistration()')) {
      source = source.replace('TelnyxVoipPushHandler.initializeVoipRegistration()', pushRegistration);
    } else if (!source.includes('vocivoVoipRegistry = PKPushRegistry')) {
      source = source.replace(/return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/, `${pushRegistration}\n\n    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`);
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
    guard UserDefaults.standard.bool(forKey: "vocivo_voice_signed_in") else {
      completion()
      return
    }
    TelnyxVoipPushHandler.shared.handleVoipPush(payload, type: type, completion: completion)
  }

`;
      const nextClass = source.indexOf('\n}\n\nclass ReactNativeDelegate');
      if (nextClass === -1) throw new Error('Unable to locate the iOS AppDelegate class ending.');
      source = `${source.slice(0, nextClass)}${methods}${source.slice(nextClass)}`;
    }
    if (!source.includes('didInvalidatePushTokenFor type: PKPushType')) {
      const invalidationMethod = `

  public func pushRegistry(
    _ registry: PKPushRegistry,
    didInvalidatePushTokenFor type: PKPushType
  ) {
    UserDefaults.standard.removeObject(forKey: "voip_push_token")
    UserDefaults.standard.removeObject(forKey: "telnyx_voip_push_token")
  }
`;
      const nextClass = source.indexOf('\n}\n\nclass ReactNativeDelegate');
      if (nextClass === -1) throw new Error('Unable to locate the iOS AppDelegate class ending.');
      source = `${source.slice(0, nextClass)}${invalidationMethod}${source.slice(nextClass)}`;
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
  config = withDangerousMod(config, ['ios', async (appConfig) => { patchTelnyxIosSdk(appConfig.modRequest.projectRoot); return appConfig; }]);
  config = withDangerousMod(config, ['android', async (appConfig) => { patchTelnyxAndroidSdk(appConfig.modRequest.projectRoot); return appConfig; }]);
  config = withTelnyxMainActivity(config);
  config = withTelnyxAndroidComponents(config);
  config = withAndroidRingtones(config);
  return config;
};
