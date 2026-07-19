import 'package:flutter/material.dart';

import '../screens/membership_screen.dart';
import '../services/api_client.dart';
import '../theme.dart';

/// What a member sees when they hit a paid feature.
///
/// Two rules this follows, both learned the hard way in products that get
/// paywalls wrong:
///
///  1. Say what the feature DOES before asking for money. "Upgrade to unlock"
///     with no explanation is just a wall; naming the benefit is an offer.
///  2. Never pretend the wall isn't there. Hiding a feature entirely leaves
///     people wondering if the app can do it at all — showing it locked, with
///     the price, respects them enough to let them decide.
///
/// The server is the actual gate: it returns 402 PAYMENT_REQUIRED with the
/// required tier, and this renders that. Hiding the button is courtesy, not
/// security.
class UpgradePrompt extends StatelessWidget {
  const UpgradePrompt({
    super.key,
    required this.feature,
    required this.requiredTier,
    this.icon = Icons.lock_outline,
    this.title,
    this.message,
  });

  /// Build one straight from the API's 402 response.
  factory UpgradePrompt.fromException(ApiException e, {IconData? icon}) {
    final details = e.details;
    final tier = (details is Map ? details['requiredTier'] as String? : null) ?? 'PREMIUM';
    final feat = (details is Map ? details['feature'] as String? : null) ?? '';
    return UpgradePrompt(
      feature: feat,
      requiredTier: tier,
      icon: icon ?? Icons.lock_outline,
      message: e.message,
    );
  }

  final String feature;
  final String requiredTier;
  final IconData icon;
  final String? title;
  final String? message;

  String get _tierName => requiredTier == 'PRO' ? 'Pro' : 'Premium';

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: context.mq.accent.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: context.mq.accent, size: 26),
          ),
          const SizedBox(height: 16),
          Text(
            title ?? '$_tierName unlocks this',
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          if (message != null) ...[
            const SizedBox(height: 8),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: TextStyle(color: context.mq.muted, fontSize: 13.5, height: 1.45),
            ),
          ],
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const MembershipScreen()),
              ),
              child: Text('See $_tierName'),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Cancel any time',
            style: TextStyle(fontSize: 11.5, color: context.mq.faint),
          ),
        ],
      ),
    );
  }
}

/// A locked row in a list — shows the feature exists without pretending it's
/// available. Tapping goes to the pricing screen.
class LockedTile extends StatelessWidget {
  const LockedTile({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.requiredTier,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String requiredTier;

  @override
  Widget build(BuildContext context) {
    final tierName = requiredTier == 'PRO' ? 'Pro' : 'Premium';
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: ListTile(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const MembershipScreen()),
          ),
          leading: CircleAvatar(
            backgroundColor: context.mq.neutralBg,
            child: Icon(icon, color: context.mq.faint),
          ),
          title: Row(
            children: [
              Flexible(
                child: Text(title,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontWeight: FontWeight.w600, color: context.mq.muted)),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: context.mq.accent.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(tierName,
                    style: TextStyle(
                        fontSize: 9.5, fontWeight: FontWeight.w800, color: context.mq.accent)),
              ),
            ],
          ),
          subtitle: Text(subtitle, style: TextStyle(color: context.mq.faint)),
          trailing: Icon(Icons.lock_outline, size: 18, color: context.mq.faint),
        ),
      ),
    );
  }
}
