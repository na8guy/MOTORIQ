import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
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
          const _SectionLabel('Units'),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Distances and drive times',
                    style: TextStyle(fontWeight: FontWeight.w600, color: Colors.grey.shade800),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'UK road signs are in miles, so that\'s the default — switch if you prefer km.',
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
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
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
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
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
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
              style: TextStyle(fontSize: 11.5, color: Colors.grey.shade500),
            ),
          ),
          const SizedBox(height: 20),

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
                  onTap: () => _open(_legal?.termsUrl ?? 'https://motoriq.co.uk/terms'),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: const Text('Privacy Policy'),
                  subtitle: user?.privacyAcceptedAt != null
                      ? Text('Accepted ${_fmtDate(user!.privacyAcceptedAt!)}')
                      : null,
                  trailing: const Icon(Icons.open_in_new, size: 16),
                  onTap: () => _open(_legal?.privacyUrl ?? 'https://motoriq.co.uk/privacy'),
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
                      const Icon(Icons.shield_outlined, size: 18, color: kBrandBlue),
                      const SizedBox(width: 8),
                      Text('Your rights',
                          style: TextStyle(
                              fontWeight: FontWeight.w700, color: Colors.grey.shade800)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Under UK GDPR you can ask for a copy of your data, have it '
                    'corrected, or have your account and data deleted. Deleting your '
                    'account (in Your details) removes your data permanently.',
                    style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600, height: 1.4),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
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
          color: Colors.grey.shade500,
        ),
      ),
    );
  }
}
