import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';
import '../widgets/upgrade_prompt.dart';
import 'marketplace_screen.dart';

/// Vehicle Health Report.
///
/// Every finding shows its BASIS (DVLA, DVSA, mileage, age, member-entered) so
/// an inference is never mistaken for a measurement. We have no OBD data, and
/// dressing a mileage guess up as diagnosis would destroy trust the first time
/// it was wrong.
class HealthScreen extends StatefulWidget {
  const HealthScreen({super.key});

  @override
  State<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends State<HealthScreen> {
  late final VehicleRepository _vehicles;
  late final HealthRepository _health;
  List<Vehicle> _list = [];
  HealthReport? _report;
  ApiException? _locked;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _vehicles = VehicleRepository(context.read<ApiClient>());
    _health = HealthRepository(context.read<ApiClient>());
    _vehicles.list().then((v) {
      if (!mounted) return;
      setState(() => _list = v);
      if (v.isNotEmpty) _generate(v.first.id);
    }).catchError((_) {});
  }

  Future<void> _generate(String vehicleId) async {
    setState(() => _busy = true);
    try {
      final r = await _health.generate(vehicleId);
      if (mounted) setState(() => _report = r);
    } on ApiException catch (e) {
      if (mounted && e.isPaymentRequired) setState(() => _locked = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_locked != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Vehicle health')),
        body: SingleChildScrollView(
          child: UpgradePrompt.fromException(_locked!, icon: Icons.health_and_safety_outlined),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Vehicle health')),
      body: _list.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.directions_car_outlined, size: 44, color: context.mq.faint),
                    const SizedBox(height: 12),
                    const Text('Add a vehicle first',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text(
                      'We build the report from your MOT history, tax status and mileage.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: context.mq.muted, fontSize: 13),
                    ),
                  ],
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
              children: [
                if (_list.length > 1)
                  SizedBox(
                    height: 38,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: _list
                          .map((v) => Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ChoiceChip(
                                  label: Text(v.registration),
                                  selected: _report?.vehicleId == v.id,
                                  onSelected: (_) => _generate(v.id),
                                ),
                              ))
                          .toList(),
                    ),
                  ),
                if (_busy)
                  const Padding(
                      padding: EdgeInsets.all(40),
                      child: Center(child: CircularProgressIndicator()))
                else if (_report != null) ...[
                  const SizedBox(height: 8),
                  _ScoreCard(report: _report!),
                  const SizedBox(height: 20),
                  if (_report!.actions.isNotEmpty) ...[
                    Text('What to do',
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.6,
                            color: context.mq.faint)),
                    const SizedBox(height: 8),
                    for (final a in _report!.actions) _ActionCard(action: a),
                    const SizedBox(height: 16),
                  ],
                  Text('What we found',
                      style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.6,
                          color: context.mq.faint)),
                  const SizedBox(height: 8),
                  for (final f in _report!.findings) _FindingCard(finding: f),
                  const SizedBox(height: 12),
                  Text(
                    'This report is built from DVLA and DVSA records, your mileage and the '
                    'dates you have given us. It is not a mechanical inspection — we have no '
                    'sensor data from your car.',
                    style: TextStyle(fontSize: 11.5, color: context.mq.faint, height: 1.4),
                  ),
                ],
              ],
            ),
    );
  }
}

class _ScoreCard extends StatelessWidget {
  const _ScoreCard({required this.report});
  final HealthReport report;

  @override
  Widget build(BuildContext context) {
    final r = report;
    final color = switch (r.band) {
      'URGENT' => context.mq.dangerFg,
      'ATTENTION' => context.mq.warningFg,
      _ => context.mq.money,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            SizedBox(
              width: 78,
              height: 78,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 78,
                    height: 78,
                    child: CircularProgressIndicator(
                      value: r.score / 100,
                      strokeWidth: 7,
                      backgroundColor: context.mq.border,
                      valueColor: AlwaysStoppedAnimation(color),
                    ),
                  ),
                  Text('${r.score}',
                      style: TextStyle(
                          fontSize: 24, fontWeight: FontWeight.w800, color: color)),
                ],
              ),
            ),
            const SizedBox(width: 18),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(r.registration,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 2),
                  Text(
                    switch (r.band) {
                      'URGENT' => 'Needs attention now',
                      'ATTENTION' => 'A couple of things to sort',
                      _ => 'In good shape',
                    },
                    style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                  if (r.estimatedCostMinor > 0) ...[
                    const SizedBox(height: 6),
                    Text('Estimated cost to put right: ${formatMinor(r.estimatedCostMinor)}',
                        style: TextStyle(fontSize: 12, color: context.mq.muted)),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  const _ActionCard({required this.action});
  final HealthAction action;

  @override
  Widget build(BuildContext context) {
    final a = action;
    final urgent = a.urgency == 'NOW';
    final color = urgent ? context.mq.dangerFg : context.mq.accent;
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(urgent ? Icons.priority_high : Icons.schedule, size: 16, color: color),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(a.title,
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  ),
                  if (a.estimatedMinor != null)
                    Text('~${formatMinor(a.estimatedMinor!)}',
                        style: TextStyle(fontWeight: FontWeight.w700, color: context.mq.muted)),
                ],
              ),
              const SizedBox(height: 5),
              Text(a.detail,
                  style: TextStyle(fontSize: 12.5, color: context.mq.muted, height: 1.35)),
              if (a.bookable != null) ...[
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: color),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const MarketplaceScreen()),
                    ),
                    child: Text('Compare ${a.bookable!.toLowerCase()} prices'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _FindingCard extends StatelessWidget {
  const _FindingCard({required this.finding});
  final HealthFinding finding;

  @override
  Widget build(BuildContext context) {
    final f = finding;
    final (Color color, IconData icon) = switch (f.severity) {
      'URGENT' => (context.mq.dangerFg, Icons.error_outline),
      'ATTENTION' => (context.mq.warningFg, Icons.warning_amber_rounded),
      'GOOD' => (context.mq.money, Icons.check_circle_outline),
      _ => (context.mq.muted, Icons.info_outline),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 17, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(f.title,
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                    ),
                    const SizedBox(width: 6),
                    // The basis, always — so an inference can't pass for a fact.
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                      decoration: BoxDecoration(
                        color: context.mq.neutralBg,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(f.basis,
                          style: TextStyle(
                              fontSize: 8.5,
                              fontWeight: FontWeight.w700,
                              color: context.mq.faint)),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(f.detail,
                    style: TextStyle(fontSize: 12, color: context.mq.muted, height: 1.35)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
