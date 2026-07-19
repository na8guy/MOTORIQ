import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

/// Request a password reset link.
///
/// Deliberately says the same thing whether or not the address has an account —
/// the API won't reveal which, and neither should this screen. Telling someone
/// "no account with that email" turns a login form into a tool for discovering
/// who has a SaveOnDrive account.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key, this.email});

  /// Pre-filled from the login form, so they don't retype it.
  final String? email;

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _email;
  bool _busy = false;
  bool _sent = false;

  @override
  void initState() {
    super.initState();
    _email = TextEditingController(text: widget.email ?? '');
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AuthRepository(context.read<ApiClient>()).forgotPassword(_email.text.trim());
      if (!mounted) return;
      setState(() => _sent = true);
    } catch (e) {
      if (!mounted) return;
      // Only a genuine transport failure lands here — the API returns ok
      // regardless of whether the address exists.
      messenger.showSnackBar(SnackBar(content: Text('Could not send: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reset password')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: _sent ? _sentView() : _formView(),
            ),
          ),
        ),
      ),
    );
  }

  Widget _formView() {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(Icons.lock_reset, size: 48, color: context.mq.accent),
          const SizedBox(height: 16),
          const Text(
            'Forgot your password?',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          Text(
            "Enter your email and we'll send you a link to choose a new password.",
            textAlign: TextAlign.center,
            style: TextStyle(color: context.mq.muted, height: 1.4),
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email'),
            validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
          ),
          const SizedBox(height: 20),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : const Text('Send reset link'),
          ),
        ],
      ),
    );
  }

  Widget _sentView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.mark_email_read_outlined, size: 48, color: context.mq.money),
        const SizedBox(height: 16),
        const Text(
          'Check your email',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 8),
        Text(
          // Careful wording: "if an account exists" is the honest phrasing and
          // avoids confirming whether this address is registered.
          "If an account exists for ${_email.text.trim()}, we've sent a link to "
          'choose a new password. It expires in 1 hour.',
          textAlign: TextAlign.center,
          style: TextStyle(color: context.mq.muted, height: 1.4),
        ),
        const SizedBox(height: 8),
        Text(
          "Can't see it? Check your spam folder.",
          textAlign: TextAlign.center,
          style: TextStyle(color: context.mq.faint, fontSize: 12.5),
        ),
        const SizedBox(height: 24),
        FilledButton(
          style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Back to sign in'),
        ),
        TextButton(
          onPressed: _busy ? null : () => setState(() => _sent = false),
          child: const Text('Use a different email'),
        ),
      ],
    );
  }
}
