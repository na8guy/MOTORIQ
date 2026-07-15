import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// MOTORIQ brand theme.
const kBrandBlue = Color(0xFF1F6FEB);
const kBrandDark = Color(0xFF0B2545);
const kBrandGreen = Color(0xFF16A34A);

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: kBrandBlue,
    primary: kBrandBlue,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF6F8FB),
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.transparent,
      elevation: 0,
      foregroundColor: kBrandDark,
      centerTitle: false,
    ),
    cardTheme: CardTheme(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
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
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE1E7EF)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Color(0xFFE1E7EF)),
      ),
    ),
  );
}

/// Formats integer minor units (pence) as GBP.
String formatMinor(int minor) {
  final f = NumberFormat.currency(locale: 'en_GB', symbol: '£');
  return f.format(minor / 100);
}
