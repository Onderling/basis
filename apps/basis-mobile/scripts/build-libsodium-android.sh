#!/usr/bin/env bash
# OUR OWN LIBSODIUM FOR THE PHONE (ledger L835): build libsodium for the four Android ABIs from the source pinned in
# libsodium/PIN.json, and put it where react-native-libsodium's CMake reads it (libsodium/build/libsodium-android-*),
# instead of the package's prebuilt build.tgz (built on its maintainer's machine).
#
#   • the source is pinned by its SHA-256 AND verified with libsodium.org's minisign key (both; a missing minisign is an
#     error, never a skip). libsodium re-rolls its "-stable" tarball over time, so the name alone pins nothing;
#   • the build is reproducible with the pinned NDK (same bytes in any directory), so each library's SHA-256 is pinned
#     too, and a library that differs fails the build;
#   • the libraries in place already match the pin: nothing is done (a gradle build pays this once).
#
# Run by gradle before every build (android/build.gradle, task buildOwnLibsodium) and by CI (.github/workflows/
# libsodium.yml), which prints the sums. Usage: build-libsodium-android.sh [--check | --print]
#   --check  build and compare with the pinned sums, place nothing (CI: no app install needed; fails on a difference)
#   --print  build and print the sums, compare nothing (for pinning a new source or NDK, after review)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app="$(cd "$here/.." && pwd)"
pin="$app/libsodium/PIN.json"
mode="${1:-}"

field() { node -e 'const p=require(process.argv[1]); const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],p); if(v==null) process.exit(2); process.stdout.write(String(v));' "$pin" "$1"; }
sha() { sha256sum "$1" | cut -d' ' -f1; }

url="$(field url)"; source_sha="$(field sourceSha256)"; sig_url="$(field minisignUrl)"
pubkey="$app/libsodium/$(field minisignPublicKeyFile)"; ndk_version="$(field ndk)"; platform="$(field androidPlatform)"
abis=(armv7-a armv8-a x86 x86_64)

# where react-native-libsodium's CMake reads the libraries (only when placing them)
target=""
if [ -z "$mode" ]; then
  pkg="$(cd "$app" && node -p 'require("path").dirname(require.resolve("react-native-libsodium/package.json"))')"
  target="$pkg/libsodium/build"
fi

in_place() {
  for abi in "${abis[@]}"; do
    local dir so; dir="$(field "abis.$abi.dir")"; so="$target/$dir/lib/libsodium.so"
    [ -f "$so" ] && [ "$(sha "$so")" = "$(field "abis.$abi.soSha256")" ] || return 1
  done
}
if [ -z "$mode" ] && in_place; then echo "libsodium: our build is in place (pinned sums match)"; exit 0; fi

# the pinned NDK, exactly
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
ndk="${ANDROID_NDK_HOME:-$sdk/ndk/$ndk_version}"
[ -d "$ndk" ] && grep -q "Pkg.Revision = $ndk_version" "$ndk/source.properties" || { echo "libsodium: NDK $ndk_version not found at $ndk" >&2; exit 1; }
command -v minisign >/dev/null || { echo "libsodium: minisign is required to verify the source (apt install minisign)" >&2; exit 1; }

cache="${XDG_CACHE_HOME:-$HOME/.cache}/onderling-libsodium/$source_sha"
mkdir -p "$cache"
tarball="$cache/source.tar.gz"
if [ ! -f "$tarball" ] || [ "$(sha "$tarball")" != "$source_sha" ]; then
  curl -fsSL "$url" -o "$tarball.part" && mv "$tarball.part" "$tarball"
fi
[ "$(sha "$tarball")" = "$source_sha" ] || { echo "libsodium: the source's SHA-256 is not the pinned one" >&2; exit 1; }
curl -fsSL "$sig_url" -o "$cache/source.tar.gz.minisig"
minisign -Vm "$tarball" -x "$cache/source.tar.gz.minisig" -p "$pubkey" >/dev/null || { echo "libsodium: the source's signature does not verify" >&2; exit 1; }
echo "libsodium: source verified (sha256 $source_sha, minisign $(head -1 "$pubkey" | awk '{print $NF}'))"

# a work folder of its own per run: two builds at once (two worktrees, a developer and CI) never share one
work="$(mktemp -d "$cache/work.XXXXXX")"
trap 'rm -rf "$work"' EXIT
tar -xzf "$tarball" -C "$work"
src="$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -1)"

failed=0
for abi in "${abis[@]}"; do
  (cd "$src" && ANDROID_NDK_HOME="$ndk" NDK_PLATFORM="$platform" "dist-build/android-$abi.sh" > "$cache/build-$abi.$$.log" 2>&1) \
    || { echo "libsodium: the $abi build failed (log: $cache/build-$abi.$$.log)" >&2; exit 1; }
  dir="$(field "abis.$abi.dir")"; got="$(sha "$src/$dir/lib/libsodium.so")"; want="$(field "abis.$abi.soSha256")"
  echo "libsodium: $abi $got"
  if [ "$mode" != "--print" ] && [ "$got" != "$want" ]; then echo "libsodium: $abi differs from the pinned $want" >&2; failed=1; fi
done
[ "$failed" = 0 ] || exit 1
[ -n "$mode" ] && { echo "libsodium: $mode done (nothing placed)"; exit 0; }

# in place of the prebuilt: only the four Android directories this build owns
mkdir -p "$target"
for abi in "${abis[@]}"; do
  dir="$(field "abis.$abi.dir")"
  rm -rf "$target/$dir"
  cp -R "$src/$dir" "$target/$dir"
done
in_place && echo "libsodium: our build is in place"
