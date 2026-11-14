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
  assert.deepEqual(commands, ['checkPermissions', 'filesDirectory', 'liveUpdate', 'registerEvents', 'requestPermissions']);
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
  // Rust alone names the plugin's files under the app's files: the Kotlin side answers the folder of the app's
  // files and names nothing below it, and Rust hands liveactivity what `src/files.rs` makes of that answer. The
  // unit test there holds the names.
  assert.match(plugin, /put\("path", activity\.applicationContext\.filesDir\.absolutePath\)/);
  for (const file of files) assert.doesNotMatch(own(file), /tauri-live-activity/, file);
  assert.match(rust, /let directory: FilesDirectory = call\(&handle, "filesDirectory",/);
  assert.match(rust, /\.with_files\(directory\.for_app\(/);
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

// TP-ANDROID-17
test("the library carries liveupdate's alarm and its start receiver, and leaves the exact time and the restart to the app", () => {
  assert.ok(copiedFiles(liveupdateDir()).includes('android/src/main/java/io/github/eedaegon/liveupdate/ScheduledStarts.kt'));
  const manifest = readFileSync(join(root, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifest, /<receiver android:name="io\.github\.eedaegon\.liveupdate\.LiveUpdateStartReceiver" android:exported="false" \/>/);
  // The permission for exact alarms and the receiver's declaration for a restart of the device are the app's.
  assert.doesNotMatch(manifest, /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|BOOT_COMPLETED/);
  // A page reads from the capabilities whether a start can be scheduled, and whether it begins at its time.
  const types = readFileSync(join(root, 'guest-js/types.ts'), 'utf8');
  for (const member of ['scheduledStart', 'exactStart']) assert.match(types, new RegExp(`readonly ${member}: boolean;`));
});
