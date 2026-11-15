#!/bin/sh
set -eu

case "${1:-}" in
  lobby|warehouse|inspection) ;;
  *) exit 2 ;;
esac
aid="${2:-none}"
case "$aid" in
  none|bucket|towel|clear|stair-sign) ;;
  *) exit 2 ;;
esac
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$(dirname "$0")"
case "$aid" in
  stair-sign) blender-headless --python render-stairs.py -- "$work/inspection.png" >&2 ;;
  bucket|towel) blender-headless --python render-leak.py -- "$work/inspection.png" "$aid" >&2 ;;
  *) blender-headless scene.blend --python script.py -- "$1" "$work/inspection.png" "$aid" >&2 ;;
esac
cat "$work/inspection.png"
