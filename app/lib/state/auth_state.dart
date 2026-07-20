import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/secure_store.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

/// App-wide authentication + current-user state.
class AuthState extends ChangeNotifier {
  AuthState(this._api) : _auth = AuthRepository(_api);

  final ApiClient _api;
  final AuthRepository _auth;

  AuthStatus _status = AuthStatus.unknown;
  AppUser? _user;
  String? _error;

  AuthStatus get status => _status;
  AppUser? get user => _user;
  String? get error => _error;

  /// Called on startup to restore a session from stored tokens.
  Future<void> bootstrap() async {
    if (!await _api.isLoggedIn) {
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }
    try {
      _user = await _auth.me();
      _status = AuthStatus.authenticated;
      unawaited(_registerDevice());
    } catch (_) {
      await _api.clearTokens();
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  /// Register this install's push token so the backend can fan out
  /// notifications. In production swap the generated id for
  /// `FirebaseMessaging.instance.getToken()`.
  Future<void> _registerDevice() async {
    try {
      var token = await SecureStore.read('saveondrive_device');
      if (token == null) {
        token = 'dev-${DateTime.now().microsecondsSinceEpoch}-${identityHashCode(this)}';
        await SecureStore.write('saveondrive_device', token);
      }
      final platform = switch (defaultTargetPlatform) {
        TargetPlatform.iOS => 'IOS',
        TargetPlatform.android => 'ANDROID',
        _ => 'WEB',
      };
      await NotificationRepository(_api).registerDevice(token, platform);
    } catch (_) {/* best effort */}
  }

  Future<bool> login(String email, String password) async {
    return _run(() => _auth.login(email, password));
  }

  Future<bool> register({
    required String email,
    required String password,
    String? firstName,
    String? lastName,
    required bool acceptTerms,
    required bool acceptPrivacy,
    bool marketingOptIn = false,
  }) async {
    return _run(() => _auth.register(
          email: email,
          password: password,
          firstName: firstName,
          lastName: lastName,
          acceptTerms: acceptTerms,
          acceptPrivacy: acceptPrivacy,
          marketingOptIn: marketingOptIn,
        ));
  }

  Future<void> refreshUser() async {
    try {
      _user = await _auth.me();
      notifyListeners();
    } catch (_) {/* keep last known user */}
  }

  /// Save profile edits. Unlike refreshUser this rethrows: the member pressed
  /// Save and must be told if it didn't work.
  Future<void> updateProfile({
    String? firstName,
    String? lastName,
    String? phone,
    String? distanceUnit,
    bool? marketingOptIn,
  }) async {
    _user = await _auth.updateMe({
      if (firstName != null) 'firstName': firstName,
      if (lastName != null) 'lastName': lastName,
      if (phone != null) 'phone': phone,
      if (distanceUnit != null) 'distanceUnit': distanceUnit,
      if (marketingOptIn != null) 'marketingOptIn': marketingOptIn,
    });
    notifyListeners();
  }

  Future<void> logout() async {
    await _auth.logout();
    _user = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  Future<bool> _run(Future<AppUser> Function() action) async {
    _error = null;
    notifyListeners();
    try {
      _user = await action();
      _status = AuthStatus.authenticated;
      unawaited(_registerDevice());
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      // Includes NetworkException (can't reach the server) with a specific message.
      _error = e.message;
      notifyListeners();
      return false;
    } catch (e) {
      // Surface the real cause instead of hiding it (helps diagnose device/env issues).
      _error = 'Unexpected error: $e';
      notifyListeners();
      return false;
    }
  }
}
