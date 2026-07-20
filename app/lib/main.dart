import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'app_config.dart';
import 'services/api_client.dart';
import 'state/auth_state.dart';
import 'state/theme_state.dart';
import 'theme.dart';
import 'screens/login_screen.dart';
import 'screens/home_screen.dart';
import 'screens/splash_screen.dart';

/// App entry point.
///
/// ── WHY NOTHING IS AWAITED BEFORE runApp ──
/// This used to `await` two Keychain reads before the first frame. That is a
/// launch-time crash waiting to happen for two separate reasons:
///
///   1. iOS kills an app that takes too long to produce its first frame
///      (the watchdog, 0x8badf00d). Blocking startup on Keychain I/O is
///      exactly the kind of thing that trips it — intermittently, on a cold
///      start, which is why it "sometimes works and sometimes crashes".
///
///   2. The Keychain is unreadable while the device is locked unless the item
///      says otherwise, so those reads could fail or stall outright.
///
/// So the app now starts immediately and loads preferences in the background.
/// The splash screen already existed for precisely this gap, and ThemeState
/// notifies when the saved theme arrives — a few frames of the system theme is
/// a far better outcome than a launch that dies.
void main() {
  // runZonedGuarded wraps everything so an uncaught async error is logged
  // rather than tearing the isolate down. A background failure — a stray
  // network timeout, a plugin throwing — should never kill a running app.
  runZonedGuarded(
    () {
      WidgetsFlutterBinding.ensureInitialized();

      // Any framework-level build/layout error: log it and keep going.
      FlutterError.onError = (details) {
        FlutterError.presentError(details);
        debugPrint('[flutter-error] ${details.exceptionAsString()}');
      };

      // Errors from the engine that never reach the framework.
      ui.PlatformDispatcher.instance.onError = (error, stack) {
        debugPrint('[platform-error] $error');
        return true; // handled — do not terminate
      };

      // In release, show a plain apology instead of the grey/red error box.
      // A member should never be shown a stack trace.
      ErrorWidget.builder = (details) {
        if (kDebugMode) return ErrorWidget(details.exception);
        return const _FriendlyError();
      };

      final themeState = ThemeState();
      // Deliberately NOT awaited — see the note above.
      unawaited(AppConfig.loadOverride());
      unawaited(themeState.load());

      runApp(SaveOnDriveApp(api: ApiClient(), themeState: themeState));
    },
    (error, stack) {
      debugPrint('[uncaught] $error\n$stack');
    },
  );
}

/// Shown in place of a widget that failed to build, in release builds.
class _FriendlyError extends StatelessWidget {
  const _FriendlyError();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF6F8FB),
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 40, color: Color(0xFF5A6B84)),
              const SizedBox(height: 12),
              const Text(
                "Something didn't load",
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              const Text(
                'Pull down to refresh, or reopen the app.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Color(0xFF5A6B84)),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
