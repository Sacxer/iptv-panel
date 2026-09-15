import 'package:flutter/material.dart';

import 'models/portal_models.dart';

/// Paleta de colores "TV-first" oscura.
class AppColors {
  AppColors._();

  static const background = Color(0xFF0A0E16);
  static const surface = Color(0xFF141A26);
  static const surfaceHigh = Color(0xFF1D2535);
  static const surfaceHighest = Color(0xFF273145);
  static const accent = Color(0xFF4F8CFF);
  static const accentSoft = Color(0xFF223A66);
  static const focus = Color(0xFF7FB0FF);
  static const text = Color(0xFFF2F5FA);
  static const textSecondary = Color(0xFF9AA5B8);
  static const textMuted = Color(0xFF687388);
  static const success = Color(0xFF22C55E);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);
  static const info = Color(0xFF3B82F6);
  static const live = Color(0xFFE53935);
  static const star = Color(0xFFFFC53D);

  static Color forLevel(NoticeLevel level) {
    switch (level) {
      case NoticeLevel.info:
        return info;
      case NoticeLevel.warning:
        return warning;
      case NoticeLevel.critical:
        return danger;
    }
  }

  static IconData iconForLevel(NoticeLevel level) {
    switch (level) {
      case NoticeLevel.info:
        return Icons.info_outline;
      case NoticeLevel.warning:
        return Icons.warning_amber_rounded;
      case NoticeLevel.critical:
        return Icons.error_outline;
    }
  }
}

class AppTheme {
  AppTheme._();

  static ThemeData dark() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.accent,
      brightness: Brightness.dark,
    ).copyWith(
      primary: AppColors.accent,
      surface: AppColors.surface,
      onSurface: AppColors.text,
      error: AppColors.danger,
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: scheme,
      scaffoldBackgroundColor: AppColors.background,
      canvasColor: AppColors.background,
      visualDensity: VisualDensity.standard,
    );
    return base.copyWith(
      textTheme: base.textTheme.apply(
        bodyColor: AppColors.text,
        displayColor: AppColors.text,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.background,
        foregroundColor: AppColors.text,
        elevation: 0,
        centerTitle: false,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: AppColors.surfaceHighest,
        contentTextStyle: TextStyle(color: AppColors.text),
        behavior: SnackBarBehavior.floating,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surfaceHigh,
        labelStyle: const TextStyle(color: AppColors.textSecondary),
        hintStyle: const TextStyle(color: AppColors.textMuted),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.transparent, width: 2),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.focus, width: 2.5),
        ),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      ),
      progressIndicatorTheme:
          const ProgressIndicatorThemeData(color: AppColors.accent),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        indicatorColor: AppColors.accentSoft,
        labelTextStyle: WidgetStateProperty.all(
            const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(AppColors.surfaceHighest),
      ),
    );
  }
}
