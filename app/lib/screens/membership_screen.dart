import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';

/// Membership: what you're on, what the tiers cost, and how to upgrade.
///
/// Prices and features come from the API, which serves them from the same
/// entitlements module the paywall enforces — so this screen can never
/// advertise something the server then refuses.
class MembershipScreen extends StatefulWidget {
  const MembershipScreen({super.key});

  @override
  State<MembershipScreen> createState() => _MembershipScreenState();
}

class _MembershipScreenState extends State<MembershipScreen> {
  late final MembershipRepository _repo;
  Future<(List<MembershipPlan>, MyMembership)>? _future;
  bool _annual = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _repo = MembershipRepository(context.read<ApiClient>());
    _load();
  }

  void _load() {
    setState(() {
      _future = Future.wait([_repo.plans(), _repo.mine()])
          .then((r) => (r[0] as List<MembershipPlan>, r[1] as MyMembership));
    });
  }

  Future<void> _upgrade(MembershipPlan plan) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final period = _annual ? 'ANNUAL' : 'MONTHLY';
      final session = await _repo.checkout(tier: plan.tier, period: period);

      if (!session.live) {
        // Stripe isn't configured. Be explicit that nothing was charged rather
        // than letting a test upgrade look like a real purchase.
        if (!mounted) return;
        final go = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Test mode'),
            content: Text(
              session.note ??
                  'Stripe is not configured, so no payment will be taken. '
                      'Continue to apply ${plan.name} for testing?',
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
              FilledButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Apply for testing'),
              ),
            ],
          ),
        );
        if (go != true) return;
        await _repo.confirmMockCheckout(tier: plan.tier, period: period);
        if (!mounted) return;
        messenger.showSnackBar(SnackBar(content: Text('${plan.name} applied (test mode)')));
        await context.read<AuthState>().refreshUser();
        _load();
        return;
      }

      // Real checkout: hand off to Stripe. The tier changes only when their
      // webhook confirms payment, so we refresh on return rather than assume.
      final uri = Uri.parse(session.url);
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
        if (!mounted) return;
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Finish payment in your browser — your membership updates automatically'),
            duration: Duration(seconds: 6),
          ),
        );
      } else if (mounted) {
        messenger.showSnackBar(const SnackBar(content: Text('Could not open the payment page')));
      }
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _manageBilling() async {
    try {
      final url = await _repo.portalUrl();
      final uri = Uri.parse(url);
      if (await canLaunchUrl(uri)) await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _cancel() async {
    // Capture before the await — the widget can be disposed while the dialog
    // is open, and reaching for `context` afterwards is a use-after-dispose.
    final auth = context.read<AuthState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel membership?'),
        content: const Text(
          "You'll keep your perks until the end of the period you've already paid for. "
          'After that you drop back to Free.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel')),
        ],
      ),
    );
    if (ok != true) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final msg = await _repo.cancel();
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(msg)));
      await auth.refreshUser();
      if (mounted) _load();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Membership')),
      body: FutureBuilder<(List<MembershipPlan>, MyMembership)>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('${snap.error}', textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  ],
                ),
              ),
            );
          }

          final (plans, mine) = snap.data!;
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              if (mine.simulated) _SimulationBanner(tier: mine.tier),
              _CurrentCard(
                membership: mine,
                onManage: _manageBilling,
                onCancel: _cancel,
              ),
              const SizedBox(height: 20),
              _PeriodToggle(
                annual: _annual,
                onChanged: (v) => setState(() => _annual = v),
                // Show the actual saving rather than a vague "save more".
                savingLabel: () {
                  final paid = plans.where((p) => !p.isFree).toList();
                  if (paid.isEmpty) return null;
                  final best = paid
                      .map((p) => p.annualSavingMinor)
                      .reduce((a, b) => a > b ? a : b);
                  return best > 0 ? 'Save up to ${formatMinor(best)} a year' : null;
                }(),
              ),
              const SizedBox(height: 16),
              for (final plan in plans)
                _PlanCard(
                  plan: plan,
                  annual: _annual,
                  current: plan.tier == mine.tier,
                  busy: _busy,
                  onChoose: () => _upgrade(plan),
                ),
              const SizedBox(height: 8),
              Text(
                'Prices include VAT. Cancel any time — you keep your perks until the '
                'end of the period you have paid for.',
                style: TextStyle(fontSize: 11.5, color: context.mq.faint, height: 1.4),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Shown when an admin is viewing the app as another tier.
class _SimulationBanner extends StatelessWidget {
  const _SimulationBanner({required this.tier});
  final String tier;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.mq.warningBg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.science_outlined, size: 18, color: context.mq.warningFg),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              'Simulating $tier — this is a test view, not a real membership. '
              'Your billing is untouched.',
              style: TextStyle(fontSize: 12, color: context.mq.warningFg),
            ),
          ),
        ],
      ),
    );
  }
}

class _CurrentCard extends StatelessWidget {
  const _CurrentCard({
    required this.membership,
    required this.onManage,
    required this.onCancel,
  });

