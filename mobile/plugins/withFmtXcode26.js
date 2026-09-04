const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Lets the iOS project compile with Xcode 26.
 *
 * React Native 0.81 pins the {fmt} library at 11.0.2, and the clang that ships
 * with Xcode 26 refuses its compile-time format-string checks ("call to
 * consteval function ... is not a constant expression" in format-inl.h, five
 * times, and the build stops). The library provides the switch for exactly
 * this: FMT_USE_CONSTEVAL=0 turns those checks into runtime ones, which is
 * what every compiler without consteval support already gets. Set on every pod
 * so the library and everything that includes it agree on the type.
 *
 * One catch, found the hard way: 11.0.2's base.h does not check whether the
 * switch was already given before deciding it for itself, so the value from
 * the command line was simply overwritten and the errors stayed. The header is
 * given that check at pod install — a two-line edit that later versions of the
 * library already carry.
 *
 * Applied at prebuild, so EAS and a local `expo run:ios` get it alike; it goes
 * the day React Native moves to a {fmt} that Xcode 26 accepts.
 */

const marker = '# Vocivo: {fmt} under Xcode 26';
const snippet = `
    ${marker}
    fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(fmt_base) && !File.read(fmt_base).include?('Vocivo: honour')
      File.chmod(0644, fmt_base)
      File.write(fmt_base, File.read(fmt_base).sub(
        "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\\n#if !defined(__cpp_lib_is_constant_evaluated)",
        "// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\\n#if defined(FMT_USE_CONSTEVAL)\\n// Vocivo: honour a value given on the command line (FMT_USE_CONSTEVAL=0 for Xcode 26).\\n#elif !defined(__cpp_lib_is_constant_evaluated)"))
    end
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'FMT_USE_CONSTEVAL=0'
      end
    end
`;

module.exports = function withFmtXcode26(config) {
  return withDangerousMod(config, ['ios', async (appConfig) => {
    const podfile = path.join(appConfig.modRequest.platformProjectRoot, 'Podfile');
    if (!fs.existsSync(podfile)) return appConfig;
    const contents = fs.readFileSync(podfile, 'utf8');
    if (contents.includes(marker)) return appConfig;
    const anchor = 'post_install do |installer|';
    if (!contents.includes(anchor)) throw new Error('withFmtXcode26: the Podfile has no post_install block to extend.');
    fs.writeFileSync(podfile, contents.replace(anchor, `${anchor}${snippet}`));
    return appConfig;
  }]);
};
