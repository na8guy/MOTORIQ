/// Data models mirroring the MOTORIQ API responses.
/// All monetary values arrive as integer minor units (pence).
library;

class AppUser {
  final String id;
  final String email;
  final String? firstName;
  final String? lastName;
  final String? phone;
  final String tier;
  final bool emailVerified;
  final int walletBalanceMinor;
  final int totalSavedMinor;

  AppUser({
    required this.id,
    required this.email,
    this.firstName,
    this.lastName,
    this.phone,
    required this.tier,
    this.emailVerified = true,
    this.walletBalanceMinor = 0,
    this.totalSavedMinor = 0,
  });

  String get displayName {
    final name = [firstName, lastName].where((s) => s != null && s.isNotEmpty).join(' ');
    return name.isEmpty ? email : name;
  }

  factory AppUser.fromJson(Map<String, dynamic> j) => AppUser(
        id: j['id'] as String,
        email: j['email'] as String,
        firstName: j['firstName'] as String?,
        lastName: j['lastName'] as String?,
        phone: j['phone'] as String?,
        tier: (j['tier'] as String?) ?? 'FREE',
        emailVerified: (j['emailVerified'] as bool?) ?? true,
        walletBalanceMinor: (j['walletBalanceMinor'] as int?) ?? 0,
        totalSavedMinor: (j['totalSavedMinor'] as int?) ?? 0,
      );
}

class Vehicle {
  final String id;
  final String registration;
  final String? make;
  final String? model;
  final int? year;
  final String fuelType;
  final int? mileage;
  final String? colour;

  // ── From the DVLA / DVSA APIs (read-only; we don't let members edit these) ──
  final String? taxStatus;
  final DateTime? taxDueDate;
  final String? motStatus;
  final DateTime? motExpiryDate;
  final DateTime? dvlaSyncedAt;
  final String? dvlaSyncError;

  // ── Member-entered: no public API publishes these ──
  final DateTime? insuranceRenewalDate;
  final DateTime? serviceDueDate;

  Vehicle({
    required this.id,
    required this.registration,
    this.make,
    this.model,
    this.year,
    required this.fuelType,
    this.mileage,
    this.colour,
    this.taxStatus,
    this.taxDueDate,
    this.motStatus,
    this.motExpiryDate,
    this.dvlaSyncedAt,
    this.dvlaSyncError,
    this.insuranceRenewalDate,
    this.serviceDueDate,
  });

  String get label => [make, model].where((s) => s != null && s.isNotEmpty).join(' ');

  /// True once we've successfully pulled government data for this vehicle.
  bool get hasDvlaData => motExpiryDate != null || taxDueDate != null;

  factory Vehicle.fromJson(Map<String, dynamic> j) => Vehicle(
        id: j['id'] as String,
        registration: j['registration'] as String,
        make: j['make'] as String?,
        model: j['model'] as String?,
        year: j['year'] as int?,
        fuelType: (j['fuelType'] as String?) ?? 'PETROL',
        mileage: j['mileage'] as int?,
        colour: j['colour'] as String?,
        taxStatus: j['taxStatus'] as String?,
        taxDueDate: _date(j['taxDueDate']),
        motStatus: j['motStatus'] as String?,
        motExpiryDate: _date(j['motExpiryDate']),
        dvlaSyncedAt: _date(j['dvlaSyncedAt']),
        dvlaSyncError: j['dvlaSyncError'] as String?,
        insuranceRenewalDate: _date(j['insuranceRenewalDate']),
        serviceDueDate: _date(j['serviceDueDate']),
      );

  static DateTime? _date(Object? v) =>
      v == null ? null : DateTime.tryParse(v as String)?.toLocal();
}

/// What the DVLA/DVSA know about a registration, before it's added as a
/// vehicle. Returned by GET /vehicles/lookup.
class VehicleLookup {
  final String registration;
  final String? make;
  final String? model;
  final String? colour;
  final String? fuelType;
  final int? year;
  final String? taxStatus;
  final DateTime? taxDueDate;
  final String? motStatus;
  final DateTime? motExpiryDate;
  final int? mileage;

  /// 'live' if a government API answered, 'mock' if it's sample data.
  final String source;
  final String? error;

  VehicleLookup({
    required this.registration,
    this.make,
    this.model,
    this.colour,
    this.fuelType,
    this.year,
    this.taxStatus,
    this.taxDueDate,
    this.motStatus,
    this.motExpiryDate,
    this.mileage,
    this.source = 'mock',
    this.error,
  });

  bool get found => make != null || motExpiryDate != null || taxDueDate != null;

  String get label => [make, model].where((s) => s != null && s.isNotEmpty).join(' ');

