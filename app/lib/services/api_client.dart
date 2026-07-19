import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import '../app_config.dart';

/// Thrown for non-2xx API responses. Carries the server error message.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final String? code;

  /// The error's `details` payload. Carried because a 402 PAYMENT_REQUIRED
  /// includes which tier the member needs — throwing that away would leave the
  /// app guessing, and it would guess wrong for Pro-only features.
  final Object? details;

  ApiException(this.statusCode, this.message, {this.code, this.details});

  /// True when the server refused because this needs a paid membership.
  bool get isPaymentRequired => statusCode == 402 || code == 'PAYMENT_REQUIRED';

  /// The tier that unlocks it, from the 402 details.
  String? get requiredTier {
    final d = details;
    return d is Map ? d['requiredTier'] as String? : null;
  }

  @override
  String toString() => message;
}

/// Thrown when the app cannot reach the API at all (DNS, connection refused,
/// timeout, TLS). statusCode 0 distinguishes it from server-returned errors.
class NetworkException extends ApiException {
  NetworkException(String message) : super(0, message, code: 'NETWORK');
}

/// How long to wait per request. Render free services cold-start slowly, so
/// give the first request generous headroom.
const _requestTimeout = Duration(seconds: 45);

/// Low-level HTTP client for the SaveOnDrive API.
///
/// - Injects the bearer access token on every request.
/// - Persists tokens in secure storage.
/// - Transparently refreshes an expired access token once, then retries.
class ApiClient {
  ApiClient({http.Client? client}) : _http = client ?? http.Client();

  final http.Client _http;
  static const _storage = FlutterSecureStorage();
  static const _kAccess = 'saveondrive_access';
  static const _kRefresh = 'saveondrive_refresh';

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

    try {
      final Future<http.Response> req;
      switch (method) {
        case 'GET':
          req = _http.get(uri, headers: headers);
        case 'POST':
          req = _http.post(uri, headers: headers, body: encoded);
        case 'PATCH':
          req = _http.patch(uri, headers: headers, body: encoded);
        case 'DELETE':
          req = _http.delete(uri, headers: headers, body: encoded);
        default:
          throw ArgumentError('Unsupported method $method');
      }
      return await req.timeout(_requestTimeout);
    } on TimeoutException {
      throw NetworkException(
        "The server took too long to respond at ${uri.origin}. It may be waking up — try again in a moment.",
      );
    } on SocketException catch (e) {
      throw NetworkException(
        "Can't reach the server at ${uri.origin}. Check your connection and the API URL. (${e.osError?.message ?? e.message})",
      );
    } on http.ClientException catch (e) {
      throw NetworkException("Can't reach the server at ${uri.origin}. (${e.message})");
    } on HandshakeException {
      throw NetworkException("Secure connection to ${uri.origin} failed (TLS/certificate).");
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
    Object? details;
    if (data is Map && data['error'] is Map) {
      message = (data['error']['message'] as String?) ?? message;
      code = data['error']['code'] as String?;
      // Keep details: a 402 carries the tier the member needs to upgrade to.
      details = data['error']['details'];
    }
    throw ApiException(res.statusCode, message, code: code, details: details);
  }
}
