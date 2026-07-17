// Smoke tests for the MOTORIQ app shell.
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:motoriq_app/main.dart';
import 'package:motoriq_app/services/api_client.dart';
import 'package:motoriq_app/state/theme_state.dart';
import 'package:motoriq_app/theme.dart';

void main() {
  // flutter_secure_storage talks to the Keychain, which doesn't exist in a
  // test binding; stub the channel so ThemeState.load() resolves instead of
  // throwing and taking the test with it.
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  testWidgets('App boots to a MaterialApp', (tester) async {
    await tester.pumpWidget(
      MotoriqApp(api: ApiClient(), themeState: ThemeState(const FlutterSecureStorage())),
    );
    expect(find.byType(MaterialApp), findsOneWidget);
  });

  testWidgets('Both themes are wired up, and the mode is honoured', (tester) async {
    final themeState = ThemeState(const FlutterSecureStorage());
    await tester.pumpWidget(MotoriqApp(api: ApiClient(), themeState: themeState));

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.theme, isNotNull, reason: 'light theme must exist');
    expect(app.darkTheme, isNotNull, reason: 'dark theme must exist');
    expect(app.themeMode, ThemeMode.system, reason: 'defaults to following the phone');

    await themeState.setMode(ThemeMode.dark);
    await tester.pump();
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
      ThemeMode.dark,
      reason: 'choosing dark must reach MaterialApp',
    );
  });

  group('theme tokens', () {
    test('both themes carry the MotoriqColors extension', () {
      // Every screen reads colours through this. If it were ever missing, the
      // `context.mq` lookup would throw at runtime rather than fail here.
      for (final b in [Brightness.light, Brightness.dark]) {
        final theme = buildTheme(brightness: b);
        expect(theme.extension<MotoriqColors>(), isNotNull, reason: '$b needs tokens');
      }
    });

    test('dark is genuinely dark, light is genuinely light', () {
      expect(buildTheme().brightness, Brightness.light);
      expect(buildTheme(brightness: Brightness.dark).brightness, Brightness.dark);
      final darkBg = buildTheme(brightness: Brightness.dark).scaffoldBackgroundColor;
      final lightBg = buildTheme().scaffoldBackgroundColor;
      expect(darkBg.computeLuminance(), lessThan(0.1));
      expect(lightBg.computeLuminance(), greaterThan(0.8));
    });

    test('brand accents stay legible as small text on their own ground', () {
      // 4.5:1, not 3:1. These tokens carry *small* text — the accent sets the
      // 12.5px "Save £8.33 vs average" line, muted sets every caption — and
      // WCAG's 3:1 allowance is only for large text and UI shapes.
      //
      // This is exactly why the dark variants exist. Raw #1F6FEB on the dark
      // card measures 3.52:1: fine for a big shape, too low for a caption.
      // The lifted #5B9BFF reaches 5.89:1.
      for (final b in [Brightness.light, Brightness.dark]) {
        final theme = buildTheme(brightness: b);
        final t = theme.extension<MotoriqColors>()!;
        final surface = theme.cardTheme.color!;
        expect(_contrast(t.accent, surface), greaterThanOrEqualTo(4.5),
            reason: '$b: accent sets small text on cards');
        expect(_contrast(t.money, surface), greaterThanOrEqualTo(4.5),
            reason: '$b: money sets small text on cards');
        expect(_contrast(t.muted, surface), greaterThanOrEqualTo(4.5),
            reason: '$b: muted is the caption colour');
      }
    });

    test('the raw brand blue would fail as caption text on dark', () {
      // Guards the reasoning above: if someone "simplifies" MotoriqColors.dark
      // back to the raw brand blue, this fails and says why.
      const rawBrandOnDarkCard = 3.52;
      expect(_contrast(kBrandBlue, const Color(0xFF0C2136)), lessThan(4.5),
          reason: 'raw brand blue measures ~$rawBrandOnDarkCard:1 on the dark '
              'card — below the 4.5:1 small text needs. Hence _brandBlueDark.');
    });

    test('status foregrounds are legible on their own beds', () {
      // Status text is small too — a banner reading "Location is turned off"
      // is 12–13px.
      for (final b in [Brightness.light, Brightness.dark]) {
        final t = buildTheme(brightness: b).extension<MotoriqColors>()!;
        expect(_contrast(t.successFg, t.successBg), greaterThanOrEqualTo(4.5), reason: '$b success');
        expect(_contrast(t.warningFg, t.warningBg), greaterThanOrEqualTo(4.5), reason: '$b warning');
        expect(_contrast(t.dangerFg, t.dangerBg), greaterThanOrEqualTo(4.5), reason: '$b danger');
      }
    });
  });
}

/// WCAG relative-contrast ratio between two opaque colours.
double _contrast(Color a, Color b) {
  final l1 = a.computeLuminance();
  final l2 = b.computeLuminance();
  final hi = l1 > l2 ? l1 : l2;
  final lo = l1 > l2 ? l2 : l1;
  return (hi + 0.05) / (lo + 0.05);
}
