/// Data models mirroring the MOTORIQ API responses.
/// All monetary values arrive as integer minor units (pence).
library;

class AppUser {
  final String id;
  final String email;
  final String? firstName;
  final String? lastName;
  final String tier;
  final bool emailVerified;
  final int walletBalanceMinor;
  final int totalSavedMinor;

  AppUser({
    required this.id,
    required this.email,
    this.firstName,
    this.lastName,
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

  Vehicle({
    required this.id,
    required this.registration,
    this.make,
    this.model,
    this.year,
    required this.fuelType,
    this.mileage,
  });

  String get label => [make, model].where((s) => s != null && s.isNotEmpty).join(' ');

  factory Vehicle.fromJson(Map<String, dynamic> j) => Vehicle(
        id: j['id'] as String,
        registration: j['registration'] as String,
        make: j['make'] as String?,
        model: j['model'] as String?,
        year: j['year'] as int?,
        fuelType: (j['fuelType'] as String?) ?? 'PETROL',
        mileage: j['mileage'] as int?,
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

  RankedResult({
    required this.kind,
    required this.tankLitres,
    this.averagePence,
    this.cheapestPence,
    required this.results,
  });

  factory RankedResult.fromJson(Map<String, dynamic> j) => RankedResult(
        kind: j['kind'] as String,
        tankLitres: (j['tankLitres'] as num).round(),
        averagePence: (j['averagePence'] as num?)?.toDouble(),
        cheapestPence: (j['cheapestPence'] as num?)?.toDouble(),
        results: ((j['results'] as List?) ?? [])
            .map((e) => RankedStation.fromJson(e as Map<String, dynamic>))
            .toList(),
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
