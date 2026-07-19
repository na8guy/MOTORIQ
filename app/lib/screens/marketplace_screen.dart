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
import '../widgets/upgrade_prompt.dart';

/// Shop for the cheapest MOT, service or tyres near you.
///
/// Comparing is free — seeing that a London MOT ranges £29.95 to £45 is the
/// clearest argument for the membership. Booking at that price is Pro.
class MarketplaceScreen extends StatefulWidget {
  const MarketplaceScreen({super.key});

  @override
  State<MarketplaceScreen> createState() => _MarketplaceScreenState();
}

class _MarketplaceScreenState extends State<MarketplaceScreen> {
  late final MarketplaceRepository _repo;
  Future<QuoteComparison>? _future;
  LocatedPosition? _pos;
  String _serviceType = 'MOT';
  bool _locating = false;

  static const _services = {
    'MOT': 'MOT',
    'SERVICE': 'Servicing',
    'TYRES': 'Tyres',
    'VALETING': 'Valeting',
  };

  @override
  void initState() {
    super.initState();
    _repo = MarketplaceRepository(context.read<ApiClient>());
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
        LocationService.describe(pos.lat, pos.lng).then((n) {
          if (mounted && n != null) setState(() => _pos = _pos?.withPlace(n));
        });
      }
    }
    if (!mounted) return;
    setState(() {
      _pos = pos;
      _locating = false;
      _future = _repo.compare(
        lat: pos!.lat,
        lng: pos.lng,
        serviceType: _serviceType,
      );
    });
  }

  Future<void> _book(ServiceQuote q) async {
    final when = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 3)),
      firstDate: DateTime.now().add(const Duration(days: 1)),
      lastDate: DateTime.now().add(const Duration(days: 120)),
      helpText: 'When suits you?',
    );
    if (when == null || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      final res = await _repo.book(
        partnerId: q.partnerId,
        serviceType: _serviceType,
        requestedFor: when,
      );
      if (!mounted) return;
      final perk = (res['perkAppliedMinor'] as num?)?.toInt() ?? 0;
      final payable = (res['payableMinor'] as num?)?.toInt() ?? q.priceMinor;
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Booking requested'),
          content: Text(
            '${q.partnerName} has your request for ${_services[_serviceType]}.\n\n'
            '${perk > 0 ? 'Your membership covers ${formatMinor(perk)}.\n' : ''}'
            'You pay ${formatMinor(payable)}.\n\n'
            "We'll confirm the slot with the garage shortly.",
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
          ],
        ),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isPaymentRequired) {
        // Booking is Pro; comparing isn't. Offer the upgrade rather than error.
        showModalBottomSheet<void>(
          context: context,
          showDragHandle: true,
          builder: (_) => UpgradePrompt.fromException(e, icon: Icons.build_outlined),
        );
      } else {
        messenger.showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final unit = DistanceUnit.fromApi(context.watch<AuthState>().user?.distanceUnit);

    return Scaffold(
      appBar: AppBar(title: const Text('Book a service')),
      body: RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            const Text('Compare prices near you',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('Garages charge very different prices for the same job',
                style: TextStyle(color: context.mq.muted, fontSize: 13)),
            const SizedBox(height: 12),
            if (_locating || _pos == null)
              Text('Finding your location…',
                  style: TextStyle(fontSize: 12.5, color: context.mq.muted))
            else
              Row(
                children: [
                  Icon(_pos!.isReal ? Icons.my_location : Icons.location_off,
                      size: 14,
                      color: _pos!.isReal ? context.mq.money : context.mq.warningFg),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _pos!.isReal
                          ? 'Near ${_pos!.placeName ?? 'you'}'
                          : '${_pos!.problem} — showing ${_pos!.placeName ?? 'central London'}',
                      style: TextStyle(fontSize: 12.5, color: context.mq.muted),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: 14),
            SizedBox(
              height: 38,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: _services.entries
                    .map((e) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(e.value),
                            selected: _serviceType == e.key,
                            onSelected: (_) {
                              setState(() => _serviceType = e.key);
                              _load();
                            },
                          ),
                        ))
                    .toList(),
              ),
            ),
            const SizedBox(height: 16),
            FutureBuilder<QuoteComparison>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(40),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                if (snap.hasError) {
                  return _empty(Icons.cloud_off, "Couldn't load prices", '${snap.error}');
                }
                final data = snap.data;
                if (data == null || data.quotes.isEmpty) {
                  return _empty(
                    Icons.store_outlined,
                    'No garages in range',
                    data?.note ??
                        'We have no partner garages near here yet. Coverage is being built out.',
                  );
                }

                return Column(
                  children: [
                    // The spread is the headline: it's the reason to compare.
                    if (data.spreadMinor > 0) _SpreadBanner(comparison: data),
                    if (data.note != null) ...[
                      const SizedBox(height: 10),
                      _Note(text: data.note!),
                    ],
                    const SizedBox(height: 12),
                    for (final q in data.quotes)
                      _QuoteCard(
                        quote: q,
                        unit: unit,
                        serviceLabel: _services[_serviceType] ?? _serviceType,
                        onBook: () => _book(q),
                        onNavigate: () => MapsLauncher.navigate(
                          context,
                          // The comparison doesn't carry coordinates, so open
                          // the postcode — which is what a driver would type.
                          lat: 0,
                          lng: 0,
                          label: '${q.partnerName}, ${q.postcode}',
                        ),
                      ),
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
            Icon(icon, size: 40, color: context.mq.faint),
            const SizedBox(height: 12),
            Text(title,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 6),
            Text(message,
                textAlign: TextAlign.center,
                style: TextStyle(color: context.mq.muted, fontSize: 13, height: 1.4)),
          ],
        ),
      );
}

