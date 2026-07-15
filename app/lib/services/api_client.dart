import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../app_config.dart';

/// Thrown for non-2xx API responses. Carries the server error message.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;
  ApiException(this.statusCode, this.message, {this.code});
  @override
  String toString() => message;
}

/// Low-level HTTP client for the MOTORIQ API.
///
/// - Injects the bearer access token on every request.
/// - Persists tokens in secure storage.
/// - Transparently refreshes an expired access token once, then retries.
class ApiClient {
  ApiClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  static const _storage = FlutterSecureStorage();
  static const _kAccess = 'motoriq_access';
  static const _kRefresh = 'motoriq_refresh';

  Future<String?> get accessToken => _storage.read(key: _kAccess);
  Future<String?> get refreshToken => _storage.read(key: _kRefresh);

  Future<bool> get isLoggedIn async => (await accessToken) != null;

  Future<void> setTokens(String access, String refresh) async {
    await _storage.write(key: _kAccess, value: access);
    await _storage.write(key: _kRefresh, value: refresh);
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _kAccess);
    await _storage.delete(key: _kRefresh);
  }

  Uri _uri(String path) => Uri.parse('${AppConfig.apiBaseUrl}$path');

  Future<Map<String, String>> _headers({bool auth = true}) async {
    final headers = {'content-type': 'application/json'};
    if (auth) {
      final token = await accessToken;
      if (token != null) headers['authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<dynamic> get(String path, {bool auth = true}) =>
      _send('GET', path, auth: auth);

  Future<dynamic> post(String path, {Object? body, bool auth = true}) =>
      _send('POST', path, body: body, auth: auth);

  Future<dynamic> patch(String path, {Object? body, bool auth = true}) =>
      _send('PATCH', path, body: body, auth: auth);

  Future<dynamic> delete(String path, {bool auth = true}) =>
      _send('DELETE', path, auth: auth);

  Future<dynamic> _send(
    String method,
    String path, {
    Object? body,
    bool auth = true,
    bool isRetry = false,
  }) async {
    final res = await _dispatch(method, path, body: body, auth: auth);

    // One transparent refresh-and-retry on 401.
    if (res.statusCode == 401 && auth && !isRetry) {
      if (await _refresh()) {
        return _send(method, path, body: body, auth: auth, isRetry: true);
      }
    }

    return _parse(res);
  }

  Future<http.Response> _dispatch(
    String method,
    String path, {
    Object? body,
    bool auth = true,
  }) async {
    final uri = _uri(path);
    final headers = await _headers(auth: auth);
    final encoded = body == null ? null : jsonEncode(body);

    switch (method) {
      case 'GET':
        return _http.get(uri, headers: headers);
      case 'POST':
        return _http.post(uri, headers: headers, body: encoded);
      case 'PATCH':
        return _http.patch(uri, headers: headers, body: encoded);
      case 'DELETE':
        return _http.delete(uri, headers: headers, body: encoded);
      default:
        throw ArgumentError('Unsupported method $method');
    }
  }

  Future<bool> _refresh() async {
    final rt = await refreshToken;
    if (rt == null) return false;
    final res = await _http.post(
      _uri('/auth/refresh'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'refreshToken': rt}),
    );
    if (res.statusCode != 200) return false;
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    await setTokens(data['accessToken'] as String, data['refreshToken'] as String);
    return true;
  }

  dynamic _parse(http.Response res) {
    final hasBody = res.body.isNotEmpty;
    final data = hasBody ? jsonDecode(res.body) : null;

    if (res.statusCode >= 200 && res.statusCode < 300) return data;

    String message = 'Request failed (${res.statusCode})';
    String? code;
    if (data is Map && data['error'] is Map) {
      message = (data['error']['message'] as String?) ?? message;
      code = data['error']['code'] as String?;
    }
    throw ApiException(res.statusCode, message, code: code);
  }
}
