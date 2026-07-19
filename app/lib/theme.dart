import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// SaveOnDrive brand theme.
///
/// The brand colours are fixed, but they can't be used raw on both grounds:
/// #1F6FEB is sized for white paper and goes muddy on navy, and #16A34A loses
/// too much contrast to read as "money" in the dark. So each has a dark-ground
/// counterpart — same hue, lifted for legibility. Everything else is a semantic
/// token on [SaveOnDriveColors], never a literal in a widget, so a screen can't
/// look right in one theme and broken in the other.
const kBrandBlue = Color(0xFF1F6FEB);
const kBrandDark = Color(0xFF0B2545);
const kBrandGreen = Color(0xFF16A34A);

/// Brand colours lifted for dark grounds (same hue, more luminance).
///
/// Raw #1F6FEB manages only 3.5:1 on the dark card — fine for a large shape,
/// too low for the 12px captions the accent actually sets.
const _brandBlueDark = Color(0xFF5B9BFF);
const _brandGreenDark = Color(0xFF34D07F);

/// Brand green, darkened for small text on white.
///
/// #16A34A is the brand fill colour and stays that — but as *text* on a white
/// card it manages only 3.30:1, under the 4.5:1 small text needs, and the
/// savings line ("Save £8.33 vs average") is 12.5px. This is the same hue one
/// step darker, at 5.02:1. Use kBrandGreen for fills and icons; use the `money`
/// token for anything a member has to read.
const _brandGreenText = Color(0xFF15803D);

/// Semantic colours the brand palette doesn't cover.
///
/// Reach for these instead of `Colors.grey.shade600` or a raw hex: those look
/// deliberate in light mode and accidental in dark. Status colours (success /
/// warning / danger) are separate from the brand accent on purpose — a warning
/// must not be brand blue just because blue is the accent.
@immutable
class SaveOnDriveColors extends ThemeExtension<SaveOnDriveColors> {
  const SaveOnDriveColors({
    required this.muted,
    required this.faint,
    required this.border,
    required this.accent,
    required this.money,
    required this.successBg,
    required this.successFg,
    required this.warningBg,
    required this.warningFg,
    required this.dangerBg,
    required this.dangerFg,
    required this.neutralBg,
    required this.brandGradient,
  });

  /// Secondary text — labels, captions, subtitles.
  final Color muted;

  /// Tertiary text and hairlines. Quieter than [muted]; never for body text.
  final Color faint;

  /// Card and input borders.
  final Color border;

  /// Brand blue, corrected for the current ground.
  final Color accent;

  /// Brand green, corrected for the current ground. Savings and money ONLY.
  final Color money;

  final Color successBg, successFg;
  final Color warningBg, warningFg;
  final Color dangerBg, dangerFg;

  /// Ground for a chip or tile carrying no status.
  final Color neutralBg;

  /// The savings card / splash gradient.
  final List<Color> brandGradient;

  @override
  SaveOnDriveColors copyWith({
    Color? muted,
    Color? faint,
    Color? border,
    Color? accent,
    Color? money,
    Color? successBg,
    Color? successFg,
    Color? warningBg,
    Color? warningFg,
    Color? dangerBg,
    Color? dangerFg,
    Color? neutralBg,
    List<Color>? brandGradient,
  }) {
    return SaveOnDriveColors(
      muted: muted ?? this.muted,
      faint: faint ?? this.faint,
      border: border ?? this.border,
      accent: accent ?? this.accent,
      money: money ?? this.money,
      successBg: successBg ?? this.successBg,
      successFg: successFg ?? this.successFg,
      warningBg: warningBg ?? this.warningBg,
      warningFg: warningFg ?? this.warningFg,
      dangerBg: dangerBg ?? this.dangerBg,
      dangerFg: dangerFg ?? this.dangerFg,
      neutralBg: neutralBg ?? this.neutralBg,
      brandGradient: brandGradient ?? this.brandGradient,
    );
  }

