#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
vm_dir="$project_dir/.fix-this-spot/blender-vm"
export LIMA_HOME="$(cat "$vm_dir/lima-home")"
exec "$vm_dir/lima/bin/limactl" shell --workdir / fix-this-spot -- \
  /opt/fix-this-spot-blender/render.sh "$@"
