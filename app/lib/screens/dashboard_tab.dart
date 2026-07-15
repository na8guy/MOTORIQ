import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import 'home_screen.dart';

class DashboardTab extends StatelessWidget {
  const DashboardTab({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthState>();
    final user = auth.user;

    return RefreshIndicator(
      onRefresh: auth.refreshUser,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Welcome back',
                        style: TextStyle(color: Colors.grey.shade600)),
                    Text(user?.displayName ?? '',
                        style: const TextStyle(
                            fontSize: 22, fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
              const SignOutButton(),
            ],
          ),
          const SizedBox(height: 16),
          _SavingsCard(
            savedMinor: user?.totalSavedMinor ?? 0,
            tier: user?.tier ?? 'FREE',
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _StatTile(
                  icon: Icons.account_balance_wallet,
                  label: 'Wallet',
                  value: formatMinor(user?.walletBalanceMinor ?? 0),
                  color: kBrandBlue,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatTile(
                  icon: Icons.workspace_premium,
                  label: 'Membership',
                  value: _tierLabel(user?.tier ?? 'FREE'),
                  color: kBrandGreen,
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const Text('Your MOTORIQ',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          const _FeatureRow(
              icon: Icons.local_gas_station,
              title: 'Find cheaper fuel',
              subtitle: 'Compare prices near you and on your route'),
          const _FeatureRow(
              icon: Icons.ev_station,
              title: 'EV charging savings',
              subtitle: 'Cheapest chargers and live availability'),
          const _FeatureRow(
              icon: Icons.credit_card,
              title: 'MOTORIQ Mastercard',
              subtitle: 'Prepaid driving wallet for fuel & charging'),
          const _FeatureRow(
              icon: Icons.savings,
              title: 'Cashback & rewards',
              subtitle: 'Earn on every mile you drive'),
        ],
      ),
    );
  }

  static String _tierLabel(String tier) => switch (tier) {
        'PLUS' => 'Plus',
        'DRIVE' => 'Drive',
        'DRIVE_PLUS' => 'Drive+',
        _ => 'Free',
      };
}

class _SavingsCard extends StatelessWidget {
  const _SavingsCard({required this.savedMinor, required this.tier});
  final int savedMinor;
  final String tier;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [kBrandBlue, kBrandDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Total saved with MOTORIQ',
              style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 6),
          Text(formatMinor(savedMinor),
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 34,
                  fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          const Text('across fuel, insurance, servicing & cashback',
              style: TextStyle(color: Colors.white70, fontSize: 12)),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color),
            const SizedBox(height: 12),
            Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            const SizedBox(height: 2),
            Text(value,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          ],
        ),
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: ListTile(
          leading: CircleAvatar(
            backgroundColor: kBrandBlue.withOpacity(0.1),
            child: Icon(icon, color: kBrandBlue),
          ),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(subtitle),
        ),
      ),
    );
  }
}
