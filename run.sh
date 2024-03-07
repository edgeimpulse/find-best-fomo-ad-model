#!/bin/bash
set -e

SCRIPTPATH="$( cd "$(dirname "$0")" ; pwd -P )"

cd $SCRIPTPATH

OUTPUT_DIR=$(node build/get-out-dir.js "$@")
echo "Output dir is $OUTPUT_DIR"
echo ""
node build/search.js "$@"

echo ""
echo "Analyzing results..."
node build/analyze.js --out-directory "$OUTPUT_DIR"
