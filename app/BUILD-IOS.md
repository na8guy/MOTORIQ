# Building the MOTORIQ IPA for iPhone (iOS 26)

## ✅ Status: the app compiles for iOS. Two things stand between you and an installable IPA.

I generated the native `ios/` project, added the location/maps permissions, and **built
the app all the way to an unsigned iOS archive** — so the Dart + native code is verified
good (`flutter analyze` = 0 errors; `flutter build ios --simulator` = `✓ Built Runner.app`;
`flutter build ipa --no-codesign` = `Runner.xcarchive`, 168 MB).

The only two remaining blockers are environmental — **not code**:

### 🔴 Blocker 1 — your project is in iCloud-synced `~/Documents`
`~/Documents/MOTORIQ` is under macOS **iCloud "Desktop & Documents" sync**. Its File
Provider stamps `com.apple.fileprovider.fpfs#P` / `com.apple.FinderInfo` xattrs onto build
artifacts, and **`codesign` rejects them** (`resource fork, Finder information, or similar
detritus not allowed`). This is why builds fail *inside* `~/Documents`. **Fix — move the
project out of iCloud**, e.g.:
```bash
mkdir -p ~/Developer && mv ~/Documents/MOTORIQ ~/Developer/MOTORIQ
```
(or turn off System Settings → Apple ID → iCloud → Drive → "Desktop & Documents Folders").
I already proved this works by building a copy at **`~/motoriq_ios_build`** (outside iCloud)
— that build succeeded and produced `build/ios/archive/Runner.xcarchive`.

### 🔴 Blocker 2 — no Apple code-signing identity
A device-installable IPA *requires* signing with **your Apple ID** (Apple ties the
provisioning profile to your account + the iPhone's UDID). I can't log into your Apple ID,
so this final step is yours. A **free Apple ID works** for your own device (7-day expiry).

---

**Fastest way to finish from here** (Xcode 26.6 is installed and supports iOS 26):
```bash
# 1. Get the project out of iCloud (one-time)
mv ~/Documents/MOTORIQ ~/Developer/MOTORIQ && cd ~/Developer/MOTORIQ/app
# 2. Sign & install straight to the connected iPhone
open ios/Runner.xcworkspace     # Signing & Capabilities → pick your Team, set a unique bundle id
flutter run --release --dart-define=API_BASE_URL=https://<your-render>.onrender.com/api/v1
```
**Or** sign the archive I already built: open
`~/motoriq_ios_build/build/ios/archive/Runner.xcarchive` in **Xcode → Window → Organizer →
Distribute App → set your Team → export the `.ipa`.**

---

_Original setup notes below still apply._

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
