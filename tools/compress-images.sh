#!/usr/bin/env bash
# Compress generated PNG masters into web-ready images in assets/img/.
# Prefers cwebp (brew install webp); falls back to macOS sips JPEG.
set -euo pipefail

SRC="${1:?usage: compress-images.sh <src-dir-with-pngs> [out-dir]}"
OUT="${2:-$(dirname "$0")/../assets/img}"
mkdir -p "$OUT"

for f in "$SRC"/*.png; do
  name="$(basename "$f" .png)"
  if command -v cwebp >/dev/null 2>&1; then
    cwebp -quiet -q 80 -resize 1600 0 "$f" -o "$OUT/$name.webp"
    echo "$name.webp $(du -h "$OUT/$name.webp" | cut -f1)"
  else
    sips -Z 1600 -s format jpeg -s formatOptions 85 "$f" --out "$OUT/$name.jpg" >/dev/null
    echo "$name.jpg $(du -h "$OUT/$name.jpg" | cut -f1)"
  fi
done
