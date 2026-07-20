import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

class ReferralsScreen extends StatefulWidget {
  const ReferralsScreen({super.key});

  @override
  State<ReferralsScreen> createState() => _ReferralsScreenState();
}

class _ReferralsScreenState extends State<ReferralsScreen> {
  late final ReferralRepository _repo;
  Future<List<Referral>>? _future;

  @override
  void initState() {
    super.initState();
    _repo = ReferralRepository(context.read<ApiClient>());
    _load();
  }

  void _load() {
    // Statement body on purpose: an arrow here returns the assigned
    // Future, and setState asserts on a callback that returns one.
    setState(() {
      _future = _repo.list();
    });
  }

  Future<void> _create() async {
    try {
      await _repo.create();
      _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Refer a friend')),
      body: FutureBuilder<List<Referral>>(
        future: _future,
        builder: (context, snap) {
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [context.mq.money, kBrandDark]),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Give £10, get £10',
                        style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
                    SizedBox(height: 6),
                    Text('Share your code. When a friend joins SaveOnDrive, you both get £10 in your wallet.',
                        style: TextStyle(color: Colors.white70)),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _create,
                icon: const Icon(Icons.add),
                label: const Text('Generate a new code'),
              ),
              const SizedBox(height: 16),
              if (snap.hasData && snap.data!.isNotEmpty)
                ...snap.data!.map((r) => _CodeCard(referral: r))
              else if (snap.connectionState == ConnectionState.done)
                const Padding(
                  padding: EdgeInsets.only(top: 40),
                  child: Center(child: Text('No codes yet — generate one above.')),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.referral});
  final Referral referral;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Icon(Icons.confirmation_number, color: context.mq.money),
        title: Text(referral.code, style: const TextStyle(fontWeight: FontWeight.w800, letterSpacing: 1)),
        subtitle: Text('Reward ${formatMinor(referral.rewardMinor)} · ${referral.status}'),
        trailing: IconButton(
          icon: const Icon(Icons.copy),
          onPressed: () {
            Clipboard.setData(ClipboardData(text: referral.code));
            ScaffoldMessenger.of(context)
                .showSnackBar(const SnackBar(content: Text('Code copied')));
          },
        ),
      ),
    );
  }
}