class _SpreadBanner extends StatelessWidget {
  const _SpreadBanner({required this.comparison});
  final QuoteComparison comparison;

  @override
  Widget build(BuildContext context) {
    final c = comparison;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.mq.successBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(Icons.savings_outlined, color: context.mq.successFg),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${formatMinor(c.spreadMinor)} between cheapest and dearest',
                    style: TextStyle(
                        fontWeight: FontWeight.w700, color: context.mq.successFg, fontSize: 14)),
                const SizedBox(height: 2),
                Text(
                  '${formatMinor(c.cheapestMinor ?? 0)} – ${formatMinor(c.dearestMinor ?? 0)} '
                  'across ${c.partnersFound} garages nearby',
                  style: TextStyle(fontSize: 12, color: context.mq.successFg),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Note extends StatelessWidget {
  const _Note({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, size: 13, color: context.mq.faint),
        const SizedBox(width: 6),
        Expanded(
          child: Text(text,
              style: TextStyle(fontSize: 11.5, color: context.mq.faint, height: 1.35)),
        ),
      ],
    );
  }
}

class _QuoteCard extends StatelessWidget {
  const _QuoteCard({
    required this.quote,
    required this.unit,
    required this.serviceLabel,
    required this.onBook,
    required this.onNavigate,
  });

  final ServiceQuote quote;
  final DistanceUnit unit;
  final String serviceLabel;
  final VoidCallback onBook;
  final VoidCallback onNavigate;

  @override
  Widget build(BuildContext context) {
    final q = quote;
    final cheapest = q.rank == 1;
    final accent = cheapest ? context.mq.money : context.mq.accent;
    final covered = q.perkCoversMinor > 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: cheapest ? context.mq.money : context.mq.border,
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
                  child: Text('#${q.rank}',
                      style: TextStyle(
                          color: accent, fontWeight: FontWeight.w800, fontSize: 13)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(q.partnerName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      Text(
                        [
                          formatDistanceKm(q.distanceKm, unit),
                          if (q.postcode.isNotEmpty) q.postcode,
                          if (q.rating != null) '★ ${q.rating!.toStringAsFixed(1)}',
                        ].join('  ·  '),
                        style: TextStyle(fontSize: 12, color: context.mq.muted),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (covered)
                      Text(formatMinor(q.priceMinor),
                          style: TextStyle(
                            fontSize: 13,
                            color: context.mq.faint,
                            decoration: TextDecoration.lineThrough,
                          )),
                    Text(
                      covered && q.youPayMinor == 0 ? 'FREE' : formatMinor(q.youPayMinor),
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: covered ? context.mq.money : null),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 10),
            // The basis of the price, always. A firm price and a guess are
            // different promises and must not look alike.
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
              decoration: BoxDecoration(
                color: (q.isEstimate ? context.mq.warningFg : accent).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Row(
                children: [
                  Icon(
                    q.isEstimate ? Icons.help_outline : Icons.verified_outlined,
                    size: 14,
                    color: q.isEstimate ? context.mq.warningFg : accent,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      covered
                          ? 'Your membership covers ${formatMinor(q.perkCoversMinor)} — ${q.priceNote.toLowerCase()}'
                          : q.priceNote,
                      style: TextStyle(
                        fontSize: 11.5,
                        color: q.isEstimate ? context.mq.warningFg : accent,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            if (cheapest && q.savingVsDearestMinor > 0) ...[
              const SizedBox(height: 8),
              Text('CHEAPEST — ${formatMinor(q.savingVsDearestMinor)} less than the dearest nearby',
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w700, color: context.mq.money)),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: onNavigate,
                    icon: const Icon(Icons.navigation_outlined, size: 15),
                    label: const Text('Directions'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: accent),
                    // Only a vetted partner with a real price can be booked.
                    onPressed: q.bookable ? onBook : null,
                    child: Text(q.bookable ? 'Book' : 'Not bookable'),
                  ),
                ),
              ],
            ),
            if (!q.bookable) ...[
              const SizedBox(height: 6),
              Text(
                q.isEstimate
                    ? 'We have no confirmed price from this garage — ring them to book.'
                    : 'Not yet a partner garage, so we cannot book on your behalf.',
                style: TextStyle(fontSize: 11, color: context.mq.faint),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
