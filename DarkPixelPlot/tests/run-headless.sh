#!/bin/bash
# Runs DarkPixelPlot in a separate headless PixInsight instance.
# Usage: tests/run-headless.sh <dark folder> <file name regex> <output.png> [defect map .xisf|""] [extra options, e.g. --yaxis=apranat]
# Writes <output.png> and <output>.json (or <output.png>.error.txt on failure).
set -euo pipefail

PI="${PIXINSIGHT:-/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight}"
HERE="$(cd "$(dirname "$0")" && pwd)"
DARKS="$1"; PATTERN="$2"; OUT="$3"; MAP="${4:-}"
# the tool always writes PNG and appends .png when it is missing
case "$OUT" in *.png|*.PNG) ;; *) OUT="$OUT.png" ;; esac
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# -r arguments are separated by commas: link the inputs to paths without spaces
ln -s "$DARKS" "$WORK/darks"
FILES=$(ls "$WORK/darks/" | grep -E "$PATTERN" | sed "s#^#$WORK/darks/#" | paste -sd, -)
[ -n "$FILES" ] || { echo "no dark frame matches $PATTERN" >&2; exit 1; }
ARGS="--out=$OUT"
if [ -n "$MAP" ]; then ln -s "$MAP" "$WORK/map.xisf"; ARGS="$ARGS,--map=$WORK/map.xisf"; fi
if [ -n "${5:-}" ]; then ARGS="$ARGS,$5"; fi

rm -f "$OUT" "${OUT%.*}.json" "$OUT.error.txt"
# PixInsight leaves a stray folder in its working directory: keep it in WORK
( cd "$WORK" && "$PI" -n --automation-mode --no-startup-scripts --no-startup-check-updates --no-splash \
     -r="$HERE/../DarkPixelPlot.js,$ARGS,$FILES" --force-exit >/dev/null 2>&1 ) || true

if [ -f "$OUT.error.txt" ]; then cat "$OUT.error.txt" >&2; exit 1; fi
[ -f "$OUT" ] || { echo "no output written" >&2; exit 1; }
cat "${OUT%.*}.json"
