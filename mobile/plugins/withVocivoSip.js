const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withMainApplication,
  withXcodeProject,
} = require('expo/config-plugins');

/**
 * Links Vocivo's own call handling into the native projects.
 *
 * Vocivo speaks SIP to its own Kamailio from JavaScript, so this plugin is not
 * installing a SIP stack. What it installs is the part JavaScript cannot do:
 * CallKit and PushKit on iOS, a self-managed ConnectionService on Android, and
 * in both cases the ability to put an incoming call on screen before the
 * JavaScript runtime exists — which is the whole reason a killed app can ring.
 *
 * The native sources live in `native/` and are copied in verbatim, so they can
 * be read and reviewed as ordinary Swift and Kotlin rather than as strings
 * inside a plugin.
 */

const IOS_SOURCES = ['VocivoSipCallManager.swift', 'VocivoSip.swift', 'VocivoSip.m'];
const ANDROID_SOURCES = [
  'VocivoSipCallRegistry.kt',
  'VocivoConnection.kt',
  'VocivoConnectionService.kt',
  'VocivoSipIncomingCall.kt',
  'VocivoSipModule.kt',
  'VocivoSipPackage.kt',
];
const ANDROID_PACKAGE = 'app.vocivo.sip';

function nativeDir(projectRoot, platform) {
  return path.join(projectRoot, 'native', platform);
}

// MARK: - iOS

function withVocivoSipIosSources(config) {
  config = withDangerousMod(config, ['ios', async (appConfig) => {
    const { projectRoot, platformProjectRoot } = appConfig.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const destination = path.join(platformProjectRoot, projectName);
    fs.mkdirSync(destination, { recursive: true });
    IOS_SOURCES.forEach((name) => {
      fs.copyFileSync(path.join(nativeDir(projectRoot, 'ios'), name), path.join(destination, name));
    });
    return appConfig;
  }]);

  return withXcodeProject(config, (projectConfig) => {
    const { projectRoot } = projectConfig.modRequest;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    IOS_SOURCES.forEach((name) => {
      const relativePath = path.join(projectName, name);
      if (projectConfig.modResults.hasFile(relativePath)) return;
      projectConfig.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativePath,
        groupName: projectName,
        project: projectConfig.modResults,
        verbose: false,
      });
    });
    return projectConfig;
  });
}

function withVocivoSipInfoPlist(config) {
  return withInfoPlist(config, (appConfig) => {
    const modes = new Set(appConfig.modResults.UIBackgroundModes || []);
    // `voip` is what lets PushKit deliver at all; `audio` keeps the call alive
    // once the user puts the phone in a pocket and opens something else.
    modes.add('voip');
    modes.add('audio');
    modes.add('remote-notification');
    appConfig.modResults.UIBackgroundModes = [...modes];
    return appConfig;
  });
}

function withVocivoSipAppDelegate(config) {
  return withAppDelegate(config, (appConfig) => {
    if (appConfig.modResults.language !== 'swift') {
      throw new Error('Vocivo requires a Swift AppDelegate for its CallKit integration.');
    }
    let source = appConfig.modResults.contents;
    if (source.includes('// VOCIVO_SIP_BOOTSTRAP')) {
      appConfig.modResults.contents = source;
      return appConfig;
    }
    const returnPattern = /return\s+super\.application\(application,\s*didFinishLaunchingWithOptions:\s*launchOptions\)/;
    if (!returnPattern.test(source)) {
      throw new Error('Unable to locate the AppDelegate launch return statement.');
    }
    // Registering the PushKit registry at launch is not optional: iOS only
    // delivers VoIP pushes to an app that asked for them before the push
    // arrived, and a launch caused by a push is exactly when that matters.
    source = source.replace(returnPattern, [
      '// VOCIVO_SIP_BOOTSTRAP',
      '    VocivoSipCallManager.shared.start()',
      '',
      '    return super.application(application, didFinishLaunchingWithOptions: launchOptions)',
    ].join('\n'));
    appConfig.modResults.contents = source;
    return appConfig;
  });
}

// MARK: - Android

function androidSourceRoot(appConfig, packageName) {
  return path.join(
    appConfig.modRequest.platformProjectRoot,
    'app', 'src', 'main', 'java',
    ...packageName.split('.'),
  );
}

function withVocivoSipAndroidSources(config) {
  return withDangerousMod(config, ['android', async (appConfig) => {
    const { projectRoot } = appConfig.modRequest;
    const destination = androidSourceRoot(appConfig, ANDROID_PACKAGE);
    fs.mkdirSync(destination, { recursive: true });
    ANDROID_SOURCES.forEach((name) => {
      fs.copyFileSync(path.join(nativeDir(projectRoot, 'android'), name), path.join(destination, name));
    });

    return appConfig;
  }]);
}

