#!/bin/sh
# End to end on an iOS Simulator of its own: builds the demo app (examples/demo) for the simulator, installs it, runs
# the UI tests of tests/ios/DemoUITests against it, copies the screenshots to tests/ios/output (OUTPUT), and deletes
# the simulator. Needs Xcode, XcodeGen, Node with the repository's npm packages, and cargo with the iOS simulator target
# of this Mac.
#
#   MODE=build  (default) the demo from `tauri ios build --debug`, every UI test
#   MODE=dev    the demo that `tauri ios dev` builds, installs and serves; the layout, button and relaunch tests
#               through the page, and the one where Rust starts the layout
#   BUILD_DIR   where the demo app and the built UI tests go (a temporary folder unless set); CI caches it
#   REUSE=1     take the demo app and the UI tests from BUILD_DIR and run them with `test-without-building`
#   ONLY=DemoTests/test2LockScreenButtonReachesRustAndJavaScript runs one test
#
# TP-E2E-1, TP-E2E-2, TP-E2E-3, TP-E2E-4, TP-E2E-5, TP-E2E-6, TP-BUILD-1
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output=${OUTPUT:-$root/tests/ios/output}
mode=${MODE:-build}
work=$(mktemp -d "${TMPDIR:-/tmp}/live-activity-e2e.XXXXXX")
build=${BUILD_DIR:-$work/build}
apple=$root/examples/demo/src-tauri/gen/apple
# XcodeGen gives the empty groups of the demo's project new ids on every run, so the run puts the tracked file back.
project=$apple/live-activity-demo.xcodeproj/project.pbxproj
derived=$HOME/Library/Developer/Xcode/DerivedData
bundle=io.github.eedaegon.liveactivitydemo
case "$(uname -m)" in arm64) arch=arm64 target=aarch64-sim ;; *) arch=x86_64 target=x86_64 ;; esac
runtime=$(xcrun simctl list runtimes -j | python3 -I -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')
name="live-activity-e2e-$$"
device=$(xcrun simctl create "$name" "iPhone 17 Pro" "$runtime")
dev=
# Stops the run, keeping the log of `tauri ios dev`.
fail() {
  if [ -f "$work/dev.log" ]; then mkdir -p "$output" && cp "$work/dev.log" "$output/tauri-ios-dev.log"; fi
  echo "$1" >&2
  exit 1
}
cleanup() {
  [ -z "$dev" ] || kill "$dev" 2>/dev/null || true
  xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
  xcrun simctl delete "$device" || true
  [ ! -f "$work/project.pbxproj" ] || cp "$work/project.pbxproj" "$project"
  rm -rf "$work" "$apple/build"
  find "$derived" -maxdepth 1 \( -name 'live-activity-demo-*' -o -name 'DemoUITests-*' \) -exec rm -rf {} + 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
cp "$project" "$work/project.pbxproj"
echo "simulator $device ($runtime), $arch, $mode"
destination="platform=iOS Simulator,id=$device,arch=$arch"

if [ "${REUSE:-}" = 1 ] && [ -d "$build/demo/live-activity-demo.app" ] && ls "$build"/tests/Build/Products/*.xctestrun >/dev/null 2>&1; then
  echo "reusing the demo and the UI tests in $build"
else
  rm -rf "$build"
  mkdir -p "$build/demo"
  (cd "$root" && npm run build:demo >/dev/null)
  xcodegen generate --spec "$apple/project.yml" --quiet
  xcodegen generate --spec "$root/tests/ios/DemoUITests/project.yml" --quiet
  if [ "$mode" = build ]; then
    # Tauri drives xcodebuild: its build phase builds the Rust library and needs the CLI running. After the build
    # Tauri archives an IPA, which needs a signing team; the simulator needs only the build, so the archive may fail.
    find "$derived" -maxdepth 1 -name 'live-activity-demo-*' -exec rm -rf {} + 2>/dev/null || true
    (cd "$root/examples/demo" && "$root/node_modules/.bin/tauri" ios build --debug --target "$target" --ci) > "$work/build.log" 2>&1 || true
    grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$work/build.log" || true
    app=$(find "$derived" -maxdepth 6 -path '*live-activity-demo-*/Build/Products/debug-iphonesimulator/live-activity-demo.app' \
      -type d | head -n 1)
    test -n "$app" || { tail -n 40 "$work/build.log" >&2; echo "the demo did not build for the simulator" >&2; exit 1; }
    cp -R "$app" "$build/demo/"
  fi
  xcodebuild build-for-testing -quiet -project "$root/tests/ios/DemoUITests/DemoUITests.xcodeproj" -scheme DemoUITests \
    -destination "$destination" -derivedDataPath "$build/tests" CODE_SIGNING_ALLOWED=NO
fi

xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b >/dev/null
if [ "$mode" = dev ]; then
  # `tauri ios dev` builds the debug app, installs it on the simulator of this name, launches it and serves the page;
  # it runs until it is stopped. The tests run while it does. Two of Tauri's steps need help here, through shims early
  # on its PATH:
  # - It looks at the connected iPhones first, through `xcrun devicectl` and `ios-deploy`, and when none has the name
  #   it takes one of them: the shims answer that no iPhone is connected, so that it takes the simulator, and refuse
  #   anything else ios-deploy would do. A run that exports, which only a device needs, stops at once.
  # - After its simulator build it archives the app and installs the archive's copy. On an Intel Mac that archive
  #   is a device build, which needs a signing team: the `xcodebuild` shim answers the archive with the app that the
  #   simulator build made, unchanged and unsigned, where Tauri installs it from. Every other xcodebuild call is
  #   Xcode's own.
  mkdir -p "$work/bin"
  cat > "$work/bin/xcrun" <<'SHIM'
#!/bin/sh
if [ "${1:-}" = devicectl ] && [ "${2:-}" = list ] && [ "${3:-}" = devices ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = --json-output ]; then printf '%s' '{"info":{"outcome":"success"},"result":{"devices":[]}}' > "$2"; fi
    shift
  done
  exit 0
fi
exec /usr/bin/xcrun "$@"
SHIM
  printf '%s\n' '#!/bin/sh' 'case " $* " in *" --detect "*) exit 0 ;; esac' \
    'echo "ios-deploy is not available to this test run" >&2' 'exit 1' > "$work/bin/ios-deploy"
  cat > "$work/bin/xcodebuild" <<'SHIM'
#!/bin/sh
case " $* " in
  *" archive "*)
    archive=
    while [ $# -gt 0 ]; do [ "$1" = -archivePath ] && archive=$2; shift; done
    app=$(ls -dt "$HOME"/Library/Developer/Xcode/DerivedData/live-activity-demo-*/Build/Products/debug-iphonesimulator/live-activity-demo.app | head -n 1)
    [ -n "$archive" ] && [ -d "$app" ] || exit 1
    rm -rf "$archive.xcarchive" && mkdir -p "$archive.xcarchive/Products/Applications" && cp -R "$app" "$archive.xcarchive/Products/Applications/"
    echo "** ARCHIVE SUCCEEDED ** (the simulator build of the run, unsigned)"
    exit 0 ;;
esac
exec /usr/bin/xcodebuild "$@"
SHIM
  chmod +x "$work/bin/xcrun" "$work/bin/ios-deploy" "$work/bin/xcodebuild"
  # The dev build loads the page from Tauri's built-in server for static files, on this Mac's loopback address. The
  # server lives as long as `tauri ios dev`, which watches the sources: with `--no-watch` it ends once it has launched
  # the app, and the page then fails to load.
  (cd "$root/examples/demo" && PATH="$work/bin:$PATH" exec "$root/node_modules/.bin/tauri" ios dev "$name" \
    --host 127.0.0.1) \
    > "$work/dev.log" 2>&1 &
  dev=$!
  waited=0
  until xcrun simctl get_app_container "$device" "$bundle" >/dev/null 2>&1; do
    ! grep -q 'Exporting app' "$work/dev.log" || fail "tauri ios dev exports the app, which only a device needs"
    kill -0 "$dev" 2>/dev/null || fail "tauri ios dev ended"
    waited=$((waited + 5))
    [ "$waited" -lt 1800 ] || fail "tauri ios dev did not install the app"
    sleep 5
  done
  # The tests launch the app again; give the first launch a moment to settle.
  sleep 10
  grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$work/dev.log" | head -n 1 || true
  # test3 ends the activity that test2 leaves running.
  only=${ONLY:-DemoTests/test1BoundStyleShowsOnTheLockScreen DemoTests/test2LockScreenButtonReachesRustAndJavaScript \
    DemoTests/test3ListAfterARelaunchFindsTheActivity DemoTests/test7RustStartsALayoutWhoseButtonReachesRust}
else
  xcrun simctl install "$device" "$build/demo/live-activity-demo.app"
  only=${ONLY:-}
fi

status=0
filters=
for test in $only; do filters="$filters -only-testing:DemoUITests/$test"; done
# shellcheck disable=SC2086
xcodebuild test-without-building -xctestrun "$(ls "$build"/tests/Build/Products/*.xctestrun | head -n 1)" \
  -destination "$destination" -resultBundlePath "$work/result.xcresult" $filters || status=$?
rm -rf "$output"
mkdir -p "$output"
[ ! -f "$work/dev.log" ] || cp "$work/dev.log" "$output/tauri-ios-dev.log"
xcrun xcresulttool export attachments --path "$work/result.xcresult" --output-path "$output" >/dev/null 2>&1 || true
# The manifest names each attachment; a screenshot keeps the name its test gave it.
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
