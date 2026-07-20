import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

const _fuelTypes = ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID', 'PLUGIN_HYBRID', 'LPG'];

class VehiclesTab extends StatefulWidget {
  const VehiclesTab({super.key});

  @override
  State<VehiclesTab> createState() => _VehiclesTabState();
}

class _VehiclesTabState extends State<VehiclesTab> {
  late final VehicleRepository _repo;
  Future<List<Vehicle>>? _future;

  @override
  void initState() {
    super.initState();
    _repo = VehicleRepository(context.read<ApiClient>());
    // Assign directly rather than via _load(): calling setState() inside
    // initState() throws, because the State is not yet mounted into the tree.
    // initState is always followed by a build, so no setState is needed here.
    _future = _repo.list();
  }

  void _load() => setState(() => _future = _repo.list());

  Future<void> _openForm({Vehicle? existing}) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _VehicleForm(repo: _repo, existing: existing),
    );
    if (saved == true) _load();
  }

  Future<void> _delete(Vehicle v) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Remove vehicle?'),
        content: Text('${v.registration} will be removed from your account.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _repo.delete(v.id);
      _load();
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  /// Re-pull DVLA/DVSA data for one vehicle on demand.
  Future<void> _refresh(Vehicle v) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await _repo.refresh(v.id);
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('${v.registration} updated from DVLA')),
      );
      _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _openForm(),
        icon: const Icon(Icons.add),
        label: const Text('Add vehicle'),
      ),
      body: FutureBuilder<List<Vehicle>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            // A readable card rather than a raw exception dumped on screen —
            // and a way out, so a transient network failure is not a dead end.
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.cloud_off, size: 40, color: context.mq.faint),
                    const SizedBox(height: 12),
                    const Text("Couldn't load your vehicles",
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 6),
                    Text('${snap.error}',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: context.mq.muted, fontSize: 13)),
                    const SizedBox(height: 16),
                    OutlinedButton(onPressed: _load, child: const Text('Try again')),
                  ],
                ),
              ),
            );
          }
          final vehicles = snap.data ?? [];
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
              children: [
                const Text('My vehicles',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                Text('MOT and tax dates come from the DVLA automatically',
                    style: TextStyle(color: context.mq.muted, fontSize: 13)),
                const SizedBox(height: 16),
                if (vehicles.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 60),
                    child: Center(
                      child: Text(
                        'No vehicles yet.\nAdd your registration and we\'ll fetch your\n'
                        'MOT and tax dates and remind you automatically.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                else
                  ...vehicles.map((v) => _VehicleCard(
                        vehicle: v,
                        onEdit: () => _openForm(existing: v),
                        onDelete: () => _delete(v),
                        onRefresh: () => _refresh(v),
                      )),
              ],
            ),
          );
        },
      ),
    );
  }

}

IconData _iconFor(String fuel) =>
    fuel == 'ELECTRIC' ? Icons.electric_car : Icons.directions_car;

String _fuelLabel(String f) => switch (f) {
      'PLUGIN_HYBRID' => 'Plug-in hybrid',
      'ELECTRIC' => 'Electric',
      _ => f[0] + f.substring(1).toLowerCase(),
    };

/// A vehicle with its MOT and tax status pulled from government data.
class _VehicleCard extends StatelessWidget {
  const _VehicleCard({
    required this.vehicle,
    required this.onEdit,
    required this.onDelete,
    required this.onRefresh,
  });

