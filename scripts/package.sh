#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

version=$(node -p "require('./manifest.json').version")
archive="dist/bigshoot-${version}.zip"

mkdir -p dist
rm -f "$archive"
zip -qr "$archive" manifest.json src icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png \
  -x '*.DS_Store'

echo "Created $archive"
