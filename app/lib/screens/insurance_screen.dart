import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';
import '../widgets/upgrade_prompt.dart';

/// Insurance renewal guidance.
///
/// NOT quotes — we are not an FCA-authorised broker and inventing premiums
/// would be both illegal and useless. What we can honestly do is tell members
/// when to shop, which is where the money actually is: quotes taken about
/// three weeks before renewal are consistently the cheapest.
class InsuranceScreen extends StatefulWidget {
  const InsuranceScreen({super.key});

  @override
  State<InsuranceScreen> createState() => _InsuranceScreenState();
}

class _InsuranceScreenState extends State<InsuranceScreen> {
  late final InsuranceRepository _repo;
  Future<({List<RenewalGuidance> vehicles, String disclaimer})>? _future;
  ApiException? _locked;

  @override
  void initState() {
    super.initState();
    _repo = InsuranceRepository(context.read<ApiClient>());
    _future = _repo.renewal().catchError((Object e) {
      if (e is ApiException && e.isPaymentRequired) {
        if (mounted) setState(() => _locked = e);
      }
      throw e;
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
    if (_locked != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Insurance')),
        body: SingleChildScrollView(
          child: UpgradePrompt.fromException(_locked!, icon: Icons.shield_outlined),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Insurance renewal')),
      body: FutureBuilder<({List<RenewalGuidance> vehicles, String disclaimer})>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('${snap.error}', textAlign: TextAlign.center),
              ),
            );
          }
          final d = snap.data!;
          if (d.vehicles.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text('Add a vehicle to get renewal reminders.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: context.mq.muted)),
              ),
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
            children: [
              for (final v in d.vehicles) _RenewalCard(guidance: v, onOpen: _open),
              const SizedBox(height: 8),
              Text(d.disclaimer,
                  style: TextStyle(fontSize: 11.5, color: context.mq.faint, height: 1.4)),
            ],
          );
        },
      ),
    );
  }
}

class _RenewalCard extends StatelessWidget {
  const _RenewalCard({required this.guidance, required this.onOpen});
  final RenewalGuidance guidance;
  final Future<void> Function(String) onOpen;

  @override
  Widget build(BuildContext context) {
    final g = guidance;
    final (Color bg, Color fg) = switch (g.window) {
      'OPTIMAL' => (context.mq.successBg, context.mq.successFg),
      'OVERDUE' || 'LATE' => (context.mq.warningBg, context.mq.warningFg),
      _ => (context.mq.neutralBg, context.mq.muted),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(g.registration,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(g.headline,
                        style: TextStyle(fontWeight: FontWeight.w800, color: fg, fontSize: 15)),
                    const SizedBox(height: 5),
                    Text(g.detail,
                        style: TextStyle(fontSize: 12.5, color: fg, height: 1.4)),
                  ],
                ),
              ),
              if (g.typicalSavingMinor != null && g.window == 'OPTIMAL') ...[
                const SizedBox(height: 10),
                Row(
                  children: [
                    Icon(Icons.savings_outlined, size: 15, color: context.mq.money),
                    const SizedBox(width: 7),
                    Expanded(
                      child: Text(
                        'Drivers who switch typically save around '
                        '${formatMinor(g.typicalSavingMinor!)} — an industry average, not a quote.',
                        style: TextStyle(fontSize: 11.5, color: context.mq.muted, height: 1.35),
                      ),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 14),
              for (final a in g.actions)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                      alignment: Alignment.centerLeft,
                    ),
                    onPressed: () => onOpen(a.url),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text(a.label,
                                  style: const TextStyle(
                                      fontWeight: FontWeight.w600, fontSize: 13.5)),
                              Text(a.note,
                                  style: TextStyle(fontSize: 11, color: context.mq.faint)),
                            ],
                          ),
                        ),
                        const Icon(Icons.open_in_new, size: 15),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
