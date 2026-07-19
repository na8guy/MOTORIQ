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
    // The API rejects registration unless both are true — consent must be
    // actively given, so these are required arguments, not defaulted flags.
    required bool acceptTerms,
    required bool acceptPrivacy,
    bool marketingOptIn = false,
  }) async {
    final data = await _api.post('/auth/register', auth: false, body: {
      'email': email,
      'password': password,
      if (firstName != null && firstName.isNotEmpty) 'firstName': firstName,
      if (lastName != null && lastName.isNotEmpty) 'lastName': lastName,
      'acceptTerms': acceptTerms,
      'acceptPrivacy': acceptPrivacy,
      'marketingOptIn': marketingOptIn,
    });
    await _api.setTokens(data['accessToken'] as String, data['refreshToken'] as String);
    return AppUser.fromJson(data['user'] as Map<String, dynamic>);
  }

  /// The Terms and Privacy Policy URLs and versions currently in force.
  Future<LegalDocs> legal() async {
    final data = await _api.get('/auth/legal', auth: false) as Map<String, dynamic>;
    return LegalDocs.fromJson(data);
  }

  /// Start a password reset. Always succeeds, whether or not the address has an
  /// account — the API deliberately won't reveal which.
  Future<void> forgotPassword(String email) =>
      _api.post('/auth/forgot-password', auth: false, body: {'email': email});

  /// Finish a reset with the token from the emailed link.
  Future<void> resetPassword(String token, String password) => _api
      .post('/auth/reset-password', auth: false, body: {'token': token, 'password': password});

  Future<AppUser> me() async {
    final data = await _api.get('/users/me') as Map<String, dynamic>;
    return AppUser.fromJson(data);
  }

  /// Update the member's own details. PATCH /users/me returns a trimmed user
  /// (no wallet/savings), so re-read the full profile rather than let the
  /// dashboard's balance and savings blank out after a name change.
  Future<AppUser> updateMe(Map<String, dynamic> body) async {
    await _api.patch('/users/me', body: body);
    return me();
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

  Future<void> resendVerification(String email) =>
      _api.post('/auth/resend-verification', auth: false, body: {'email': email});
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

  /// Ask the DVLA/DVSA what they know about a registration, before adding it.
  Future<VehicleLookup> lookup(String registration) async {
    final data = await _api.get('/vehicles/lookup?registration=$registration')
        as Map<String, dynamic>;
    return VehicleLookup.fromJson(data);
  }

  /// Re-pull government data (MOT expiry, tax due) for an existing vehicle.
  Future<Vehicle> refresh(String id) async {
    final data = await _api.post('/vehicles/$id/refresh') as Map<String, dynamic>;
    return Vehicle.fromJson(data['vehicle'] as Map<String, dynamic>);
  }
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

  /// Ranked cheapest stations for a fuel kind, with savings + navigation URLs.
  Future<RankedResult> ranked({
    required double lat,
    required double lng,
    required String kind,
    int limit = 3,
  }) async {
    final data = await _api.get(
      '/fuel/ranked?lat=$lat&lng=$lng&kind=$kind&limit=$limit',
      auth: false,
    ) as Map<String, dynamic>;
    return RankedResult.fromJson(data);
  }
}

/// EV charging. Mirrors FuelRepository — see the backend's ev.service for why
/// some chargers have no price.
class EvRepository {
  EvRepository(this._api);
  final ApiClient _api;

  Future<RankedChargerResult> ranked({
    required double lat,
    required double lng,
    int limit = 3,
    double radiusKm = 15,
    double? minPowerKw,
  }) async {
    final q = <String>[
      'lat=$lat',
      'lng=$lng',
      'limit=$limit',
      'radiusKm=$radiusKm',
      if (minPowerKw != null) 'minPowerKw=$minPowerKw',
    ].join('&');
    final data = await _api.get('/ev/ranked?$q') as Map<String, dynamic>;
    return RankedChargerResult.fromJson(data);
  }
}

/// Fill-up intents and their confirmation.
///
/// Tapping "Navigate here" records an INTENT, which counts for nothing until a
/// card transaction matches it or the member confirms. This is what keeps the
/// savings figure honest.
class FillUpRepository {
  FillUpRepository(this._api);
  final ApiClient _api;

  /// Record that the member set off for a station.
  Future<void> recordIntent({
    required String fuelKind,
    required double pricePencePerUnit,
    double? benchmarkPencePerUnit,
    double? estimatedLitres,
    String? siteId,
    String? stationBrand,
    String? stationPostcode,
    double? lat,
    double? lng,
  }) =>
      _api.post('/insights/intents', body: {
        'fuelKind': fuelKind,
        'pricePencePerUnit': pricePencePerUnit,
        if (benchmarkPencePerUnit != null) 'benchmarkPencePerUnit': benchmarkPencePerUnit,
        if (estimatedLitres != null) 'estimatedLitres': estimatedLitres,
        if (siteId != null && siteId.isNotEmpty) 'siteId': siteId,
        if (stationBrand != null) 'stationBrand': stationBrand,
        if (stationPostcode != null && stationPostcode.isNotEmpty)
          'stationPostcode': stationPostcode,
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
      });

