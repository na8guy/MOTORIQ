# MOTORIQ App (Flutter)

The MOTORIQ mobile app. Talks to the [MOTORIQ API](../backend) over REST and performs full
GET / POST / PATCH / DELETE against it.

## First-time setup

This repo contains the Dart source (`lib/`) and `pubspec.yaml`. Generate the
native platform folders once, then install packages:

```bash
cd app
flutter create .      # scaffolds android/ ios/ web/ (keeps lib/ and pubspec)
flutter pub get
```

### Location + maps permissions (for the Fuel tab)

The Fuel tab uses the device location (`geolocator`) and opens directions in a
maps app (`url_launcher`). Add these after `flutter create .`:

**Android** — `android/app/src/main/AndroidManifest.xml`, inside `<manifest>`:
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.INTERNET"/>
<queries>
  <intent><action android:name="android.intent.action.VIEW"/><data android:scheme="https"/></intent>
</queries>
```

**iOS** — `ios/Runner/Info.plist`:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>MOTORIQ uses your location to find the cheapest fuel near you.</string>
<key>LSApplicationQueriesSchemes</key>
<array><string>https</string><string>comgooglemaps</string></array>
```

Without location permission the app falls back to central London.

### Push notifications (optional, production)

The app registers a device token so the backend can send push. For **real**
FCM delivery, add Firebase to the app (`flutterfire configure`, add
`firebase_messaging`) and replace the generated token in
`AuthState._registerDevice()` with `FirebaseMessaging.instance.getToken()`.
Until then, notifications still appear in the in-app inbox.

## Run

```bash
flutter pub get
flutter run
```

- **iOS simulator / macOS / web:** uses `http://localhost:4000/api/v1`.
- **Android emulator:** automatically uses `http://10.0.2.2:4000/api/v1` (host localhost).
- **Custom / deployed API:** `flutter run --dart-define=API_BASE_URL=https://…/api/v1`

Make sure the backend is running first (`cd ../backend && npm run dev`).

**Demo login:** `demo@motoriq.co.uk` / `password123` (pre-filled on the login screen).

## Structure

```
lib/
  app_config.dart          API base URL resolution
  main.dart                App root + auth-gated routing
  theme.dart               Brand theme + money formatting
  models/models.dart       API response models
  services/
    api_client.dart        HTTP, secure token storage, auto refresh-and-retry
    repositories.dart      Typed feature repositories (auth, vehicles, wallet, fuel)
  state/auth_state.dart    ChangeNotifier auth/session state
  services/location.dart   Device location (geolocator) + maps launch (url_launcher)
  screens/
    login_screen.dart          Sign in / register
    home_screen.dart           Bottom-nav shell (Home · Wallet · Fuel · Vehicles · More)
    dashboard_tab.dart         Savings summary + membership
    wallet_tab.dart            Balance, top-up, virtual Mastercard, transactions
    fuel_tab.dart              Ranked cheapest fuel + savings each + Navigate
    vehicles_tab.dart          Vehicle CRUD
    more_tab.dart              Hub: KYC banner + links below
    kyc_screen.dart            Identity verification (gates money features)
    insights_screen.dart       Daily/weekly/monthly savings + AI tips + log fill-up
    subscriptions_screen.dart  Free · Plus · Drive · Drive+ with mileage packages
    referrals_screen.dart      Give £10 / get £10 codes
    reminders_screen.dart      MOT / tax / service / insurance reminders
    notifications_screen.dart  In-app notification inbox
```

## Packages
`provider` (state), `http` (networking), `flutter_secure_storage` (tokens),
`intl` (currency/dates), `geolocator` (location), `url_launcher` (maps navigation).
