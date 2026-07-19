import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Remembers whether the member wants light, dark, or whatever their phone is set to.
///
/// Defaults to [ThemeMode.system]: the OS already knows their preference — and
/// on iOS that includes the automatic sunset switch — so overriding it out of
/// the box would be presumptuous. The choice is persisted so it survives a
/// restart; it's read before the first frame in main(), which avoids the flash
/// of the wrong theme that comes from loading it after runApp.
class ThemeState extends ChangeNotifier {
  ThemeState(this._storage);

  final FlutterSecureStorage _storage;
  static const _key = 'saveondrive_theme_mode';

  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  /// Load the saved choice. Call before runApp.
  Future<void> load() async {
    try {
      final raw = await _storage.read(key: _key);
      _mode = _parse(raw);
      notifyListeners();
    } catch (_) {
      // Storage unavailable — following the system is a safe default, and a
      // theme preference is never worth failing a launch over.
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    if (_mode == mode) return;
    _mode = mode;
    notifyListeners(); // repaint immediately; don't wait on the disk write
    try {
      await _storage.write(key: _key, value: mode.name);
    } catch (_) {
      // The choice still applies this session, it just won't survive a restart.
    }
  }

  static ThemeMode _parse(String? raw) => switch (raw) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
}
