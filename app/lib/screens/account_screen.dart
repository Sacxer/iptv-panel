import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../constants.dart';
import '../models/profile.dart';
import '../providers/app_update_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/session_provider.dart';
import '../services/device.dart';
import '../services/distribution.dart';
import '../services/storage.dart';
import '../theme.dart';
import '../widgets/app_update_widgets.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import 'navigation.dart';

class _InfoCard extends StatelessWidget {
  final String title;
  final IconData icon;
  final List<Widget> children;

  const _InfoCard({required this.title, required this.icon, required this.children});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.accent),
              const SizedBox(width: 10),
              Text(title,
                  style: const TextStyle(
                      fontSize: 17, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 12),
          ...children,
        ],
      ),
    );
  }
}

class _Row extends StatelessWidget {
  final String label;
  final String value;
  final Color? valueColor;
  const _Row(this.label, this.value, {this.valueColor});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 150,
            child: Text(label,
                style: const TextStyle(color: AppColors.textSecondary)),
          ),
          Expanded(
            child: Text(value,
                style: TextStyle(
                    fontWeight: FontWeight.w600, color: valueColor)),
          ),
        ],
      ),
    );
  }
}

Color _statusColor(String status) {
  switch (status.toLowerCase()) {
    case 'active':
      return AppColors.success;
    case 'expired':
      return AppColors.warning;
    default:
      return AppColors.danger;
  }
}

String _expiry(DateTime? d) {
  if (d == null) return 'Sin vencimiento';
  final days = d.difference(DateTime.now()).inDays;
  final rel = days < 0
      ? 'vencida'
      : days == 0
          ? 'vence hoy'
          : 'en $days día${days == 1 ? '' : 's'}';
  return '${formatDate(d)} ($rel)';
}

/// Estado de la cuenta y datos del perfil.
class AccountScreen extends StatelessWidget {
  final bool standalone;
  final bool includeSettings;

  const AccountScreen({
    super.key,
    this.standalone = false,
    this.includeSettings = true,
  });

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    final portal = context.watch<PortalProvider>();
    final profile = session.profile;
    final user = session.auth?.userInfo;
    final pUser = portal.enabled ? portal.info?.user : null;

    final list = ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (profile != null)
          _InfoCard(
            title: 'Perfil',
            icon: Icons.person_outline,
            children: [
              _Row('Nombre', profile.name),
              _Row('Tipo', profile.type.label),
              if (profile.isXtream) ...[
                _Row('Servidor', profile.serverUrl),
                _Row('Usuario', profile.username),
              ],
              if (profile.type == ProfileType.m3uUrl) _Row('URL', profile.m3uUrl),
              if (profile.type == ProfileType.m3uFile)
                _Row('Archivo', profile.fileName),
            ],
          ),
        if (pUser != null)
          _InfoCard(
            title: 'Estado de la cuenta',
            icon: Icons.verified_user_outlined,
            children: [
              _Row('Estado', pUser.statusLabel,
                  valueColor: _statusColor(
                      pUser.status == 'active' ? 'active' : pUser.status)),
              _Row('Vencimiento', _expiry(pUser.expDate)),
              _Row('Conexiones máx.', '${pUser.maxConnections}'),
              if (pUser.isTrial) const _Row('Prueba', 'Sí'),
              if (pUser.suspensionReason != null)
                _Row('Motivo', pUser.suspensionReason!),
              if (portal.info?.serverName.isNotEmpty ?? false)
                _Row('Proveedor', portal.info!.serverName),
            ],
          )
        else if (user != null)
          _InfoCard(
            title: 'Estado de la cuenta',
            icon: Icons.verified_user_outlined,
            children: [
              _Row('Estado', user.statusLabel,
                  valueColor: _statusColor(user.status)),
              _Row('Vencimiento', _expiry(user.expDate)),
              _Row('Conexiones', '${user.activeConnections} de ${user.maxConnections}'),
              if (user.isTrial) const _Row('Prueba', 'Sí'),
              if (user.message.isNotEmpty) _Row('Mensaje', user.message),
            ],
          ),
        if (session.source != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                TvButton(
                  label: 'Actualizar contenido',
                  icon: Icons.refresh,
                  onPressed: () async {
                    showSnack(context, 'Actualizando contenido…');
                    try {
                      await session.refreshCatalog();
                      await portal.refresh();
                      if (context.mounted) showSnack(context, 'Contenido actualizado');
                    } catch (e) {
                      if (context.mounted) showSnack(context, '$e');
                    }
                  },
                ),
                TvButton(
                  label: 'Cambiar perfil',
                  icon: Icons.switch_account_outlined,
                  onPressed: () => switchProfile(context),
                ),
              ],
            ),
          ),
        if (includeSettings) const SettingsPanel(),
      ],
    );
    if (!standalone) return list;
    return Scaffold(
      appBar: AppBar(title: const Text('Cuenta')),
      body: SafeArea(top: false, child: list),
    );
  }
}

/// Ajustes de la aplicación.
class SettingsPanel extends StatefulWidget {
  const SettingsPanel({super.key});

  @override
  State<SettingsPanel> createState() => _SettingsPanelState();
}

class _SettingsPanelState extends State<SettingsPanel> {
  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    final storage = context.read<Storage>();
    final format = session.liveFormat;
    return Column(
      children: [
        _InfoCard(
          title: 'Reproducción',
          icon: Icons.tune_rounded,
          children: [
            const Text('Formato de canales en vivo (Xtream)',
                style: TextStyle(color: AppColors.textSecondary)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                TvChip(
                  label: 'MPEG-TS (.ts)',
                  selected: format == 'ts',
                  onTap: () => session.setLiveFormat('ts'),
                ),
                TvChip(
                  label: 'HLS (.m3u8)',
                  selected: format == 'm3u8',
                  onTap: () => session.setLiveFormat('m3u8'),
                ),
              ],
            ),
            const SizedBox(height: 14),
            FocusableCard(
              color: AppColors.surfaceHigh,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              onTap: () async {
                await storage.setAutoLogin(!storage.autoLogin);
                setState(() {});
              },
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Iniciar con el último perfil usado'),
                  ),
                  IgnorePointer(
                    child: Switch(
                      value: storage.autoLogin,
                      onChanged: (_) {},
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        _InfoCard(
          title: 'Acerca de',
          icon: Icons.info_outline,
          children: [
            _Row('Aplicación', '${AppConfig.appName} ${Device.appVersion}'),
            if (Device.appBuild.isNotEmpty)
              _Row('Compilación', Device.appBuild),
            _Row('Distribución',
                AppDistribution.isPlay ? 'Google Play' : 'Portal (APK)'),
            _Row('Dispositivo',
                [Device.brand, Device.model].where((s) => s.isNotEmpty).join(' ')),
            _Row('Sistema', Device.os),
            _Row('Tipo', Device.type),
            _Row('ID de dispositivo', Device.deviceId),
            if (AppDistribution.updaterEnabled && AppUpdateController.supported)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: CheckForUpdatesButton(),
              ),
          ],
        ),
      ],
    );
  }
}

/// Página de ajustes independiente (desde "Más").
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ajustes')),
      body: SafeArea(
        top: false,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: const [SettingsPanel()],
        ),
      ),
    );
  }
}