  final Vehicle vehicle;
  final VoidCallback onEdit;
  final VoidCallback onDelete;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final v = vehicle;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onEdit,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: context.mq.accent.withValues(alpha: 0.1),
                      child: Icon(_iconFor(v.fuelType), color: context.mq.accent),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(v.registration,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w800, fontSize: 16, letterSpacing: 0.5)),
                          Text(
                            [
                              if (v.label.isNotEmpty) v.label,
                              if (v.colour != null) v.colour!,
                              _fuelLabel(v.fuelType),
                              if (v.mileage != null) '${v.mileage} mi',
                            ].join('  •  '),
                            style: TextStyle(color: context.mq.muted, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh from DVLA',
                      icon: const Icon(Icons.sync, size: 20),
                      onPressed: onRefresh,
                    ),
                    IconButton(
                      tooltip: 'Delete',
                      icon: const Icon(Icons.delete_outline, size: 20),
                      onPressed: onDelete,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _DateChip(
                        label: 'MOT',
                        date: v.motExpiryDate,
                        status: v.motStatus,
                        // No MOT history is normal for a car under 3 years old.
                        emptyHint: 'No MOT data',
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _DateChip(
                        label: 'Tax',
                        date: v.taxDueDate,
                        status: v.taxStatus,
                        emptyHint: 'No tax data',
                      ),
                    ),
                  ],
                ),
                if (v.insuranceRenewalDate != null || v.serviceDueDate != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: _DateChip(
                          label: 'Insurance',
                          date: v.insuranceRenewalDate,
                          emptyHint: 'Not set',
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: _DateChip(
                          label: 'Service',
                          date: v.serviceDueDate,
                          emptyHint: 'Not set',
                        ),
                      ),
                    ],
                  ),
                ],
                if (v.dvlaSyncError != null) ...[
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(Icons.info_outline, size: 13, color: context.mq.warningFg),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(v.dvlaSyncError!,
                            style: TextStyle(fontSize: 11, color: context.mq.warningFg)),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A due date with urgency colouring — red once overdue, amber within 30 days.
class _DateChip extends StatelessWidget {
  const _DateChip({
    required this.label,
    required this.date,
    required this.emptyHint,
    this.status,
  });

  final String label;
  final DateTime? date;
  final String? status;
  final String emptyHint;

  @override
  Widget build(BuildContext context) {
    final d = date;
    if (d == null) {
      return _box(
        color: context.mq.border,
        fg: context.mq.muted,
        title: label,
        value: status ?? emptyHint,
      );
    }

    final days = d.difference(DateTime.now()).inDays;
    final (Color bg, Color fg) = switch (days) {
      < 0 => (context.mq.dangerBg, context.mq.dangerFg), // overdue
      < 30 => (context.mq.warningBg, context.mq.warningFg), // due soon
      _ => (context.mq.successBg, context.mq.successFg), // fine
    };

    final when = days < 0
        ? 'Expired ${_fmt(d)}'
        : days == 0
            ? 'Due today'
            : days < 30
                ? '$days day${days == 1 ? '' : 's'} — ${_fmt(d)}'
                : _fmt(d);

    return _box(color: bg, fg: fg, title: label, value: when);
  }

  Widget _box({
    required Color color,
    required Color fg,
    required String title,
    required String value,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title,
              style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, color: fg)),
          const SizedBox(height: 1),
          Text(value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, color: fg)),
        ],
      ),
    );
  }

  static String _fmt(DateTime d) => DateFormat('d MMM yyyy').format(d);
}

class _VehicleForm extends StatefulWidget {
  const _VehicleForm({required this.repo, this.existing});
  final VehicleRepository repo;
  final Vehicle? existing;

  @override
  State<_VehicleForm> createState() => _VehicleFormState();
}

