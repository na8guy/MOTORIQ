import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../services/location.dart';
import '../services/maps_launcher.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import '../units.dart';
import 'home_screen.dart';

const _fuelKinds = {
  'E10': 'Petrol E10',
  'E5': 'Super E5',
  'B7': 'Diesel',
  'ELECTRIC': 'EV charging',
};

class FuelTab extends StatefulWidget {
  const FuelTab({super.key});

  @override
  State<FuelTab> createState() => _FuelTabState();
}

class _FuelTabState extends State<FuelTab> {
  late final FuelRepository _repo;
  Future<RankedResult>? _future;
  String _kind = 'E10';
  LocatedPosition? _pos;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _repo = FuelRepository(context.read<ApiClient>());
    // The dashboard's "EV charging savings" card asks for EV mode directly.
    evOnlyRequest.addListener(_onEvRequested);
    if (evOnlyRequest.value) {
      _kind = 'ELECTRIC';
      evOnlyRequest.value = false;
    }
    _load();
  }

  @override
  void dispose() {
    evOnlyRequest.removeListener(_onEvRequested);
    super.dispose();
  }

  void _onEvRequested() {
    if (!evOnlyRequest.value || !mounted) return;
    evOnlyRequest.value = false;
    if (_kind == 'ELECTRIC') return;
    setState(() => _kind = 'ELECTRIC');
    _load();
  }

  /// Re-resolve the position (`refresh: true`) or reuse the one we have.
  Future<void> _load({bool refresh = false}) async {
    if (refresh) _pos = null;
    var pos = _pos;

    if (pos == null) {
      setState(() => _locating = true);
      pos = await LocationService.current();
      if (!mounted) return;
      // Name the place in the background — the prices must not wait on it.
      if (pos.placeName == null) {
        LocationService.describe(pos.lat, pos.lng).then((name) {
          if (mounted && name != null) setState(() => _pos = _pos?.withPlace(name));
        });
      }
    }

    if (!mounted) return;
    setState(() {
      _pos = pos;
      _locating = false;
      _future = _repo.ranked(lat: pos!.lat, lng: pos.lng, kind: _kind, limit: 3);
    });
  }

  Future<void> _enableLocation() async {
    final pos = _pos;
    // A permanent denial can only be undone in Settings; asking again is a no-op.
    if (pos?.source == LocationSource.deniedForever ||
        pos?.source == LocationSource.serviceDisabled) {
      await LocationService.openSettings();
    } else {
      await LocationService.requestPermission();
    }
    await _load(refresh: true);
  }

  /// Open directions in the member's chosen maps app, and record that they set
  /// off. That record is an INTENT: it counts for nothing until a card payment
  /// matches it or they confirm they filled up, so the savings figure stays
  /// honest even when someone arrives and changes their mind.
  Future<void> _navigate(RankedStation s, RankedResult data) async {
    final messenger = ScaffoldMessenger.of(context);

    // Fire and forget — a failure to log intent must never block navigation.
    FillUpRepository(context.read<ApiClient>())
        .recordIntent(
          fuelKind: _kind,
          pricePencePerUnit: s.pricePence,
          benchmarkPencePerUnit: data.averagePence,
          estimatedLitres: data.tankLitres.toDouble(),
          siteId: s.siteId,
          stationBrand: s.brand,
          stationPostcode: s.postcode,
          lat: s.latitude,
          lng: s.longitude,
        )
        .catchError((_) {/* savings just won't include this trip */});

    if (!mounted) return;
    final ok = await MapsLauncher.navigate(
      context,
      lat: s.latitude,
      lng: s.longitude,
      label: s.brand,
    );
    if (!ok && mounted) {
      messenger.showSnackBar(const SnackBar(content: Text('Could not open a maps app')));
    }
  }

  String get _unit => _kind == 'ELECTRIC' ? 'p/kWh' : 'p/L';

  String get _kindLabel => (_fuelKinds[_kind] ?? _kind).toLowerCase();

  /// Explain an empty list. The three causes need three different answers:
  /// no location, nowhere sells this fuel here, or the data itself is missing.
  String _emptyReason(RankedResult? data) {
    final pos = _pos;
    // Mock data is a handful of London samples, so anywhere else comes back
    // empty. Saying "no stations near you" there would be false — the area has
    // forecourts; we just have no live data. Name the real cause.
    if (data?.source == 'mock') {
      return "We're not connected to live fuel prices right now, so we can't "
          "show real prices near ${pos?.placeName ?? 'you'}. This is a problem "
          'at our end, not with your location.';
    }
    if (pos != null && !pos.isReal) {
      return '${pos.problem}, so we searched ${pos.placeName ?? 'central London'} instead. '
          'Turn on location to see prices where you actually are.';
    }
    if (data != null && data.stationsInRadius > 0) {
      // We know about forecourts here — none of them lists this fuel kind.
      return 'We found ${data.stationsInRadius} station${data.stationsInRadius == 1 ? '' : 's'} '
          'near ${pos?.placeName ?? 'you'}, but none publishes a $_kindLabel price right now. '
          'Try another fuel type.';
    }
    return 'No stations publish prices near ${pos?.placeName ?? 'your location'} yet. '
        'UK coverage depends on which retailers report their prices.';
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () => _load(refresh: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text('Cheapest near you',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('Ranked live prices + one-tap directions',
              style: TextStyle(color: Colors.grey.shade600)),
          const SizedBox(height: 12),
          // Always say where we're searching. Previously a denied permission
          // silently searched central London, so members far from London saw
          // "No prices found nearby" with no idea why.
          _LocationBanner(
            pos: _pos,
            locating: _locating,
            onEnable: _enableLocation,
            onRefresh: () => _load(refresh: true),
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 38,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: _fuelKinds.entries
                  .map((e) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(e.value),
                          selected: _kind == e.key,
                          onSelected: (_) {
                            setState(() => _kind = e.key);
                            _load();
                          },
                        ),
                      ))
                  .toList(),
            ),
          ),
          const SizedBox(height: 16),
          FutureBuilder<RankedResult>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (snap.hasError) {
                return _EmptyState(
                  icon: Icons.cloud_off,
                  title: "Couldn't load prices",
                  message: '${snap.error}',
                  actionLabel: 'Try again',
                  onAction: () => _load(refresh: true),
                );
              }
              final data = snap.data;
              if (data == null || data.results.isEmpty) {
                return _EmptyState(
                  icon: Icons.location_searching,
                  title: 'No $_kindLabel prices near here',
                  // Say which of the possible reasons it actually is, rather
                  // than one vague line that fits all of them.
                  message: _emptyReason(data),
                  actionLabel: _pos?.isReal == false ? 'Use my location' : 'Try again',
                  onAction: _pos?.isReal == false
                      ? _enableLocation
                      : () => _load(refresh: true),
                );
              }
              return Column(
                children: [
                  if (data.source == 'mock') const _MockDataWarning(),
                  if (data.averagePence != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'Local average ${data.averagePence!.toStringAsFixed(1)}$_unit  ·  full tank ${data.tankLitres}L',
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                      ),
                    ),
                  for (final s in data.results)
                    _StationCard(
                      station: s,
                      unit: _unit,
                      distanceUnit: DistanceUnit.fromApi(
                        context.watch<AuthState>().user?.distanceUnit,
                      ),
                      onNavigate: () => _navigate(s, data),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

/// Tells the member exactly where we're searching from — and offers the fix
/// when that isn't their real location.
class _LocationBanner extends StatelessWidget {
  const _LocationBanner({
    required this.pos,
    required this.locating,
    required this.onEnable,
    required this.onRefresh,
  });

  final LocatedPosition? pos;
  final bool locating;
  final VoidCallback onEnable;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    if (locating || pos == null) {
      return _shell(
        context,
        icon: Icons.my_location,
        color: kBrandBlue,
        child: Text('Finding your location…',
            style: TextStyle(color: Colors.grey.shade700, fontSize: 13)),
      );
    }

    final p = pos!;
    if (p.isReal) {
      return _shell(
        context,
        icon: Icons.my_location,
        color: kBrandGreen,
        child: RichText(
          text: TextSpan(
            style: TextStyle(color: Colors.grey.shade700, fontSize: 13),
            children: [
              const TextSpan(text: 'Searching near '),
              TextSpan(
                text: p.placeName ??
                    '${p.lat.toStringAsFixed(3)}, ${p.lng.toStringAsFixed(3)}',
                style: const TextStyle(fontWeight: FontWeight.w700, color: Colors.black87),
              ),
            ],
          ),
        ),
        trailing: IconButton(
          tooltip: 'Update location',
          icon: const Icon(Icons.refresh, size: 18),
          onPressed: onRefresh,
        ),
      );
    }

    // Not a real fix — be explicit that these are not prices near them.
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          const Icon(Icons.location_off, size: 18, color: Color(0xFFD97706)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.problem ?? 'Location unavailable',
                    style: const TextStyle(
                        fontWeight: FontWeight.w700, fontSize: 13, color: Color(0xFF92400E))),
                const SizedBox(height: 2),
                Text('Showing ${p.placeName ?? 'central London'} instead',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF92400E))),
              ],
            ),
          ),
          TextButton(onPressed: onEnable, child: const Text('Enable')),
        ],
      ),
    );
  }

  Widget _shell(
    BuildContext context, {
    required IconData icon,
    required Color color,
    required Widget child,
    Widget? trailing,
  }) {
    return Container(
      padding: EdgeInsets.fromLTRB(12, 10, trailing != null ? 4 : 12, 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(child: child),
          if (trailing != null) trailing,
        ],
      ),
    );
  }
}

