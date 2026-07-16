import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/location.dart';
import '../services/maps_launcher.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import '../units.dart';

/// Cheapest EV charging nearby, ranked like the fuel tab.
///
/// The honest caveat, surfaced in the UI: EV prices aren't open data. Open
/// Charge Map's cost field is contributor-written free text, so some chargers
/// have a usable price and many don't. Priced ones rank first; the rest are
/// still listed (marked "price not published") rather than hidden or guessed.
class EvScreen extends StatefulWidget {
  const EvScreen({super.key});

  @override
  State<EvScreen> createState() => _EvScreenState();
}

class _EvScreenState extends State<EvScreen> {
  late final EvRepository _repo;
  Future<RankedChargerResult>? _future;
  LocatedPosition? _pos;
  bool _locating = false;
  bool _rapidOnly = false;

  @override
  void initState() {
    super.initState();
    _repo = EvRepository(context.read<ApiClient>());
    _load();
  }

  Future<void> _load({bool refresh = false}) async {
    if (refresh) _pos = null;
    var pos = _pos;
    if (pos == null) {
      setState(() => _locating = true);
      pos = await LocationService.current();
      if (!mounted) return;
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
      _future = _repo.ranked(
        lat: pos!.lat,
        lng: pos.lng,
        limit: 3,
        // 50kW+ is the usual definition of "rapid" — worth filtering to when
        // you need a top-up now rather than overnight.
        minPowerKw: _rapidOnly ? 50 : null,
      );
    });
  }

  Future<void> _navigate(RankedCharger c) async {
    final ok = await MapsLauncher.navigate(
      context,
      lat: c.latitude,
      lng: c.longitude,
      label: c.operator ?? c.title,
    );
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not open a maps app')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final unit = DistanceUnit.fromApi(context.watch<AuthState>().user?.distanceUnit);

    return Scaffold(
      appBar: AppBar(title: const Text('EV charging')),
      body: RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            const Text('Cheapest charging near you',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Ranked by price per kWh where published',
                style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
            const SizedBox(height: 12),
            _LocationLine(pos: _pos, locating: _locating),
            const SizedBox(height: 12),
            Row(
              children: [
                FilterChip(
                  label: const Text('Rapid only (50kW+)'),
                  selected: _rapidOnly,
                  onSelected: (v) {
                    setState(() => _rapidOnly = v);
                    _load();
                  },
                ),
              ],
            ),
            const SizedBox(height: 12),
            FutureBuilder<RankedChargerResult>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(40),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snap.hasError) {
                  return _empty(
                    Icons.cloud_off,
                    "Couldn't load chargers",
                    '${snap.error}',
                  );
                }
                final data = snap.data;
                if (data == null || data.results.isEmpty) {
                  return _empty(
                    Icons.ev_station_outlined,
                    'No chargers found nearby',
                    _pos?.isReal == false
                        ? '${_pos!.problem}, so we searched ${_pos!.placeName ?? 'central London'}. '
                            'Turn on location to see chargers near you.'
                        : _rapidOnly
                            ? 'No rapid (50kW+) chargers within range. Try turning the filter off.'
                            : 'No public chargers are listed near ${_pos?.placeName ?? 'you'}.',
                  );
                }
                return Column(
                  children: [
                    if (data.source == 'mock') const _MockBanner(),
                    if (data.averagePence != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          'Local average ${data.averagePence!.toStringAsFixed(0)}p/kWh  ·  '
                          'based on a ${data.kwh} kWh charge',
                          style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                        ),
                      ),
                    for (final c in data.results)
                      _ChargerCard(
                        charger: c,
                        unit: unit,
                        onNavigate: () => _navigate(c),
                      ),
                    if (data.unpricedCount > 0) _UnpricedNote(count: data.unpricedCount),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _empty(IconData icon, String title, String message) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 8),
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
            OutlinedButton(
                onPressed: () => _load(refresh: true), child: const Text('Try again')),
          ],
        ),
      );
}

class _LocationLine extends StatelessWidget {
  const _LocationLine({required this.pos, required this.locating});
  final LocatedPosition? pos;
  final bool locating;

  @override
  Widget build(BuildContext context) {
    if (locating || pos == null) {
      return Text('Finding your location…',
          style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600));
    }
    final p = pos!;
    return Row(
      children: [
        Icon(p.isReal ? Icons.my_location : Icons.location_off,
            size: 14, color: p.isReal ? kBrandGreen : const Color(0xFFD97706)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            p.isReal
                ? 'Searching near ${p.placeName ?? 'you'}'
                : '${p.problem} — showing ${p.placeName ?? 'central London'}',
            style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700),
          ),
        ),
      ],
    );
  }
}

