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
  assert.throws(() => liveupdateDir({ cargo: join(dir, 'no-such-cargo') }), /cargo metadata failed/);
});

const OWN = 'android/src/main/java/io/github/eedaegon/liveactivity';
const own = file => readFileSync(join(root, OWN, file), 'utf8');

// TP-ANDROID-11
test('the plugin has no Kotlin lifecycle, renderer, receivers or validator for layouts', () => {
  const files = readdirSync(join(root, OWN)).sort();
  assert.deepEqual(files, ['Input.kt', 'LiveActivityPlugin.kt', 'Models.kt', 'Openings.kt', 'PermissionPolicy.kt']);
  const plugin = own('LiveActivityPlugin.kt');
  const commands = [...plugin.matchAll(/@Command\s+(?:override )?fun (\w+)/g)].map(([, name]) => name).sort();
  assert.deepEqual(commands, ['checkPermissions', 'imageDirectory', 'liveUpdate', 'registerEvents', 'requestPermissions']);
  assert.match(plugin, /LiveUpdateBridge\.invoke\(activity, args\.getString\("command"\), args\.getString\("payload"\)\)/);
  // The plugin's one component of its own is the provider that watches for the intents which open the app
  // (TP-ANDROID-16). It hands them to liveupdate and does nothing else: it posts nothing and stores nothing.
  const manifest = readFileSync(join(root, 'android/src/main/AndroidManifest.xml'), 'utf8');
  const components = [...manifest.matchAll(/android:name="(io\.github\.eedaegon\.liveactivity\.[\w.]+)"/g)].map(([, name]) => name);
  assert.deepEqual(components, ['io.github.eedaegon.liveactivity.OpeningsProvider']);
  const openings = own('Openings.kt');
  assert.match(openings, /LiveUpdateEvents\.opened\(activity, /);
  assert.doesNotMatch(openings, /Notification|SharedPreferences|BroadcastReceiver|LiveUpdateBridge/);
  // Rust calls no command that the Kotlin side lacks.
  const rust = readFileSync(join(root, 'src/android.rs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const called = [...rust.matchAll(/\b(?:run_mobile_plugin\(|call(?:::<[^>]+>)?\(\s*&[\w.]+,)\s*"(\w+)"/g)].map(([, name]) => name);
  assert.deepEqual([...new Set(called)].sort(), commands);
  // The image folder is named on both sides: Rust takes the app's files from two folders above the one Kotlin answers.
  const folder = rust.match(/const IMAGE_FOLDER: &str = "([^"]+)";/)[1];
  assert.equal(plugin.match(/const val IMAGE_FOLDER = "([^"]+)"/)[1], folder);
  assert.equal(folder.split('/').length, 2);
  assert.match(rust, /\.ancestors\(\)\s*\.nth\(2\)/);
  // R8 keeps what Tauri and Jackson reach by reflection: the plugin and the argument classes of its commands.
  const kept = [...readFileSync(join(root, 'android/consumer-rules.pro'), 'utf8')
    .matchAll(/^-keep class io\.github\.eedaegon\.liveactivity\.(\w+) \{ \*; \}$/gm)].map(([, name]) => name).sort();
  const reflected = [...files.map(own).join('\n').matchAll(/@(?:TauriPlugin|InvokeArg)(?:\([^\n]*\))?\s+class (\w+)/g)]
    .map(([, name]) => name).sort();
  assert.deepEqual(kept, reflected);
});

// TP-ANDROID-13
test("the plugin's permissions read the notification settings through liveupdate's adapter alone", () => {
  const plugin = own('LiveActivityPlugin.kt');
  assert.match(plugin, /LiveUpdateBridge\.invoke\(activity, "capabilities", "\{\}"\)/);
  // No reading of the settings or of liveupdate's channel of the plugin's own, which could differ from the adapter's.
  for (const file of readdirSync(join(root, OWN))) {
    assert.doesNotMatch(own(file), /NotificationManager|CHANNEL_ID|areNotificationsEnabled|canPostPromotedNotifications/, file);
  }
});