/// Shown when the backend is serving bundled sample data. Members must never
/// be sent driving to a made-up price.
class _MockDataWarning extends StatelessWidget {
  const _MockDataWarning();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEE2E2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFB91C1C)),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Sample prices — live fuel data is unavailable right now. '
              "Don't rely on these figures.",
              style: TextStyle(fontSize: 12, color: Color(0xFF991B1B)),
            ),
          ),
        ],
      ),
    );
  }
}

/// A dead end with a way out: what happened, why, and what to do about it.
class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32, horizontal: 8),
      child: Column(
        children: [
          Icon(icon, size: 40, color: Colors.grey.shade400),
          const SizedBox(height: 12),
          Text(title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(message,
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.grey.shade600, fontSize: 13, height: 1.4)),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}

class _StationCard extends StatelessWidget {
  const _StationCard({
    required this.station,
    required this.unit,
    required this.distanceUnit,
    required this.onNavigate,
  });
  final RankedStation station;
  final String unit;
  final DistanceUnit distanceUnit;
  final VoidCallback onNavigate;

  @override
  Widget build(BuildContext context) {
    final cheapest = station.rank == 1;
    final saving = station.savingVsAverageMinor;
    final hours = station.hours;
    // Only ever say "closed" when we actually know. Most sites publish nothing.
    final closed = hours?.isOpen == false;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: cheapest ? kBrandGreen : const Color(0xFFE1E7EF),
            width: cheapest ? 1.5 : 1,
          ),
        ),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 16,
                  backgroundColor: (cheapest ? kBrandGreen : kBrandBlue).withValues(alpha: 0.12),
                  child: Text('#${station.rank}',
                      style: TextStyle(
                          color: cheapest ? kBrandGreen : kBrandBlue,
                          fontWeight: FontWeight.w800,
                          fontSize: 13)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(station.brand,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      Text(
                        [
                          // "4 min · 1.2 mi" — the drive time is what a member
                          // actually wants; raw straight-line km wasn't useful.
                          if (station.eta != null)
                            formatEta(
                              station.eta!.seconds,
                              station.eta!.routed ? station.eta!.km : station.distanceKm,
                              distanceUnit,
                            )
                          else if (station.distanceKm != null)
                            formatDistanceKm(station.distanceKm!, distanceUnit),
                          if (station.postcode.isNotEmpty) station.postcode,
                        ].join('  ·  '),
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                Text('${station.pricePence.toStringAsFixed(1)}$unit',
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ],
            ),
            // Opening hours, only when a source actually publishes them. Most
            // forecourts don't, and inventing hours is worse than silence.
            if (hours != null) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(
                    closed ? Icons.schedule : Icons.check_circle_outline,
                    size: 13,
                    color: closed ? const Color(0xFFB91C1C) : kBrandGreen,
                  ),
                  const SizedBox(width: 5),
                  Expanded(
                    child: Text(
                      hours.describe(),
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: closed ? const Color(0xFFB91C1C) : kBrandGreen,
                      ),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: (cheapest ? kBrandGreen : kBrandBlue).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(cheapest ? Icons.local_offer : Icons.savings,
                      size: 16, color: cheapest ? kBrandGreen : kBrandBlue),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      cheapest
                          ? 'CHEAPEST — save ${formatMinor(saving)} on a full tank'
                          : saving > 0
                              ? 'Save ${formatMinor(saving)} vs average  ·  +${formatMinor(station.extraVsCheapestMinor)} vs cheapest'
                              : '+${formatMinor(station.extraVsCheapestMinor)} vs the cheapest option',
                      style: TextStyle(
                        color: cheapest ? kBrandGreen : kBrandBlue,
                        fontWeight: FontWeight.w600,
                        fontSize: 12.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: cheapest ? kBrandGreen : kBrandBlue,
                  minimumSize: const Size.fromHeight(44),
                ),
                onPressed: onNavigate,
                icon: const Icon(Icons.navigation, size: 18),
                label: const Text('Navigate here'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
