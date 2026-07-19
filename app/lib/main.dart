import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:provider/provider.dart';

import 'app_config.dart';
import 'services/api_client.dart';
import 'state/auth_state.dart';
import 'state/theme_state.dart';
import 'theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/splash_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppConfig.loadOverride(); // apply any saved API URL before first request

  // Read the saved theme BEFORE the first frame, otherwise a dark-mode member
  // gets a white flash on every launch while it loads.
  final themeState = ThemeState(const FlutterSecureStorage());
  await themeState.load();

  runApp(SaveOnDriveApp(api: ApiClient(), themeState: themeState));
}

class SaveOnDriveApp extends StatelessWidget {
  const SaveOnDriveApp({super.key, required this.api, required this.themeState});
  final ApiClient api;
  final ThemeState themeState;

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: api),
        ChangeNotifierProvider(create: (_) => AuthState(api)..bootstrap()),
        ChangeNotifierProvider.value(value: themeState),
      ],
      child: Consumer<ThemeState>(
        builder: (context, theme, _) => MaterialApp(
          title: 'SaveOnDrive',
          debugShowCheckedModeBanner: false,
          theme: buildTheme(),
          darkTheme: buildTheme(brightness: Brightness.dark),
          themeMode: theme.mode,
          home: const _Root(),
        ),
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
        return const SplashScreen();
      case AuthStatus.authenticated:
        return const HomeScreen();
      case AuthStatus.unauthenticated:
        return const LoginScreen();
    }
  }
}
