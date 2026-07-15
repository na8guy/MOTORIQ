import 'dart:io' show Platform;

/// Central configuration for the MOTORIQ app.
class AppConfig {
  /// Base URL of the MOTORIQ API.
  ///
  /// - iOS simulator / desktop / web: `localhost`
  /// - Android emulator: `10.0.2.2` maps to the host machine's localhost
  ///
  /// Override at build time with:
  ///   flutter run --dart-define=API_BASE_URL=https://api.motoriq.co.uk
  static String get apiBaseUrl {
    const fromEnv = String.fromEnvironment('API_BASE_URL');
    if (fromEnv.isNotEmpty) return fromEnv;

    var host = 'localhost';
    try {
      if (Platform.isAndroid) host = '10.0.2.2';
    } catch (_) {
      // Platform is unavailable on web; fall back to localhost.
    }
    return 'http://$host:4000/api/v1';
  }
}
