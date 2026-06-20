#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check dependencies
command -v node >/dev/null 2>&1 || error "Node.js is required. Install with: brew install node"
command -v ares-package >/dev/null 2>&1 || error "ares-package not found. Install with: npm install -g @webos-tools/cli"

# Install npm deps if needed
if [ ! -d node_modules ]; then
  info "Installing dependencies..."
  npm install
fi

# Type check
info "Type checking..."
npx tsc --noEmit

# Bundle
info "Bundling with esbuild..."
node esbuild.config.mjs

# Compile the upload service (TypeScript -> Node CommonJS)
info "Building upload service..."
rm -rf build/upload-service
npx tsc -p upload-service/tsconfig.json
cp upload-service/package.json build/upload-service/
cp upload-service/src/services.json upload-service/src/upload-page.html build/upload-service/

# Package IPK (--no-minify since esbuild already minifies)
info "Packaging IPK..."
ares-package --no-minify -e "*preview-libs.js" dist build/upload-service -o .

IPK=$(ls -t *.ipk 2>/dev/null | head -1)
info "Built: $IPK ($(du -h "$IPK" | cut -f1))"

# Deploy if --install flag
if [ "$1" = "--install" ]; then
  DEVICE="${2:-$(ares-setup-device -F -j 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const a=JSON.parse(d);const t=a.find(x=>x.default);console.log(t?t.name:a[0]?.name||'')}catch{}
    })
  ")}"
  if [ -z "$DEVICE" ]; then
    error "No device found. Run: ares-setup-device"
  fi
  info "Installing on $DEVICE..."
  ares-install --device "$DEVICE" "$IPK"
  # webOS keeps the old instance suspended through an in-place upgrade; a plain
  # relaunch resumes that stale in-memory copy — so close after installing, then
  # cold-start so the new bundle loads.
  info "Terminating stale instance..."
  ares-launch --device "$DEVICE" --close com.lennylxx.iptv 2>/dev/null || true
  sleep 1
  info "Launching..."
  ares-launch --device "$DEVICE" com.lennylxx.iptv
  info "Done! App is running on $DEVICE"
fi
