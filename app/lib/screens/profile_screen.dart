import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import 'membership_screen.dart';

/// Lets a member view and edit their own details. Email is deliberately
/// read-only: it identifies the account and is what verification is tied to,
/// so changing it needs a re-verification flow we don't have yet.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _first;
  late final TextEditingController _last;
  late final TextEditingController _phone;

  bool _saving = false;
  bool _resending = false;

  @override
  void initState() {
    super.initState();
    final user = context.read<AuthState>().user;
    _first = TextEditingController(text: user?.firstName ?? '');
    _last = TextEditingController(text: user?.lastName ?? '');
    _phone = TextEditingController(text: user?.phone ?? '');
  }

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<AuthState>().updateProfile(
            firstName: _first.text.trim(),
            lastName: _last.text.trim(),
            phone: _phone.text.trim(),
          );
      if (!mounted) return;
      messenger.showSnackBar(const SnackBar(content: Text('Details saved')));
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      // Show the real reason — a silent failure here loses the member's edits.
      messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _resendVerification(String email) async {
    setState(() => _resending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AuthRepository(context.read<ApiClient>()).resendVerification(email);
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text('Verification email sent to $email')));
    } catch (_) {
      if (!mounted) return;
      messenger.showSnackBar(
        const SnackBar(content: Text('Could not send — try again shortly')),
      );
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text(
          'This permanently deletes your SaveOnDrive account, wallet, vehicles and '
          'saved history. This cannot be undone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: context.mq.dangerFg),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    try {
      await context.read<ApiClient>().delete('/users/me');
      if (!mounted) return;
      await context.read<AuthState>().logout();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not delete: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthState>().user;

    return Scaffold(
      appBar: AppBar(title: const Text('Your details')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 32),
          children: [
            Center(
              child: CircleAvatar(
                radius: 34,
                backgroundColor: context.mq.accent.withValues(alpha: 0.12),
                child: Text(
                  _initials(user?.firstName, user?.lastName, user?.email),
                  style: TextStyle(
                      fontSize: 24, fontWeight: FontWeight.w800, color: context.mq.accent),
                ),
              ),
            ),
            const SizedBox(height: 20),

            // Email: read-only, with its verification state made obvious.
            _ReadOnlyField(
              label: 'Email',
              value: user?.email ?? '',
              trailing: user == null
                  ? null
                  : user.emailVerified
                      ? _Chip(
                          label: 'Verified', color: context.mq.money, icon: Icons.verified)
                      : _Chip(
                          label: 'Unverified',
                          color: context.mq.warningFg,
                          icon: Icons.error_outline),
            ),
            if (user != null && !user.emailVerified) ...[
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Verify your email to secure your account.',
                      style: TextStyle(fontSize: 12, color: context.mq.muted),
                    ),
                  ),
                  _resending
                      ? const SizedBox(
                          height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : TextButton(
                          onPressed: () => _resendVerification(user.email),
                          child: const Text('Resend'),
                        ),
                ],
              ),
            ],
            const SizedBox(height: 16),

            TextFormField(
              controller: _first,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'First name'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter your first name' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _last,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Last name'),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Enter your last name' : null,
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'Mobile number',
                helperText: 'Used for card and security alerts',
              ),
              validator: (v) {
                final s = v?.trim() ?? '';
                if (s.isEmpty) return null; // optional
                // Deliberately permissive: accepts 07…, +44…, spaces, brackets.
                if (!RegExp(r'^\+?[\d\s()-]{7,20}$').hasMatch(s)) {
                  return 'Enter a valid phone number';
                }
                return null;
              },
            ),
            const SizedBox(height: 24),

            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                onPressed: _saving ? null : _save,
                child: _saving
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Save changes'),
              ),
            ),
            const SizedBox(height: 28),

            Card(
              clipBehavior: Clip.antiAlias,
              child: ListTile(
                leading: Icon(Icons.workspace_premium, color: context.mq.money),
                title: const Text('Membership',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text(_tierLabel(user?.tier ?? 'FREE')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MembershipScreen()),
                ),
              ),
            ),
            const SizedBox(height: 24),

            TextButton.icon(
              onPressed: _confirmDelete,
              icon: Icon(Icons.delete_outline, color: context.mq.dangerFg),
              label: Text('Delete account', style: TextStyle(color: context.mq.dangerFg)),
            ),
          ],
        ),
      ),
    );
  }

  static String _tierLabel(String tier) => switch (tier) {
        'PREMIUM' => 'SaveOnDrive Premium',
        'PRO' => 'SaveOnDrive Pro',
        _ => 'Free',
      };

  static String _initials(String? first, String? last, String? email) {
    final a = (first ?? '').trim();
    final b = (last ?? '').trim();
    if (a.isNotEmpty || b.isNotEmpty) {
      return '${a.isNotEmpty ? a[0] : ''}${b.isNotEmpty ? b[0] : ''}'.toUpperCase();
    }
    final e = (email ?? '').trim();
    return e.isNotEmpty ? e[0].toUpperCase() : '?';
  }
}

class _ReadOnlyField extends StatelessWidget {
  const _ReadOnlyField({required this.label, required this.value, this.trailing});
  final String label;
  final String value;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        filled: true,
        fillColor: context.mq.neutralBg,
      ),
      child: Row(
        children: [
          Expanded(child: Text(value, style: const TextStyle(fontSize: 15))),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.color, required this.icon});
  final String label;
  final Color color;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(label,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: color)),
        ],
      ),
    );
  }
}
