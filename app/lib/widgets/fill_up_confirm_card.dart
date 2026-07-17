import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

/// Asks the member whether a fill-up actually happened.
///
/// Tapping "Navigate here" only proves they set off. Until this is answered
/// (or a card payment matches the trip), the saving is not counted — so this
/// card is what turns an intention into a real, honest number.
class FillUpConfirmCard extends StatefulWidget {
  const FillUpConfirmCard({super.key, required this.onChanged});

  /// Called after an answer, so the dashboard can refresh its savings total.
  final VoidCallback onChanged;

  @override
  State<FillUpConfirmCard> createState() => _FillUpConfirmCardState();
}

class _FillUpConfirmCardState extends State<FillUpConfirmCard> {
  late final FillUpRepository _repo;
  List<PendingFillUp> _pending = [];
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _repo = FillUpRepository(context.read<ApiClient>());
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await _repo.pending();
      if (mounted) setState(() => _pending = p);
    } catch (_) {
      // Non-fatal — the dashboard works fine without this prompt.
    }
  }

  Future<void> _answer(PendingFillUp f, bool filledUp) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _repo.confirm(f.id, filledUp: filledUp);
      if (!mounted) return;
      setState(() => _pending.removeWhere((p) => p.id == f.id));
      messenger.showSnackBar(SnackBar(
        content: Text(filledUp
            ? 'Added ${formatMinor(f.savedMinor)} to your savings'
            : "No problem — we won't count it"),
      ));
      widget.onChanged();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// "Yes, but it wasn't a full tank" — let them correct our estimate rather
  /// than record a saving we know is wrong.
  Future<void> _confirmWithLitres(PendingFillUp f) async {
    final controller = TextEditingController(text: f.litres.toStringAsFixed(0));
    final litres = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('How much did you put in?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'We assumed ${f.litres.toStringAsFixed(0)} litres at '
              '${f.pricePencePerUnit.toStringAsFixed(1)}p. Correct it and your '
              'saving is recalculated.',
              style: const TextStyle(fontSize: 13),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Litres', suffixText: 'L'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, double.tryParse(controller.text.trim())),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (litres == null || litres <= 0 || !mounted) return;

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _repo.confirm(f.id, filledUp: true, actualLitres: litres);
      if (!mounted) return;
      setState(() => _pending.removeWhere((p) => p.id == f.id));
      messenger.showSnackBar(const SnackBar(content: Text('Fill-up recorded')));
      widget.onChanged();
    } catch (e) {
      if (mounted) messenger.showSnackBar(SnackBar(content: Text('Could not save: $e')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_pending.isEmpty) return const SizedBox.shrink();
    final f = _pending.first; // ask about one at a time

    final where = f.stationBrand ?? 'the station';
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: context.mq.accent.withValues(alpha: 0.12),
                  child: Icon(Icons.local_gas_station, color: context.mq.accent, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Did you fill up?',
                          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      const SizedBox(height: 2),
                      Text(
                        '$where${f.stationPostcode != null && f.stationPostcode!.isNotEmpty ? ' · ${f.stationPostcode}' : ''}'
                        ' · worth ${formatMinor(f.savedMinor)}',
                        style: TextStyle(fontSize: 12, color: context.mq.muted),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              "We only count savings you've actually made, so we need to know.",
              style: TextStyle(fontSize: 11.5, color: context.mq.faint),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy ? null : () => _answer(f, false),
                    child: const Text("Didn't fill up"),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: _busy ? null : () => _answer(f, true),
                    child: const Text('Yes, I did'),
                  ),
                ),
              ],
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _busy ? null : () => _confirmWithLitres(f),
                child: const Text('Yes — but a different amount', style: TextStyle(fontSize: 12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
