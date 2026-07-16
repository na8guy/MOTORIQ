import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

/// How we arrived at the position we're searching from.
enum LocationSource {
  /// A real GPS fix from the device.
  gps,

  /// Location services are switched off device-wide.
  serviceDisabled,

  /// The member declined the permission prompt.
  denied,

  /// Declined permanently — only Settings can undo it.
  deniedForever,

  /// Something else went wrong (timeout, no fix).
  error,
}

/// A position plus the story of where it came from, so the UI can say
/// "Searching near Leeds" or "Turn on location to see prices near you"
/// instead of silently pretending central London is where you are.
class LocatedPosition {
  const LocatedPosition({
    required this.lat,
    required this.lng,
    required this.source,
    this.placeName,
  });

  final double lat;
  final double lng;
  final LocationSource source;

  /// Human-readable place ("Leeds", "SE1 9PX") — null until reverse-geocoded.
  final String? placeName;

  /// True when this is a real device fix rather than the London fallback.
  bool get isReal => source == LocationSource.gps;

  /// What to tell the member about why we're not using their location.
  String? get problem => switch (source) {
        LocationSource.gps => null,
        LocationSource.serviceDisabled => 'Location is turned off on this device',
        LocationSource.denied => 'MOTORIQ needs location permission',
        LocationSource.deniedForever =>
          'Location permission is blocked — enable it in Settings',
        LocationSource.error => "Couldn't get a location fix",
      };

  LocatedPosition withPlace(String? name) =>
      LocatedPosition(lat: lat, lng: lng, source: source, placeName: name);
}

/// Device location + maps navigation helpers.
class LocationService {
  /// Where we search when we have no fix. Central London is arbitrary but
  /// keeps the screen useful rather than empty; the UI must say so.
  static const fallbackLat = 51.5074;
  static const fallbackLng = -0.1278;
  static const fallbackName = 'Central London';

  /// Current position, reporting *why* if it isn't a real fix.
  static Future<LocatedPosition> current() async {
    LocatedPosition fallback(LocationSource source) => LocatedPosition(
          lat: fallbackLat,
          lng: fallbackLng,
          source: source,
          placeName: fallbackName,
        );

    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return fallback(LocationSource.serviceDisabled);
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        return fallback(LocationSource.deniedForever);
      }
      if (permission == LocationPermission.denied) {
        return fallback(LocationSource.denied);
      }

      // Cap the wait: a cold GPS fix indoors can hang for a long time, and a
      // stale-but-recent position beats making the member stare at a spinner.
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 12),
        ),
      );
      return LocatedPosition(
        lat: pos.latitude,
        lng: pos.longitude,
        source: LocationSource.gps,
      );
    } catch (_) {
      final last = await _lastKnown();
      return last ?? fallback(LocationSource.error);
    }
  }

  /// A previous fix, if the OS still has one — better than jumping to London.
  static Future<LocatedPosition?> _lastKnown() async {
    try {
      final pos = await Geolocator.getLastKnownPosition();
      if (pos == null) return null;
      return LocatedPosition(
        lat: pos.latitude,
        lng: pos.longitude,
        source: LocationSource.gps,
      );
    } catch (_) {
      return null;
    }
  }

  /// Turn coordinates into something a person recognises. Best-effort: this
  /// hits the platform geocoder, which can fail offline — never let it break
  /// the price list, which is the thing that actually matters.
  static Future<String?> describe(double lat, double lng) async {
    try {
      // geocoding 5.x exposes this on a Geocoding instance; the old top-level
      // placemarkFromCoordinates() function was removed in 4.0.
      final marks = await Geocoding().placemarkFromCoordinates(lat, lng);
      if (marks.isEmpty) return null;
      final m = marks.first;
      final town = <String?>[m.locality, m.subAdministrativeArea, m.administrativeArea]
          .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);
      final code = m.postalCode;
      final hasCode = code != null && code.isNotEmpty;
      if (town != null && hasCode) return '$town · $code';
      return town ?? (hasCode ? code : null);
    } catch (_) {
      return null;
    }
  }

  /// Opens the OS location settings so a blocked member can fix it.
  static Future<void> openSettings() => Geolocator.openLocationSettings();

  /// Ask for permission again (no-op if permanently denied).
  static Future<bool> requestPermission() async {
    final p = await Geolocator.requestPermission();
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  /// Open turn-by-turn directions to the station in the device's maps app.
  static Future<bool> navigate(String url) async {
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      return launchUrl(uri, mode: LaunchMode.externalApplication);
    }
    return false;
  }
}
