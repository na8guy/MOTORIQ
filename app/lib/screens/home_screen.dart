import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/auth_state.dart';
import 'dashboard_tab.dart';
import 'wallet_tab.dart';
import 'vehicles_tab.dart';
import 'fuel_tab.dart';
import 'more_tab.dart';

/// Tab indices, so callers say what they mean rather than passing a bare int.
abstract final class HomeTab {
  static const dashboard = 0;
  static const wallet = 1;
  static const fuel = 2;
  static const vehicles = 3;
  static const more = 4;
}

/// Lets any descendant jump to a tab — e.g. the dashboard's "Find cheaper fuel"
/// card opening the Fuel tab. Without this the tiles were decoration: they had
/// no onTap at all, so tapping them did nothing.
class HomeNav extends InheritedWidget {
  const HomeNav({super.key, required this.goToTab, required super.child});

  /// Switch tabs. `evOnly` pre-selects EV charging on the Fuel tab.
  final void Function(int index, {bool evOnly}) goToTab;

  static HomeNav of(BuildContext context) {
    final nav = context.dependOnInheritedWidgetOfExactType<HomeNav>();
    assert(nav != null, 'HomeNav.of() called outside HomeScreen');
    return nav!;
  }

  @override
  bool updateShouldNotify(HomeNav oldWidget) => false;
}

/// Set when the user asks for EV charging specifically, so the Fuel tab can
/// open straight into EV mode. A notifier (not a constructor arg) because the
/// tabs live in a const IndexedStack and must not be rebuilt to pass a flag.
final evOnlyRequest = ValueNotifier<bool>(false);

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  static const _tabs = [
    DashboardTab(),
    WalletTab(),
    FuelTab(),
    VehiclesTab(),
    MoreTab(),
  ];

  void _goToTab(int index, {bool evOnly = false}) {
    if (evOnly) evOnlyRequest.value = true;
    setState(() => _index = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: HomeNav(
          goToTab: _goToTab,
          child: IndexedStack(index: _index, children: _tabs),
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.dashboard_outlined),
              selectedIcon: Icon(Icons.dashboard),
              label: 'Home'),
          NavigationDestination(
              icon: Icon(Icons.account_balance_wallet_outlined),
              selectedIcon: Icon(Icons.account_balance_wallet),
              label: 'Wallet'),
          NavigationDestination(
              icon: Icon(Icons.local_gas_station_outlined),
              selectedIcon: Icon(Icons.local_gas_station),
              label: 'Fuel'),
          NavigationDestination(
              icon: Icon(Icons.directions_car_outlined),
              selectedIcon: Icon(Icons.directions_car),
              label: 'Vehicles'),
          NavigationDestination(
              icon: Icon(Icons.grid_view_outlined),
              selectedIcon: Icon(Icons.grid_view),
              label: 'More'),
        ],
      ),
    );
  }
}

/// Shared app bar action to sign out.
class SignOutButton extends StatelessWidget {
  const SignOutButton({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Sign out',
      icon: const Icon(Icons.logout),
      onPressed: () => context.read<AuthState>().logout(),
    );
  }
}
