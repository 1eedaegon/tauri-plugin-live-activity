// The plugin's Android library is liveupdate's adapter plus the plugin's permissions and event channel.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adapt, copiedFiles, differing, liveupdateDir, missingManifestEntries } from '../tools/sync-liveupdate.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

// TP-ANDROID-11
test("the Android library carries liveupdate's Kotlin, resources and manifest entries, its R renamed", () => {
  const dir = liveupdateDir();
  assert.match(readFileSync(join(dir, 'Cargo.toml'), 'utf8'), /^name = "liveupdate"$/m);
  const files = copiedFiles(dir);
  for (const file of ['LiveUpdateBridge.kt', 'LiveUpdateEvents.kt', 'LiveUpdateReceivers.kt', 'NotificationRenderer.kt']) {
    assert.ok(files.includes(`android/src/main/java/io/github/eedaegon/liveupdate/${file}`), file);
  }
  assert.ok(files.includes('android/src/main/res/drawable/liveupdate_status.xml'));
  assert.deepEqual(differing(dir), []);
  assert.deepEqual(missingManifestEntries(dir), []);
  // The one change of the copy: liveupdate's `R` becomes the plugin's.
  const renderer = readFileSync(join(root, 'android/src/main/java/io/github/eedaegon/liveupdate/NotificationRenderer.kt'), 'utf8');
  assert.match(renderer, /io\.github\.eedaegon\.liveactivity\.R\.drawable\.liveupdate_status/);
  assert.doesNotMatch(renderer, /[^.]R\.drawable\./);
  assert.equal(adapt('a R.drawable.x b'), 'a io.github.eedaegon.liveactivity.R.drawable.x b');
  // The plugin reads liveupdate's channel for its permissions.
  const plugin = readFileSync(join(root, 'android/src/main/java/io/github/eedaegon/liveactivity/AndroidNotifications.kt'), 'utf8');
  const adapter = readFileSync(join(dir, 'android/src/main/java/io/github/eedaegon/liveupdate/AndroidAdapter.kt'), 'utf8');
  const channel = adapter.match(/CHANNEL_ID = "([^"]+)"/)[1];
  assert.match(plugin, new RegExp(`CHANNEL_ID = "${channel.replaceAll('.', '\\.')}"`));
  assert.throws(() => liveupdateDir({ cargo: join(dir, 'no-such-cargo') }), /cargo metadata failed/);
});

// TP-ANDROID-11
test('the plugin has no Kotlin lifecycle, renderer, receivers or validator for layouts', () => {
  const own = readdirSync(join(root, 'android/src/main/java/io/github/eedaegon/liveactivity')).sort();
  assert.deepEqual(own, ['AndroidNotifications.kt', 'Input.kt', 'LiveActivityPlugin.kt', 'Models.kt', 'PermissionPolicy.kt']);
  const plugin = readFileSync(join(root, 'android/src/main/java/io/github/eedaegon/liveactivity/LiveActivityPlugin.kt'), 'utf8');
  const commands = [...plugin.matchAll(/@Command\s+(?:override )?fun (\w+)/g)].map(([, name]) => name).sort();
  assert.deepEqual(commands, ['checkPermissions', 'imageDirectory', 'liveUpdate', 'registerEvents', 'requestPermissions']);
  assert.match(plugin, /LiveUpdateBridge\.invoke\(activity, args\.getString\("command"\), args\.getString\("payload"\)\)/);
  const manifest = readFileSync(join(root, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.doesNotMatch(manifest, /io\.github\.eedaegon\.liveactivity\./);
});
