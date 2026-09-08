const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, '../../node_modules')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/(?:AuthContext|VoiceContext|BusinessContext|MessagingContext|shared\/api|contactDirectory|expo-contacts)$/.test(moduleName)) {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'fixtures.tsx') };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
