import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../state/theme_state.dart';
import '../theme.dart';
import '../units.dart';

/// Preferences the member controls: units, marketing consent, and links to the
/// legal documents they accepted.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _saving = false;
  LegalDocs? _legal;

  @override
  void initState() {
    super.initState();
    AuthRepository(context.read<ApiClient>()).legal().then((l) {
      if (mounted) setState(() => _legal = l);
    }).catchError((_) {});
  }

  Future<void> _setUnit(DistanceUnit unit) async {
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<AuthState>().updateProfile(distanceUnit: unit.api);
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _setMarketing(bool value) async {
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<AuthState>().updateProfile(marketingOptIn: value);
      if (mounted) {
        messenger.showSnackBar(SnackBar(
          content: Text(value
              ? "You'll get savings tips and offers"
              : "You won't get marketing emails"),
        ));
      }
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _open(String url) async {
    final uri = Uri.tryParse(url);
    if (uri != null && await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthState>().user;
    final unit = DistanceUnit.fromApi(user?.distanceUnit);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
        children: [
          const _SectionLabel('Appearance'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Theme',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, color: context.mq.muted)),
                  const SizedBox(height: 4),
                  Text(
                    'Match your phone, or pick one. Dark is easier on the eyes at '
                    'night — which is when you are most likely to be looking for fuel.',
                    style: TextStyle(fontSize: 12, color: context.mq.muted),
                  ),
                  const SizedBox(height: 12),
                  SegmentedButton<ThemeMode>(
                    segments: const [
                      ButtonSegment(
                        value: ThemeMode.system,
                        label: Text('Auto'),
                        icon: Icon(Icons.brightness_auto_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: ThemeMode.light,
                        label: Text('Light'),
                        icon: Icon(Icons.light_mode_outlined, size: 16),
                      ),
                      ButtonSegment(
                        value: ThemeMode.dark,
                        label: Text('Dark'),
                        icon: Icon(Icons.dark_mode_outlined, size: 16),
                      ),
                    ],
                    selected: {context.watch<ThemeState>().mode},
                    onSelectionChanged: (s) =>
                        context.read<ThemeState>().setMode(s.first),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _themeHint(context),
                    style: TextStyle(fontSize: 11.5, color: context.mq.faint),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          const _SectionLabel('Units'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Distances and drive times',
                    style: TextStyle(fontWeight: FontWeight.w600, color: context.mq.muted),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'UK road signs are in miles, so that\'s the default — switch if you prefer km.',
                    style: TextStyle(fontSize: 12, color: context.mq.muted),
                  ),
                  const SizedBox(height: 12),
                  SegmentedButton<DistanceUnit>(
                    segments: const [
                      ButtonSegment(
                        value: DistanceUnit.miles,
                        label: Text('Miles'),
                        icon: Icon(Icons.straighten, size: 16),
                      ),
                      ButtonSegment(
                        value: DistanceUnit.km,
                        label: Text('Kilometres'),
                        icon: Icon(Icons.straighten, size: 16),
                      ),
                    ],
                    selected: {unit},
                    onSelectionChanged:
                        _saving ? null : (s) => _setUnit(s.first),
                  ),
                  const SizedBox(height: 10),
                  // Show the effect immediately, in their chosen unit.
                  Text(
                    'Example: ${formatDistanceKm(3.2, unit)} away · ${formatDuration(480)}',
                    style: TextStyle(fontSize: 12, color: context.mq.muted),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),

          const _SectionLabel('Email preferences'),
          Card(
            child: SwitchListTile(
              value: user?.marketingOptIn ?? false,
              onChanged: _saving ? null : _setMarketing,
              title: const Text('Savings tips & offers',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              subtitle: Text(
                'Occasional emails about saving money on fuel. You can turn this '
                'off at any time — it never affects your membership.',
                style: TextStyle(fontSize: 12, color: context.mq.muted),
              ),
              isThreeLine: true,
            ),
          ),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              'Service emails (verification, security, reminders) are always sent — '
              "they're part of your account, not marketing.",
              style: TextStyle(fontSize: 11.5, color: context.mq.faint),
            ),
          ),
          const SizedBox(height: 20),

          // Admin only: switch the whole app's view to another tier to test
          // what those members actually see. The API refuses this for
          // non-admins, so a member cannot grant themselves Pro with it.
          if (_isAdmin(context)) ...[
            const _SectionLabel('Admin'),
            _AdminTierSwitcher(onChanged: () => setState(() {})),
            const SizedBox(height: 20),
          ],
          const _SectionLabel('Legal'),
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                ListTile(
                  leading: const Icon(Icons.description_outlined),
                  title: const Text('Terms & Conditions'),
                  subtitle: user?.termsAcceptedAt != null
                      ? Text('Accepted ${_fmtDate(user!.termsAcceptedAt!)}')
                      : null,
                  trailing: const Icon(Icons.open_in_new, size: 16),
                  onTap: () => _open(_legal?.termsUrl ?? 'https://saveondrive.co.uk/terms'),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: const Text('Privacy Policy'),
                  subtitle: user?.privacyAcceptedAt != null
                      ? Text('Accepted ${_fmtDate(user!.privacyAcceptedAt!)}')
                      : null,
                  trailing: const Icon(Icons.open_in_new, size: 16),
                  onTap: () => _open(_legal?.privacyUrl ?? 'https://saveondrive.co.uk/privacy'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 20),

          const _SectionLabel('Your data'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.shield_outlined, size: 18, color: context.mq.accent),
                      const SizedBox(width: 8),
                      Text('Your rights',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, color: context.mq.muted)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Under UK GDPR you can ask for a copy of your data, have it '
                    'corrected, or have your account and data deleted. Deleting your '
                    'account (in Your details) removes your data permanently.',
                    style: TextStyle(fontSize: 12.5, color: context.mq.muted, height: 1.4),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// On Auto, say what the phone is currently doing — otherwise "Auto" tells
  /// the member nothing about what they're actually going to see.
  static String _themeHint(BuildContext context) {
    final mode = context.watch<ThemeState>().mode;
    if (mode != ThemeMode.system) return 'Always ${mode.name}, whatever your phone is set to.';
    final dark = MediaQuery.platformBrightnessOf(context) == Brightness.dark;
    return 'Following your phone — currently ${dark ? 'dark' : 'light'}.';
  }

  /// The admin tools only render for the admin account. This is a UI
  /// convenience — the API enforces it independently.
  static bool _isAdmin(BuildContext context) {
    final email = context.read<AuthState>().user?.email.toLowerCase();
    return email == 'wood.tyna@gmail.com';
  }

  static String _fmtDate(DateTime d) =>
      '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
          color: context.mq.faint,
        ),
      ),
    );
  }
}


/// Lets an admin experience any membership tier without paying.
///
/// Deliberately loud about what it is: a simulation banner appears throughout
/// the app, billing is untouched, and no upgrade email is sent — because
/// nothing was bought. Real tier changes do email.
class _AdminTierSwitcher extends StatefulWidget {
  const _AdminTierSwitcher({required this.onChanged});
  final VoidCallback onChanged;

  @override
  State<_AdminTierSwitcher> createState() => _AdminTierSwitcherState();
}

class _AdminTierSwitcherState extends State<_AdminTierSwitcher> {
  String? _simulated;
  String _realTier = 'FREE';
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    MembershipRepository(context.read<ApiClient>()).mine().then((m) {
      if (mounted) {
        setState(() {
          _simulated = m.simulated ? m.tier : null;
          _realTier = m.simulated ? _realTier : m.tier;
        });
      }
    }).catchError((_) {});
  }

  Future<void> _set(String? tier) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    final auth = context.read<AuthState>();
    try {
      final r = await AdminRepository(context.read<ApiClient>()).simulateTier(tier);
      if (!mounted) return;
      setState(() {
        _simulated = r.simulatedTier;
        _realTier = r.realTier;
      });
      messenger.showSnackBar(SnackBar(content: Text(r.message)));
      await auth.refreshUser();
      widget.onChanged();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('\$e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Test a membership tier',
                style: TextStyle(fontWeight: FontWeight.w600, color: context.mq.muted)),
            const SizedBox(height: 4),
            Text(
              'See the app exactly as a member on that tier would. Your real '
              'membership and billing are untouched, and no email is sent.',
              style: TextStyle(fontSize: 12, color: context.mq.muted),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'OFF', label: Text('Off')),
                ButtonSegment(value: 'FREE', label: Text('Free')),
                ButtonSegment(value: 'PREMIUM', label: Text('Premium')),
                ButtonSegment(value: 'PRO', label: Text('Pro')),
              ],
              selected: {_simulated ?? 'OFF'},
              onSelectionChanged:
                  _busy ? null : (s) => _set(s.first == 'OFF' ? null : s.first),
            ),
            const SizedBox(height: 8),
            Text(
              _simulated == null
                  ? 'Not simulating — you are on your real \$_realTier membership.'
                  : 'Simulating \$_simulated. Your real membership is \$_realTier.',
              style: TextStyle(fontSize: 11.5, color: context.mq.faint),
            ),
          ],
        ),
      ),
    );
  }
}
