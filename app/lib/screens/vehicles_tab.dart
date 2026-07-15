import 'package:flutter/material.dart';
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
    _load();
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
            return Center(child: Text('${snap.error}'));
          }
          final vehicles = snap.data ?? [];
          return RefreshIndicator(
            onRefresh: () async => _load(),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 96),
              children: [
                const Text('My vehicles',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                if (vehicles.isEmpty)
                  const Padding(
                    padding: EdgeInsets.only(top: 80),
                    child: Center(
                        child: Text('No vehicles yet. Add one to get reminders.')),
                  )
                else
                  ...vehicles.map((v) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: kBrandBlue.withValues(alpha: 0.1),
                              child: Icon(_iconFor(v.fuelType), color: kBrandBlue),
                            ),
                            title: Text(v.registration,
                                style:
                                    const TextStyle(fontWeight: FontWeight.w700)),
                            subtitle: Text([
                              if (v.label.isNotEmpty) v.label,
                              _fuelLabel(v.fuelType),
                              if (v.mileage != null) '${v.mileage} mi',
                            ].join('  •  ')),
                            onTap: () => _openForm(existing: v),
                            trailing: IconButton(
                              icon: const Icon(Icons.delete_outline),
                              onPressed: () => _delete(v),
                            ),
                          ),
                        ),
                      )),
              ],
            ),
          );
        },
      ),
    );
  }

  static IconData _iconFor(String fuel) =>
      fuel == 'ELECTRIC' ? Icons.electric_car : Icons.directions_car;

  static String _fuelLabel(String f) => switch (f) {
        'PLUGIN_HYBRID' => 'Plug-in hybrid',
        'ELECTRIC' => 'Electric',
        _ => f[0] + f.substring(1).toLowerCase(),
      };
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
                decoration: const InputDecoration(labelText: 'Registration'),
                validator: (v) =>
                    (v == null || v.trim().length < 2) ? 'Required' : null,
              ),
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
