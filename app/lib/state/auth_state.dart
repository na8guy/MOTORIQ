import 'package:flutter/foundation.dart';
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
    } catch (_) {
      await _api.clearTokens();
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    return _run(() => _auth.login(email, password));
  }

  Future<bool> register({
    required String email,
    required String password,
    String? firstName,
    String? lastName,
  }) async {
    return _run(() => _auth.register(
          email: email,
          password: password,
          firstName: firstName,
          lastName: lastName,
        ));
  }

  Future<void> refreshUser() async {
    try {
      _user = await _auth.me();
      notifyListeners();
    } catch (_) {/* keep last known user */}
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
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      _error = e.message;
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Something went wrong. Please try again.';
      notifyListeners();
      return false;
    }
  }
}
