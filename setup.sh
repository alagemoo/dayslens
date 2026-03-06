#!/bin/bash
set -e

echo ""
echo " ============================================"
echo "  DayLens — Setup Script (macOS / Linux)"
echo " ============================================"
echo ""

echo "[1/3] Installing dependencies..."
npm install

echo ""
echo "[2/3] Rebuilding native modules for Electron..."
npx electron-rebuild || echo "WARNING: electron-rebuild had issues, trying to continue..."

echo ""
echo "[3/3] Setup complete!"
echo ""
echo " To launch DayLens, run:"
echo "   npm start"
echo ""
