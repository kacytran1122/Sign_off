#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
vm_dir="$project_dir/.fix-this-spot/blender-vm"
downloads="$vm_dir/downloads"
version=2.3.0
archive="lima-$version-Darwin-arm64.tar.gz"
release="https://github.com/lima-vm/lima/releases/download/v$version"
mkdir -p "$downloads" "$vm_dir/lima"
socket_dir="$(cat "$vm_dir/lima-home" 2>/dev/null || true)"
if [[ ! -d "$socket_dir" || -L "$socket_dir" ]]; then
  socket_dir="$(mktemp -d /tmp/fix-spot-vm.XXXXXX)"
  printf '%s\n' "$socket_dir" > "$vm_dir/lima-home"
fi
export LIMA_HOME="$socket_dir"
lima="$vm_dir/lima/bin/limactl"

if [[ ! -x "$lima" ]]; then
  curl --http1.1 --retry 3 --retry-all-errors -fLSs "$release/SHA256SUMS" -o "$downloads/SHA256SUMS"
  (
    cd "$downloads"
    if ! grep "  $archive$" SHA256SUMS | shasum -a 256 -c - >/dev/null 2>&1; then
      curl --http1.1 --retry 3 --retry-all-errors -fLSs -C - "$release/$archive" -o "$archive"
    fi
    grep "  $archive$" SHA256SUMS | shasum -a 256 -c -
    tar -xzf "$archive" -C "$vm_dir/lima"
  )
fi

config="$project_dir/backend/blender/lima.yaml"
image="$downloads/debian-12-genericcloud-arm64.qcow2"
if [[ -f "$image" ]]; then
  archive_name="$(basename "$image")"
  curl --http1.1 -fLSs https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS -o "$downloads/SHA512SUMS"
  if (cd "$downloads" && grep "  $archive_name$" SHA512SUMS | shasum -a 512 -c -); then
    config="$vm_dir/local-image.yaml"
    sed "s|https://cloud.debian.org/images/cloud/bookworm/latest/$archive_name|$image|" "$project_dir/backend/blender/lima.yaml" > "$config"
  fi
fi

if "$lima" list -q | grep -Fxq fix-this-spot; then
  "$lima" start --tty=false fix-this-spot
else
  "$lima" start --tty=false --name=fix-this-spot "$config"
fi

"$lima" shell --workdir / fix-this-spot -- sudo sh -s <<'GUEST'
set -eu
if ! command -v blender >/dev/null; then
  apt-get -q -o Acquire::Retries=3 update
  DEBIAN_FRONTEND=noninteractive apt-get -qy -o Acquire::Retries=3 -o Acquire::ForceIPv4=true \
    --no-install-recommends install blender
fi
mkdir -p /opt/fix-this-spot-blender
cat >/usr/local/bin/blender-headless <<'WRAPPER'
#!/bin/sh
exec blender --background --factory-startup --threads 4 --python-exit-code 1 "$@"
WRAPPER
chmod 755 /usr/local/bin/blender-headless
GUEST

COPYFILE_DISABLE=1 tar -cf - -C "$project_dir/backend/blender" create-scene.py script.py render.sh guide_scene.py render-stairs.py render-leak.py render-model.py |
  "$lima" shell --workdir / fix-this-spot -- sudo tar -xf - -C /opt/fix-this-spot-blender
"$lima" shell --workdir / fix-this-spot -- sudo blender-headless \
  --python /opt/fix-this-spot-blender/create-scene.py -- /opt/fix-this-spot-blender/scene.blend
