# Building the MOTORIQ IPA for iPhone (iOS 26)

> **Honest note:** I could not build the IPA inside the assistant's sandbox — it has
> **no Flutter SDK, no `ios/` project, and no Apple code-signing identity**. A
> device-installable IPA for a physical iPhone 14 Pro Max *requires* signing in with
> your Apple ID (Apple ties the provisioning profile to your account + the device's
> UDID), which only you can do. The good news: **this Mac already has Xcode 26.6**,
> which supports iOS 26 — so you can build it here in a few minutes.

## Prerequisites (one-time)
1. **Xcode 26.6** — already installed. ✅
2. **Flutter SDK** — not installed. Install it:
   ```bash
   brew install --cask flutter        # or: https://docs.flutter.dev/get-started/install/macos
   flutter doctor                     # accept Xcode licence if prompted:
   sudo xcodebuild -license accept
   ```
3. **CocoaPods** (Flutter iOS needs it):
   ```bash
   sudo gem install cocoapods         # or: brew install cocoapods
   ```
4. **An Apple account for signing** — either:
   - a **free Apple ID** (installs on *your* device, app expires after 7 days), or
   - a paid **Apple Developer** account ($99/yr) for TestFlight/ad-hoc.

## Fastest path — install straight to the connected iPhone
Plug the iPhone 14 Pro Max into the Mac, trust the computer, then:
```bash
cd app
flutter create .                       # generates ios/ android/ (first time only)
flutter pub get
open ios/Runner.xcworkspace            # Xcode → Runner target → Signing & Capabilities:
                                       #   • tick "Automatically manage signing"
                                       #   • pick your Team (your Apple ID)
                                       #   • set a unique Bundle Identifier, e.g. com.yourname.motoriq
flutter devices                        # confirm the iPhone shows up
flutter run --release \
  --dart-define=API_BASE_URL=https://<your-render-service>.onrender.com/api/v1
```
This compiles, signs, installs, and launches on the phone. On the iPhone, approve the
developer under **Settings → General → VPN & Device Management** the first time.

## Producing an actual `.ipa` file
```bash
cd app
# One-time: add the location/maps permissions to ios/Runner/Info.plist (see README).
TEAM_ID=YOUR_TEAM_ID \
API_BASE_URL=https://<your-render-service>.onrender.com/api/v1 \
  ./scripts/build-ipa.sh
```
- Find your **Team ID** in Xcode → Settings → Accounts (or developer.apple.com → Membership).
- Output: **`build/ios/ipa/*.ipa`**.
- The signing config lives in [`ios_config/ExportOptions.plist`](ios_config/ExportOptions.plist)
  (set `method` = `development` for a personal device, `ad-hoc` for a device list).

Without `TEAM_ID` the script builds an **unsigned archive** at
`build/ios/archive/Runner.xcarchive` — open it in Xcode → **Distribute App →
Development**, choose your team, and export the IPA there.

## Installing the IPA on the iPhone
- **Xcode:** Window → Devices and Simulators → select the phone → drag the `.ipa` in, **or**
- ```bash
  flutter install --use-application-binary build/ios/ipa/Runner.ipa
  ```
- **Apple Configurator** (Mac App Store) also sideloads an `.ipa`.

## iOS 26 beta specifics
- Xcode 26.6 (installed) ships the iOS 26 SDK, so it targets the device fine.
- If Xcode says the device's iOS is newer than its SDK, update Xcode from the App Store.
- Deployment target is iOS 12+ by default from `flutter create`; the iPhone 14 Pro Max on
  iOS 26 is well within range.

## Before you build — permissions
The Fuel tab uses location + maps. After `flutter create .`, add the `Info.plist` and
`AndroidManifest.xml` snippets from [`README.md`](README.md) → *Location + maps permissions*.
