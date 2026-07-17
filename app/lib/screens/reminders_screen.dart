import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

const _types = {
  'MOT': 'MOT',
  'ROAD_TAX': 'Road tax',
  'SERVICE': 'Service',
  'INSURANCE': 'Insurance',
  'BREAKDOWN': 'Breakdown',
  'OTHER': 'Other',
};

class RemindersScreen extends StatefulWidget {
  const RemindersScreen({super.key});

  @override
  State<RemindersScreen> createState() => _RemindersScreenState();
}

class _RemindersScreenState extends State<RemindersScreen> {
  late final ReminderRepository _repo;
  Future<List<Reminder>>? _future;

  @override
  void initState() {
    super.initState();
    _repo = ReminderRepository(context.read<ApiClient>());
    _load();
  }

  void _load() => setState(() => _future = _repo.list());

  Future<void> _add() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _ReminderSheet(repo: _repo),
    );
    if (saved == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reminders')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _add,
        icon: const Icon(Icons.add),
        label: const Text('Add reminder'),
      ),
      body: FutureBuilder<List<Reminder>>(
        future: _future,
        builder: (context, snap) {
          if (!snap.hasData) return const Center(child: CircularProgressIndicator());
          final items = snap.data!;
          if (items.isEmpty) {
            return const Center(child: Text('No reminders yet.'));
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
            children: items.map((r) => _ReminderTile(reminder: r, repo: _repo, onChanged: _load)).toList(),
          );
        },
      ),
    );
  }
}

class _ReminderTile extends StatelessWidget {
  const _ReminderTile({required this.reminder, required this.repo, required this.onChanged});
  final Reminder reminder;
  final ReminderRepository repo;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final due = DateFormat('d MMM yyyy').format(reminder.dueDate);
    final overdue = reminder.dueDate.isBefore(DateTime.now()) && !reminder.completed;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: (overdue ? Colors.redAccent : context.mq.accent).withValues(alpha: 0.12),
          child: Icon(Icons.event, color: overdue ? Colors.redAccent : context.mq.accent),
        ),
        title: Text(_types[reminder.type] ?? reminder.type,
            style: const TextStyle(fontWeight: FontWeight.w700)),
        subtitle: Text([
          'Due $due',
          if (overdue) 'OVERDUE',
          if (reminder.note != null && reminder.note!.isNotEmpty) reminder.note!,
        ].join(' · ')),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          if (!reminder.completed)
            IconButton(
              icon: const Icon(Icons.check_circle_outline),
              onPressed: () async {
                await repo.complete(reminder.id);
                onChanged();
              },
            ),
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () async {
              await repo.delete(reminder.id);
              onChanged();
            },
          ),
        ]),
      ),
    );
  }
}

class _ReminderSheet extends StatefulWidget {
  const _ReminderSheet({required this.repo});
  final ReminderRepository repo;

  @override
  State<_ReminderSheet> createState() => _ReminderSheetState();
}

class _ReminderSheetState extends State<_ReminderSheet> {
  final _note = TextEditingController();
  String _type = 'MOT';
  DateTime _due = DateTime.now().add(const Duration(days: 30));
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await widget.repo.create({
        'type': _type,
        'dueDate': _due.toIso8601String(),
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
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
          const Text('Add reminder', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _type,
            decoration: const InputDecoration(labelText: 'Type'),
            items: _types.entries
                .map((e) => DropdownMenuItem(value: e.key, child: Text(e.value)))
                .toList(),
            onChanged: (v) => setState(() => _type = v ?? 'MOT'),
          ),
          const SizedBox(height: 12),
          InkWell(
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _due,
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365 * 3)),
              );
              if (picked != null) setState(() => _due = picked);
            },
            child: InputDecorator(
              decoration: const InputDecoration(labelText: 'Due date'),
              child: Text(DateFormat('d MMM yyyy').format(_due)),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            decoration: const InputDecoration(labelText: 'Note (optional)'),
          ),
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
