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
#               the run replaces only its own files there. The log of `tauri ios dev` is written there from its
#               start: a run that is stopped from outside, as CI's runner stops a cancelled job, leaves it. A run
#               in which a test failed leaves what the simulator logged since the tests began: `app.log`, the
#               demo's lines, and `activities.log`, the lines about its Live Activities; and each failure leaves a
#               screenshot, `e2e-failed-<test>-<time>.png`
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
# What `tauri ios dev` says, kept where CI's job uploads it whatever ended the step. An earlier run's goes now.
devlog=$output/tauri-ios-dev.log
rm -f "$devlog"
work=$(mktemp -d "${TMPDIR:-/tmp}/live-activity-e2e.XXXXXX")
build=${BUILD_DIR:-$work/build}
stamp=$build/build-key
apple=$root/examples/demo/src-tauri/gen/apple
tests=$root/tests/ios/DemoUITests/DemoUITests.xcodeproj
derived=$HOME/Library/Developer/Xcode/DerivedData
bundle=io.github.eedaegon.liveactivitydemo
# The lines of the simulator's log that tell what became of a Live Activity: those of the demo's widget extension,
# which draws it (the product name of the widget target in the demo's project.yml), of the system's two daemons for
# widgets and Live Activities, and of ActivityKit in any process.
activities='process == "LiveActivityWidget" OR process == "chronod" OR process == "liveactivitiesd" OR subsystem BEGINSWITH "com.apple.activitykit"'
# The page of a dev build, from Tauri's built-in server for static files.
page=http://127.0.0.1:1430/
# How long `tauri ios dev` may take to build, install, launch and serve the demo, in seconds, and how often the
# run says how far it is.
dev_wait=1800
dev_progress=60
case "$(uname -m)" in arm64) arch=arm64 target=aarch64-sim ;; *) arch=x86_64 target=x86_64 ;; esac
runtime=${RUNTIME:-$(xcrun simctl list runtimes -j | python3 -I -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS" and x["isAvailable"]]; print(r[-1]["identifier"])')}
name="live-activity-e2e-$$"
device=
dev=
cleaned=

# Ends `pid` and every process it started, children first: `tauri ios dev` runs cargo, xcodebuild and a log stream.
# The children come through a pipe, not a command substitution: macOS's sh (bash 3.2) keeps a line that it could not
# write and hands it to its next command substitution, where its words would pass for processes. The shell at the
# pipe's end may get that line on its way out and fail on it, which is nothing to the tree.
kill_tree() {
  pgrep -P "$1" 2>/dev/null | while read -r child; do kill_tree "$child"; done || true
  kill "$1" 2>/dev/null || true
}
# A line for the step's log, on the stream that the caller gives it. The log has the time of each line: before a
# part that takes minutes the run says which it begins, and a run that is stopped shows where it was. A shell of its
# own writes the line: when nobody reads any more, as behind a step that CI's runner has given up or a pipe to a
# command that has ended, the write ends the shell that tried, and the run has to go on to its cleanup. printf,
# because a shell's echo reads the backslashes of what it is given.
report() {
  (printf '%s\n' "$1") || true
}
# Stops the run and says why.
fail() {
  report "$1" >&2
  exit 1
}
# A line for the step's log while `tauri ios dev` builds, after `$1` seconds of waiting: what the Mac has left, and
# the last line of Tauri's log, which has no times of its own.
progress() {
  load=$(sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | xargs)
  free=$(memory_pressure -Q 2>/dev/null | sed -n 's/^System-wide memory free percentage: //p')
  report "tauri ios dev, $1 s: load ${load:-unknown}, memory free ${free:-unknown}: $(tail -n 1 "$devlog" | sed 's/^ *//' | cut -c1-160)"
}
cleanup() {
  [ -z "$cleaned" ] || return 0
  # A second signal does not cut the cleanup short: CI's runner sends TERM some seconds after INT. The shell takes it
  # and does nothing. It does not ignore it, which every command of the cleanup would inherit: a terminal's Ctrl-C
  # still ends a command that hangs here, and the cleanup goes on. This comes before the mark: a signal handled
  # between the two would find the cleanup marked as done and end the run without it.
  trap : INT TERM HUP
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
# A signal from outside ends the run with status `$2` after the cleanup. The signal is named first, for the step's
# log: CI's runner kills the step ten seconds after its first signal, cleaned up or not. The shell handles a signal
# when the command it waits for has ended. While `tauri ios dev` builds that is at once, or after the look at the
# simulator that is under way; during the build of the UI tests, the simulator's boot and the tests it is only
# after them.
stopped() {
  report "tests/ios/run.sh: stopped by SIG$1" >&2
  cleanup
  exit "$2"
}
trap cleanup EXIT
trap 'stopped INT 130' INT
trap 'stopped TERM 143' TERM
trap 'stopped HUP 143' HUP

# The tracked files of gen/apple as they are now, put back by the cleanup.
git -C "$root" ls-files -z -- "$apple" | (cd "$root" && tar -cf "$work/apple.tar" --null -T -)
device=$(xcrun simctl create "$name" "${DEVICE_TYPE:-iPhone 17 Pro}" "$runtime")
report "simulator $device ($runtime), $arch, $mode"
destination="platform=iOS Simulator,id=$device,arch=$arch"

# Whether BUILD_DIR holds the complete products of a build of BUILD_KEY: the UI tests, and in build mode the demo.
built() {
  [ -n "${BUILD_KEY:-}" ] && [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$BUILD_KEY" ] || return 1
  [ -f "$build/tests/Build/Products/Debug-iphonesimulator/DemoUITests-Runner.app/PlugIns/DemoUITests.xctest/DemoUITests" ] || return 1
  [ "$mode" = dev ] || [ -f "$build/demo/live-activity-demo.app/live-activity-demo" ]
}

xcodegen generate --spec "$root/tests/ios/DemoUITests/project.yml" --quiet
if built; then
  report "the products in $build were built for $BUILD_KEY: no build"
else
  if [ -n "${BUILD_KEY:-}" ]; then report "no complete products built for $BUILD_KEY: building"; fi
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
    report "building the demo with tauri ios build"
    (cd "$root/examples/demo" && "$root/node_modules/.bin/tauri" ios build --debug --target "$target" --ci) > "$work/build.log" 2>&1 || true
    grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$work/build.log" || true
    app=$(find "$derived" -maxdepth 6 -path '*live-activity-demo-*/Build/Products/debug-iphonesimulator/live-activity-demo.app' \
      -type d | head -n 1)
    # A build that failed can leave the app that it had begun, with no program in it: nothing to install.
    [ -n "$app" ] && [ -f "$app/live-activity-demo" ] \
      || { tail -n 40 "$work/build.log" >&2; fail "the demo did not build for the simulator"; }
    cp -R "$app" "$build/demo/"
  fi
  report "building the UI tests"
  xcodebuild -project "$tests" -scheme DemoUITests -destination "$destination" -derivedDataPath "$build/tests" \
    CODE_SIGNING_ALLOWED=NO build-for-testing -quiet
  if [ -n "${BUILD_KEY:-}" ]; then printf '%s\n' "$BUILD_KEY" >"$stamp"; fi
fi

report "booting the simulator"
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
  mkdir -p "$output"
  report "waiting for tauri ios dev to build, install, launch and serve the demo"
  (cd "$root/examples/demo" && PATH="$work/bin:$PATH" exec "$root/node_modules/.bin/tauri" ios dev "$name" \
    --host 127.0.0.1) \
    > "$devlog" 2>&1 &
  dev=$!
  # Ready once the demo is installed and running and its page is served.
  waited=0
  until xcrun simctl get_app_container "$device" "$bundle" >/dev/null 2>&1 \
    && xcrun simctl spawn "$device" launchctl list 2>/dev/null | grep -q "$bundle" \
    && curl -sf -o /dev/null "$page"; do
    ! grep -q 'Exporting app' "$devlog" || fail "tauri ios dev exports the app, which only a device needs"
    kill -0 "$dev" 2>/dev/null || fail "tauri ios dev ended"
    waited=$((waited + 5))
    [ "$waited" -lt "$dev_wait" ] || fail "tauri ios dev did not install, launch and serve the demo in $dev_wait s"
    [ $((waited % dev_progress)) -ne 0 ] || progress "$waited"
    # The sleep runs beside the shell, which waits for it: so the shell handles a signal at once, and not when the
    # five seconds are over.
    sleep 5 &
    wait $!
  done
  grep -E '^\*\* BUILD (SUCCEEDED|FAILED) \*\*' "$devlog" | head -n 1 || true
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
# When the tests begin: a run in which a test fails reads the simulator's log from here on.
began=$(date +%s)
# The status goes through a file: the group runs in a subshell of the pipe, where `set -e` would end it at a failing
# xcodebuild before the status is written. On a shared runner the tests sometimes cannot start: the test runner does
# not come up ("failed to initialize for UI testing", waiting for the accessibility server), or xcodebuild does not
# find the simulator that this run created and booted ("Unable to find a device matching the provided destination
# specifier"). Then no test ran, and the tests run once more.
attempt=1
while :; do
  { tested=0
    xcodebuild -project "$tests" -scheme DemoUITests -destination "$destination" -derivedDataPath "$build/tests" \
      -resultBundlePath "$work/result.xcresult" test-without-building "$@" 2>&1 || tested=$?
    echo "$tested" >"$work/status"; } | tee "$work/xcodebuild-$attempt.log"
  status=$(cat "$work/status")
  if [ "$status" -ne 0 ] && [ "$attempt" -eq 1 ] && grep -q -e 'failed to initialize for UI testing' \
    -e 'Unable to find a device matching the provided destination specifier' "$work/xcodebuild-$attempt.log"; then
    report "::warning title=UI test runner::the tests could not start; they run once more"
    rm -rf -- "${work:?}/result.xcresult"
    attempt=2
    continue
  fi
  break
done
cat "$work"/xcodebuild-*.log >"$work/xcodebuild.log"
retried=$(sed -n "s/^Test Case '-\[DemoUITests\.\([^ ]*\) \([^]]*\)\]' failed.*/\1\/\2/p" "$work/xcodebuild.log" | sort -u)
# What the simulator logged since the tests began, when a test failed, read before the simulator goes: the demo's own
# lines, and the lines about its Live Activities. A card that the Lock Screen shows without its content has no reason
# in the demo's lines: the system made the activity, and what drew it or did not is another process.
logged() {
  xcrun simctl spawn "$device" log show --start "@$began" --style compact --predicate "$1"
}
if [ -n "$retried" ]; then
  logged 'process == "live-activity-demo"' >"$work/app.log" 2>&1 || true
  logged "$activities" >"$work/activities.log" 2>&1 || true
fi
if [ -n "$retried" ] && [ "$status" -eq 0 ]; then
  for test in $retried; do report "::warning title=Retried UI test::$test failed once and passed on a retry"; done
fi

# Only the run's own files are replaced in OUTPUT: the screenshots and other attachments, the logs and passed. The
# log of `tauri ios dev` is there since Tauri started.
mkdir -p "$output" "$work/attachments"
rm -f "$output"/e2e-*.png "$output/passed" "$output/xcodebuild.log" "$output/app.log" "$output/activities.log"
cp "$work/xcodebuild.log" "$output/xcodebuild.log"
for kept in app.log activities.log; do [ ! -f "$work/$kept" ] || cp "$work/$kept" "$output/$kept"; done
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