/**
 * Android delivers a data message to exactly one `FirebaseMessagingService`.
 * Until the SIP edge is the only path in production, Vocivo has to share that
 * one service with the carrier SDK, so this rewrites the service the Telnyx
 * plugin generates to try Vocivo's own handling first.
 *
 * It runs as a manifest mod rather than a dangerous mod on purpose: dangerous
 * mods are applied before the typed ones, so writing this file from a dangerous
 * mod let the Telnyx plugin's copy win and the Vocivo branch never appeared in
 * the generated project at all.
 */
function withVocivoSipMessagingService(config) {
  return withAndroidManifest(config, (appConfig) => {
    const appPackage = appConfig.android?.package;
    if (!appPackage) throw new Error('Vocivo requires an Android package name.');
    const appRoot = androidSourceRoot(appConfig, appPackage);
    fs.mkdirSync(appRoot, { recursive: true });
    fs.writeFileSync(path.join(appRoot, 'AppFirebaseMessagingService.kt'), [
      `package ${appPackage}`,
      '',
      'import android.content.Context',
      'import app.vocivo.sip.VocivoSipIncomingCall',
      'import com.google.firebase.messaging.RemoteMessage',
      'import com.telnyx.react_voice_commons.TelnyxFirebaseMessagingService',
      '',
      '/**',
      ' * One FCM entry point for two voice paths.',
      ' *',
      ' * A Vocivo call is handled by Vocivo. Anything else falls through to the',
      ' * carrier SDK, which still serves builds that have not moved to the SIP',
      ' * edge yet.',
      ' */',
      'class AppFirebaseMessagingService : TelnyxFirebaseMessagingService() {',
      '    override fun onMessageReceived(remoteMessage: RemoteMessage) {',
      '        if (VocivoSipIncomingCall.handle(applicationContext, remoteMessage.data)) return',
      '        val signedIn = getSharedPreferences("vocivo_auth", Context.MODE_PRIVATE)',
      '            .getBoolean("voice_signed_in", false)',
      '        if (!signedIn) return',
      '        super.onMessageReceived(remoteMessage)',
      '    }',
      '',
      '    override fun handleTokenRefresh(token: String) {',
      '        super.handleTokenRefresh(token)',
      '        getSharedPreferences("vocivo_push", Context.MODE_PRIVATE)',
      '            .edit()',
      '            .putString("fcm_token", token)',
      '            .apply()',
      '    }',
      '}',
      '',
    ].join('\n'));
    return appConfig;
  });
}

function withVocivoSipMainApplication(config) {
  return withMainApplication(config, (appConfig) => {
    if (appConfig.modResults.language !== 'kt') {
      throw new Error('Vocivo requires a Kotlin MainApplication.');
    }
    let source = appConfig.modResults.contents;
    if (!source.includes('import app.vocivo.sip.VocivoSipPackage')) {
      const packageLine = source.match(/^package .+$/m)?.[0];
      if (!packageLine) throw new Error('Unable to locate the Android application package.');
      source = source.replace(packageLine, `${packageLine}\n\nimport app.vocivo.sip.VocivoSipPackage`);
    }
    if (!source.includes('VocivoSipPackage()')) {
      // Expo's template builds the list then lets the app append to it; this is
      // the one line every RN template has in common.
      const anchor = /(add\(MyReactNativePackage\(\)\)|\/\/ packages\.add\(MyReactNativePackage\(\)\))/;
      if (anchor.test(source)) {
        source = source.replace(anchor, (match) => `${match}\n              add(VocivoSipPackage())`);
      } else {
        const listPattern = /(val packages = PackageList\(this\)\.packages)/;
        if (!listPattern.test(source)) {
          throw new Error('Unable to locate the React Native package list in MainApplication.');
        }
        source = source.replace(listPattern, '$1\n              packages.add(VocivoSipPackage())');
      }
    }
    appConfig.modResults.contents = source;
    return appConfig;
  });
}

function withVocivoSipManifest(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    // Lets Vocivo register a self-managed calling account, which is what puts
    // an incoming call on the system call screen instead of in a notification.
    'android.permission.MANAGE_OWN_CALLS',
  ]);

  return withAndroidManifest(config, (appConfig) => {
    const application = appConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error('Unable to locate the Android application manifest.');
    application.service = application.service || [];
    const name = `${ANDROID_PACKAGE}.VocivoConnectionService`;
    if (!application.service.some((entry) => entry.$?.['android:name'] === name)) {
      application.service.push({
        $: {
          'android:name': name,
          'android:exported': 'true',
          // Only the telecom stack may bind it, and only it needs to.
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] }],
      });
    }
    return appConfig;
  });
}

module.exports = function withVocivoSip(config) {
  config = withVocivoSipIosSources(config);
  config = withVocivoSipInfoPlist(config);
  config = withVocivoSipAppDelegate(config);
  config = withVocivoSipAndroidSources(config);
  config = withVocivoSipMainApplication(config);
  config = withVocivoSipMessagingService(config);
  config = withVocivoSipManifest(config);
  return config;
};
