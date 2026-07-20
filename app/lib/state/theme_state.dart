import 'dart:async';

import 'package:flutter/material.dart';
import '../services/secure_store.dart';

/// Remembers whether the member wants light, dark, or whatever their phone is set to.
///
/// Defaults to [ThemeMode.system]: the OS already knows their preference — and
/// on iOS that includes the automatic sunset switch — so overriding it out of
/// the box would be presumptuous. The choice is persisted so it survives a
/// restart; it's read before the first frame in main(), which avoids the flash
/// of the wrong theme that comes from loading it after runApp.
class ThemeState extends ChangeNotifier {
  ThemeState();

  static const _key = 'saveondrive_theme_mode';

  ThemeMode _mode = ThemeMode.system;
  ThemeMode get mode => _mode;

  /// Load the saved choice. Call before runApp.
  Future<void> load() async {
    try {
      final raw = await SecureStore.read(_key);
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
    notifyListeners(); // repaint immediately

    // Deliberately NOT awaited. The theme has already changed on screen; making
    // the caller wait on a Keychain write means a slow or unresponsive Keychain
    // stalls the UI for as long as the write takes. Persisting is best-effort —
    // if it fails the choice still applies for this session.
    unawaited(SecureStore.write(_key, mode.name));
  }

  static ThemeMode _parse(String? raw) => switch (raw) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        _ => ThemeMode.system,
      };
}
