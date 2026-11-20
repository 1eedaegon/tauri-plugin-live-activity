// The plugin's Android library is liveupdate's adapter plus the plugin's permissions and event channel.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { crateDir } from '../tools/cargo.ts';
import { adapt, copiedFiles, differing, liveupdateDir, missingManifestEntries } from '../tools/sync-liveupdate.ts';
import { present } from './support.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

// TP-ANDROID-11, TP-ANDROID-23
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
  assert.throws(() => crateDir('no-such-crate'), /^Error: no-such-crate is not a dependency of this crate$/);
});

// TP-ANDROID-11
test("a permission or a receiver of liveupdate's manifest that the plugin's lacks is named, a receiver by its class", t => {
  const later = mkdtempSync(join(tmpdir(), 'la-liveupdate-'));
  t.after(() => rmSync(later, { recursive: true, force: true }));
  const manifest = 'android/src/main/AndroidManifest.xml';
  const theirs = readFileSync(join(liveupdateDir(), manifest), 'utf8');
  const more = '    <uses-permission android:name="android.permission.NEW_IN_LIVEUPDATE" />\n'
    + '    <receiver android:name=".NewReceiver" android:exported="false" />\n'
    + '    <receiver android:name="com.example.Named" android:exported="false" />\n';
  mkdirSync(dirname(join(later, manifest)), { recursive: true });
  writeFileSync(join(later, manifest), theirs.replace('</manifest>', `${more}</manifest>`));
  assert.deepEqual(missingManifestEntries(later), [
    'permission android.permission.NEW_IN_LIVEUPDATE',
    'receiver io.github.eedaegon.liveupdate.NewReceiver',
    'receiver com.example.Named',
  ]);
});

const OWN = 'android/src/main/java/io/github/eedaegon/liveactivity';
const own = (file: string): string => readFileSync(join(root, OWN, file), 'utf8');

