import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

class FuelTab extends StatefulWidget {
  const FuelTab({super.key});

  @override
  State<FuelTab> createState() => _FuelTabState();
}

class _FuelTabState extends State<FuelTab> {
  late final FuelRepository _repo;
  Future<List<FuelStation>>? _future;
  bool _evOnly = false;

  // Default to central London; a production app would use device location.
  static const _lat = 51.5074;
  static const _lng = -0.1278;

  @override
  void initState() {
    super.initState();
    _repo = FuelRepository(context.read<ApiClient>());
    _load();
  }

  void _load() {
    setState(() =>
        _future = _repo.nearby(lat: _lat, lng: _lng, evOnly: _evOnly));
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: () async => _load(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          const Text('Fuel & charging',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text('Cheapest prices near you',
              style: TextStyle(color: Colors.grey.shade600)),
          const SizedBox(height: 16),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('Fuel'), icon: Icon(Icons.local_gas_station)),
              ButtonSegment(value: true, label: Text('EV'), icon: Icon(Icons.ev_station)),
            ],
            selected: {_evOnly},
            onSelectionChanged: (s) {
              setState(() => _evOnly = s.first);
              _load();
            },
          ),
          const SizedBox(height: 16),
          FutureBuilder<List<FuelStation>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (snap.hasError) {
                return Center(child: Text('${snap.error}'));
              }
              final stations = _sorted(snap.data ?? []);
              if (stations.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: Text('No stations found nearby')),
                );
              }
              return Column(
                children: [
                  for (var i = 0; i < stations.length; i++)
                    _StationCard(station: stations[i], cheapest: i == 0, evOnly: _evOnly),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  /// Sort by the headline price (E10 for fuel, ELECTRIC for EV), cheapest first.
  List<FuelStation> _sorted(List<FuelStation> stations) {
    final kind = _evOnly ? 'ELECTRIC' : 'E10';
    double priceOf(FuelStation s) {
      final p = s.prices.where((x) => x.kind == kind);
      return p.isEmpty ? double.infinity : p.first.pricePence;
    }

    final copy = [...stations]..sort((a, b) => priceOf(a).compareTo(priceOf(b)));
    return copy;
  }
}

class _StationCard extends StatelessWidget {
  const _StationCard({
    required this.station,
    required this.cheapest,
    required this.evOnly,
  });
  final FuelStation station;
  final bool cheapest;
  final bool evOnly;

  @override
  Widget build(BuildContext context) {
    final unit = evOnly ? 'p/kWh' : 'p/L';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(station.brand,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                  if (cheapest)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: kBrandGreen.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Text('Cheapest',
                          style: TextStyle(
                              color: kBrandGreen,
                              fontWeight: FontWeight.w700,
                              fontSize: 12)),
                    ),
                ],
              ),
              const SizedBox(height: 2),
              Text('${station.address}  •  ${station.postcode}',
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
              if (station.distanceKm != null)
                Text('${station.distanceKm!.toStringAsFixed(1)} km away',
                    style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
              const Divider(height: 20),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: station.prices
                    .map((p) => Chip(
                          label: Text('${p.kind}  ${p.pricePence.toStringAsFixed(1)}$unit'),
                          backgroundColor: kBrandBlue.withOpacity(0.08),
                          side: BorderSide.none,
                        ))
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
