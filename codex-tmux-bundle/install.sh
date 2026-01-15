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
else
  cp -a "$bundle_dir/.tmux.conf" "$HOME/.tmux.conf"
fi

chmod +x "$HOME/.codex-accounts/bin/"* "$HOME/bin/"*

echo "Installed. If ~/bin isn't on PATH, add: export PATH=\"$HOME/bin:$PATH\""
