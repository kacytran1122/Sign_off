#!/bin/sh
set -eu

case "${1:-}" in
  lobby|warehouse|inspection) ;;
  *) exit 2 ;;
esac
case "${2:-none}" in
  none|bucket|towel|clear|stair-sign) ;;
  *) exit 2 ;;
esac
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd /opt/fix-this-spot-blender
if [ "${2:-none}" = stair-sign ]; then
  blender-headless --python render-stairs.py -- "$work/inspection.png" >&2
elif [ "${2:-none}" = bucket ]; then
  blender-headless --python render-leak.py -- "$work/inspection.png" >&2
else
  blender-headless scene.blend --python script.py -- "$1" "$work/inspection.png" "${2:-none}" >&2
fi
cat "$work/inspection.png"
