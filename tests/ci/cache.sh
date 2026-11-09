#!/bin/sh
# What CI keeps between runs (.github/workflows/ci.yml): the cache of the built demo and UI tests, and records of the
# simulator suites that passed. Adapted from activitykit's tests/ci/cache.sh.
#
#   cache.sh keys SUITE...        For each suite (simulator: the demo of `tauri ios build`; dev: the demo of `tauri ios
#                                 dev`) writes SUITE=NAME, the name of the record that a pass for these exact inputs
#                                 leaves. Also writes runtime=ID, the simulator runtime the suites test on, and
#                                 products=KEY, the key of the built demo and UI tests (tests/ios/run.sh's BUILD_KEY).
#   cache.sh passed NAME          Looks for the record NAME that a run of this repository's CI left and prints that
#                                 run. Writes found=true or found=false.
#   cache.sh record SUITE FILE    Writes the record of this run's pass to $RUNNER_TEMP/passed-SUITE/. FILE is the
#                                 OUTPUT/passed that tests/ios/run.sh leaves after a pass of every test, listing the
#                                 tests that passed only on a retry; without it the suite did not pass in full, and
#                                 nothing is written. Writes recorded=true or false.
#
# Outputs go to $GITHUB_OUTPUT (standard output when it is not set). The inputs of a suite are the files it reads as git
# tracks them (nothing generated or ignored counts), the workflow file, what selects the suite (MODE, which must be the
# suite's own, ONLY, and the retries that CI turns on, as tests/ios/run.sh reads them), the Xcode version, the runner's
# system, architecture and image ($ImageOS, $ImageVersion), the Rust toolchain ($TOOLCHAIN), XcodeGen ($XCODEGEN), Node
# ($NODE) and the simulator runtime: a narrower or differently run suite never stands for a full one. The products key
# leaves out the workflow, the selection, the image and the runtime: Xcode and the tools decide what is built. XCODE
# and RUNTIME, when set, stand for what this Mac has.
#
# A record is an artifact, not a cache: a push to main cannot restore the caches of a pull request, but it can find the
# artifact that the pull request's run left. Only runs of this repository's ci.yml count, not runs of a fork.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
# Raise to start every key and record afresh.
version=1
temp=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
# The tracked files that the demo on the simulator is built and tested from: the plugin crate and its permissions, the
# TypeScript API, setup, the tools that the demo's build imports, the npm packages, the demo, the UI tests and this
# script. The ios area of ci.yml's changes job names the same files (tests/ci.test.mjs).
inputs="src build.rs Cargo.toml Cargo.lock permissions guest-js cli tools package.json package-lock.json tsconfig.json
examples/demo tests/ios tests/ci"

put() { printf '%s\n' "$1" >>"${GITHUB_OUTPUT:-/dev/stdout}"; }

# A hash of the tracked input files: their paths, modes and contents.
files() {
  # Word splitting into the paths of $inputs, which hold no spaces.
  # shellcheck disable=SC2086
  list=$(git -C "$root" ls-files --stage -- $inputs)
  [ -n "$list" ] || { echo "git lists no input files" >&2; exit 1; }
  printf '%s\n' "$list" | git hash-object --stdin
}

# The newest iOS simulator runtime, read from CoreSimulator's list of runtime images: the first simctl call on a fresh
# runner starts CoreSimulator, which can take minutes. simctl's newest available iOS when no image lists one.
newest_runtime() {
  images=/Library/Developer/CoreSimulator/Images/images.plist
  if [ -r "$images" ]; then
    python3 -I - "$images" <<'PYTHON'
import plistlib, re, sys
with open(sys.argv[1], "rb") as file:
    images = plistlib.load(file).get("images", [])
found = []
for image in images:
    identifier = image.get("runtimeInfo", {}).get("bundleIdentifier", "")
    match = re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-(\d+)-(\d+)(?:-(\d+))?", identifier)
    if match:
        found.append((tuple(int(part or 0) for part in match.groups()), identifier))
if found:
    print(max(found)[1])
PYTHON
  fi | grep . || xcrun simctl list runtimes | awk '/^iOS/ && !/unavailable/ { id = $NF } END { print id }'
}

