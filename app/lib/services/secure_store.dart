import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// One shared, correctly-configured Keychain handle.
///
/// ── WHY THIS EXISTS ──
/// Four separate `FlutterSecureStorage()` instances were scattered across the
/// app, all on defaults. On iOS the default accessibility is
/// `kSecAttrAccessibleWhenUnlocked`, which means a read FAILS whenever the
/// device is locked — including the moment right after a reboot, and any
/// background launch. That is the difference between "works" and "crashes on
/// launch" from one run to the next, which is exactly the symptom we had.
///
/// `first_unlock` is the right setting for credentials that must survive the
/// screen locking: the item becomes readable once the device has been unlocked
/// at least once since boot, and stays readable while it is locked afterwards.
/// It is still encrypted at rest and still not restored to a different device.
///
/// Every read is also individually guarded, because a Keychain that is
/// unavailable should degrade to "no saved value" — never take the app down.
class SecureStore {
  const SecureStore._();

  static const _storage = FlutterSecureStorage(
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  /// Give up on the Keychain after this long.
  ///
  /// This matters more than it looks. A platform channel call does not always
  /// fail — it can simply never answer, and `await` on it then hangs forever.
  /// A test proved this: with no plugin registered the call blocked for ten
  /// minutes rather than throwing. On a real device the same stall during
  /// startup is what iOS's watchdog kills an app for, which is the intermittent
  /// launch crash we were chasing.
  ///
  /// Two seconds is far longer than a healthy Keychain read (single-digit
  /// milliseconds) and far shorter than the watchdog's patience.
  static const _timeout = Duration(seconds: 2);

  /// Read a value. Returns null if it is missing, the Keychain is unavailable,
  /// or it simply does not answer in time. Never throws, never hangs.
  static Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key).timeout(_timeout);
    } on TimeoutException {
      debugPrint('[secure-store] read "$key" timed out — continuing without it');
      return null;
    } catch (e) {
      // Losing a saved preference is survivable; crashing on launch is not.
      debugPrint('[secure-store] read "$key" failed: $e');
      return null;
    }
  }

  /// Write a value, or delete it when null. Never throws, never hangs.
  static Future<void> write(String key, String? value) async {
    try {
      final op = value == null ? _storage.delete(key: key) : _storage.write(key: key, value: value);
      await op.timeout(_timeout);
    } on TimeoutException {
      debugPrint('[secure-store] write "$key" timed out');
    } catch (e) {
      debugPrint('[secure-store] write "$key" failed: $e');
    }
  }

  static Future<void> delete(String key) => write(key, null);
}
