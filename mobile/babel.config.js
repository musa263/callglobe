module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [require.resolve('./plugins/stripProductionConsole')],
    // Jest is CommonJS; retain lazy imports in the shipped Metro bundle.
    env: { test: { plugins: ['@babel/plugin-transform-dynamic-import'] } },
  };
};
