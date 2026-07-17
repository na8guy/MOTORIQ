import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';

class SubscriptionsScreen extends StatefulWidget {
  const SubscriptionsScreen({super.key});

  @override
  State<SubscriptionsScreen> createState() => _SubscriptionsScreenState();
}

class _SubscriptionsScreenState extends State<SubscriptionsScreen> {
  late final SubscriptionRepository _repo;
  Future<List<Plan>>? _future;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _repo = SubscriptionRepository(context.read<ApiClient>());
    _future = _repo.plans();
  }

  Future<void> _subscribe(Plan plan) async {
    int? mileage;
    if (plan.mileagePackages.isNotEmpty) {
      mileage = await showModalBottomSheet<int>(
        context: context,
        builder: (_) => _MileageSheet(packages: plan.mileagePackages),
      );
      if (mileage == null) return;
    }
    setState(() => _busy = true);
    try {
      await _repo.subscribe(plan.plan, mileagePackage: mileage);
      if (!mounted) return;
      await context.read<AuthState>().refreshUser();
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('Subscribed to ${plan.label}')));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final currentTier = context.watch<AuthState>().user?.tier ?? 'FREE';
    return Scaffold(
      appBar: AppBar(title: const Text('Membership')),
      body: FutureBuilder<List<Plan>>(
        future: _future,
        builder: (context, snap) {
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final plans = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              for (final p in plans)
                _PlanCard(
                  plan: p,
                  current: p.plan == currentTier,
                  busy: _busy,
                  onSubscribe: () => _subscribe(p),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.plan,
    required this.current,
    required this.busy,
    required this.onSubscribe,
  });
  final Plan plan;
  final bool current;
  final bool busy;
  final VoidCallback onSubscribe;

  static const _features = {
    'FREE': ['Fuel & EV price comparison', 'Fuel spend tracking', 'Vehicle reminders'],
    'PLUS': ['Everything in Free', 'Cashback & partner rewards', 'Service & insurance alerts'],
    'DRIVE': ['Monthly prepaid fuel wallet', 'MOTORIQ Mastercard', 'Mileage packages'],
    'DRIVE_PLUS': ['Everything in Drive', 'Free MOT & breakdown cover', 'Road tax contribution'],
  };

  @override
  Widget build(BuildContext context) {
    final price = plan.priceMinor == 0
        ? (plan.mileagePackages.isNotEmpty ? 'Variable' : 'Free')
        : '${formatMinor(plan.priceMinor)}/mo';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Container(
        decoration: BoxDecoration(
          // Follows the theme surface so the card is not stranded white on a
          // dark scaffold.
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: current ? context.mq.accent : context.mq.border, width: current ? 1.5 : 1),
        ),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(plan.label, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                ),
                Text(price, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: context.mq.accent)),
              ],
            ),
            const SizedBox(height: 12),
            ...(_features[plan.plan] ?? []).map((f) => Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    Icon(Icons.check_circle, size: 18, color: context.mq.money),
                    const SizedBox(width: 8),
                    Expanded(child: Text(f)),
                  ]),
                )),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: current
                  ? const OutlinedButton(onPressed: null, child: Text('Current plan'))
                  : FilledButton(
                      onPressed: busy ? null : onSubscribe,
                      child: Text(plan.plan == 'FREE' ? 'Switch to Free' : 'Choose ${plan.label}'),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MileageSheet extends StatelessWidget {
  const _MileageSheet({required this.packages});
  final List<int> packages;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Choose a mileage package', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          ...packages.map((m) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FilledButton(
                  onPressed: () => Navigator.pop(context, m),
                  child: Text('Drive $m — $m miles/month'),
                ),
              )),
        ],
      ),
    );
  }
}