class _VehicleFormState extends State<_VehicleForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _reg;
  late final TextEditingController _make;
  late final TextEditingController _model;
  late final TextEditingController _year;
  late final TextEditingController _mileage;
  late String _fuelType;
  bool _busy = false;

  // Member-entered dates: no public API publishes either (see backend
  // integrations/dvla/dvla.client.ts for why).
  DateTime? _insuranceRenewal;
  DateTime? _serviceDue;

  bool _looking = false;
  VehicleLookup? _lookup;

  @override
  void initState() {
    super.initState();
    final e = widget.existing;
    _reg = TextEditingController(text: e?.registration ?? '');
    _make = TextEditingController(text: e?.make ?? '');
    _model = TextEditingController(text: e?.model ?? '');
    _year = TextEditingController(text: e?.year?.toString() ?? '');
    _mileage = TextEditingController(text: e?.mileage?.toString() ?? '');
    _fuelType = e?.fuelType ?? 'PETROL';
    _insuranceRenewal = e?.insuranceRenewalDate;
    _serviceDue = e?.serviceDueDate;
  }

  /// Ask the DVLA what this registration is, and fill the form in.
  Future<void> _lookupReg() async {
    final reg = _reg.text.trim();
    if (reg.length < 2) return;
    setState(() => _looking = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final r = await widget.repo.lookup(reg);
      if (!mounted) return;
      setState(() {
        _lookup = r;
        _looking = false;
        if (r.make != null) _make.text = r.make!;
        if (r.model != null) _model.text = r.model!;
        if (r.year != null) _year.text = r.year!.toString();
        if (r.mileage != null && _mileage.text.isEmpty) {
          _mileage.text = r.mileage!.toString();
        }
        final f = _mapFuel(r.fuelType);
        if (f != null) _fuelType = f;
      });
      if (!r.found) {
        messenger.showSnackBar(
          SnackBar(content: Text(r.error ?? "Couldn't find that registration")),
        );
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _looking = false);
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  /// DVLA fuel descriptions don't match our enum ("ELECTRICITY" vs ELECTRIC).
  static String? _mapFuel(String? raw) {
    if (raw == null) return null;
    final v = raw.toUpperCase();
    if (v.contains('ELECTRIC')) return 'ELECTRIC';
    if (v.contains('DIESEL')) return 'DIESEL';
    if (v.contains('PLUG')) return 'PLUGIN_HYBRID';
    if (v.contains('HYBRID')) return 'HYBRID';
    if (v.contains('GAS') || v.contains('LPG')) return 'LPG';
    if (v.contains('PETROL')) return 'PETROL';
    return null;
  }

  Future<void> _pickDate({required bool insurance}) async {
    final now = DateTime.now();
    final initial = (insurance ? _insuranceRenewal : _serviceDue) ?? now;
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(now.year - 1),
      lastDate: DateTime(now.year + 6),
    );
    if (picked == null) return;
    setState(() {
      if (insurance) {
        _insuranceRenewal = picked;
      } else {
        _serviceDue = picked;
      }
    });
  }

  @override
  void dispose() {
    _reg.dispose();
    _make.dispose();
    _model.dispose();
    _year.dispose();
    _mileage.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _busy = true);
    final body = <String, dynamic>{
      'registration': _reg.text.trim(),
      if (_make.text.trim().isNotEmpty) 'make': _make.text.trim(),
      if (_model.text.trim().isNotEmpty) 'model': _model.text.trim(),
      if (_year.text.trim().isNotEmpty) 'year': int.tryParse(_year.text.trim()),
      'fuelType': _fuelType,
      if (_mileage.text.trim().isNotEmpty)
        'mileage': int.tryParse(_mileage.text.trim()),
    };
    // Only send these when editing: POST /vehicles doesn't accept them, and
    // sending null would wipe a date the member set earlier.
    if (widget.existing != null) {
      if (_insuranceRenewal != null) {
        body['insuranceRenewalDate'] = _insuranceRenewal!.toIso8601String();
      }
      if (_serviceDue != null) {
        body['serviceDueDate'] = _serviceDue!.toIso8601String();
      }
    }
    try {
      if (widget.existing == null) {
        await widget.repo.create(body);
      } else {
        await widget.repo.update(widget.existing!.id, body);
      }
      if (mounted) Navigator.pop(context, true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + bottom),
      child: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(widget.existing == null ? 'Add vehicle' : 'Edit vehicle',
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              TextFormField(
                controller: _reg,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(
                  labelText: 'Registration',
                  helperText: 'We fetch your MOT & tax dates from the DVLA',
                  suffixIcon: _looking
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2)),
                        )
                      : IconButton(
                          tooltip: 'Look up',
                          icon: const Icon(Icons.search),
                          onPressed: _lookupReg,
                        ),
                ),
                // Looking up on submit rather than on every keystroke: the DVLA
                // rate-limits, and a half-typed plate is never a real vehicle.
                onFieldSubmitted: (_) => _lookupReg(),
                validator: (v) =>
                    (v == null || v.trim().length < 2) ? 'Required' : null,
              ),
              if (_lookup != null && _lookup!.found) ...[
                const SizedBox(height: 10),
                _LookupResult(lookup: _lookup!),
              ],
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: TextFormField(
                    controller: _make,
                    decoration: const InputDecoration(labelText: 'Make'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _model,
                    decoration: const InputDecoration(labelText: 'Model'),
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(
                  child: TextFormField(
                    controller: _year,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Year'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextFormField(
                    controller: _mileage,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: 'Mileage'),
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _fuelType,
                decoration: const InputDecoration(labelText: 'Fuel type'),
                items: _fuelTypes
                    .map((f) => DropdownMenuItem(value: f, child: Text(f)))
                    .toList(),
                onChanged: (v) => setState(() => _fuelType = v ?? 'PETROL'),
              ),
              // Only on edit: POST /vehicles doesn't take these, and the
              // vehicle must exist before there's anything to attach them to.
              if (widget.existing != null) ...[
                const SizedBox(height: 20),
                Row(
                  children: [
                    Icon(Icons.edit_calendar, size: 15, color: context.mq.muted),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        'Insurance and service dates aren\'t published by any '
                        'public API, so add them yourself and we\'ll remind you.',
                        style: TextStyle(fontSize: 11.5, color: context.mq.muted),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _DateField(
                  label: 'Insurance renewal',
                  date: _insuranceRenewal,
                  onTap: () => _pickDate(insurance: true),
                  onClear: () => setState(() => _insuranceRenewal = null),
                ),
                const SizedBox(height: 10),
                _DateField(
                  label: 'Next service due',
                  date: _serviceDue,
                  onTap: () => _pickDate(insurance: false),
                  onClear: () => setState(() => _serviceDue = null),
                ),
              ],
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _busy ? null : _save,
                child: _busy
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Text('Save'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// What the DVLA returned for a registration, shown inline in the add form so
/// the member can confirm it's actually their car before saving.
class _LookupResult extends StatelessWidget {
  const _LookupResult({required this.lookup});
  final VehicleLookup lookup;

  @override
  Widget build(BuildContext context) {
    final l = lookup;
    final mock = l.source == 'mock';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: mock ? context.mq.warningBg : context.mq.successBg,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(mock ? Icons.science_outlined : Icons.verified,
                  size: 15, color: mock ? context.mq.warningFg : context.mq.successFg),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  mock ? 'Sample data (DVLA not connected)' : 'Found at the DVLA',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: mock ? context.mq.warningFg : context.mq.successFg,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            [
              if (l.label.isNotEmpty) l.label,
              if (l.colour != null) l.colour!,
              if (l.year != null) '${l.year}',
            ].join(' · '),
            style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
          ),
          if (l.motExpiryDate != null)
            Text('MOT expires ${DateFormat('d MMM yyyy').format(l.motExpiryDate!)}',
                style: const TextStyle(fontSize: 12)),
          if (l.taxDueDate != null)
            Text('Tax due ${DateFormat('d MMM yyyy').format(l.taxDueDate!)}',
                style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}

/// A tappable date field with a clear button.
class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.date,
    required this.onTap,
    required this.onClear,
  });

  final String label;
  final DateTime? date;
  final VoidCallback onTap;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          suffixIcon: date == null
              ? const Icon(Icons.calendar_today, size: 18)
              : IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: onClear,
                ),
        ),
        child: Text(
          date == null ? 'Not set' : DateFormat('d MMM yyyy').format(date!),
          style: TextStyle(
            fontSize: 15,
            color: date == null ? context.mq.muted : null,
          ),
        ),
      ),
    );
  }
}
