#!/usr/bin/env bash
set -euo pipefail

bundle_dir="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$HOME/.codex-accounts/bin" "$HOME/.codex-accounts/accounts" "$HOME/bin"

cp -a "$bundle_dir/codex-accounts/bin/"* "$HOME/.codex-accounts/bin/"
cp -a "$bundle_dir/bin/"* "$HOME/bin/"

# Merge or replace tmux.conf depending on existing content
if [ -f "$HOME/.tmux.conf" ]; then
  # Append only if our lines are missing
  conf_has_plugin=0
  if command -v rg >/dev/null 2>&1; then
    rg -q "tmux-plugins/tpm" "$HOME/.tmux.conf" && conf_has_plugin=1 || true
  else
    grep -q "tmux-plugins/tpm" "$HOME/.tmux.conf" && conf_has_plugin=1 || true
  fi
  if [ "$conf_has_plugin" -eq 0 ]; then
    printf '\n# Codex tmux plugins\n' >> "$HOME/.tmux.conf"
    cat "$bundle_dir/.tmux.conf" >> "$HOME/.tmux.conf"
  fi
  # Ensure mouse support is enabled
  has_mouse=0
  has_mode_keys=0
  if command -v rg >/dev/null 2>&1; then
    rg -q -F "set -g mouse on" "$HOME/.tmux.conf" && has_mouse=1 || true
    rg -q -F "setw -g mode-keys vi" "$HOME/.tmux.conf" && has_mode_keys=1 || true
  else
    grep -qF "set -g mouse on" "$HOME/.tmux.conf" && has_mouse=1 || true
    grep -qF "setw -g mode-keys vi" "$HOME/.tmux.conf" && has_mode_keys=1 || true
  fi
  if [ "$has_mouse" -eq 0 ] || [ "$has_mode_keys" -eq 0 ]; then
    if ! grep -qF "Codex tmux extras" "$HOME/.tmux.conf"; then
      printf '\n# Codex tmux extras\n' >> "$HOME/.tmux.conf"
    fi
    if [ "$has_mouse" -eq 0 ]; then
      printf 'set -g mouse on\n' >> "$HOME/.tmux.conf"
    fi
    if [ "$has_mode_keys" -eq 0 ]; then
      printf 'setw -g mode-keys vi\n' >> "$HOME/.tmux.conf"
    fi
  fi
else
  cp -a "$bundle_dir/.tmux.conf" "$HOME/.tmux.conf"
fi

chmod +x "$HOME/.codex-accounts/bin/"* "$HOME/bin/"*

echo "Installed. If ~/bin isn't on PATH, add: export PATH=\"$HOME/bin:$PATH\""
