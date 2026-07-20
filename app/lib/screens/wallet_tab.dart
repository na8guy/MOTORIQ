import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../state/auth_state.dart';
import '../theme.dart';

class WalletTab extends StatefulWidget {
  const WalletTab({super.key});

  @override
  State<WalletTab> createState() => _WalletTabState();
}

class _WalletTabState extends State<WalletTab> {
  late final WalletRepository _repo;
  Future<Wallet>? _future;
  List<PaymentCard> _cards = [];

  @override
  void initState() {
    super.initState();
    _repo = WalletRepository(context.read<ApiClient>());
    // Same as vehicles: setState() inside initState() throws. Assign the
    // future directly and let the first build pick it up.
    _future = _repo.get();
    _loadCards();
  }

  /// Cards are a paid perk, so a free member gets a 402 here. That is an
  /// ordinary answer, not an error — swallow it and show no cards.
  void _loadCards() {
    _repo.cards().then((c) {
      if (mounted) setState(() => _cards = c);
    }).catchError((_) {});
  }

  void _load() {
    setState(() => _future = _repo.get());
    _loadCards();
  }

  Future<void> _topUp() async {
    final amount = await showModalBottomSheet<double>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _TopUpSheet(),
    );
    if (amount == null) return;
    try {
      await _repo.topUp(amount);
      if (!mounted) return;
      _load();
      await context.read<AuthState>().refreshUser();
      _snack('Added ${formatMinor((amount * 100).round())} to your wallet');
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  Future<void> _issueCard() async {
    try {
      final card = await _repo.issueCard();
      if (!mounted) return;
      setState(() => _cards = [card, ..._cards]);
      _snack('SaveOnDrive Mastercard issued •••• ${card.last4 ?? ''}');
    } on ApiException catch (e) {
      _snack(e.message);
    }
  }

  void _snack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Wallet>(
      future: _future,
      builder: (context, snap) {
        return RefreshIndicator(
          onRefresh: () async => _load(),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
            children: [
              const Text('Wallet',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              if (snap.connectionState == ConnectionState.waiting)
                const Padding(
                  padding: EdgeInsets.all(40),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (snap.hasError)
                _ErrorCard(message: '${snap.error}', onRetry: _load)
              else if (snap.hasData) ...[
                _BalanceCard(
                  wallet: snap.data!,
                  onTopUp: _topUp,
                ),
                const SizedBox(height: 20),
                _CardsSection(cards: _cards, onIssue: _issueCard),
                const SizedBox(height: 20),
                const Text('Recent activity',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                if (snap.data!.transactions.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 24),
                    child: Center(child: Text('No transactions yet')),
                  )
                else
                  ...snap.data!.transactions.map((t) => _TxnTile(txn: t)),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.wallet, required this.onTopUp});
  final Wallet wallet;
  final VoidCallback onTopUp;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: [kBrandDark, context.mq.accent]),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Available balance',
              style: TextStyle(color: Colors.white70)),
          const SizedBox(height: 6),
          Text(formatMinor(wallet.balanceMinor),
              style: const TextStyle(
                  color: Colors.white,
                  fontSize: 36,
                  fontWeight: FontWeight.w800)),
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: kBrandDark,
            ),
            onPressed: onTopUp,
            icon: const Icon(Icons.add),
            label: const Text('Top up'),
          ),
        ],
      ),
    );
  }
}

class _CardsSection extends StatelessWidget {
  const _CardsSection({required this.cards, required this.onIssue});
  final List<PaymentCard> cards;
  final VoidCallback onIssue;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text('SaveOnDrive Mastercard',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            TextButton.icon(
              onPressed: onIssue,
              icon: const Icon(Icons.add_card, size: 18),
              label: const Text('Issue'),
            ),
          ],
        ),
        if (cards.isEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(children: [
                const Icon(Icons.credit_card_off, color: Colors.grey),
                const SizedBox(width: 12),
                Expanded(
                  child: Text('No card yet — issue a virtual Mastercard to spend your wallet.',
                      style: TextStyle(color: context.mq.muted)),
                ),
              ]),
            ),
          )
        else
          ...cards.map((c) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Card(
                  child: ListTile(
                    leading: Icon(Icons.credit_card, color: context.mq.accent),
                    title: Text('${c.brand} •••• ${c.last4 ?? '----'}'),
                    subtitle: Text('Expires ${c.expiryMonth ?? '--'}/${c.expiryYear ?? '--'}'),
                    trailing: Chip(
                      label: Text(c.status),
                      backgroundColor: c.status == 'ACTIVE'
                          ? context.mq.money.withValues(alpha: 0.12)
                          : Colors.orange.withValues(alpha: 0.12),
                    ),
                  ),
                ),
              )),
      ],
    );
  }
}

class _TxnTile extends StatelessWidget {
  const _TxnTile({required this.txn});
  final WalletTxn txn;

  @override
  Widget build(BuildContext context) {
    final credit = txn.amountMinor >= 0;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: (credit ? context.mq.money : Colors.redAccent)
              .withValues(alpha: 0.12),
          child: Icon(credit ? Icons.arrow_downward : Icons.arrow_upward,
              color: credit ? context.mq.money : Colors.redAccent, size: 20),
        ),
        title: Text(txn.description ?? txn.type),
        subtitle: Text(txn.type),
        trailing: Text(
          '${credit ? '+' : ''}${formatMinor(txn.amountMinor)}',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            color: credit ? context.mq.money : Colors.redAccent,
          ),
        ),
      ),
    );
  }
}

class _TopUpSheet extends StatefulWidget {
  const _TopUpSheet();

  @override
  State<_TopUpSheet> createState() => _TopUpSheetState();
}

class _TopUpSheetState extends State<_TopUpSheet> {
  final _controller = TextEditingController(text: '25');

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
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
          const Text('Top up wallet',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [10, 25, 50, 100]
                .map((v) => ActionChip(
                      label: Text('£$v'),
                      onPressed: () => _controller.text = '$v',
                    ))
                .toList(),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _controller,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: const InputDecoration(
                labelText: 'Amount', prefixText: '£ '),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(_controller.text.trim());
              if (v == null || v <= 0) return;
              Navigator.pop(context, v);
            },
            child: const Text('Add funds'),
          ),
        ],
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
