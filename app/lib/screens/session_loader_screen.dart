import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/profile.dart';
import '../providers/library_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/profiles_provider.dart';
import '../providers/session_provider.dart';
import '../theme.dart';
import '../widgets/focusable_card.dart';
import '../widgets/portal_widgets.dart';
import '../widgets/server_search_button.dart';
import 'home_screen.dart';
import 'profile_form_screen.dart';

/// Conecta con el perfil (login Xtream / descarga M3U) y abre el inicio.
class SessionLoaderScreen extends StatefulWidget {
  final Profile profile;
  const SessionLoaderScreen({super.key, required this.profile});

  @override
  State<SessionLoaderScreen> createState() => _SessionLoaderScreenState();
}

class _SessionLoaderScreenState extends State<SessionLoaderScreen> {
  late Profile _profile;
  bool _cancelled = false;

  @override
  void initState() {
    super.initState();
    _profile = widget.profile;
    WidgetsBinding.instance.addPostFrameCallback((_) => _start());
  }

  Future<void> _start() async {
    final session = context.read<SessionProvider>();
    final portal = context.read<PortalProvider>();
    final library = context.read<LibraryProvider>();
    final profiles = context.read<ProfilesProvider>();

    // El perfil guardado puede tener una dirección más nueva (se reencontró el portal).
    _profile = profiles.byId(_profile.id) ?? _profile;
    final ok = await session.login(_profile);
    if (!mounted || _cancelled) {
      return;
    }
    // Si el portal apareció en otra dirección, la sesión ya actualizó el perfil.
    final current = session.profile ?? _profile;
    if (current.id == _profile.id) setState(() => _profile = current);
    if (!ok) return;

    await profiles.markUsed(_profile);
    library.load(_profile.id);
    if (_profile.isXtream) {
      // Detección del portal (silenciosa si no aplica).
      await portal.start(session.profile ?? _profile).timeout(
            const Duration(seconds: 15),
            onTimeout: () {},
          );
    } else {
      portal.stop();
    }
    if (!mounted || _cancelled) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeScreen()),
      (_) => false,
    );
  }

  Future<void> _editProfile() async {
    final updated = await Navigator.of(context).push<Profile>(
      MaterialPageRoute(builder: (_) => ProfileFormScreen(profile: _profile)),
    );
    if (updated != null && mounted) {
      setState(() => _profile = updated);
      _start();
    }
  }

  void _back() {
    _cancelled = true;
    context.read<SessionProvider>().logout();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    Widget body;
    switch (session.status) {
      case SessionStatus.error:
        body = _ErrorPanel(
          profile: _profile,
          message: session.error ?? 'Error desconocido',
          canSearchServer: _profile.isXtream && session.errorCanRelocate,
          onRetry: _start,
          onEdit: _editProfile,
          onBack: _back,
        );
      case SessionStatus.blocked:
        final b = session.block;
        body = BlockedView(
          title: b?.title ?? 'Cuenta no disponible',
          message: b?.message ?? '',
          actions: [
            TvButton(
              label: 'Reintentar',
              icon: Icons.refresh,
              primary: true,
              autofocus: true,
              onPressed: _start,
            ),
            TvButton(
              label: 'Cambiar perfil',
              icon: Icons.switch_account_outlined,
              onPressed: _back,
            ),
          ],
        );
      default:
        body = Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_profile.name,
                  style: const TextStyle(
                      fontSize: 24, fontWeight: FontWeight.w800)),
              const SizedBox(height: 28),
              const SizedBox(
                  width: 48, height: 48, child: CircularProgressIndicator()),
              const SizedBox(height: 20),
              Text(
                session.progress.isEmpty ? 'Cargando…' : session.progress,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 28),
              TvButton(
                label: 'Cancelar',
                autofocus: true,
                dense: true,
                onPressed: _back,
              ),
            ],
          ),
        );
    }
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(body: SafeArea(child: body)),
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  final Profile profile;
  final String message;
  final bool canSearchServer;
  final VoidCallback onRetry;
  final VoidCallback onEdit;
  final VoidCallback onBack;

  const _ErrorPanel({
    required this.profile,
    required this.message,
    required this.canSearchServer,
    required this.onRetry,
    required this.onEdit,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.wifi_off_rounded,
                  size: 64, color: AppColors.warning),
              const SizedBox(height: 16),
              Text('No se pudo conectar a "${profile.name}"',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 22, fontWeight: FontWeight.w700)),
              const SizedBox(height: 10),
              Text(message,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 26),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                alignment: WrapAlignment.center,
                children: [
                  TvButton(
                    label: 'Reintentar',
                    icon: Icons.refresh,
                    primary: true,
                    autofocus: true,
                    onPressed: onRetry,
                  ),
                  if (canSearchServer) ServerSearchButton(onFound: onRetry),
                  TvButton(
                    label: 'Editar perfil',
                    icon: Icons.edit_outlined,
                    onPressed: onEdit,
                  ),
                  TvButton(
                    label: 'Cambiar perfil',
                    icon: Icons.switch_account_outlined,
                    onPressed: onBack,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
