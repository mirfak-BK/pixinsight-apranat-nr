#!/bin/bash
# Runs FlatSmooth in a separate headless PixInsight instance.
# Usage: tests/run-headless.sh <master flat> <output.xisf> [options, comma separated, e.g. --radius=4 or --check]
# Prints the JSON summary (<output>.json), or the error (<output>.error.txt) and exits 1.
set -euo pipefail

PI="${PIXINSIGHT:-/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight}"
HERE="$(cd "$(dirname "$0")" && pwd)"
FLAT="$1"; OUT="$2"; OPTS="${3:-}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# -r arguments are separated by commas and the paths may contain spaces: link them
ln -s "$FLAT" "$WORK/flat.${FLAT##*.}"
mkdir -p "$(dirname "$OUT")"; ln -s "$(cd "$(dirname "$OUT")" && pwd)" "$WORK/out"
NAME="$(basename "$OUT")"
ARGS="--out=$WORK/out/$NAME"
[ -n "$OPTS" ] && ARGS="$ARGS,$OPTS"

rm -f "$OUT.json" "$OUT.error.txt"
# PixInsight leaves a stray folder in its working directory: keep it in WORK
( cd "$WORK" && "$PI" -n --automation-mode --no-startup-scripts --no-startup-check-updates --no-splash \
     -r="$HERE/../FlatSmooth.js,$ARGS,$WORK/flat.${FLAT##*.}" --force-exit >/dev/null 2>&1 ) || true

if [ -f "$OUT.error.txt" ]; then cat "$OUT.error.txt" >&2; exit 1; fi
[ -f "$OUT.json" ] || { echo "no summary written" >&2; exit 1; }
cat "$OUT.json"
