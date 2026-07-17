import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../models/models.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import 'home_screen.dart';
import 'kyc_screen.dart';
import 'insights_screen.dart';
import 'profile_screen.dart';
import 'settings_screen.dart';
import 'subscriptions_screen.dart';
import 'referrals_screen.dart';
import 'reminders_screen.dart';
import 'notifications_screen.dart';

class MoreTab extends StatefulWidget {
  const MoreTab({super.key});

  @override
  State<MoreTab> createState() => _MoreTabState();
}

class _MoreTabState extends State<MoreTab> {
  late final KycRepository _kyc;
  KycProfile? _kycProfile;

  @override
  void initState() {
    super.initState();
    _kyc = KycRepository(context.read<ApiClient>());
    _kyc.get().then((k) {
      if (mounted) setState(() => _kycProfile = k);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthState>().user;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      children: [
        Row(
          children: [
            Expanded(
              child: Text('Hi, ${user?.firstName ?? 'driver'}',
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
            ),
            const SignOutButton(),
          ],
        ),
        const SizedBox(height: 12),
        _KycBanner(profile: _kycProfile, onTap: () => _open(const KycScreen())),
        const SizedBox(height: 16),
        _tile(Icons.person_outline, 'Your details', 'Name, phone & email',
            () => _open(const ProfileScreen())),
        _tile(Icons.settings_outlined, 'Settings', 'Units, emails & legal',
            () => _open(const SettingsScreen())),
        _tile(Icons.insights, 'Fuel savings', 'Your daily/weekly/monthly savings + AI tips',
            () => _open(const InsightsScreen())),
        _tile(Icons.workspace_premium, 'Membership', 'Free · Plus · Drive · Drive+',
            () => _open(const SubscriptionsScreen())),
        _tile(Icons.card_giftcard, 'Refer a friend', 'Give £10, get £10',
            () => _open(const ReferralsScreen())),
        _tile(Icons.notifications_active, 'Reminders', 'MOT, tax, service, insurance',
            () => _open(const RemindersScreen())),
        _tile(Icons.notifications, 'Notifications', 'Your alerts & updates',
            () => _open(const NotificationsScreen())),
        _tile(Icons.verified_user, 'Identity (KYC)', _kycProfile?.status ?? 'Verify to unlock money features',
            () => _open(const KycScreen())),
      ],
    );
  }

  void _open(Widget screen) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen)).then((_) {
      _kyc.get().then((k) {
        if (mounted) setState(() => _kycProfile = k);
      }).catchError((_) {});
    });
  }

  Widget _tile(IconData icon, String title, String subtitle, VoidCallback onTap) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        child: ListTile(
          leading: CircleAvatar(
            backgroundColor: context.mq.accent.withValues(alpha: 0.1),
            child: Icon(icon, color: context.mq.accent),
          ),
          title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          subtitle: Text(subtitle),
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      ),
    );
  }
}

class _KycBanner extends StatelessWidget {
  const _KycBanner({required this.profile, required this.onTap});
  final KycProfile? profile;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final verified = profile?.isVerified ?? false;
    if (verified) {
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: context.mq.money.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(children: [
          Icon(Icons.verified, color: context.mq.money),
          const SizedBox(width: 10),
          const Text('Identity verified — wallet & card active',
              style: TextStyle(fontWeight: FontWeight.w600)),
        ]),
      );
    }
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: context.mq.warningBg,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(children: [
          Icon(Icons.gpp_maybe, color: context.mq.warningFg),
          const SizedBox(width: 10),
          Expanded(
            child: Text('Verify your identity to enable top-ups & your Mastercard',
                style: TextStyle(fontWeight: FontWeight.w600, color: context.mq.warningFg)),
          ),
          Icon(Icons.chevron_right, color: context.mq.warningFg),
        ]),
      ),
    );
  }
}
