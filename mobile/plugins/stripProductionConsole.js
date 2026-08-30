module.exports = function stripProductionConsole({ types: t }) {
  return {
    name: 'vocivo-strip-production-console',
    visitor: {
      CallExpression(path, state) {
        if (state.file.opts.envName !== 'production') return;
        const callee = path.node.callee;
        if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object, { name: 'console' })) return;
        if (!t.isIdentifier(callee.property) || !['log', 'debug', 'info', 'warn', 'trace'].includes(callee.property.name)) return;
        path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
      },
    },
  };
};
