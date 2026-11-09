#!/bin/sh
# End to end on an iOS Simulator of its own: builds the demo app (examples/demo) for the simulator, installs it, runs
# the UI tests of tests/ios/DemoUITests against it through their project's scheme, copies the screenshots to OUTPUT,
# and deletes the simulator. Needs Xcode, XcodeGen, Node with the repository's npm packages, and cargo with the iOS
# simulator target of this Mac.
#
#   MODE=build  (default) the demo from `tauri ios build --debug`, every UI test
#   MODE=dev    the demo that `tauri ios dev` builds, installs, launches and serves; the layout, button and relaunch
#               tests through the page, and the one where Rust starts the layout
#   OUTPUT      where the screenshots, the other attachments, the logs and `passed` go (default tests/ios/output);
#               the run replaces only its own files there
#   BUILD_DIR   where the demo app and the built UI tests go (a temporary folder unless set); CI caches it
#   BUILD_KEY   names the inputs of the build (CI passes a hash of them, from tests/ci/cache.sh). A complete build
#               writes it next to its products, and a later run with the same key tests those products without
#               building. XcodeGen makes the UI tests' project either way: the tests run through its scheme, because
#               with an .xctestrun file alone xcodebuild found no simulator on a CI runner.
#   RUNTIME     the simulator runtime (default the newest iOS of this Mac)
#   ONLY="DemoTests/test2LockScreenButtonReachesRustAndJavaScript" runs those tests
#
# Under CI a failed test runs again, up to three times in all, and each retry is reported. After a pass of every test,
# OUTPUT/passed lists the tests that passed only on a retry (often none); tests/ci/cache.sh records it. The run leaves
# the checkout as it was: it puts back the tracked files of the demo's gen/apple, which XcodeGen rewrites.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
output=${OUTPUT:-$root/tests/ios/output}
mode=${MODE:-build}
case $mode in build | dev) ;; *) echo "MODE is build or dev, not $mode" >&2; exit 2 ;; esac
work=$(mktemp -d "${TMPDIR:-/tmp}/live-activity-e2e.XXXXXX")
build=${BUILD_DIR:-$work/build}
stamp=$build/build-key
apple=$root/examples/demo/src-tauri/gen/apple
tests=$root/tests/ios/DemoUITests/DemoUITests.xcodeproj
derived=$HOME/Library/Developer/Xcode/DerivedData
bundle=io.github.eedaegon.liveactivitydemo
# The page of a dev build, from Tauri's built-in server for static files.
page=http://127.0.0.1:1430/
# How long `tauri ios dev` may take to build, install, launch and serve the demo, in seconds.
dev_wait=1800
case "$(uname -m)" in arm64) arch=arm64 target=aarch64-sim ;; *) arch=x86_64 target=x86_64 ;; esac
runtime=${RUNTIME:-$(xcrun simctl list runtimes -j | python3 -I -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')}
name="live-activity-e2e-$$"
device=
dev=
cleaned=

# Ends `pid` and every process it started, children first: `tauri ios dev` runs cargo, xcodebuild and a log stream.
kill_tree() {
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
# Stops the run, keeping the log of `tauri ios dev`.
fail() {
  if [ -f "$work/dev.log" ]; then mkdir -p "$output" && cp "$work/dev.log" "$output/tauri-ios-dev.log"; fi
  echo "$1" >&2
  exit 1
}
cleanup() {
  [ -z "$cleaned" ] || return 0
  cleaned=1
  [ -z "$dev" ] || kill_tree "$dev"
  if [ -n "$device" ]; then
    xcrun simctl shutdown "$device" >/dev/null 2>&1 || true
    xcrun simctl delete "$device" || true
  fi
  if [ -f "$work/apple.tar" ]; then tar -xf "$work/apple.tar" -C "$root"; fi
  rm -rf "$work" "$apple/build"
  find "$derived" -maxdepth 1 \( -name 'live-activity-demo-*' -o -name 'DemoUITests-*' \) -exec rm -rf {} + 2>/dev/null || true
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM HUP

# The tracked files of gen/apple as they are now, put back by the cleanup.
git -C "$root" ls-files -z -- "$apple" | (cd "$root" && tar -cf "$work/apple.tar" --null -T -)
device=$(xcrun simctl create "$name" "${DEVICE_TYPE:-iPhone 17 Pro}" "$runtime")
echo "simulator $device ($runtime), $arch, $mode"
destination="platform=iOS Simulator,id=$device,arch=$arch"

# Whether BUILD_DIR holds the complete products of a build of BUILD_KEY: the UI tests, and in build mode the demo.
built() {
  [ -n "${BUILD_KEY:-}" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$BUILD_KEY" ] || return 1
  [ -f "$build/tests/Build/Products/Debug-iphonesimulator/DemoUITests-Runner.app/PlugIns/DemoUITests.xctest/DemoUITests" ] || return 1
  [ "$mode" = dev ] || [ -f "$build/demo/live-activity-demo.app/live-activity-demo" ]
}

xcodegen generate --spec "$root/tests/ios/DemoUITests/project.yml" --quiet
if built; then
  echo "the products in $build were built for $BUILD_KEY: no build"
else
  if [ -n "${BUILD_KEY:-}" ]; then echo "no complete products built for $BUILD_KEY: building"; fi
  rm -rf "$build"
  mkdir -p "$build/demo"
  (cd "$root" && npm run build:demo >/dev/null)
  # The spec lists Externals (Rust libraries) and assets (the page), which Tauri fills during the build; a fresh
  # checkout has neither, and XcodeGen refuses a missing source directory.
  mkdir -p "$apple/Externals" "$apple/assets"
  xcodegen generate --spec "$apple/project.yml" --quiet
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
  xcodebuild -project "$tests" -scheme DemoUITests -destination "$destination" -derivedDataPath "$build/tests" \
    CODE_SIGNING_ALLOWED=NO build-for-testing -quiet
  if [ -n "${BUILD_KEY:-}" ]; then printf '%s\n' "$BUILD_KEY" >"$stamp"; fi
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
  # Ready once the demo is installed and running and its page is served.
  waited=0
  until xcrun simctl get_app_container "$device" "$bundle" >/dev/null 2>&1 \
    && xcrun simctl spawn "$device" launchctl list 2>/dev/null | grep -q "$bundle" \
    && curl -sf -o /dev/null "$page"; do
    ! grep -q 'Exporting app' "$work/dev.log" || fail "tauri ios dev exports the app, which only a device needs"
    kill -0 "$dev" 2>/dev/null || fail "tauri ios dev ended"
    waited=$((waited + 5))
    [ "$waited" -lt "$dev_wait" ] || fail "tauri ios dev did not install, launch and serve the demo in $dev_wait s"
    sleep 5
  done
  grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$work/dev.log" | head -n 1 || true
  only=${ONLY:-DemoTests/test1BoundStyleShowsOnTheLockScreen DemoTests/test2LockScreenButtonReachesRustAndJavaScript \
    DemoTests/test3ListAfterARelaunchFindsTheActivity DemoTests/test7RustStartsALayoutWhoseButtonReachesRust}
else
  xcrun simctl install "$device" "$build/demo/live-activity-demo.app"
  only=${ONLY:-}
fi

set --
for test in $only; do set -- "$@" "-only-testing:DemoUITests/$test"; done
# A shared runner's simulator sometimes loses a tap or its accessibility server.
if [ -n "${CI:-}" ]; then set -- "$@" -retry-tests-on-failure -test-iterations 3; fi
# The status goes through a file: the group runs in a subshell of the pipe, where `set -e` would end it at a failing
# xcodebuild before the status is written. A shared runner's test runner sometimes cannot start ("failed to initialize
# for UI testing", waiting for the accessibility server): then no test ran, and the tests run once more.
attempt=1
while :; do
  { tested=0
    xcodebuild -project "$tests" -scheme DemoUITests -destination "$destination" -derivedDataPath "$build/tests" \
      -resultBundlePath "$work/result.xcresult" test-without-building "$@" 2>&1 || tested=$?
    echo "$tested" >"$work/status"; } | tee "$work/xcodebuild-$attempt.log"
  status=$(cat "$work/status")
  if [ "$status" -ne 0 ] && [ "$attempt" -eq 1 ] && grep -q 'failed to initialize for UI testing' "$work/xcodebuild-$attempt.log"; then
    echo "::warning title=UI test runner::the test runner could not start; the tests run once more"
    rm -rf -- "${work:?}/result.xcresult"
    attempt=2
    continue
  fi
  break
done
cat "$work"/xcodebuild-*.log >"$work/xcodebuild.log"
retried=$(sed -n "s/^Test Case '-\[DemoUITests\.\([^ ]*\) \([^]]*\)\]' failed.*/\1\/\2/p" "$work/xcodebuild.log" | sort -u)
# What the demo logged while a test failed, read before the simulator goes.
if [ -n "$retried" ]; then
  xcrun simctl spawn "$device" log show --last 30m --style compact --predicate 'process == "live-activity-demo"' \
    >"$work/app.log" 2>&1 || true
fi
if [ -n "$retried" ] && [ "$status" -eq 0 ]; then
  for test in $retried; do echo "::warning title=Retried UI test::$test failed once and passed on a retry"; done
fi

# Only the run's own files are replaced in OUTPUT: the screenshots and other attachments, the logs and passed.
mkdir -p "$output" "$work/attachments"
rm -f "$output"/e2e-*.png "$output/passed" "$output/xcodebuild.log" "$output/tauri-ios-dev.log" "$output/app.log"
cp "$work/xcodebuild.log" "$output/xcodebuild.log"
[ ! -f "$work/app.log" ] || cp "$work/app.log" "$output/app.log"
[ ! -f "$work/dev.log" ] || cp "$work/dev.log" "$output/tauri-ios-dev.log"
xcrun xcresulttool export attachments --path "$work/result.xcresult" --output-path "$work/attachments" >/dev/null 2>&1 || true
# The manifest names each attachment; a screenshot keeps the name its test gave it.
python3 -I - "$work/attachments" "$output" <<'PYTHON' || true
import json, pathlib, re, shutil, sys
found, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
manifest = found / "manifest.json"
if manifest.exists():
    for test in json.loads(manifest.read_text()):
        for item in test.get("attachments", []):
            source = found / item["exportedFileName"]
            name = item.get("suggestedHumanReadableName", source.name).split("_0_")[0]
            # XCTest names some attachments after an element ("Debug description for `"Pet Mochi" Button`"); CI's
            # artifact upload refuses quotes, backticks and the like in a path.
            name = re.sub(r'[\\/"`:<>|*?\r\n]', "_", name)
            if source.exists():
                shutil.copyfile(source, out / f"{name}{source.suffix}")
PYTHON
if [ "$status" -eq 0 ] && [ -z "${ONLY:-}" ]; then printf '%s' "$retried" >"$output/passed"; fi
ls "$output"
exit "$status"