// TP-ANDROID-11
test('the plugin has no Kotlin lifecycle, renderer, receivers or validator for layouts', () => {
  const files = readdirSync(join(root, OWN)).sort();
  assert.deepEqual(files, ['Input.kt', 'LiveActivityPlugin.kt', 'Models.kt', 'Openings.kt', 'PermissionPolicy.kt']);
  const plugin = own('LiveActivityPlugin.kt');
  const commands = [...plugin.matchAll(/@Command\s+(?:override )?fun (\w+)/g)].map(([, name]) => name).sort();
  assert.deepEqual(commands, ['checkPermissions', 'filesDirectory', 'liveUpdate', 'openExactAlarmSettings', 'registerEvents', 'requestPermissions']);
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
  const called = [...rust.matchAll(/\b(?:run_mobile_plugin\(|call(?:_waiting)?(?:::<[^>]+>)?\(\s*&[\w.]+,)\s*"(\w+)"/g)].map(([, name]) => name);
  assert.deepEqual([...new Set(called)].sort(), commands);
  // Rust alone names the plugin's files under the app's files: the Kotlin side answers the folder of the app's
  // files and names nothing below it, and Rust hands liveactivity what `src/files.rs` makes of that answer. The
  // unit test there holds the names.
  assert.match(plugin, /put\("path", activity\.applicationContext\.filesDir\.absolutePath\)/);
  for (const file of files) assert.doesNotMatch(own(file), /tauri-live-activity/, file);
  assert.match(rust, /let directory: FilesDirectory = call\(&handle, "filesDirectory",/);
  assert.match(rust, /crate::bridge::engine\(\s*bridge,\s*directory\.for_app\(/);
  assert.match(readFileSync(join(root, 'src/bridge.rs'), 'utf8'), /\.with_files\(files\)/);
  // R8 keeps what Tauri and Jackson reach by reflection: the plugin and the argument classes of its commands.
  const kept = [...readFileSync(join(root, 'android/consumer-rules.pro'), 'utf8')
    .matchAll(/^-keep class io\.github\.eedaegon\.liveactivity\.(\w+) \{ \*; \}$/gm)].map(([, name]) => name).sort();
  const reflected = [...files.map(own).join('\n').matchAll(/@(?:TauriPlugin|InvokeArg)(?:\([^\n]*\))?\s+class (\w+)/g)]
    .map(([, name]) => name).sort();
  assert.deepEqual(kept, reflected);
});

// TP-ANDROID-20
test("the Android library compiles against the library of a watch's Ongoing Activity and does not bring it", () => {
  // liveupdate's WearOngoing is the one class of the adapter that names AndroidX classes of a watch. Its own AAR
  // compiles against that library and does not bring it, and so does the plugin's Android library: an app has an
  // Ongoing Activity only when it adds the library itself.
  const adapter = 'android/src/main/java/io/github/eedaegon/liveupdate';
  const naming = readdirSync(join(root, adapter)).filter(name => /androidx\.wear\.ongoing/.test(readFileSync(join(root, adapter, name), 'utf8')));
  assert.deepEqual(naming, ['WearOngoing.kt']);
  const gradle = readFileSync(join(root, 'android/build.gradle.kts'), 'utf8');
  const wear = [...gradle.matchAll(/^\s*(\w+)\("androidx\.wear:wear-ongoing:([\d.]+)"\)/gm)].map(([, how, version]) => [how, version]);
  assert.deepEqual(wear, [['compileOnly', '1.1.0']]);
  // What liveupdate's own Gradle file compiles against is what the plugin compiles against.
  const theirs = readFileSync(join(liveupdateDir(), 'android/build.gradle.kts'), 'utf8');
  assert.match(theirs, /^\s*compileOnly\("androidx\.wear:wear-ongoing:1\.1\.0"\)/m);
  // R8 in an app without that library: liveupdate's consumer rules for the class are the plugin's too.
  const rule = (text: string): string[] => text.split('\n').filter(line => /^-(?:dontwarn|keep)\b.*(?:androidx\.wear|NotificationCompat|WearOngoing)/.test(line)).sort();
  const ours = rule(readFileSync(join(root, 'android/consumer-rules.pro'), 'utf8'));
  assert.deepEqual(ours, rule(readFileSync(join(liveupdateDir(), 'android/consumer-rules.pro'), 'utf8')));
  assert.equal(ours.length, 3);
});

// TP-ANDROID-19
test("every run_mobile_plugin call of the plugin's Rust has a guard for Tauri's panic", () => {
  // Tauri's call to a command of the Kotlin side panics while the app has no activity. `src/android.rs` is compiled
  // for Android alone, so this holds as text what the unit tests of `src/bridge.rs` cannot reach: the three such
  // calls, which no other file of the plugin makes. (Registering the Kotlin class goes to Tauri too, at setup,
  // where the app has its activity.)
  const calls = /\brun_mobile_plugin(?:_async)?\s*(?:::\s*<[^>]*>)?\s*\(/g;
  const sources = readdirSync(join(root, 'src')).filter(name => name.endsWith('.rs') && !name.endsWith('_tests.rs'));
  const called = Object.fromEntries(sources
    .map((name): [file: string, count: number] => [name, [...readFileSync(join(root, 'src', name), 'utf8').replace(/^\s*\/\/.*$/gm, '').matchAll(calls)].length])
    .filter(([, count]) => count > 0));
  assert.deepEqual(called, { 'android.rs': 3 });
  const rust = readFileSync(join(root, 'src/android.rs'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  // The transport of liveupdate's driver is guarded under liveactivity's backend, which catches no panic: the
  // plugin builds that backend through `bridge::engine` and in no other way, so every caller of the backend has
  // the guard.
  assert.match(rust, /let engine = crate::bridge::engine\(\s*bridge,/);
  assert.match(rust, /type Engine<R> = crate::bridge::Engine<TauriBridge<R>>;/);
  assert.doesNotMatch(rust, /LiveUpdateBackend|over_bridge|JsonDriver/);
  const bridge = readFileSync(join(root, 'src/bridge.rs'), 'utf8');
  assert.match(bridge, /LiveUpdateBackend::over_bridge\(ContainedBridge\(bridge\)\)\.with_files\(files\)/);
  assert.equal([...bridge.replace(/#\[cfg\(test\)\][\s\S]*$/, '').matchAll(/over_bridge\(/g)].length, 1);
  // The plugin's own two calls, of its commands and of the one that waits for the person, each in its guard.
  assert.match(rust, /let reply = contained\(\|\| handle\.run_mobile_plugin\(command, input\)\)\s*\.ok_or_else\(Error::native\)\?/);
  assert.match(rust, /let reply = Contained::new\(handle\.run_mobile_plugin_async\(command, input\)\)\s*\.await\s*\.ok_or_else\(Error::native\)\?/);
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

// TP-ANDROID-18
test("the plugin's Kotlin opens Android's setting for exact alarms, and reads whether they are allowed through liveupdate's adapter alone", () => {
  const plugin = own('LiveActivityPlugin.kt');
  // Tauri finds the method that takes an activity's result by its name, and answers nothing when none has it: the
  // call would wait for ever.
  const callback = present(/startActivityForResult\(invoke, intent, "(\w+)"\)/.exec(plugin)?.[1], 'the name of the method that takes the result');
  assert.match(plugin, new RegExp(`@ActivityCallback\\s+private fun ${callback}\\(invoke: Invoke, result: ActivityResult\\)`));
  // Android's own setting, for this app.
  assert.match(plugin, /Intent\(Settings\.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri\.parse\("package:\$packageName"\)\)/);
  // Whether an exact alarm may be set is what liveupdate's adapter says in its capabilities, as the alarm that it
  // sets goes by: the plugin asks the alarm manager nowhere.
  assert.ok(plugin.includes('exactAlarmsAllowed(observed())'));
  for (const file of readdirSync(join(root, OWN))) assert.doesNotMatch(own(file), /AlarmManager|canScheduleExactAlarms/, file);
  // The permission is the app's to declare (TP-ANDROID-17): the command reads the app's manifest for it.
  assert.ok(plugin.includes('PermissionHelper.hasDefinedPermission(activity, Manifest.permission.SCHEDULE_EXACT_ALARM)'));
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
