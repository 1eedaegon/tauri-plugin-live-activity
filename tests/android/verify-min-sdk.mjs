// Verify the merged APK metadata, including library manifest requirements.
// Usage: node tests/android/verify-min-sdk.mjs <aapt> <apk>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const [aapt, apk] = process.argv.slice(2);
if (!aapt || !apk) throw new Error('Provide the Android aapt executable and built APK.');
const metadata = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8', timeout: 15000 });
const match = /^sdkVersion:'(\d+)'$/m.exec(metadata);
assert.ok(match, 'The merged APK must declare its minimum SDK.');
const minSdk = Number(match[1]);
assert.equal(minSdk, 26, 'Reject Android versions where Tauri/Jackson fails before plugin initialization.');
console.info(JSON.stringify({ status: 'passed', minSdk }));
