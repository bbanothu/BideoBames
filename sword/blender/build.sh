#!/usr/bin/env bash
# Rebuild the Blender assets (assets/models/*.glb + blender/*.blend).
# Uses $BLENDER if set, else ../tools/blender-*/blender. On ARM Linux (no native Blender build)
# the x86-64 Blender runs through FEX inside muvm, which gives it the 4K pages it needs.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
blender="${BLENDER:-$(ls -d "$here"/../tools/blender-*/blender 2>/dev/null | head -1)}"
[ -x "$blender" ] || { echo "Blender not found; set BLENDER=/path/to/blender" >&2; exit 1; }
log="$here/blender/build.log"
# Scripts to run: arguments, or every build step by default.
scripts=("$@")
[ ${#scripts[@]} -gt 0 ] || scripts=(build_assets.py build_ritual.py)
: > "$log"
for script in "${scripts[@]}"; do
  cmd=("$blender" -b --factory-startup --python "$here/blender/$script" -- "$here")
  if [ "$(uname -m)" = "aarch64" ] && command -v muvm >/dev/null; then
    # muvm doesn't forward stdout, so capture Blender's output into the log file.
    muvm -- bash -c "$(printf '%q ' "${cmd[@]}") >> $(printf '%q' "$log") 2>&1"
  else
    "${cmd[@]}" 2>&1 | tee -a "$log"
  fi
done
grep -E "\[(assets|ritual)\]|Error|Traceback" "$log" || true
