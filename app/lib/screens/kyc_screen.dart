import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

const _docTypes = {
  'PASSPORT': 'Passport',
  'DRIVING_LICENCE': 'Driving licence',
  'NATIONAL_ID': 'National ID',
};

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});

  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  late final KycRepository _repo;
  final _formKey = GlobalKey<FormState>();
  final _line1 = TextEditingController();
  final _city = TextEditingController();
  final _postcode = TextEditingController();
  final _docNumber = TextEditingController();
  DateTime? _dob;
  String _docType = 'PASSPORT';
  KycProfile? _profile;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _repo = KycRepository(context.read<ApiClient>());
    _repo.get().then((k) {
      if (mounted) setState(() => _profile = k);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _line1.dispose();
    _city.dispose();
    _postcode.dispose();
    _docNumber.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate() || _dob == null) {
      if (_dob == null) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Please select your date of birth')));
      }
      return;
    }
    setState(() => _busy = true);
    try {
      final k = await _repo.submit({
        'dateOfBirth': _dob!.toIso8601String(),
        'addressLine1': _line1.text.trim(),
        'city': _city.text.trim(),
        'postcode': _postcode.text.trim(),
        'documentType': _docType,
        'documentNumber': _docNumber.text.trim(),
      });
      if (!mounted) return;
      setState(() => _profile = k);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Identity ${k.status.toLowerCase()}')),
      );
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final verified = _profile?.isVerified ?? false;
    return Scaffold(
      appBar: AppBar(title: const Text('Identity verification')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_profile != null) _StatusChip(status: _profile!.status),
          const SizedBox(height: 12),
          Text(
            verified
                ? 'You are fully verified. Your wallet and Mastercard are active.'
                : 'MOTORIQ moves money, so we must verify your identity (KYC) before you can top up or use your card. Verification is handled by our regulated banking partner.',
            style: TextStyle(color: context.mq.muted),
          ),
          const SizedBox(height: 20),
          if (!verified)
            Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _dobField(),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _line1,
                    decoration: const InputDecoration(labelText: 'Address line 1'),
                    validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                  ),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: TextFormField(
                        controller: _city,
                        decoration: const InputDecoration(labelText: 'City'),
                        validator: (v) => (v == null || v.isEmpty) ? 'Required' : null,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: TextFormField(
                        controller: _postcode,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(labelText: 'Postcode'),
                        validator: (v) => (v == null || v.length < 2) ? 'Required' : null,
                      ),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _docType,
                    decoration: const InputDecoration(labelText: 'ID document'),
                    items: _docTypes.entries
                        .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                        .toList(),
                    onChanged: (v) => setState(() => _docType = v ?? 'PASSPORT'),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _docNumber,
                    decoration: const InputDecoration(labelText: 'Document number'),
                    validator: (v) => (v == null || v.length < 3) ? 'Required' : null,
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Submit for verification'),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _dobField() {
    return InkWell(
      onTap: () async {
        final picked = await showDatePicker(
          context: context,
          initialDate: DateTime(1995, 1, 1),
          firstDate: DateTime(1920),
          lastDate: DateTime.now(),
        );
        if (picked != null) setState(() => _dob = picked);
      },
      child: InputDecorator(
        decoration: const InputDecoration(labelText: 'Date of birth'),
        child: Text(_dob == null ? 'Select…' : _dob!.toIso8601String().split('T').first),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final (Color c, IconData i) = switch (status) {
      'VERIFIED' => (context.mq.money, Icons.verified),
      'REJECTED' => (Colors.redAccent, Icons.cancel),
      'PENDING' => (context.mq.warningFg, Icons.hourglass_top),
      _ => (Colors.grey, Icons.info_outline),
    };
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Row(children: [
        Icon(i, color: c),
        const SizedBox(width: 10),
        Text('Status: $status', style: TextStyle(fontWeight: FontWeight.w700, color: c)),
      ]),
    );
  }
}
