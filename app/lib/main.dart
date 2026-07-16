import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_config.dart';
import 'services/api_client.dart';
import 'state/auth_state.dart';
import 'theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.loadOverride(); // apply any saved API URL before first request
  runApp(MotoriqApp(api: ApiClient()));
}

class MotoriqApp extends StatelessWidget {
  const MotoriqApp({super.key, required this.api});
  final ApiClient api;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: api),
        ChangeNotifierProvider(create: (_) => AuthState(api)..bootstrap()),
      ],
      child: MaterialApp(
        title: 'MOTORIQ',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const _Root(),
      ),
    );
  }
}

/// Chooses the login or home screen based on auth status.
class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final status = context.watch<AuthState>().status;
    switch (status) {
      case AuthStatus.unknown:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case AuthStatus.authenticated:
        return const HomeScreen();
      case AuthStatus.unauthenticated:
        return const LoginScreen();
    }
  }
}
