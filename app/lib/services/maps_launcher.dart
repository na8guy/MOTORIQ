import 'dart:io';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// A navigation app installed on this device.
class MapsApp {
  const MapsApp({
    required this.id,
    required this.name,
    required this.icon,
    required this.buildUrl,
  });

  final String id;
  final String name;
  final IconData icon;

  /// Builds the deep link for a destination.
  final Uri Function(double lat, double lng, String? label) buildUrl;
}

/// Opens turn-by-turn directions in the member's own choice of maps app.
///
/// Previously every "Navigate here" went straight to Google Maps, which is
/// wrong twice over: on iOS most people use Apple Maps, and if Google Maps
/// isn't installed the https:// link dumps them into a browser.
///
/// So: detect what's actually installed, ask if there's a choice, and go
/// straight there if there's only one.
class MapsLauncher {
  /// Every app we know how to launch. `canLaunchUrl` on the scheme tells us
  /// which are actually installed.
  static final List<MapsApp> _known = [
    MapsApp(
      id: 'apple',
      name: 'Apple Maps',
      icon: Icons.map_outlined,
      // `dirflg=d` = driving directions.
      buildUrl: (lat, lng, label) => Uri.parse(
        'https://maps.apple.com/?daddr=$lat,$lng&dirflg=d${label != null ? '&q=${Uri.encodeComponent(label)}' : ''}',
      ),
    ),
    MapsApp(
      id: 'google',
      name: 'Google Maps',
      icon: Icons.navigation_outlined,
      buildUrl: (lat, lng, label) => Uri.parse(
        'comgooglemaps://?daddr=$lat,$lng&directionsmode=driving',
      ),
    ),
    MapsApp(
      id: 'waze',
      name: 'Waze',
      icon: Icons.traffic_outlined,
      buildUrl: (lat, lng, label) => Uri.parse('waze://?ll=$lat,$lng&navigate=yes'),
    ),
    MapsApp(
      id: 'citymapper',
      name: 'Citymapper',
      icon: Icons.directions_transit_outlined,
      buildUrl: (lat, lng, label) => Uri.parse('citymapper://directions?endcoord=$lat,$lng'),
    ),
  ];

  /// Probe schemes to see which apps exist.
  ///
  /// iOS only answers `canLaunchUrl` for schemes declared in
  /// LSApplicationQueriesSchemes — an undeclared scheme silently reports false,
  /// which would hide an app the member actually has installed.
  static Future<List<MapsApp>> installed() async {
    final probes = <String, String>{
      'apple': Platform.isIOS ? 'https://maps.apple.com/' : '',
      'google': 'comgooglemaps://',
      'waze': 'waze://',
      'citymapper': 'citymapper://',
    };

    final found = <MapsApp>[];
    for (final app in _known) {
      final probe = probes[app.id];
      if (probe == null || probe.isEmpty) continue;
      try {
        if (await canLaunchUrl(Uri.parse(probe))) found.add(app);
      } catch (_) {
        // A scheme we can't query is one we shouldn't offer.
      }
    }
    return found;
  }

  /// Universal web fallback — works everywhere, opens whatever handles it.
  static Uri _webFallback(double lat, double lng) => Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=$lat,$lng&travelmode=driving',
      );

  /// Navigate to a destination, letting the member choose when they have more
  /// than one maps app. Returns false if nothing could be opened.
  static Future<bool> navigate(
    BuildContext context, {
    required double lat,
    required double lng,
    String? label,
  }) async {
    final apps = await installed();

    // Nothing detected: fall back to the web link rather than dead-ending.
    if (apps.isEmpty) {
      return _open(_webFallback(lat, lng));
    }

    // Only one app — don't make them choose between one thing.
    if (apps.length == 1) {
      return _open(apps.first.buildUrl(lat, lng, label));
    }

    if (!context.mounted) return false;
    final chosen = await showModalBottomSheet<MapsApp>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Row(
                children: [
                  const Icon(Icons.navigation, size: 18),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      label == null ? 'Navigate with' : 'Navigate to $label with',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
            for (final app in apps)
              ListTile(
                leading: Icon(app.icon),
                title: Text(app.name),
                onTap: () => Navigator.pop(ctx, app),
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );

    if (chosen == null) return true; // dismissed on purpose — not a failure
    final ok = await _open(chosen.buildUrl(lat, lng, label));
    // A deep link can still fail (app removed since we probed) — don't strand them.
    return ok ? true : _open(_webFallback(lat, lng));
  }

  static Future<bool> _open(Uri uri) async {
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }
}
