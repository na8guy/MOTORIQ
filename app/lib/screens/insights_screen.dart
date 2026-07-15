import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  late final InsightsRepository _repo;
  Future<SavingsInsight>? _future;
  String _period = 'monthly';

  @override
  void initState() {
    super.initState();
    _repo = InsightsRepository(context.read<ApiClient>());
    _load();
  }

  void _load() => setState(() => _future = _repo.ai(period: _period));

  Future<void> _logFillup() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _LogFillupSheet(repo: _repo),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Fuel savings')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _logFillup,
        icon: const Icon(Icons.add),
        label: const Text('Log fill-up'),
      ),
      body: FutureBuilder<SavingsInsight>(
        future: _future,
        builder: (context, snap) {
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
            children: [
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'daily', label: Text('Daily')),
                  ButtonSegment(value: 'weekly', label: Text('Weekly')),
                  ButtonSegment(value: 'monthly', label: Text('Monthly')),
                ],
                selected: {_period},
                onSelectionChanged: (s) {
                  setState(() => _period = s.first);
                  _load();
                },
              ),
              const SizedBox(height: 16),
              if (snap.connectionState == ConnectionState.waiting)
                const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
              else if (snap.hasError)
                Center(child: Text('${snap.error}'))
              else if (snap.hasData)
                ..._content(snap.data!),
            ],
          );
        },
      ),
    );
  }

  List<Widget> _content(SavingsInsight i) {
    return [
      Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          gradient: const LinearGradient(colors: [kBrandBlue, kBrandDark]),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(i.headline,
                style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(i.narrative, style: const TextStyle(color: Colors.white70)),
          ],
        ),
      ),
      const SizedBox(height: 16),
      Row(children: [
        Expanded(child: _stat('Saved', formatMinor(i.totalSavedMinor), kBrandGreen)),
        const SizedBox(width: 12),
        Expanded(child: _stat('Projected / yr', formatMinor(i.projectedAnnualSavingMinor), kBrandBlue)),
      ]),
      const SizedBox(height: 20),
      Row(children: [
        const Text('Tips to save more', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
        const SizedBox(width: 8),
        if (i.source == 'ai')
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(
              color: kBrandBlue.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Text('AI', style: TextStyle(color: kBrandBlue, fontWeight: FontWeight.w700, fontSize: 11)),
          ),
      ]),
      const SizedBox(height: 8),
      ...i.tips.map((t) => Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: const Icon(Icons.tips_and_updates, color: kBrandGreen),
              title: Text(t),
            ),
          )),
    ];
  }

  Widget _stat(String label, String value, Color color) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
              const SizedBox(height: 4),
              Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
            ],
          ),
        ),
      );
}

class _LogFillupSheet extends StatefulWidget {
  const _LogFillupSheet({required this.repo});
  final InsightsRepository repo;

  @override
  State<_LogFillupSheet> createState() => _LogFillupSheetState();
}

class _LogFillupSheetState extends State<_LogFillupSheet> {
  final _litres = TextEditingController(text: '45');
  final _price = TextEditingController(text: '139.9');
  String _kind = 'E10';
  bool _busy = false;

  @override
  void dispose() {
    _litres.dispose();
    _price.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final litres = double.tryParse(_litres.text.trim());
    final price = double.tryParse(_price.text.trim());
    if (litres == null || price == null) return;
    setState(() => _busy = true);
    try {
      await widget.repo.logPurchase({
        'fuelKind': _kind,
        'litres': litres,
        'pricePencePerUnit': price,
      });
      if (mounted) Navigator.pop(context, true);
    } catch (_) {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Log a fill-up', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _kind,
            decoration: const InputDecoration(labelText: 'Fuel'),
            items: const [
              DropdownMenuItem(value: 'E10', child: Text('Petrol E10')),
              DropdownMenuItem(value: 'E5', child: Text('Super E5')),
              DropdownMenuItem(value: 'B7', child: Text('Diesel')),
              DropdownMenuItem(value: 'ELECTRIC', child: Text('EV (kWh)')),
            ],
            onChanged: (v) => setState(() => _kind = v ?? 'E10'),
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _litres,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Litres / kWh'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: _price,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Price (pence)'),
              ),
            ),
          ]),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _busy ? null : _save,
            child: _busy
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : const Text('Save'),
          ),
        ],
      ),
    );
  }
}
