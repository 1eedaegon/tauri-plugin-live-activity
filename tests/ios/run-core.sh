#!/bin/sh
set -eu
live_activity_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
live_activity_tmp=$(mktemp -d "${TMPDIR:-/tmp}/live-activity-core.XXXXXX")
trap 'rm -rf "$live_activity_tmp"' EXIT HUP INT TERM
set -- "$live_activity_root"/ios/Sources/LiveActivityShared/*.swift "$live_activity_root"/ios/Sources/LiveActivityCore/*.swift
xcrun swiftc -parse-as-library -swift-version 5 -profile-generate -profile-coverage-mapping "$@" "$live_activity_root/tests/ios/main.swift" -o "$live_activity_tmp/tests"
LLVM_PROFILE_FILE="$live_activity_tmp/tests.profraw" "$live_activity_tmp/tests"
xcrun llvm-profdata merge -sparse "$live_activity_tmp/tests.profraw" -o "$live_activity_tmp/tests.profdata"
xcrun llvm-cov report "$live_activity_tmp/tests" -instr-profile="$live_activity_tmp/tests.profdata" "$@"
xcrun llvm-cov export "$live_activity_tmp/tests" -summary-only -instr-profile="$live_activity_tmp/tests.profdata" "$@" | python3 -c 'import json,sys; totals=json.load(sys.stdin)["data"][0]["totals"]; low=[key for key in ("lines","functions","regions") if totals[key]["percent"] < 80]; sys.exit("Coverage below 80%: " + ", ".join(low) if low else 0)'
