import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../services/location.dart';
import '../theme.dart';

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
  ({double lat, double lng})? _pos;

  @override
  void initState() {
    super.initState();
    _repo = FuelRepository(context.read<ApiClient>());
    _load();
  }

  Future<void> _load() async {
    final pos = _pos ?? await LocationService.current();
    if (!mounted) return;
    setState(() {
      _pos = pos;
      _future = _repo.ranked(lat: pos.lat, lng: pos.lng, kind: _kind, limit: 3);
    });
  }

  Future<void> _navigate(RankedStation s) async {
    final ok = await LocationService.navigate(s.navigationUrl);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not open maps')));
    }
  }

  String get _unit => _kind == 'ELECTRIC' ? 'p/kWh' : 'p/L';

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text('Cheapest near you',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('Ranked live prices + one-tap directions',
              style: TextStyle(color: Colors.grey.shade600)),
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
              if (snap.hasError) return Center(child: Text('${snap.error}'));
              final data = snap.data;
              if (data == null || data.results.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: Text('No prices found nearby')),
                );
              }
              return Column(
                children: [
                  if (data.averagePence != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'Local average ${data.averagePence!.toStringAsFixed(1)}$_unit  ·  full tank ${data.tankLitres}L',
                        style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                      ),
                    ),
                  for (final s in data.results)
                    _StationCard(station: s, unit: _unit, onNavigate: () => _navigate(s)),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _StationCard extends StatelessWidget {
  const _StationCard({required this.station, required this.unit, required this.onNavigate});
  final RankedStation station;
  final String unit;
  final VoidCallback onNavigate;

  @override
  Widget build(BuildContext context) {
    final cheapest = station.rank == 1;
    final saving = station.savingVsAverageMinor;
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
                          if (station.distanceKm != null)
                            '${station.distanceKm!.toStringAsFixed(1)} km',
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
