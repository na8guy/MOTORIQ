import 'dart:io' show Platform;
import 'services/secure_store.dart';

/// Central configuration for the SaveOnDrive app.
///
/// API base URL resolution order:
///   1. a runtime override the user set in-app (persisted) — lets an already
///      installed build be pointed at a new server without rebuilding;
///   2. a compile-time --dart-define=API_BASE_URL=...;
///   3. a sensible per-platform default.
class AppConfig {
  static const _kApiUrl = 'saveondrive_api_url';
  static const _envUrl = String.fromEnvironment('API_BASE_URL');

  static String? _override;

  /// Production API. Used by default so a plain `flutter build`/`flutter run`
  /// works on a real device with no configuration.
  static const productionUrl = 'https://motoriq-api.onrender.com/api/v1';

  /// Local dev API (host machine). Only used when USE_LOCAL_API=true.
  static String get _localUrl {
    var host = 'localhost';
    try {
      if (Platform.isAndroid) host = '10.0.2.2'; // Android emulator → host machine
    } catch (_) {
      // Platform unavailable (web) — fall back to localhost.
    }
    return 'http://$host:4000/api/v1';
  }

  static const _useLocal = bool.fromEnvironment('USE_LOCAL_API');

  static String get apiBaseUrl {
    if (_override != null && _override!.isNotEmpty) return _override!;
    if (_envUrl.isNotEmpty) return _envUrl;
    // Opt in to the local backend with --dart-define=USE_LOCAL_API=true
    if (_useLocal) return _localUrl;
    return productionUrl;
  }

  /// Whether a compile-time or runtime URL is configured (vs the local default).
  static bool get hasExplicitUrl =>
      (_override != null && _override!.isNotEmpty) || _envUrl.isNotEmpty;

  /// Load any persisted override at startup.
  static Future<void> loadOverride() async {
    try {
      _override = await SecureStore.read(_kApiUrl);
    } catch (_) {
      _override = null;
    }
  }

  /// Persist and apply a runtime override (pass null/empty to clear).
  static Future<void> saveOverride(String? url) async {
    final v = (url == null || url.trim().isEmpty) ? null : url.trim();
    _override = v;
    try {
      if (v == null) {
        await SecureStore.delete(_kApiUrl);
      } else {
        await SecureStore.write(_kApiUrl, v);
      }
    } catch (_) {/* ignore storage errors */}
  }
}
