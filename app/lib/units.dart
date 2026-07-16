/// Distance and duration formatting.
///
/// The UK is genuinely mixed: road signs and speedometers are in miles, but
/// plenty of people think in km. Miles is the default because that's what the
/// road signs say; Settings lets anyone switch.
library;

enum DistanceUnit {
  miles,
  km;

  static DistanceUnit fromApi(String? v) =>
      (v ?? 'MILES').toUpperCase() == 'KM' ? DistanceUnit.km : DistanceUnit.miles;

  String get api => this == DistanceUnit.km ? 'KM' : 'MILES';
  String get shortLabel => this == DistanceUnit.km ? 'km' : 'mi';
  String get longLabel => this == DistanceUnit.km ? 'Kilometres' : 'Miles';
}

const double _kmPerMile = 1.609344;

/// Format a distance given in kilometres (the API's unit) for display.
///
/// Precision follows what's useful, not what's available: a tenth of a mile is
/// meaningful when you're picking between forecourts; two decimal places of a
/// GPS-derived distance is false precision.
String formatDistanceKm(double km, DistanceUnit unit) {
  if (unit == DistanceUnit.km) {
    if (km < 1) return '${(km * 1000).round()} m';
    return '${km.toStringAsFixed(1)} km';
  }
  final miles = km / _kmPerMile;
  if (miles < 0.1) {
    // Yards are what a British driver expects at this range.
    return '${(miles * 1760).round()} yd';
  }
  return '${miles.toStringAsFixed(1)} mi';
}

/// Format a drive time. Rounds up to at least 1 minute — "0 min away" is
/// nonsense even if you're next door.
String formatDuration(int seconds) {
  if (seconds < 60) return '1 min';
  final mins = (seconds / 60).round();
  if (mins < 60) return '$mins min';
  final hours = mins ~/ 60;
  final rem = mins % 60;
  return rem == 0 ? '$hours hr' : '$hours hr $rem min';
}

/// "4 min · 1.2 mi" — the two facts a driver actually wants together.
String formatEta(int? seconds, double? km, DistanceUnit unit) {
  final parts = <String>[
    if (seconds != null) formatDuration(seconds),
    if (km != null) formatDistanceKm(km, unit),
  ];
  return parts.join(' · ');
}
