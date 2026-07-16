import 'dart:io' show Platform;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Central configuration for the MOTORIQ app.
///
/// API base URL resolution order:
///   1. a runtime override the user set in-app (persisted) — lets an already
///      installed build be pointed at a new server without rebuilding;
///   2. a compile-time --dart-define=API_BASE_URL=...;
///   3. a sensible per-platform default.
class AppConfig {
  static const _storage = FlutterSecureStorage();
  static const _kApiUrl = 'motoriq_api_url';
  static const _envUrl = String.fromEnvironment('API_BASE_URL');

  static String? _override;

  static String get apiBaseUrl {
    if (_override != null && _override!.isNotEmpty) return _override!;
    if (_envUrl.isNotEmpty) return _envUrl;

    // Defaults for local dev. NOTE: on a real device "localhost" is the phone
    // itself — set a real URL (e.g. your Render URL) via the in-app Server
    // setting or --dart-define=API_BASE_URL=...
    var host = 'localhost';
    try {
      if (Platform.isAndroid) host = '10.0.2.2'; // Android emulator → host machine
    } catch (_) {
      // Platform unavailable (web) — fall back to localhost.
    }
    return 'http://$host:4000/api/v1';
  }

  /// Whether a compile-time or runtime URL is configured (vs the local default).
  static bool get hasExplicitUrl =>
      (_override != null && _override!.isNotEmpty) || _envUrl.isNotEmpty;

  /// Load any persisted override at startup.
  static Future<void> loadOverride() async {
    try {
      _override = await _storage.read(key: _kApiUrl);
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
        await _storage.delete(key: _kApiUrl);
      } else {
        await _storage.write(key: _kApiUrl, value: v);
      }
    } catch (_) {/* ignore storage errors */}
  }
}
