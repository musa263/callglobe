import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plugin = require('../../../../plugins/withTelnyxVoip.js');
const fixture = `import Expo
public class AppDelegate: ExpoAppDelegate {
  public override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test('native prebuild generates one PushKit registry and dispatches SIP pushes before Telnyx handling', async () => {
  const config = plugin({ name: 'Vocivo', slug: 'vocivo', ios: {}, android: { package: 'app.vocivo.mobile' } });
  const run = async (contents: string) => (await config.mods.ios.appDelegate({
    ...config,
    modRequest: { platform: 'ios', modName: 'appDelegate', projectRoot: process.cwd() },
    modResults: { language: 'swift', contents },
  })).modResults.contents as string;
  const generated = await run(fixture);
  assert.equal(await run(generated), generated, 'repeated prebuild must not duplicate native handlers');
  assert.equal(generated.match(/PKPushRegistry\(queue:/g)?.length, 1);
  const dispatch = generated.indexOf('VocivoSipCallManager.shared.pushRegistry(registry, didReceiveIncomingPushWith:');
  assert.ok(dispatch > 0 && dispatch < generated.indexOf('TelnyxVoipPushHandler.shared.handleVoipPush('));
  assert.match(generated, /VocivoSipCallManager.shared.pushRegistry\(registry, didUpdate:/);
  assert.match(generated, /VocivoSipCallManager.shared.pushRegistry\(registry, didInvalidatePushTokenFor:/);
});
