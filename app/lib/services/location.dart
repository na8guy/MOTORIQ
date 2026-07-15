import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';

/// Device location + maps navigation helpers.
class LocationService {
  // Central London fallback when permission is denied or unavailable.
  static const fallbackLat = 51.5074;
  static const fallbackLng = -0.1278;

  /// Best-effort current position; falls back to central London.
  static Future<({double lat, double lng})> current() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return (lat: fallbackLat, lng: fallbackLng);
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return (lat: fallbackLat, lng: fallbackLng);
      }
      final pos = await Geolocator.getCurrentPosition();
      return (lat: pos.latitude, lng: pos.longitude);
    } catch (_) {
      return (lat: fallbackLat, lng: fallbackLng);
    }
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