  final MyMembership membership;
  final VoidCallback onManage;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final m = membership;
    final paid = m.tier != 'FREE';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text('Your membership',
                    style: TextStyle(fontSize: 12, color: context.mq.muted)),
                const Spacer(),
                if (!m.active)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: context.mq.dangerBg,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text('Lapsed',
                        style: TextStyle(
                            fontSize: 11, fontWeight: FontWeight.w700, color: context.mq.dangerFg)),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              m.tier == 'FREE' ? 'Free' : m.tier == 'PREMIUM' ? 'Premium' : 'Pro',
              style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
            ),
            if (m.cancelAtPeriodEnd && m.currentPeriodEnd != null) ...[
              const SizedBox(height: 6),
              Text(
                'Cancels on ${_fmt(m.currentPeriodEnd!)} — you keep everything until then.',
                style: TextStyle(fontSize: 12.5, color: context.mq.warningFg),
              ),
            ] else if (paid && m.currentPeriodEnd != null) ...[
              const SizedBox(height: 6),
              Text('Renews ${_fmt(m.currentPeriodEnd!)}',
                  style: TextStyle(fontSize: 12.5, color: context.mq.muted)),
            ],

            // Perk balances — the concrete thing they're paying for.
            if (m.balances.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('This period',
                  style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 0.6,
                      color: context.mq.faint)),
              const SizedBox(height: 8),
              for (final b in m.balances) _PerkRow(balance: b),
            ],

            if (paid) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: onManage,
                      icon: const Icon(Icons.credit_card, size: 16),
                      label: const Text('Billing'),
                    ),
                  ),
                  if (!m.cancelAtPeriodEnd) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextButton(onPressed: onCancel, child: const Text('Cancel')),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  static String _fmt(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

class _PerkRow extends StatelessWidget {
  const _PerkRow({required this.balance});
  final PerkBalance balance;

  @override
  Widget build(BuildContext context) {
    final b = balance;
    final pct = b.allowance == 0 ? 0.0 : (b.remaining / b.allowance).clamp(0.0, 1.0);
    final unit = b.kind == 'FUEL_LITRES' ? 'L' : '';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(b.label, style: const TextStyle(fontSize: 13))),
              Text('${b.remaining}$unit of ${b.allowance}$unit',
                  style: TextStyle(
                      fontSize: 13, fontWeight: FontWeight.w700, color: context.mq.money)),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(
              value: pct,
              minHeight: 5,
              backgroundColor: context.mq.border,
              valueColor: AlwaysStoppedAnimation(context.mq.money),
            ),
          ),
        ],
      ),
    );
  }
}

class _PeriodToggle extends StatelessWidget {
  const _PeriodToggle({
    required this.annual,
    required this.onChanged,
    this.savingLabel,
  });

  final bool annual;
  final ValueChanged<bool> onChanged;
  final String? savingLabel;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('Monthly')),
            ButtonSegment(value: true, label: Text('Annual')),
          ],
          selected: {annual},
          onSelectionChanged: (s) => onChanged(s.first),
        ),
        if (annual && savingLabel != null) ...[
          const SizedBox(height: 8),
          Text(savingLabel!,
              style: TextStyle(
                  fontSize: 12.5, fontWeight: FontWeight.w700, color: context.mq.money)),
        ],
      ],
    );
  }
}

class _PlanCard extends StatelessWidget {
  const _PlanCard({
    required this.plan,
    required this.annual,
    required this.current,
    required this.busy,
    required this.onChoose,
  });

  final MembershipPlan plan;
  final bool annual;
  final bool current;
  final bool busy;
  final VoidCallback onChoose;

  @override
  Widget build(BuildContext context) {
    final priceMinor = annual ? plan.annualMinor : plan.monthlyMinor;
    final per = plan.isFree ? '' : (annual ? '/year' : '/month');
    // Premium is the tier most people should be on, so it's the one flagged.
    final featured = plan.tier == 'PREMIUM';

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: Theme.of(context).cardTheme.color,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: current
                ? context.mq.money
                : featured
                    ? context.mq.accent
                    : context.mq.border,
            width: current || featured ? 1.5 : 1,
          ),
        ),
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(plan.name,
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                const SizedBox(width: 8),
                if (current)
                  _Pill(label: 'Your plan', color: context.mq.money)
                else if (featured)
                  _Pill(label: 'Most drivers', color: context.mq.accent),
              ],
            ),
            const SizedBox(height: 2),
            Text(plan.tagline, style: TextStyle(fontSize: 12.5, color: context.mq.muted)),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  plan.isFree ? 'Free' : formatMinor(priceMinor),
                  style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
                ),
                if (per.isNotEmpty)
                  Text(per, style: TextStyle(fontSize: 14, color: context.mq.muted)),
              ],
            ),
            if (annual && plan.annualSavingMinor > 0)
              Text('Saves ${formatMinor(plan.annualSavingMinor)} vs monthly',
                  style: TextStyle(
                      fontSize: 12, fontWeight: FontWeight.w600, color: context.mq.money)),
            const SizedBox(height: 14),
            for (final h in plan.highlights)
              Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.check, size: 15, color: context.mq.money),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(h, style: const TextStyle(fontSize: 13, height: 1.35)),
                    ),
                  ],
                ),
              ),
            if (!current && !plan.isFree) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: featured ? context.mq.accent : null,
                    minimumSize: const Size.fromHeight(46),
                  ),
                  onPressed: busy ? null : onChoose,
                  child: busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : Text('Choose ${plan.name}'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w800, color: color)),
    );
  }
}
