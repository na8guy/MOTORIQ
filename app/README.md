# MOTORIQ App (Flutter)

The MOTORIQ mobile app. Talks to the [MOTORIQ API](../backend) over REST and performs full
GET / POST / PATCH / DELETE against it.

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
  screens/
    login_screen.dart      Sign in / register
    home_screen.dart       Bottom-nav shell
    dashboard_tab.dart     Savings summary + membership
    wallet_tab.dart        Balance, top-up, virtual Mastercard, transactions
    vehicles_tab.dart      Vehicle CRUD (add / edit / delete)
    fuel_tab.dart          Fuel & EV price comparison
```

## Packages
`provider` (state), `http` (networking), `flutter_secure_storage` (tokens), `intl` (currency).
