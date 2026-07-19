import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/location.dart';
import '../services/repositories.dart';
import '../theme.dart';
import '../widgets/upgrade_prompt.dart';

/// ULEZ and clean-air charges before you drive.
///
/// Deliberately cautious about certainty: getting this wrong costs a member
/// £180, so every answer carries a confidence and a link to the operator's own
/// checker. We say "likely", never "you will not be charged".
class ZonesScreen extends StatefulWidget {
  const ZonesScreen({super.key});

  @override
  State<ZonesScreen> createState() => _ZonesScreenState();
}

class _ZonesScreenState extends State<ZonesScreen> {
  late final ZonesRepository _repo;
  Future<({bool inZone, List<ZoneCheck> checks, String? note})>? _future;
  LocatedPosition? _pos;
  ApiException? _locked;

  @override
  void initState() {
    super.initState();
    _repo = ZonesRepository(context.read<ApiClient>());
    _load();
  }

  Future<void> _load() async {
    final pos = _pos ?? await LocationService.current();
    if (!mounted) return;
    if (pos.placeName == null) {
      LocationService.describe(pos.lat, pos.lng).then((n) {
        if (mounted && n != null) setState(() => _pos = _pos?.withPlace(n));
      });
    }
    setState(() {
      _pos = pos;
      _locked = null;
      _future = _repo.check(lat: pos.lat, lng: pos.lng).catchError((Object e) {
        if (e is ApiException && e.isPaymentRequired) {
          setState(() => _locked = e);
        }
        throw e;
      });
    });
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Clean-air zones')),
      body: _locked != null
          ? SingleChildScrollView(child: UpgradePrompt.fromException(_locked!, icon: Icons.air_outlined))
          : RefreshIndicator(
              onRefresh: () async {
                _pos = null;
                await _load();
              },
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
                children: [
                  FutureBuilder<({bool inZone, List<ZoneCheck> checks, String? note})>(
                    future: _future,
                    builder: (context, snap) {
                      if (snap.connectionState == ConnectionState.waiting) {
                        return const Padding(
                            padding: EdgeInsets.all(40),
                            child: Center(child: CircularProgressIndicator()));
                      }
                      if (snap.hasError) {
                        return Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text('${snap.error}', textAlign: TextAlign.center),
                        );
                      }
                      final d = snap.data;
                      if (d == null || d.checks.isEmpty) {
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 40),
                          child: Column(
                            children: [
                              Icon(Icons.check_circle_outline, size: 44, color: context.mq.money),
                              const SizedBox(height: 12),
                              const Text('No charging zones near you',
                                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                              const SizedBox(height: 6),
                              Text(
                                'You are not in or near a ULEZ, clean-air or congestion zone '
                                'right now.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: context.mq.muted, fontSize: 13),
                              ),
                            ],
                          ),
                        );
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (d.note != null) ...[
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: context.mq.warningBg,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Text(d.note!,
                                  style: TextStyle(fontSize: 12, color: context.mq.warningFg)),
                            ),
                            const SizedBox(height: 14),
                          ],
                          for (final c in d.checks)
                            _ZoneCard(check: c, onOpen: () => _open(c.checkUrl)),
                          const SizedBox(height: 8),
                          Text(
                            'Zone boundaries are approximate and charges change. Always confirm '
                            'with the operator before you drive — every card links to their own '
                            'checker.',
                            style: TextStyle(fontSize: 11.5, color: context.mq.faint, height: 1.4),
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
}

class _ZoneCard extends StatelessWidget {
  const _ZoneCard({required this.check, required this.onOpen});
  final ZoneCheck check;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final c = check;
    final charged = (c.likelyChargeMinor ?? 0) > 0;
    final exempt = c.confidence == 'likely-exempt';
    final bg = charged ? context.mq.dangerBg : exempt ? context.mq.successBg : context.mq.warningBg;
    final fg = charged ? context.mq.dangerFg : exempt ? context.mq.successFg : context.mq.warningFg;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(c.zoneName,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                        color: bg, borderRadius: BorderRadius.circular(20)),
                    child: Text(c.inside ? 'You are inside' : '${c.distanceKm} km away',
                        style: TextStyle(
                            fontSize: 10.5, fontWeight: FontWeight.w800, color: fg)),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(11)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      charged
                          ? 'Likely ${formatMinor(c.likelyChargeMinor!)} a day'
                          : exempt
                              ? 'Likely no charge'
                              : 'We cannot tell yet',
                      style: TextStyle(fontWeight: FontWeight.w800, color: fg, fontSize: 14),
                    ),
                    if (c.likelyReason != null) ...[
                      const SizedBox(height: 3),
                      Text(c.likelyReason!,
                          style: TextStyle(fontSize: 12, color: fg, height: 1.35)),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 10),
              Text('${c.operator} · ${c.hours}',
                  style: TextStyle(fontSize: 11.5, color: context.mq.muted)),
              const SizedBox(height: 3),
              Text(c.exemption, style: TextStyle(fontSize: 11.5, color: context.mq.muted)),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                onPressed: onOpen,
                icon: const Icon(Icons.open_in_new, size: 15),
                label: const Text('Check on the official site'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
