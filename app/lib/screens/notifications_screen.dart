import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../models/models.dart';
import '../services/api_client.dart';
import '../services/repositories.dart';
import '../theme.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final NotificationRepository _repo;
  Future<({int unread, List<AppNotification> items})>? _future;

  @override
  void initState() {
    super.initState();
    _repo = NotificationRepository(context.read<ApiClient>());
    _load();
  }

  void _load() {
    // Statement body on purpose: an arrow here returns the assigned
    // Future, and setState asserts on a callback that returns one.
    setState(() {
      _future = _repo.inbox();
    });
  }

  Future<void> _markAll() async {
    await _repo.markAllRead();
    _load();
  }

  IconData _iconFor(String type) => switch (type) {
        'KYC' => Icons.verified_user,
        'RISK' => Icons.gpp_maybe,
        'WALLET' => Icons.account_balance_wallet,
        'FUEL' => Icons.local_gas_station,
        'MARKETING' => Icons.campaign,
        _ => Icons.notifications,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [TextButton(onPressed: _markAll, child: const Text('Mark all read'))],
      ),
      body: RefreshIndicator(
        onRefresh: () async => _load(),
        child: FutureBuilder<({int unread, List<AppNotification> items})>(
          future: _future,
          builder: (context, snap) {
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!.items;
            if (items.isEmpty) {
              return ListView(children: const [
                Padding(padding: EdgeInsets.only(top: 80), child: Center(child: Text('No notifications'))),
              ]);
            }
            return ListView(
              padding: const EdgeInsets.all(16),
              children: items.map((n) => _NotifTile(n: n, icon: _iconFor(n.type))).toList(),
            );
          },
        ),
      ),
    );
  }
}

class _NotifTile extends StatelessWidget {
  const _NotifTile({required this.n, required this.icon});
  final AppNotification n;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: n.read ? null : context.mq.accent.withValues(alpha: 0.04),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: context.mq.accent.withValues(alpha: 0.12),
          child: Icon(icon, color: context.mq.accent, size: 20),
        ),
        title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700)),
        subtitle: Text(n.body),
        trailing: Text(
          DateFormat('d MMM').format(n.createdAt),
          style: TextStyle(color: context.mq.faint, fontSize: 12),
        ),
        isThreeLine: n.body.length > 40,
      ),
    );
  }
}
