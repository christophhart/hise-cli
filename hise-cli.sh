#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -d "$DIR/node_modules" ]; then
    echo "Installing dependencies..."
    npm install --prefix "$DIR"
fi
if [ ! -d "$DIR/dist" ]; then
    echo "Building..."
    npm run --prefix "$DIR" build
fi
node "$DIR/dist/index.js" "$@"
