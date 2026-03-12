#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/dist/index.js" "$@"
