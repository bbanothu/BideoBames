#!/usr/bin/env bash
# Rebuild the character models: blender/build_chars.sh [char_1 char_2 ... villain_1]
# Sources live in blender/ (char_N) and assets/source/villain_1/; output goes to assets/models/<id>.glb.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
blender="${BLENDER:-$(ls -d "$here"/../tools/blender-*/blender 2>/dev/null | head -1)}"
declare -A SRC=(
  [char_1]="$here/blender/char_1.blend" [char_2]="$here/blender/char_2.blend" [char_3]="$here/blender/char_3.blend"
  [char_4]="$here/blender/char_4blend" [villain_1]="$here/assets/source/villain_1/human-skeleton.blend"
)
models=("$@")
[ ${#models[@]} -gt 0 ] || models=(char_1 char_2 char_3 char_4 villain_1)
for m in "${models[@]}"; do
  log="$here/blender/build_$m.log"
  cmd=("$blender" -b "${SRC[$m]}" --python "$here/blender/build_characters.py" -- "$here" "$m")
  if [ "$(uname -m)" = "aarch64" ] && command -v muvm >/dev/null; then
    muvm -- bash -c "$(printf '%q ' "${cmd[@]}") > $(printf '%q' "$log") 2>&1" || true
  else
    "${cmd[@]}" > "$log" 2>&1 || true
  fi
  grep -E "\[chars\]|Error|Traceback" "$log" | cut -c1-400 || true
done