  /// Fill-ups waiting on a yes/no.
  Future<List<PendingFillUp>> pending() async {
    final data = await _api.get('/insights/intents/pending') as List;
    return data.map((e) => PendingFillUp.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Answer "did you fill up?". [actualLitres] corrects our estimate.
  Future<void> confirm(
    String id, {
    required bool filledUp,
    double? actualLitres,
    double? actualPricePence,
  }) =>
      _api.post('/insights/intents/$id/confirm', body: {
        'filledUp': filledUp,
        if (actualLitres != null) 'actualLitres': actualLitres,
        if (actualPricePence != null) 'actualPricePence': actualPricePence,
      });
}

class KycRepository {
  KycRepository(this._api);
  final ApiClient _api;

  Future<KycProfile> get() async {
    final data = await _api.get('/kyc') as Map<String, dynamic>;
    return KycProfile.fromJson(data);
  }

  Future<KycProfile> submit(Map<String, dynamic> body) async {
    final data = await _api.post('/kyc', body: body) as Map<String, dynamic>;
    return KycProfile.fromJson(data);
  }
}

class SubscriptionRepository {
  SubscriptionRepository(this._api);
  final ApiClient _api;

  Future<List<Plan>> plans() async {
    final data = await _api.get('/subscriptions/plans', auth: false) as List;
    return data.map((e) => Plan.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>?> current() async {
    final data = await _api.get('/subscriptions/me');
    return data as Map<String, dynamic>?;
  }

  Future<void> subscribe(String plan, {int? mileagePackage}) =>
      _api.post('/subscriptions', body: {
        'plan': plan,
        if (mileagePackage != null) 'mileagePackage': mileagePackage,
      });

  Future<void> cancel() => _api.post('/subscriptions/cancel');
}

class ReferralRepository {
  ReferralRepository(this._api);
  final ApiClient _api;

  Future<List<Referral>> list() async {
    final data = await _api.get('/referrals') as List;
    return data.map((e) => Referral.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Referral> create({String? refereeEmail}) async {
    final data = await _api.post('/referrals',
        body: {if (refereeEmail != null && refereeEmail.isNotEmpty) 'refereeEmail': refereeEmail}) as Map<String, dynamic>;
    return Referral.fromJson(data);
  }
}

class ReminderRepository {
  ReminderRepository(this._api);
  final ApiClient _api;

  Future<List<Reminder>> list() async {
    final data = await _api.get('/reminders') as List;
    return data.map((e) => Reminder.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Reminder> create(Map<String, dynamic> body) async {
    final data = await _api.post('/reminders', body: body) as Map<String, dynamic>;
    return Reminder.fromJson(data);
  }

  Future<void> complete(String id) => _api.patch('/reminders/$id', body: {'completed': true});
  Future<void> delete(String id) => _api.delete('/reminders/$id');
}

class NotificationRepository {
  NotificationRepository(this._api);
  final ApiClient _api;

  Future<({int unread, List<AppNotification> items})> inbox() async {
    final data = await _api.get('/notifications') as Map<String, dynamic>;
    final items = ((data['items'] as List?) ?? [])
        .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
        .toList();
    return (unread: (data['unreadCount'] as int?) ?? 0, items: items);
  }

  Future<void> markAllRead() => _api.post('/notifications/read-all');
  Future<void> registerDevice(String token, String platform) =>
      _api.post('/notifications/devices', body: {'token': token, 'platform': platform});
}

class InsightsRepository {
  InsightsRepository(this._api);
  final ApiClient _api;

  Future<SavingsInsight> ai({String period = 'monthly'}) async {
    final data = await _api.get('/insights/ai?period=$period') as Map<String, dynamic>;
    return SavingsInsight.fromJson(data);
  }

  Future<void> logPurchase(Map<String, dynamic> body) =>
      _api.post('/insights/purchases', body: body);
}

/// Membership: pricing, upgrades, Stripe checkout, perks.
class MembershipRepository {
  MembershipRepository(this._api);
  final ApiClient _api;

  /// The pricing catalogue. Public — no account needed to see prices.
  Future<List<MembershipPlan>> plans() async {
    final data = await _api.get('/subscriptions/plans', auth: false) as Map<String, dynamic>;
    return ((data['plans'] as List?) ?? [])
        .map((e) => MembershipPlan.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// The member's own membership and perk balances.
  Future<MyMembership> mine() async {
    final data = await _api.get('/subscriptions/me') as Map<String, dynamic>;
    return MyMembership.fromJson(data);
  }

  /// Start Stripe checkout. Returns the URL to open, and whether it's real.
  ///
  /// Note this does NOT change the tier — only Stripe's webhook does that.
  Future<({String url, bool live, String? note})> checkout({
    required String tier,
    required String period,
  }) async {
    final data = await _api.post('/subscriptions/checkout',
        body: {'tier': tier, 'period': period}) as Map<String, dynamic>;
    return (
      url: data['checkoutUrl'] as String,
      live: (data['live'] as bool?) ?? false,
      note: data['note'] as String?,
    );
  }

  /// Complete a MOCK upgrade. Only works while Stripe is unconfigured — the
  /// API refuses this outright once Stripe is live.
  Future<void> confirmMockCheckout({required String tier, required String period}) =>
      _api.post('/subscriptions/checkout/mock-confirm', body: {'tier': tier, 'period': period});

  /// Stripe's billing portal — change card, invoices, cancel.
  Future<String> portalUrl() async {
    final data = await _api.post('/subscriptions/portal') as Map<String, dynamic>;
    return data['portalUrl'] as String;
  }

  Future<String> cancel() async {
    final data = await _api.post('/subscriptions/cancel') as Map<String, dynamic>;
    return (data['message'] as String?) ?? 'Cancelled';
  }

  Future<void> resume() => _api.post('/subscriptions/resume');
}

/// Shop for the cheapest MOT, service or tyres.
class MarketplaceRepository {
  MarketplaceRepository(this._api);
  final ApiClient _api;

  Future<QuoteComparison> compare({
    required double lat,
    required double lng,
    required String serviceType,
    double radiusKm = 25,
    int limit = 8,
  }) async {
    final data = await _api.get(
      '/marketplace/compare?lat=$lat&lng=$lng&serviceType=$serviceType&radiusKm=$radiusKm&limit=$limit',
    ) as Map<String, dynamic>;
    return QuoteComparison.fromJson(data);
  }

  Future<Map<String, dynamic>> book({
    required String partnerId,
    required String serviceType,
    required DateTime requestedFor,
    String? vehicleId,
    String? notes,
  }) async {
    final data = await _api.post('/marketplace/bookings', body: {
      'partnerId': partnerId,
      'serviceType': serviceType,
      'requestedFor': requestedFor.toIso8601String(),
      if (vehicleId != null) 'vehicleId': vehicleId,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    }) as Map<String, dynamic>;
    return data;
  }

  Future<List<Map<String, dynamic>>> bookings() async {
    final data = await _api.get('/marketplace/bookings') as List;
    return data.cast<Map<String, dynamic>>();
  }
}

/// ULEZ and clean-air zones.
class ZonesRepository {
  ZonesRepository(this._api);
  final ApiClient _api;

  Future<({bool inZone, List<ZoneCheck> checks, String? note})> check({
    required double lat,
    required double lng,
    String? vehicleId,
  }) async {
    final q = 'lat=$lat&lng=$lng${vehicleId != null ? '&vehicleId=$vehicleId' : ''}';
    final data = await _api.get('/zones/check?$q') as Map<String, dynamic>;
    return (
      inZone: (data['inZone'] as bool?) ?? false,
      checks: ((data['checks'] as List?) ?? [])
          .map((e) => ZoneCheck.fromJson(e as Map<String, dynamic>))
          .toList(),
      note: data['note'] as String?,
    );
  }
}

/// Vehicle health reports.
class HealthRepository {
  HealthRepository(this._api);
  final ApiClient _api;

  Future<HealthReport> generate(String vehicleId) async {
    final data = await _api.post('/health-report/$vehicleId') as Map<String, dynamic>;
    return HealthReport.fromJson(data);
  }
}

/// Insurance renewal guidance (guidance, not quotes).
class InsuranceRepository {
  InsuranceRepository(this._api);
  final ApiClient _api;

  Future<({List<RenewalGuidance> vehicles, String disclaimer})> renewal() async {
    final data = await _api.get('/insurance/renewal') as Map<String, dynamic>;
    return (
      vehicles: ((data['vehicles'] as List?) ?? [])
          .map((e) => RenewalGuidance.fromJson(e as Map<String, dynamic>))
          .toList(),
      disclaimer: (data['disclaimer'] as String?) ?? '',
    );
  }
}

/// Admin-only: switch your own view to any tier for testing.
class AdminRepository {
  AdminRepository(this._api);
  final ApiClient _api;

  Future<({String? simulatedTier, String realTier, String message})> simulateTier(String? tier) async {
    final data = await _api.post('/admin/simulate-tier', body: {'tier': tier}) as Map<String, dynamic>;
    return (
      simulatedTier: data['simulatedTier'] as String?,
      realTier: (data['realTier'] as String?) ?? 'FREE',
      message: (data['message'] as String?) ?? '',
    );
  }
}
