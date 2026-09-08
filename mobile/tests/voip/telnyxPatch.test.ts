import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

test('installed Telnyx patch parses in both source and runtime and preserves locked-device credential access', () => {
  for (const file of ['src/telnyx-voip-client.ts', 'lib/telnyx-voip-client.js']) {
    const filename = `node_modules/@telnyx/react-voice-commons-sdk/${file}`;
    const source = readFileSync(filename, 'utf8');
    const result = ts.transpileModule(source, { fileName: filename, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    assert.deepEqual((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error).map(item => ts.flattenDiagnosticMessageText(item.messageText, ' ')), [], file);
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    let writes = 0;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 'SecureStore.setItemAsync') {
        writes++;
        assert.equal(node.arguments.length, 3);
        const options = node.arguments[2];
        assert.ok(options);
        assert.match(options.getText(ast), /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(writes, 2);
  }
});
