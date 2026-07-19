import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../app_config.dart';
import '../models/models.dart';
import '../password_policy.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';
import 'forgot_password_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  // Deliberately not prefilled: shipping demo credentials invites people to
  // sign in as someone else, and "password123" is exactly what the password
  // policy now rejects.
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();

  bool _isRegister = false;
  bool _busy = false;
  bool _obscure = true;
  bool _obscureConfirm = true;

  // UK GDPR: consent must be actively given, so these start false and the
  // marketing one is separate from accepting the terms.
  bool _acceptTerms = false;
  bool _acceptPrivacy = false;
  bool _marketingOptIn = false;

  LegalDocs? _legal;

  @override
  void initState() {
    super.initState();
    // Fetch the current terms URLs/versions so the links are always right.
    AuthRepository(context.read<ApiClient>()).legal().then((l) {
      if (mounted) setState(() => _legal = l);
    }).catchError((_) {
      // Non-fatal: fall back to the default URLs baked into LegalDocs.
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    _firstName.dispose();
    _lastName.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_isRegister && !(_acceptTerms && _acceptPrivacy)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please accept the Terms and Privacy Policy to continue')),
      );
      return;
    }

    setState(() => _busy = true);
    final auth = context.read<AuthState>();
    final ok = _isRegister
        ? await auth.register(
            email: _email.text.trim(),
            password: _password.text,
            firstName: _firstName.text.trim(),
            lastName: _lastName.text.trim(),
            acceptTerms: _acceptTerms,
            acceptPrivacy: _acceptPrivacy,
            marketingOptIn: _marketingOptIn,
          )
        : await auth.login(_email.text.trim(), _password.text);
    if (!mounted) return;
    setState(() => _busy = false);
    if (!ok && auth.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(auth.error!), duration: const Duration(seconds: 5)),
      );
    }
  }

  void _toggleMode() {
    setState(() {
      _isRegister = !_isRegister;
      _confirm.clear();
      // Consent is per-signup; never carry a stale tick across modes.
      _acceptTerms = false;
      _acceptPrivacy = false;
      _marketingOptIn = false;
    });
  }

  Future<void> _openUrl(String url) async {
    final uri = Uri.tryParse(url);
    if (uri == null) return;
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text("Couldn't open $url")));
    }
  }

  Future<void> _editServerUrl() async {
    final controller = TextEditingController(text: AppConfig.apiBaseUrl);
    final url = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Server URL'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'The API this app connects to. On a real device this must be a '
              'reachable URL (e.g. your Render URL), not localhost.',
              style: TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autocorrect: false,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                hintText: 'https://motoriq-api.onrender.com/api/v1',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (url != null) {
      await AppConfig.saveOverride(url);
      if (mounted) {
        setState(() {});
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Server set to ${AppConfig.apiBaseUrl}')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const SizedBox(height: 12),
                    // Long-press the logo to reach the server picker in a
                    // release build. Undiscoverable by accident, but means a
                    // tester can point at staging without a debug build.
                    GestureDetector(
                      onLongPress: _busy ? null : _editServerUrl,
                      child: const _Logo(),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'The Smart Membership for Cheaper Driving',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: context.mq.muted),
                    ),
                    const SizedBox(height: 32),
                    if (_isRegister) ...[
                      Row(children: [
                        Expanded(
                          child: TextFormField(
                            controller: _firstName,
                            textCapitalization: TextCapitalization.words,
                            decoration: const InputDecoration(labelText: 'First name'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextFormField(
                            controller: _lastName,
                            textCapitalization: TextCapitalization.words,
                            decoration: const InputDecoration(labelText: 'Last name'),
                          ),
                        ),
                      ]),
                      const SizedBox(height: 12),
                    ],
                    TextFormField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      autocorrect: false,
                      decoration: const InputDecoration(labelText: 'Email'),
                      validator: (v) =>
                          (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _password,
                      obscureText: _obscure,
                      // Prompts the OS password manager to offer a strong one.
                      autofillHints: [
                        _isRegister ? AutofillHints.newPassword : AutofillHints.password,
                      ],
                      decoration: InputDecoration(
                        labelText: 'Password',
                        suffixIcon: IconButton(
                          icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      onChanged: (_) => setState(() {}), // live meter
                      validator: (v) {
                        final pw = v ?? '';
                        if (!_isRegister) {
                          // Never apply new-password rules at sign-in: an
                          // existing password set under older rules must still
                          // work, and the server decides anyway.
                          return pw.isEmpty ? 'Enter your password' : null;
                        }
                        return passwordIssue(
                          pw,
                          email: _email.text.trim(),
                          firstName: _firstName.text.trim(),
                          lastName: _lastName.text.trim(),
                        );
                      },
                    ),
                    if (_isRegister) ...[
                      const SizedBox(height: 8),
                      _StrengthMeter(password: _password.text),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: _confirm,
                        obscureText: _obscureConfirm,
                        autofillHints: const [AutofillHints.newPassword],
                        decoration: InputDecoration(
                          labelText: 'Confirm password',
                          suffixIcon: IconButton(
                            icon: Icon(
                                _obscureConfirm ? Icons.visibility_off : Icons.visibility),
                            onPressed: () =>
                                setState(() => _obscureConfirm = !_obscureConfirm),
                          ),
                        ),
                        validator: (v) =>
                            v != _password.text ? 'Passwords do not match' : null,
                      ),
                      const SizedBox(height: 16),
                      _ConsentCheckbox(
                        value: _acceptTerms,
                        onChanged: (v) => setState(() => _acceptTerms = v ?? false),
                        child: _linkText(
                          'I accept the ',
                          linkLabel: 'Terms & Conditions',
                          url: _legal?.termsUrl ?? 'https://saveondrive.co.uk/terms',
                        ),
                      ),
                      _ConsentCheckbox(
                        value: _acceptPrivacy,
                        onChanged: (v) => setState(() => _acceptPrivacy = v ?? false),
                        child: _linkText(
                          'I have read the ',
                          linkLabel: 'Privacy Policy',
                          url: _legal?.privacyUrl ?? 'https://saveondrive.co.uk/privacy',
                          trailing:
                              ' and consent to SaveOnDrive processing my data as described.',
                        ),
                      ),
                      // Separate and optional — bundling marketing into the
                      // terms would not be freely given consent under UK GDPR.
                      _ConsentCheckbox(
                        value: _marketingOptIn,
                        onChanged: (v) => setState(() => _marketingOptIn = v ?? false),
                        child: Text(
                          'Send me fuel savings tips and offers (optional)',
                          style: TextStyle(fontSize: 13, color: context.mq.muted),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      child: _busy
                          ? const SizedBox(
                              height: 22,
                              width: 22,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : Text(_isRegister ? 'Create account' : 'Sign in'),
                    ),
                    if (!_isRegister)
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) =>
                                        ForgotPasswordScreen(email: _email.text.trim()),
                                  ),
                                ),
                        child: const Text('Forgot your password?'),
                      ),
                    const SizedBox(height: 4),
                    TextButton(
                      onPressed: _busy ? null : _toggleMode,
                      child: Text(_isRegister
                          ? 'Have an account? Sign in'
                          : 'New to SaveOnDrive? Create an account'),
                    ),
                    // The server picker is a development tool — members should
                    // never see it, let alone be able to point the app at
                    // another host. It stays reachable in debug builds, and via
                    // a long-press on the logo, so a release build can still be
                    // aimed at a staging API when something needs diagnosing.
                    if (kDebugMode) ...[
                      const SizedBox(height: 8),
                      TextButton.icon(
                        onPressed: _busy ? null : _editServerUrl,
                        icon: const Icon(Icons.dns_outlined, size: 16),
                        label: Text(
                          'Server: ${Uri.tryParse(AppConfig.apiBaseUrl)?.host ?? AppConfig.apiBaseUrl}',
                          style: const TextStyle(fontSize: 12),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Consent text with a tappable link to the document itself. Members must be
  /// able to actually read what they're agreeing to.
  Widget _linkText(
    String lead, {
    required String linkLabel,
    required String url,
    String? trailing,
  }) {
    return Text.rich(
      TextSpan(
        style: TextStyle(fontSize: 13, color: context.mq.muted, height: 1.35),
        children: [
          TextSpan(text: lead),
          TextSpan(
            text: linkLabel,
            style: TextStyle(
              color: context.mq.accent,
              fontWeight: FontWeight.w600,
              decoration: TextDecoration.underline,
            ),
            recognizer: TapGestureRecognizer()..onTap = () => _openUrl(url),
          ),
          if (trailing != null) TextSpan(text: trailing),
        ],
      ),
    );
  }
}

/// Checkbox + tappable label. The whole row toggles, so nobody has to hit a
/// 20-pixel box.
class _ConsentCheckbox extends StatelessWidget {
  const _ConsentCheckbox({
    required this.value,
    required this.onChanged,
    required this.child,
  });

  final bool value;
  final ValueChanged<bool?> onChanged;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () => onChanged(!value),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 24,
              width: 24,
              child: Checkbox(
                value: value,
                onChanged: onChanged,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
            const SizedBox(width: 10),
            // Links inside need their own gesture area, so don't absorb taps here.
            Expanded(child: Padding(padding: const EdgeInsets.only(top: 2), child: child)),
          ],
        ),
      ),
    );
  }
}

/// Live password strength. Scored by the same rules as the API
/// (lib/password_policy.dart mirrors backend lib/password.ts), so this can
/// never call a password strong that the server then rejects.
class _StrengthMeter extends StatelessWidget {
  const _StrengthMeter({required this.password});
  final String password;

  /// Weak → strong. Can't be a static const: the ends come from the theme so
  /// they stay legible on both grounds, and the middle two are a ramp between
  /// danger and money rather than arbitrary hues.
  static List<Color> _ramp(BuildContext context) => [
        context.mq.dangerFg, // weak
        context.mq.warningFg, // fair
        Color.lerp(context.mq.warningFg, context.mq.money, 0.55)!, // good
        context.mq.money, // strong
      ];

  @override
  Widget build(BuildContext context) {
    if (password.isEmpty) {
      return Text(
        'At least $kPasswordMin characters. A few random words makes a strong, memorable password.',
        style: TextStyle(fontSize: 11.5, color: context.mq.muted),
      );
    }
    final score = passwordScore(password);
    final color = _ramp(context)[score];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (var i = 0; i < 4; i++) ...[
              Expanded(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  height: 4,
                  decoration: BoxDecoration(
                    color: i <= score ? color : context.mq.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              if (i < 3) const SizedBox(width: 4),
            ],
          ],
        ),
        const SizedBox(height: 5),
        Text(
          passwordScoreLabels[score],
          style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color),
        ),
      ],
    );
  }
}

class _Logo extends StatelessWidget {
  const _Logo();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: context.mq.accent,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Icon(Icons.directions_car_filled, color: Colors.white),
        ),
        const SizedBox(width: 10),
        const Text('SaveOnDrive',
            style: TextStyle(
                fontSize: 28, fontWeight: FontWeight.w800, color: kBrandDark)),
      ],
    );
  }
}
