const { withXcodeProject } = require('expo/config-plugins');

/**
 * Lets the app build from a directory whose path contains a space.
 *
 * The "Bundle React Native code and images" phase ends by running the output
 * of a command substitution, unquoted:
 *
 *     `"$NODE_BINARY" --print "…react-native/scripts/react-native-xcode.sh"`
 *
 * The substitution yields the script's absolute path, and the shell then word
 * splits it before executing — so a checkout under "CLAUDE APPS PROJECTS"
 * became the command /Users/…/Desktop/CLAUDE with APPS and PROJECTS/… as its
 * arguments, and the build stopped with "No such file or directory". The same
 * fault, with the same cause, as the one patched in expo-constants.
 *
 * The path goes into a variable and is quoted where it is used. ios/ is
 * generated rather than committed, so this runs at prebuild to survive one.
 */

const marker = '# Vocivo: quoted so a path with a space still runs';
const original = /`"\$NODE_BINARY" --print "require\('path'\)\.dirname\(require\.resolve\('react-native\/package\.json'\)\) \+ '\/scripts\/react-native-xcode\.sh'"`/;
const replacement = [
  marker,
  `REACT_NATIVE_XCODE="$("$NODE_BINARY" --print "require('path').dirname(require.resolve('react-native/package.json')) + '/scripts/react-native-xcode.sh'")"`,
  '/bin/sh "$REACT_NATIVE_XCODE"',
].join('\n');

module.exports = function withQuotedBundlePath(config) {
  return withXcodeProject(config, (appConfig) => {
    const project = appConfig.modResults;
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase || {};
    for (const phase of Object.values(phases)) {
      if (!phase || typeof phase !== 'object' || typeof phase.shellScript !== 'string') continue;
      if (phase.shellScript.includes(marker)) continue;
      // The script is stored as one escaped string; unescape, edit, re-escape.
      const script = JSON.parse(phase.shellScript);
      if (!original.test(script)) continue;
      phase.shellScript = JSON.stringify(script.replace(original, replacement));
    }
    return appConfig;
  });
};