  @override
  SaveOnDriveColors lerp(ThemeExtension<SaveOnDriveColors>? other, double t) {
    if (other is! SaveOnDriveColors) return this;
    return SaveOnDriveColors(
      muted: Color.lerp(muted, other.muted, t)!,
      faint: Color.lerp(faint, other.faint, t)!,
      border: Color.lerp(border, other.border, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      money: Color.lerp(money, other.money, t)!,
      successBg: Color.lerp(successBg, other.successBg, t)!,
      successFg: Color.lerp(successFg, other.successFg, t)!,
      warningBg: Color.lerp(warningBg, other.warningBg, t)!,
      warningFg: Color.lerp(warningFg, other.warningFg, t)!,
      dangerBg: Color.lerp(dangerBg, other.dangerBg, t)!,
      dangerFg: Color.lerp(dangerFg, other.dangerFg, t)!,
      neutralBg: Color.lerp(neutralBg, other.neutralBg, t)!,
      brandGradient: [
        Color.lerp(brandGradient.first, other.brandGradient.first, t)!,
        Color.lerp(brandGradient.last, other.brandGradient.last, t)!,
      ],
    );
  }

  static const light = SaveOnDriveColors(
    // Neutrals carry a blue bias rather than being pure grey — a flat mid-grey
    // next to a blue accent reads as unconsidered.
    muted: Color(0xFF5A6B84),
    faint: Color(0xFF8494AC),
    border: Color(0xFFE1E7EF),
    accent: kBrandBlue,
    money: _brandGreenText,
    successBg: Color(0xFFDCFCE7),
    successFg: Color(0xFF166534),
    warningBg: Color(0xFFFEF3C7),
    warningFg: Color(0xFF92400E),
    dangerBg: Color(0xFFFEE2E2),
    dangerFg: Color(0xFFB91C1C),
    neutralBg: Color(0xFFEDF1F7),
    brandGradient: [kBrandBlue, kBrandDark],
  );

  static const dark = SaveOnDriveColors(
    muted: Color(0xFF9AAEC8),
    faint: Color(0xFF6B819D),
    border: Color(0xFF1E3B59),
    accent: _brandBlueDark,
    money: _brandGreenDark,
    // Status tints are rebuilt for a dark ground, not inverted: a dark, low
    // -saturation bed with a bright legible foreground. Inverting the light
    // tints would give near-white blocks that glare.
    successBg: Color(0xFF0E3222),
    successFg: Color(0xFF6EE7A0),
    warningBg: Color(0xFF3A2A0B),
    warningFg: Color(0xFFFBBF4E),
    dangerBg: Color(0xFF3B1518),
    dangerFg: Color(0xFFFF8A8A),
    neutralBg: Color(0xFF14304C),
    brandGradient: [Color(0xFF1B4C8F), Color(0xFF071726)],
  );
}

/// Convenience: `context.mq.muted` instead of the full lookup.
extension SaveOnDriveTheme on BuildContext {
  SaveOnDriveColors get mq => Theme.of(this).extension<SaveOnDriveColors>()!;
}

ThemeData buildTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final tokens = isDark ? SaveOnDriveColors.dark : SaveOnDriveColors.light;

  // Deeper than brand navy so cards (which sit near the brand navy) still have
  // somewhere to sit above the page.
  const darkScaffold = Color(0xFF061422);
  const darkSurface = Color(0xFF0C2136);
  const lightScaffold = Color(0xFFF6F8FB);

  final scheme = ColorScheme.fromSeed(
    seedColor: kBrandBlue,
    brightness: brightness,
    primary: tokens.accent,
    surface: isDark ? darkSurface : Colors.white,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    scaffoldBackgroundColor: isDark ? darkScaffold : lightScaffold,
    extensions: [tokens],
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: isDark ? const Color(0xFFEAF1FA) : kBrandDark,
      centerTitle: false,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: isDark ? darkSurface : Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        // In dark mode a card and the page are close in tone, so it needs an
        // edge to read as a surface at all. On white paper it doesn't.
        side: isDark ? BorderSide(color: tokens.border) : BorderSide.none,
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: isDark ? const Color(0xFF0A1B2C) : Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: tokens.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: tokens.border),
      ),
    ),
    dividerTheme: DividerThemeData(color: tokens.border, space: 1),
  );
}

/// Formats integer minor units (pence) as GBP.
String formatMinor(int minor) {
  final f = NumberFormat.currency(locale: 'en_GB', symbol: '£');
  return f.format(minor / 100);
}
