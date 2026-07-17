import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import '../widgets/fill_up_confirm_card.dart';
import 'ev_screen.dart';
import 'home_screen.dart';
import 'insights_screen.dart';
import 'profile_screen.dart';
import 'referrals_screen.dart';
import 'reminders_screen.dart';
import 'subscriptions_screen.dart';

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
                child: InkWell(
                  onTap: () => _push(context, const ProfileScreen()),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Welcome back',
                          style: TextStyle(color: context.mq.muted)),
                      Row(
                        children: [
                          Flexible(
                            child: Text(user?.displayName ?? '',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                    fontSize: 22, fontWeight: FontWeight.w700)),
                          ),
                          const SizedBox(width: 4),
                          Icon(Icons.chevron_right, size: 18, color: context.mq.faint),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SignOutButton(),
            ],
          ),
          if (user != null && !user.emailVerified) ...[
            const SizedBox(height: 12),
            _EmailVerifyBanner(email: user.email),
          ],
          const SizedBox(height: 16),
          // "Did you fill up?" — savings only count once this is answered.
          FillUpConfirmCard(onChanged: auth.refreshUser),
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
                  color: context.mq.accent,
                  onTap: () => HomeNav.of(context).goToTab(HomeTab.wallet),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _StatTile(
                  icon: Icons.workspace_premium,
                  label: 'Membership',
                  value: _tierLabel(user?.tier ?? 'FREE'),
                  color: context.mq.money,
                  onTap: () => _push(context, const SubscriptionsScreen()),
                ),
              ),
            ],
          ),
          // Upgrading was only reachable via More → Membership, which nobody
          // found. Put it on the dashboard for anyone not already on the top tier.
          if ((user?.tier ?? 'FREE') != 'DRIVE_PLUS') ...[
            const SizedBox(height: 12),
            _UpgradeCard(
              tier: user?.tier ?? 'FREE',
              onTap: () => _push(context, const SubscriptionsScreen()),
            ),
          ],
          const SizedBox(height: 24),
          const Text('Your MOTORIQ',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          _FeatureRow(
            icon: Icons.local_gas_station,
            title: 'Find cheaper fuel',
            subtitle: 'Compare prices near you and on your route',
            onTap: () => HomeNav.of(context).goToTab(HomeTab.fuel),
          ),
          _FeatureRow(
            icon: Icons.ev_station,
            title: 'EV charging savings',
            subtitle: 'Cheapest chargers near you, ranked',
            onTap: () => _push(context, const EvScreen()),
          ),
          _FeatureRow(
            icon: Icons.credit_card,
            title: 'MOTORIQ Mastercard',
            subtitle: 'Prepaid driving wallet for fuel & charging',
            onTap: () => HomeNav.of(context).goToTab(HomeTab.wallet),
          ),
          _FeatureRow(
            icon: Icons.card_giftcard,
            title: 'Rewards & referrals',
            subtitle: 'Give £10, get £10 for every friend who joins',
            onTap: () => _push(context, const ReferralsScreen()),
          ),
          _FeatureRow(
            icon: Icons.insights,
            title: 'Your fuel savings',
            subtitle: 'Daily, weekly and monthly savings breakdown',
            onTap: () => _push(context, const InsightsScreen()),
          ),
          _FeatureRow(
            icon: Icons.notifications_active,
            title: 'MOT, tax & service reminders',
            subtitle: 'Automatic from DVLA once you add a vehicle',
            onTap: () => _push(context, const RemindersScreen()),
          ),
        ],
      ),
    );
  }

  /// Push a screen, then refresh the profile so tier/balance changes show.
  void _push(BuildContext context, Widget screen) {
    final auth = context.read<AuthState>();
    Navigator.of(context)
        .push(MaterialPageRoute(builder: (_) => screen))
        .then((_) => auth.refreshUser());
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
        gradient: LinearGradient(
          colors: [context.mq.accent, kBrandDark],
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
    this.onTap,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias, // keeps the ripple inside the rounded card
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: color),
                  const Spacer(),
                  if (onTap != null)
                    Icon(Icons.chevron_right, size: 18, color: context.mq.faint),
                ],
              ),
              const SizedBox(height: 12),
              Text(label, style: TextStyle(color: context.mq.muted, fontSize: 12)),
              const SizedBox(height: 2),
              Text(value,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ],
          ),
        ),
      ),
    );
  }
}

/// Prompts an upgrade from the dashboard, naming the next tier up.
class _UpgradeCard extends StatelessWidget {
  const _UpgradeCard({required this.tier, required this.onTap});
  final String tier;
  final VoidCallback onTap;

  /// What the member gets by moving up one step from where they are.
  static ({String next, String pitch}) _pitch(String tier) => switch (tier) {
        'PLUS' => (next: 'Drive', pitch: 'Add the fuel wallet, card and cashback'),
        'DRIVE' => (next: 'Drive+', pitch: 'Add breakdown cover and priority support'),
        _ => (next: 'Plus', pitch: 'Unlock cheaper fuel alerts and savings insights'),
      };

  @override
  Widget build(BuildContext context) {
    final p = _pitch(tier);
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: context.mq.money.withValues(alpha: 0.12),
                child: Icon(Icons.arrow_upward, color: context.mq.money),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Upgrade to ${p.next}',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 2),
                    Text(p.pitch,
                        style: TextStyle(fontSize: 12, color: context.mq.muted)),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmailVerifyBanner extends StatefulWidget {
  const _EmailVerifyBanner({required this.email});
  final String email;

  @override
  State<_EmailVerifyBanner> createState() => _EmailVerifyBannerState();
}

class _EmailVerifyBannerState extends State<_EmailVerifyBanner> {
  bool _sending = false;

  Future<void> _resend() async {
    setState(() => _sending = true);
    try {
      await AuthRepository(context.read<ApiClient>()).resendVerification(widget.email);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Verification email sent to ${widget.email}')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Could not send — try again shortly')));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: context.mq.warningBg,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(Icons.mark_email_unread_outlined, color: context.mq.warningFg),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Verify your email to secure your account.',
                style: TextStyle(fontWeight: FontWeight.w600, color: context.mq.warningFg)),
          ),
          _sending
              ? const SizedBox(
                  height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: _resend, child: const Text('Resend')),
        ],
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          onTap: onTap,
          leading: CircleAvatar(
            backgroundColor: context.mq.accent.withValues(alpha: 0.1),
            child: Icon(icon, color: context.mq.accent),
          ),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
        ),
      ),
    );
  }
}
