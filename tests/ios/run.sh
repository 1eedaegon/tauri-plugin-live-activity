#!/bin/sh
# End to end on an iOS Simulator of its own: builds the demo app (examples/demo) for the simulator, installs it, runs
# the UI tests of tests/ios/DemoUITests against it, copies the screenshots to tests/ios/output (OUTPUT), and deletes
# the simulator and the build. Needs Xcode, XcodeGen, Node with the repository's npm packages, and cargo with the iOS
# simulator target of this Mac. ONLY=DemoTests/test2LockScreenButtonReachesRustAndJavaScript runs one test.
# TP-E2E-1, TP-E2E-2, TP-E2E-3, TP-E2E-4, TP-BUILD-1
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output=${OUTPUT:-$root/tests/ios/output}
work=$(mktemp -d "${TMPDIR:-/tmp}/live-activity-e2e.XXXXXX")
case "$(uname -m)" in arm64) arch=arm64 ;; *) arch=x86_64 ;; esac
runtime=$(xcrun simctl list runtimes -j | python3 -I -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')
device=$(xcrun simctl create "live-activity-e2e-$$" "iPhone 17 Pro" "$runtime")
cleanup() {
  xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
  xcrun simctl delete "$device" || true
  rm -rf "$work" "$apple/build"
  find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 1 \( -name 'live-activity-demo-*' -o -name 'DemoUITests-*' \) \
    -exec rm -rf {} + 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
echo "simulator $device ($runtime), $arch"

apple=$root/examples/demo/src-tauri/gen/apple
(cd "$root" && npm run build:demo >/dev/null)
xcodegen generate --spec "$apple/project.yml" --quiet
xcodegen generate --spec "$root/tests/ios/DemoUITests/project.yml" --quiet
# Tauri drives xcodebuild: its build phase builds the Rust library and needs the CLI running. After the build Tauri
# archives an IPA, which needs a signing team; the simulator needs only the build, so the archive may fail.
case "$arch" in arm64) target=aarch64-sim ;; *) target=x86_64 ;; esac
derived=$HOME/Library/Developer/Xcode/DerivedData
find "$derived" -maxdepth 1 -name 'live-activity-demo-*' -exec rm -rf {} + 2>/dev/null || true
(cd "$root/examples/demo" && "$root/node_modules/.bin/tauri" ios build --debug --target "$target" --ci) > "$work/build.log" 2>&1 || true
grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$work/build.log" || true
app=$(find "$derived" -maxdepth 6 -path '*live-activity-demo-*/Build/Products/debug-iphonesimulator/live-activity-demo.app' \
  -type d | head -n 1)
test -n "$app" || { tail -n 40 "$work/build.log" >&2; echo "the demo did not build for the simulator" >&2; exit 1; }
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b >/dev/null
xcrun simctl install "$device" "$app"

status=0
xcodebuild test -project "$root/tests/ios/DemoUITests/DemoUITests.xcodeproj" -scheme DemoUITests \
  -destination "id=$device" -derivedDataPath "$work/tests" -resultBundlePath "$work/result.xcresult" \
  ${ONLY:+-only-testing:"DemoUITests/$ONLY"} CODE_SIGNING_ALLOWED=NO || status=$?
rm -rf "$output"
mkdir -p "$output"
xcrun xcresulttool export attachments --path "$work/result.xcresult" --output-path "$output" >/dev/null 2>&1 || true
# The manifest names each screenshot after its attachment.
python3 -I - "$output" <<'PYTHON' || true
import json, os, pathlib, sys
out = pathlib.Path(sys.argv[1])
manifest = out / "manifest.json"
if manifest.exists():
    for test in json.loads(manifest.read_text()):
        for item in test.get("attachments", []):
            source = out / item["exportedFileName"]
            name = item.get("suggestedHumanReadableName", source.name).split("_0_")[0]
            if source.exists():
                os.replace(source, out / f"{name}{source.suffix}")
PYTHON
ls "$output"
exit "$status"
