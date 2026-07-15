#!/usr/bin/env bash
# Build a signed MOTORIQ IPA for an iPhone (e.g. iPhone 14 Pro Max / iOS 26).
# Run from the `app/` directory on a Mac with Xcode + Flutter installed.
#
#   API_BASE_URL   API to bake in (defaults to your Render URL if set)
#   TEAM_ID        Apple Developer Team ID (required for a signed IPA)
#
# Usage:
#   TEAM_ID=ABCDE12345 API_BASE_URL=https://motoriq-api.onrender.com/api/v1 \
#     ./scripts/build-ipa.sh
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-https://motoriq-api.onrender.com/api/v1}"

echo "▶ Flutter version"; flutter --version

# 1. Generate native platform folders if missing (safe to re-run).
if [ ! -d ios ]; then
  echo "▶ Generating native platform projects (flutter create .)"
  flutter create .
fi

# 2. Fetch packages.
echo "▶ flutter pub get"; flutter pub get

# 3. Build the IPA.
if [ -n "${TEAM_ID:-}" ]; then
  echo "▶ Building signed IPA (team $TEAM_ID) → API $API_BASE_URL"
  # Substitute the team id into a working copy of the export options.
  sed "s/YOUR_TEAM_ID/$TEAM_ID/" ios_config/ExportOptions.plist > ios_config/ExportOptions.local.plist
  flutter build ipa \
    --release \
    --dart-define=API_BASE_URL="$API_BASE_URL" \
    --export-options-plist=ios_config/ExportOptions.local.plist
  echo "✅ IPA at: build/ios/ipa/*.ipa"
else
  echo "▶ TEAM_ID not set — building an unsigned archive instead."
  echo "  (You can open the archive in Xcode to sign & export.)"
  flutter build ipa --release --dart-define=API_BASE_URL="$API_BASE_URL" --no-codesign || true
  echo "ℹ️  Archive at: build/ios/archive/Runner.xcarchive"
  echo "   Open it in Xcode → Distribute App → Development, pick your team, export the IPA."
fi