keys() {
  xcode=${XCODE:-$(xcodebuild -version | awk '/^Xcode / { v = $2 } /^Build version / { b = $3 } END { print v "-" b }')}
  system=${RUNNER_OS:-$(uname -s)}-${RUNNER_ARCH:-$(uname -m)}
  tools="rust ${TOOLCHAIN:?TOOLCHAIN names the Rust toolchain}
xcodegen ${XCODEGEN:?XCODEGEN names the XcodeGen version}
node ${NODE:?NODE names the Node version}"
  runtime=${RUNTIME:-$(newest_runtime)}
  [ -n "$runtime" ] || { echo "no iOS simulator runtime" >&2; exit 1; }
  hash=$(files)
  workflow=$(git -C "$root" ls-files --stage -- .github/workflows/ci.yml | git hash-object --stdin)
  # run.sh runs a failed test again, up to three times in all, under CI.
  if [ -n "${CI:-}" ]; then iterations=3; else iterations=1; fi
  products=$(printf 'version %s\nfiles %s\nxcode %s\nsystem %s\n%s\n' "$version" "$hash" "$xcode" "$system" "$tools" \
    | git hash-object --stdin)
  # CI passes them on to tests/ios/run.sh as RUNTIME and BUILD_KEY.
  put "runtime=$runtime"
  put "products=ios-build-v$version-$system-xcode$xcode-$products"
  for suite in "$@"; do
    case $suite in simulator) mode=build ;; dev) mode=dev ;; *) echo "unknown suite: $suite" >&2; exit 2 ;; esac
    [ "${MODE:-build}" = "$mode" ] || { echo "the $suite suite runs with MODE=$mode, not ${MODE:-build}" >&2; exit 2; }
    printf 'version %s\nsuite %s\nfiles %s\nworkflow %s\nselection mode %s only %s iterations %s\nxcode %s\nrunner %s %s %s\n%s\nruntime %s\n' \
      "$version" "$suite" "$hash" "$workflow" "$mode" "${ONLY:--}" "$iterations" "$xcode" "$system" "${ImageOS:-local}" \
      "${ImageVersion:-local}" "$tools" "$runtime" >"$temp/inputs-$suite.txt"
    name=passed-$suite-$(git hash-object --stdin <"$temp/inputs-$suite.txt")
    printf '%s, from:\n%s\n' "$name" "$(cat "$temp/inputs-$suite.txt")" >&2
    put "$suite=$name"
  done
}

passed() {
  name=$1
  repository=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY names the repository}
  server=${GITHUB_SERVER_URL:-https://github.com}
  # The records of that name that have not expired, newest first, from runs of this repository and not of a fork.
  if ! records=$(gh api "repos/$repository/actions/artifacts?name=$name&per_page=100" --jq '.artifacts
      | map(select((.expired | not) and .workflow_run.head_repository_id == .workflow_run.repository_id))
      | sort_by(.created_at) | reverse | .[] | "\(.id) \(.workflow_run.id)"'); then
    echo "::warning title=Test results not looked up::GitHub's artifact API failed, so the suite runs"
    put found=false
    return
  fi
  work=$(mktemp -d "$temp/passed.XXXXXX")
  # Word splitting into pairs of artifact and run IDs, which are plain numbers.
  # shellcheck disable=SC2086
  set -- $records
  while [ $# -ge 2 ]; do
    artifact=$1 run=$2
    shift 2
    workflow=$(gh api "repos/$repository/actions/runs/$run" --jq .path) || continue
    [ "$workflow" = .github/workflows/ci.yml ] || continue
    gh api "repos/$repository/actions/artifacts/$artifact/zip" >"$work/record.zip" || continue
    unzip -p "$work/record.zip" passed.txt >"$work/passed.txt" 2>/dev/null || continue
    url=$server/$repository/actions/runs/$run
    echo "$name: the suite passed for these inputs in $url"
    cat "$work/passed.txt"
    sed -n 's/^retried //p' "$work/passed.txt" | while read -r test; do
      echo "::warning title=Retried UI test::$test failed once and passed on a retry in $url"
    done
    echo "::notice title=Passed before::$name: skipped, the suite passed for the same inputs in $url"
    rm -rf "$work"
    put found=true
    put "run=$url"
    return
  done
  rm -rf "$work"
  echo "$name: no run has passed these inputs yet"
  put found=false
}

record() {
  suite=$1
  if [ ! -f "$2" ]; then
    echo "$suite did not pass in full: no record"
    put recorded=false
    return
  fi
  dir=$temp/passed-$suite
  mkdir -p "$dir"
  { cat "$temp/inputs-$suite.txt"
    echo "run ${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-local}/actions/runs/${GITHUB_RUN_ID:-0} attempt ${GITHUB_RUN_ATTEMPT:-1}"
    echo "commit ${GITHUB_SHA:-$(git -C "$root" rev-parse HEAD)} ${GITHUB_REF:-}"
    awk '{ print "retried " $0 }' "$2"
  } >"$dir/passed.txt"
  cat "$dir/passed.txt"
  put recorded=true
}

command=${1:-}
[ $# -eq 0 ] || shift
case $command in
  keys) keys "$@" ;;
  passed) passed "$1" ;;
  record) [ $# -eq 2 ] || { echo "usage: cache.sh record SUITE FILE" >&2; exit 2; }; record "$@" ;;
  *) echo "usage: cache.sh keys SUITE... | passed NAME | record SUITE FILE" >&2; exit 2 ;;
esac
