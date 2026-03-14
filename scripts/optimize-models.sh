#!/bin/bash
# ── Hood Racer — Model Optimization Script ──
set -e

MODELS_DIR="$(dirname "$0")/../public/models"
BACKUP_DIR="$MODELS_DIR/originals"
mkdir -p "$BACKUP_DIR"

echo "═══ Hood Racer Model Optimizer ═══"

for glb in "$MODELS_DIR"/*.glb; do
  filename=$(basename "$glb")
  
  if [ ! -f "$BACKUP_DIR/$filename" ]; then
    echo "📦 Backing up: $filename"
    cp "$glb" "$BACKUP_DIR/$filename"
  fi
  
  original_size=$(stat -f%z "$glb" 2>/dev/null || stat -c%s "$glb")
  echo "🔧 Optimizing: $filename ($(echo "scale=1; $original_size/1048576" | bc)MB)"
  
  npx -y @gltf-transform/cli dedup "$glb" "$glb" 2>&1 | tail -1 || true
  npx -y @gltf-transform/cli prune "$glb" "$glb" 2>&1 | tail -1 || true
  npx -y @gltf-transform/cli draco "$glb" "$glb" 2>&1 | tail -1
  
  new_size=$(stat -f%z "$glb" 2>/dev/null || stat -c%s "$glb")
  reduction=$(echo "scale=0; (1 - $new_size / $original_size) * 100" | bc)
  echo "   ✅ $(echo "scale=1; $original_size/1048576" | bc)MB → $(echo "scale=1; $new_size/1048576" | bc)MB (${reduction}% smaller)"
done

echo "═══ Done! Originals in: $BACKUP_DIR ═══"
