/// Data models mirroring the MOTORIQ API responses.
/// All monetary values arrive as integer minor units (pence).

class AppUser {
  final String id;
  final String email;
  final String? firstName;
  final String? lastName;
  final String tier;
  final int walletBalanceMinor;
  final int totalSavedMinor;

  AppUser({
    required this.id,
    required this.email,
    this.firstName,
    this.lastName,
    required this.tier,
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
