# Source this file before Rust commands in shells or Xcode build phases.
# Explicit homes take precedence; otherwise support standard rustup and XDG installs.
# Applies only to the current process and does not require Java or Android SDKs.

if [ -z "${CARGO_HOME:-}" ]; then
  if [ -f "$HOME/.cargo/env" ] || [ -x "$HOME/.cargo/bin/cargo" ]; then
    CARGO_HOME="$HOME/.cargo"
  elif [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/cargo/env" ] || [ -x "${XDG_CONFIG_HOME:-$HOME/.config}/cargo/bin/cargo" ]; then
    CARGO_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/cargo"
  else
    CARGO_HOME="$HOME/.cargo"
  fi
fi

if [ -z "${RUSTUP_HOME:-}" ]; then
  if [ -f "$HOME/.rustup/settings.toml" ]; then
    RUSTUP_HOME="$HOME/.rustup"
  elif [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/rustup/settings.toml" ]; then
    RUSTUP_HOME="${XDG_CONFIG_HOME:-$HOME/.config}/rustup"
  else
    RUSTUP_HOME="$HOME/.rustup"
  fi
fi
export CARGO_HOME RUSTUP_HOME

if [ -f "$CARGO_HOME/env" ]; then
  . "$CARGO_HOME/env"
elif [ -d "$CARGO_HOME/bin" ]; then
  case ":$PATH:" in
    *":$CARGO_HOME/bin:"*) ;;
    *) export PATH="$CARGO_HOME/bin:$PATH" ;;
  esac
fi

if ! command -v cargo >/dev/null 2>&1; then
  printf '%s\n' 'Cargo not found. Install Rust or set CARGO_HOME and RUSTUP_HOME.' >&2
  return 1
fi
