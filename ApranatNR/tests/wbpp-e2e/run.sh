#!/bin/bash
# End-to-end test of the ApranatNR WBPP pipeline builder with the real WBPP,
# in separate headless PixInsight instances (automation mode does not save
# WBPP settings). Usage: tests/wbpp-e2e/run.sh [work directory]
set -euo pipefail

PI="${PIXINSIGHT:-/Applications/PixInsight/PixInsight.app/Contents/MacOS/PixInsight}"
WBPP="${WBPP_SCRIPT:-/Applications/PixInsight/src/scripts/BatchPreprocessing/WBPP.js}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BASE="${1:-$(mktemp -d)}"

run_pi() {
   # PixInsight leaves a stray folder in its working directory: keep it in BASE
   ( cd "$BASE" && "$PI" -n --automation-mode --no-startup-scripts --no-startup-check-updates \
        --no-splash -r="$1" --force-exit >/dev/null 2>&1 ) || true
}

run_wbpp() { # $1 = builder folder, $2 = output folder
   run_pi "$WBPP,automationMode=true,dir=$BASE/data,outputDirectory=$2,platesolve=false,usePipelineBuilderScript=true,pipelineBuilderScriptFile=$1/ApranatNR-WBPP-Builder.js"
}

rm -rf "$BASE/data" "$BASE/out" "$BASE/out-bad" "$BASE/builder" "$BASE/builder-bad" "$BASE/report.txt"
mkdir -p "$BASE/builder" "$BASE/builder-bad"
cp "$ROOT/ApranatNR-WBPP-Builder.js" "$BASE/builder/"
cp "$ROOT/ApranatNR-WBPP-Builder.js" "$BASE/builder-bad/"
cp "$HERE/settings-cosmicut.json" "$BASE/builder/ApranatNR-WBPP-Settings.json"
cp "$HERE/settings-invalid.json" "$BASE/builder-bad/ApranatNR-WBPP-Settings.json"

run_pi "$HERE/make-data.js,$BASE"
run_wbpp "$BASE/builder" "$BASE/out"
run_wbpp "$BASE/builder-bad" "$BASE/out-bad"
run_pi "$HERE/check.js,$BASE"

echo "work directory: $BASE"
cat "$BASE/report.txt"
grep -q "^RESULT: PASS" "$BASE/report.txt"
