import '../models/models.dart';
import 'api_client.dart';

/// Feature repositories: thin typed wrappers over the API client.

class AuthRepository {
  AuthRepository(this._api);
  final ApiClient _api;

  Future<AppUser> login(String email, String password) async {
    final data = await _api.post('/auth/login',
        auth: false, body: {'email': email, 'password': password});
    await _api.setTokens(data['accessToken'] as String, data['refreshToken'] as String);
    return AppUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<AppUser> register({
    required String email,
    required String password,
    String? firstName,
    String? lastName,
  }) async {
    final data = await _api.post('/auth/register', auth: false, body: {
      'email': email,
      'password': password,
      if (firstName != null && firstName.isNotEmpty) 'firstName': firstName,
      if (lastName != null && lastName.isNotEmpty) 'lastName': lastName,
    });
    await _api.setTokens(data['accessToken'] as String, data['refreshToken'] as String);
    return AppUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  Future<AppUser> me() async {
    final data = await _api.get('/users/me') as Map<String, dynamic>;
    return AppUser.fromJson(data);
  }

  Future<void> logout() async {
    final rt = await _api.refreshToken;
    if (rt != null) {
      try {
        await _api.post('/auth/logout', body: {'refreshToken': rt});
      } catch (_) {/* best effort */}
    }
    await _api.clearTokens();
  }
}

class VehicleRepository {
  VehicleRepository(this._api);
  final ApiClient _api;

  Future<List<Vehicle>> list() async {
    final data = await _api.get('/vehicles') as List;
    return data.map((e) => Vehicle.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Vehicle> create(Map<String, dynamic> body) async {
    final data = await _api.post('/vehicles', body: body) as Map<String, dynamic>;
    return Vehicle.fromJson(data);
  }

  Future<Vehicle> update(String id, Map<String, dynamic> body) async {
    final data = await _api.patch('/vehicles/$id', body: body) as Map<String, dynamic>;
    return Vehicle.fromJson(data);
  }

  Future<void> delete(String id) => _api.delete('/vehicles/$id');
}

class WalletRepository {
  WalletRepository(this._api);
  final ApiClient _api;

  Future<Wallet> get() async {
    final data = await _api.get('/wallet') as Map<String, dynamic>;
    return Wallet.fromJson(data);
  }

  Future<void> topUp(double amount) =>
      _api.post('/wallet/topup', body: {'amount': amount});

  Future<List<PaymentCard>> cards() async {
    final data = await _api.get('/cards') as List;
    return data.map((e) => PaymentCard.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<PaymentCard> issueCard() async {
    final data = await _api.post('/cards', body: {}) as Map<String, dynamic>;
    return PaymentCard.fromJson(data);
  }
}

class FuelRepository {
  FuelRepository(this._api);
  final ApiClient _api;

  Future<List<FuelStation>> nearby({
    required double lat,
    required double lng,
    bool evOnly = false,
  }) async {
    final data = await _api.get(
      '/fuel/stations?lat=$lat&lng=$lng${evOnly ? '&evOnly=true' : ''}',
      auth: false,
    ) as List;
    return data.map((e) => FuelStation.fromJson(e as Map<String, dynamic>)).toList();
  }
}
