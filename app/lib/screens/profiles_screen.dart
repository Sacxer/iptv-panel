import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../constants.dart';
import '../models/profile.dart';
import '../providers/profiles_provider.dart';
import '../services/storage.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import 'profile_form_screen.dart';
import 'session_loader_screen.dart';

/// Selección de perfil al iniciar.
class ProfilesScreen extends StatefulWidget {
  /// Entrar solo con el último perfil ([Storage.autoLogin], activado de fábrica). Solo lo pide
  /// la pantalla con la que abre la app, y una vez por arranque (`_autoLoginDone`): al cambiar
  /// de perfil o cerrar sesión (`switchProfile`) se vuelve aquí sin entrar solo.
  final bool allowAutoLogin;
  const ProfilesScreen({super.key, this.allowAutoLogin = false});

  @override
  State<ProfilesScreen> createState() => _ProfilesScreenState();
}

class _ProfilesScreenState extends State<ProfilesScreen> {
  static bool _autoLoginDone = false;
  bool _manage = false;

  @override
  void initState() {
    super.initState();
    if (widget.allowAutoLogin && !_autoLoginDone) {
      _autoLoginDone = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final storage = context.read<Storage>();
        final profiles = context.read<ProfilesProvider>();
        final last = profiles.byId(profiles.lastProfileId);
        if (storage.autoLogin && last != null) _open(last);
      });
    }
  }

  void _open(Profile p) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SessionLoaderScreen(profile: p)),
    );
  }

  Future<void> _edit([Profile? p]) async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ProfileFormScreen(profile: p)),
    );
  }

  Future<void> _options(Profile p) async {
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(p.name),
        content: Text('${p.type.label}\n${p.subtitle}'),
        actions: [
          TvButton(
            label: 'Conectar',
            icon: Icons.play_arrow_rounded,
            primary: true,
            autofocus: true,
            dense: true,
            onPressed: () => Navigator.pop(ctx, 'open'),
          ),
          TvButton(
            label: 'Editar',
            icon: Icons.edit_outlined,
            dense: true,
            onPressed: () => Navigator.pop(ctx, 'edit'),
          ),
          TvButton(
            label: 'Eliminar',
            icon: Icons.delete_outline,
            danger: true,
            dense: true,
            onPressed: () => Navigator.pop(ctx, 'delete'),
          ),
        ],
      ),
    );
    if (!mounted || action == null) return;
    switch (action) {
      case 'open':
        _open(p);
      case 'edit':
        await _edit(p);
      case 'delete':
        final ok = await confirmDialog(
          context,
          title: 'Eliminar perfil',
          message:
              '¿Desea eliminar "${p.name}"? Se borrarán también sus favoritos y recientes.',
          confirm: 'Eliminar',
          danger: true,
        );
        if (ok && mounted) {
          await context.read<ProfilesProvider>().delete(p);
          if (mounted) showSnack(context, 'Perfil eliminado');
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ProfilesProvider>();
    final profiles = provider.ordered;
    final lastId = provider.lastProfileId;
    final narrow = MediaQuery.sizeOf(context).width < 600;

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(
              horizontal: narrow ? 16 : 48, vertical: narrow ? 16 : 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: AppColors.accent,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.live_tv_rounded, size: 28),
                  ),
                  const SizedBox(width: 14),
                  const Expanded(
                    child: Text(
                      AppConfig.appName,
                      style:
                          TextStyle(fontSize: 26, fontWeight: FontWeight.w800),
                    ),
                  ),
                  if (profiles.isNotEmpty)
                    TvButton(
                      label: _manage ? 'Listo' : 'Administrar',
                      icon: _manage ? Icons.check : Icons.settings_outlined,
                      dense: true,
                      onPressed: () => setState(() => _manage = !_manage),
                    ),
                ],
              ),
              const SizedBox(height: 28),
              Text(
                _manage ? 'Elija un perfil para editarlo' : 'Seleccione un perfil',
                style:
                    const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                _manage
                    ? 'Puede editar o eliminar sus perfiles.'
                    : 'Mantenga presionado OK (o clic derecho) para editar o eliminar.',
                style: const TextStyle(color: AppColors.textSecondary),
              ),
              const SizedBox(height: 22),
              Expanded(
                child: profiles.isEmpty
                    ? EmptyView(
                        icon: Icons.person_add_alt_1_outlined,
                        message:
                            'Aún no hay perfiles.\nAgregue su cuenta Xtream Codes o una lista M3U para comenzar.',
                        action: TvButton(
                          label: 'Agregar perfil',
                          icon: Icons.add,
                          primary: true,
                          autofocus: true,
                          onPressed: () => _edit(),
                        ),
                      )
                    : SingleChildScrollView(
                        clipBehavior: Clip.none,
                        padding: const EdgeInsets.all(8),
                        child: Wrap(
                          spacing: 20,
                          runSpacing: 20,
                          children: [
                            for (var i = 0; i < profiles.length; i++)
                              _ProfileCard(
                                profile: profiles[i],
                                width: narrow ? double.infinity : 250,
                                isLast: profiles[i].id == lastId,
                                autofocus: i == 0,
                                manage: _manage,
                                onTap: () => _manage
                                    ? _options(profiles[i])
                                    : _open(profiles[i]),
                                onLongPress: () => _options(profiles[i]),
                              ),
                            _AddCard(
                              width: narrow ? double.infinity : 250,
                              onTap: () => _edit(),
                            ),
                          ],
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

IconData profileIcon(ProfileType t) {
  switch (t) {
    case ProfileType.xtream:
      return Icons.dns_rounded;
    case ProfileType.m3uUrl:
      return Icons.link_rounded;
    case ProfileType.m3uFile:
      return Icons.description_outlined;
  }
}

class _ProfileCard extends StatelessWidget {
  final Profile profile;
  final double width;
  final bool isLast;
  final bool autofocus;
  final bool manage;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const _ProfileCard({
    required this.profile,
    required this.width,
    required this.isLast,
    required this.autofocus,
    required this.manage,
    required this.onTap,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 150,
      child: FocusableCard(
        autofocus: autofocus,
        onTap: onTap,
        onLongPress: onLongPress,
        color: AppColors.surfaceHigh,
        borderRadius: 16,
        padding: const EdgeInsets.all(16),
        semanticLabel: profile.name,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: AppColors.accentSoft,
                  child: Icon(profileIcon(profile.type), color: AppColors.text),
                ),
                const Spacer(),
                if (manage)
                  const Icon(Icons.edit_outlined, color: AppColors.textSecondary)
                else if (isLast)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.accentSoft,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Text('Último usado',
                        style: TextStyle(fontSize: 11)),
                  ),
              ],
            ),
            const Spacer(),
            Text(
              profile.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 2),
            Text(
              '${profile.type.label} · ${profile.subtitle}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  fontSize: 12.5, color: AppColors.textSecondary),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddCard extends StatelessWidget {
  final double width;
  final VoidCallback onTap;
  const _AddCard({required this.width, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      height: 150,
      child: FocusableCard(
        onTap: onTap,
        color: AppColors.surface,
        borderRadius: 16,
        semanticLabel: 'Agregar perfil',
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_circle_outline, size: 40, color: AppColors.accent),
            SizedBox(height: 10),
            Text('Agregar perfil',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
