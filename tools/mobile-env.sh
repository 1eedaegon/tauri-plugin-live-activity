# Source this file from the repository root: source tools/mobile-env.sh
# Applies only to the current shell; leaves Nix and shell startup files unchanged.

if [ -n "${ZSH_VERSION:-}" ]; then
  live_activity_env_source="${(%):-%x}"
elif [ -n "${BASH_VERSION:-}" ]; then
  live_activity_env_source="${BASH_SOURCE[0]}"
else
  live_activity_env_source="./tools/mobile-env.sh"
fi
. "$(dirname "$live_activity_env_source")/rust-env.sh" || return 1
unset live_activity_env_source

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/30.0.16248370}"

if [ ! -x "$JAVA_HOME/bin/java" ] || [ ! -d "$NDK_HOME/toolchains/llvm" ]; then
  printf '%s\n' 'Java or Android NDK is missing. See docs/development.md.' >&2
  return 1
fi

for live_activity_bin in "$ANDROID_HOME/cmdline-tools/latest/bin" "$ANDROID_HOME/platform-tools"; do
  if [ ! -d "$live_activity_bin" ]; then
    printf 'Android SDK directory is missing: %s\n' "$live_activity_bin" >&2
    unset live_activity_bin
    return 1
  fi
  case ":$PATH:" in
    *":$live_activity_bin:"*) ;;
    *) export PATH="$live_activity_bin:$PATH" ;;
  esac
done
unset live_activity_bin