  factory VehicleLookup.fromJson(Map<String, dynamic> j) => VehicleLookup(
        registration: j['registration'] as String,
        make: j['make'] as String?,
        model: j['model'] as String?,
        colour: j['colour'] as String?,
        fuelType: j['fuelType'] as String?,
        year: (j['year'] as num?)?.toInt(),
        taxStatus: j['taxStatus'] as String?,
        taxDueDate: Vehicle._date(j['taxDueDate']),
        motStatus: j['motStatus'] as String?,
        motExpiryDate: Vehicle._date(j['motExpiryDate']),
        mileage: (j['mileage'] as num?)?.toInt(),
        source: (j['source'] as String?) ?? 'mock',
        error: j['error'] as String?,
      );
}

class WalletTxn {
  final String id;
  final String type;
  final String status;
  final int amountMinor;
  final String? description;
  final DateTime createdAt;

  WalletTxn({
    required this.id,
    required this.type,
    required this.status,
    required this.amountMinor,
    this.description,
    required this.createdAt,
  });

  factory WalletTxn.fromJson(Map<String, dynamic> j) => WalletTxn(
        id: j['id'] as String,
        type: j['type'] as String,
        status: j['status'] as String,
        amountMinor: j['amountMinor'] as int,
        description: j['description'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

class Wallet {
  final String id;
  final int balanceMinor;
  final String currency;
  final List<WalletTxn> transactions;

  Wallet({
    required this.id,
    required this.balanceMinor,
    required this.currency,
    required this.transactions,
  });

  factory Wallet.fromJson(Map<String, dynamic> j) => Wallet(
        id: j['id'] as String,
        balanceMinor: (j['balanceMinor'] as int?) ?? 0,
        currency: (j['currency'] as String?) ?? 'GBP',
        transactions: ((j['transactions'] as List?) ?? [])
            .map((e) => WalletTxn.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class PaymentCard {
  final String id;
  final String? last4;
  final String brand;
  final String status;
  final int? expiryMonth;
  final int? expiryYear;

  PaymentCard({
    required this.id,
    this.last4,
    required this.brand,
    required this.status,
    this.expiryMonth,
    this.expiryYear,
  });

  factory PaymentCard.fromJson(Map<String, dynamic> j) => PaymentCard(
        id: j['id'] as String,
        last4: j['last4'] as String?,
        brand: (j['brand'] as String?) ?? 'Mastercard',
        status: (j['status'] as String?) ?? 'PENDING',
        expiryMonth: j['expiryMonth'] as int?,
        expiryYear: j['expiryYear'] as int?,
      );
}

class FuelStation {
  final String siteId;
  final String brand;
  final String address;
  final String postcode;
  final bool isEvCharger;
  final double? distanceKm;
  final List<FuelPrice> prices;

  FuelStation({
    required this.siteId,
    required this.brand,
    required this.address,
    required this.postcode,
    required this.isEvCharger,
    this.distanceKm,
    required this.prices,
  });

  factory FuelStation.fromJson(Map<String, dynamic> j) => FuelStation(
        siteId: j['siteId'] as String,
        brand: j['brand'] as String,
        address: (j['address'] as String?) ?? '',
        postcode: (j['postcode'] as String?) ?? '',
        isEvCharger: (j['isEvCharger'] as bool?) ?? false,
        distanceKm: (j['distanceKm'] as num?)?.toDouble(),
        prices: ((j['prices'] as List?) ?? [])
            .map((e) => FuelPrice.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class FuelPrice {
  final String kind;
  final double pricePence;

  FuelPrice({required this.kind, required this.pricePence});

  factory FuelPrice.fromJson(Map<String, dynamic> j) => FuelPrice(
        kind: j['kind'] as String,
        pricePence: (j['pricePence'] as num).toDouble(),
      );
}

/// One entry in the ranked-cheapest fuel list, with savings + a maps URL.
class RankedStation {
  final int rank;
  final String brand;
  final String address;
  final String postcode;
  final double pricePence;
  final double? distanceKm;
  final int savingVsAverageMinor;
  final int extraVsCheapestMinor;
  final String navigationUrl;

  RankedStation({
    required this.rank,
    required this.brand,
    required this.address,
    required this.postcode,
    required this.pricePence,
    this.distanceKm,
    required this.savingVsAverageMinor,
    required this.extraVsCheapestMinor,
    required this.navigationUrl,
  });

  factory RankedStation.fromJson(Map<String, dynamic> j) => RankedStation(
        rank: j['rank'] as int,
        brand: j['brand'] as String,
        address: (j['address'] as String?) ?? '',
        postcode: (j['postcode'] as String?) ?? '',
        pricePence: (j['pricePence'] as num).toDouble(),
        distanceKm: (j['distanceKm'] as num?)?.toDouble(),
        savingVsAverageMinor: (j['savingVsAverageMinor'] as int?) ?? 0,
        extraVsCheapestMinor: (j['extraVsCheapestMinor'] as int?) ?? 0,
        navigationUrl: j['navigationUrl'] as String,
      );
}

class RankedResult {
  final String kind;
  final int tankLitres;
  final double? averagePence;
  final double? cheapestPence;
  final List<RankedStation> results;

  /// 'live' for real retailer data, 'mock' for the backend's bundled samples.
  /// Shown to the member so sample prices are never passed off as real.
  final String source;

  /// Stations known within the radius before filtering by fuel kind — lets the
  /// empty state distinguish "nothing here" from "nothing sells this fuel".
  final int stationsInRadius;

  RankedResult({
    required this.kind,
    required this.tankLitres,
    this.averagePence,
    this.cheapestPence,
    required this.results,
    this.source = 'live',
    this.stationsInRadius = 0,
  });

  factory RankedResult.fromJson(Map<String, dynamic> j) => RankedResult(
        kind: j['kind'] as String,
        tankLitres: (j['tankLitres'] as num).round(),
        averagePence: (j['averagePence'] as num?)?.toDouble(),
        cheapestPence: (j['cheapestPence'] as num?)?.toDouble(),
        results: ((j['results'] as List?) ?? [])
            .map((e) => RankedStation.fromJson(e as Map<String, dynamic>))
            .toList(),
        // Default to 'live' so an older backend doesn't wrongly warn about mock.
        source: (j['source'] as String?) ?? 'live',
        stationsInRadius: (j['stationsInRadius'] as num?)?.toInt() ?? 0,
      );
}

class KycProfile {
  final String status;
  final String? rejectionReason;

  KycProfile({required this.status, this.rejectionReason});

  bool get isVerified => status == 'VERIFIED';

  factory KycProfile.fromJson(Map<String, dynamic> j) => KycProfile(
        status: (j['status'] as String?) ?? 'NOT_STARTED',
        rejectionReason: j['rejectionReason'] as String?,
      );
}

class Plan {
  final String plan;
  final String label;
  final int priceMinor;
  final List<int> mileagePackages;

  Plan({required this.plan, required this.label, required this.priceMinor, required this.mileagePackages});

  factory Plan.fromJson(Map<String, dynamic> j) => Plan(
        plan: j['plan'] as String,
        label: j['label'] as String,
        priceMinor: (j['priceMinor'] as int?) ?? 0,
        mileagePackages:
            ((j['mileagePackages'] as List?) ?? []).map((e) => e as int).toList(),
      );
}

class Referral {
  final String id;
  final String code;
  final String? refereeEmail;
  final String status;
  final int rewardMinor;

  Referral({
    required this.id,
    required this.code,
    this.refereeEmail,
    required this.status,
    required this.rewardMinor,
  });

  factory Referral.fromJson(Map<String, dynamic> j) => Referral(
        id: j['id'] as String,
        code: j['code'] as String,
        refereeEmail: j['refereeEmail'] as String?,
        status: (j['status'] as String?) ?? 'PENDING',
        rewardMinor: (j['rewardMinor'] as int?) ?? 1000,
      );
}

class Reminder {
  final String id;
  final String type;
  final DateTime dueDate;
  final String? note;
  final bool completed;

  Reminder({
    required this.id,
    required this.type,
    required this.dueDate,
    this.note,
    required this.completed,
  });

  factory Reminder.fromJson(Map<String, dynamic> j) => Reminder(
        id: j['id'] as String,
        type: j['type'] as String,
        dueDate: DateTime.parse(j['dueDate'] as String),
        note: j['note'] as String?,
        completed: (j['completed'] as bool?) ?? false,
      );
}

class AppNotification {
  final String id;
  final String title;
  final String body;
  final String type;
  final bool read;
  final DateTime createdAt;

  AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.read,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['id'] as String,
        title: j['title'] as String,
        body: j['body'] as String,
        type: (j['type'] as String?) ?? 'GENERAL',
        read: (j['read'] as bool?) ?? false,
        createdAt: DateTime.parse(j['createdAt'] as String),
      );
}

class SavingsInsight {
  final String headline;
  final String narrative;
  final List<String> tips;
  final String source;
  final int totalSavedMinor;
  final int projectedAnnualSavingMinor;
  final int purchaseCount;

  SavingsInsight({
    required this.headline,
    required this.narrative,
    required this.tips,
    required this.source,
    required this.totalSavedMinor,
    required this.projectedAnnualSavingMinor,
    required this.purchaseCount,
  });

  factory SavingsInsight.fromJson(Map<String, dynamic> j) {
    final insight = j['insight'] as Map<String, dynamic>;
    final summary = j['summary'] as Map<String, dynamic>;
    return SavingsInsight(
      headline: insight['headline'] as String,
      narrative: insight['narrative'] as String,
      tips: ((insight['tips'] as List?) ?? []).map((e) => e as String).toList(),
      source: (insight['source'] as String?) ?? 'rules',
      totalSavedMinor: (summary['totalSavedMinor'] as int?) ?? 0,
      projectedAnnualSavingMinor: (summary['projectedAnnualSavingMinor'] as int?) ?? 0,
      purchaseCount: (summary['purchaseCount'] as int?) ?? 0,
    );
  }
}