class _MockBanner extends StatelessWidget {
  const _MockBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF3C7),
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.science_outlined, size: 18, color: Color(0xFF92400E)),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Sample chargers — live EV data needs an Open Charge Map key. '
              "Don't rely on these prices.",
              style: TextStyle(fontSize: 12, color: Color(0xFF92400E)),
            ),
          ),
        ],
      ),
    );
  }
}

/// Says plainly how many nearby chargers publish nothing, rather than leaving
/// the member wondering why the list is short.
class _UnpricedNote extends StatelessWidget {
  const _UnpricedNote({required this.count});
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 13, color: Colors.grey.shade500),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '$count nearby charger${count == 1 ? '' : 's'} '
              "${count == 1 ? "doesn't" : "don't"} publish a price. "
              'Unlike petrol, EV tariffs are not open data, so we can only rank '
              'what operators actually publish.',
              style: TextStyle(fontSize: 11.5, color: Colors.grey.shade500, height: 1.35),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChargerCard extends StatelessWidget {
  const _ChargerCard({
    required this.charger,
    required this.unit,
    required this.onNavigate,
  });

  final RankedCharger charger;
  final DistanceUnit unit;
  final VoidCallback onNavigate;

  @override
  Widget build(BuildContext context) {
    final c = charger;
    final cheapest = c.rank == 1 && c.hasPrice;
    final accent = cheapest ? kBrandGreen : kBrandBlue;

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
                  backgroundColor: accent.withValues(alpha: 0.12),
                  child: Text('#${c.rank}',
                      style: TextStyle(
                          color: accent, fontWeight: FontWeight.w800, fontSize: 13)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(c.operator ?? c.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                      Text(
                        [
                          if (c.eta != null)
                            formatEta(c.eta!.seconds,
                                c.eta!.routed ? c.eta!.km : c.distanceKm, unit)
                          else if (c.distanceKm != null)
                            formatDistanceKm(c.distanceKm!, unit),
                          if (c.maxPowerKw != null) '${c.maxPowerKw!.round()} kW',
                          if (c.points > 0) '${c.points} bay${c.points == 1 ? '' : 's'}',
                        ].join('  ·  '),
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
                      ),
                    ],
                  ),
                ),
                // Price, or an honest blank where none is published.
                if (c.isFree)
                  const Text('FREE',
                      style: TextStyle(
                          fontSize: 16, fontWeight: FontWeight.w800, color: kBrandGreen))
                else if (c.hasPrice)
                  Text('${c.pricePencePerKwh!.toStringAsFixed(0)}p/kWh',
                      style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800))
                else
                  Text('—',
                      style: TextStyle(
                          fontSize: 18, fontWeight: FontWeight.w800, color: Colors.grey.shade400)),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: (c.hasPrice ? accent : Colors.grey).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(
                    c.hasPrice ? (cheapest ? Icons.local_offer : Icons.savings) : Icons.help_outline,
                    size: 16,
                    color: c.hasPrice ? accent : Colors.grey.shade600,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _blurb(c),
                      style: TextStyle(
                        color: c.hasPrice ? accent : Colors.grey.shade700,
                        fontWeight: FontWeight.w600,
                        fontSize: 12.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (c.connectorTypes.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(c.connectorTypes.join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: Colors.grey.shade500)),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: accent,
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

  static String _blurb(RankedCharger c) {
    if (c.isFree) return 'Free to charge — parking charges may still apply';
    if (!c.hasPrice) {
      // Show the operator's own words rather than pretending we know.
      return c.usageCostText?.isNotEmpty == true
          ? 'Price not published — "${c.usageCostText}"'
          : 'Price not published by this operator';
    }
    final save = c.savingVsAverageMinor ?? 0;
    final extra = c.extraVsCheapestMinor ?? 0;
    if (c.rank == 1) {
      return save > 0
          ? 'CHEAPEST — save ${formatMinor(save)} on a charge'
          : 'CHEAPEST nearby';
    }
    if (save > 0) {
      return 'Save ${formatMinor(save)} vs average  ·  +${formatMinor(extra)} vs cheapest';
    }
    return '+${formatMinor(extra)} vs the cheapest option';
  }
}
