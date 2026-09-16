import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/profile.dart';
import '../providers/profiles_provider.dart';
import '../services/device.dart';
import '../services/storage.dart';
import '../services/xtream_api.dart';
import '../theme.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/server_discovery_sheet.dart';
import 'profiles_screen.dart' show profileIcon;

/// Crear / editar perfil.
class ProfileFormScreen extends StatefulWidget {
  final Profile? profile;
  const ProfileFormScreen({super.key, this.profile});

  @override
  State<ProfileFormScreen> createState() => _ProfileFormScreenState();
}

class _ProfileFormScreenState extends State<ProfileFormScreen> {
  late final String _id;
  late ProfileType _type;
  late final TextEditingController _name;
  late final TextEditingController _server;
  late final TextEditingController _user;
  late final TextEditingController _pass;
  late final TextEditingController _m3u;
  final _userFocus = FocusNode(debugLabel: 'profile-user');
  String _filePath = '';
  String _fileName = '';
  bool _obscure = true;
  bool _saving = false;
  String? _error;

  bool get _isEdit => widget.profile != null;

  @override
  void initState() {
    super.initState();
    final p = widget.profile;
    _id = p?.id ?? ProfilesProvider.newId();
    _type = p?.type ?? ProfileType.xtream;
    _name = TextEditingController(text: p?.name ?? '');
    _server = TextEditingController(text: p?.serverUrl ?? '');
    _user = TextEditingController(text: p?.username ?? '');
    _pass = TextEditingController(text: p?.password ?? '');
    _m3u = TextEditingController(text: p?.m3uUrl ?? '');
    _filePath = p?.filePath ?? '';
    _fileName = p?.fileName ?? '';
  }

  @override
  void dispose() {
    for (final c in [_name, _server, _user, _pass, _m3u]) {
      c.dispose();
    }
    _userFocus.dispose();
    super.dispose();
  }

  /// Busca el portal en la red local y rellena la URL del servidor.
  Future<void> _findServer() async {
    final url = await showServerDiscovery(context);
    if (!mounted || url == null) return;
    setState(() {
      _server.text = url;
      _error = null;
    });
    // En el teléfono se pasa directo al usuario; en TV el foco vuelve al botón.
    if (!Device.isTv && _user.text.trim().isEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _userFocus.requestFocus();
      });
    }
  }

  Future<void> _pickFile() async {
    try {
      final file = await FilePicker.pickFile(
        dialogTitle: 'Seleccione una lista M3U',
        type: FileType.any,
      );
      if (file == null) return;
      setState(() => _saving = true);
      final bytes = await file.readAsBytes();
      final path = await Storage.storePlaylistFile(_id, bytes);
      if (!mounted) return;
      setState(() {
        _filePath = path;
        _fileName = file.name;
        _saving = false;
        _error = null;
        if (_name.text.trim().isEmpty) {
          _name.text = file.name.replaceAll(RegExp(r'\.(m3u8?|txt)$', caseSensitive: false), '');
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = 'No se pudo abrir el archivo: $e';
      });
    }
  }

  String? _validate() {
    switch (_type) {
      case ProfileType.xtream:
        if (_server.text.trim().isEmpty) {
          return 'Ingrese la URL del servidor.';
        }
        if (!XtreamApi.isValidServerUrl(_server.text)) {
          return 'La URL del servidor no es válida. Ejemplo: http://servidor.com:8080';
        }
        if (_user.text.trim().isEmpty) return 'Ingrese el usuario.';
        if (_pass.text.isEmpty) return 'Ingrese la contraseña.';
      case ProfileType.m3uUrl:
        final url = _m3u.text.trim();
        final uri = Uri.tryParse(url.contains('://') ? url : 'http://$url');
        if (url.isEmpty || uri == null || uri.host.isEmpty) {
          return 'Ingrese una URL de lista M3U válida.';
        }
      case ProfileType.m3uFile:
        if (_filePath.isEmpty) return 'Seleccione un archivo M3U.';
    }
    return null;
  }

  Future<void> _save() async {
    final err = _validate();
    if (err != null) {
      setState(() => _error = err);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    var name = _name.text.trim();
    if (name.isEmpty) {
      switch (_type) {
        case ProfileType.xtream:
          name = _user.text.trim();
        case ProfileType.m3uUrl:
          name = Uri.tryParse(_m3u.text.trim())?.host ?? 'Lista M3U';
        case ProfileType.m3uFile:
          name = _fileName.isNotEmpty ? _fileName : 'Lista local';
      }
    }
    final serverUrl = _type == ProfileType.xtream
        ? XtreamApi.normalizeServerUrl(_server.text)
        : '';
    // Datos del portal: se conservan si el servidor no cambió. Si el usuario escribió otra
    // dirección, se olvidan (la app no debe "volver" sola al servidor anterior).
    final old = widget.profile;
    final keepPortal = old != null &&
        _type == ProfileType.xtream &&
        old.isXtream &&
        XtreamApi.normalizeServerUrl(old.serverUrl) == serverUrl;
    final profile = Profile(
      id: _id,
      name: name,
      type: _type,
      portalId: keepPortal ? old.portalId : '',
      portalUrls: keepPortal ? old.portalUrls : const [],
      clientPorts: keepPortal ? old.clientPorts : const [],
      serverUrl: serverUrl,
      username: _type == ProfileType.xtream ? _user.text.trim() : '',
      password: _type == ProfileType.xtream ? _pass.text : '',
      m3uUrl: _type == ProfileType.m3uUrl ? _m3u.text.trim() : '',
      filePath: _type == ProfileType.m3uFile ? _filePath : '',
      fileName: _type == ProfileType.m3uFile ? _fileName : '',
      createdAt: widget.profile?.createdAt ??
          DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );
    await context.read<ProfilesProvider>().save(profile);
    if (!mounted) return;
    Navigator.of(context).pop(profile);
  }

  @override
  Widget build(BuildContext context) {
    final narrow = MediaQuery.sizeOf(context).width < 600;
    return Scaffold(
      appBar: AppBar(
        title: Text(_isEdit ? 'Editar perfil' : 'Nuevo perfil'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          tooltip: 'Volver',
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: ListView(
              padding: EdgeInsets.symmetric(
                  horizontal: narrow ? 16 : 32, vertical: 16),
              children: [
                const Text('Tipo de perfil',
                    style: TextStyle(
                        fontSize: 16, color: AppColors.textSecondary)),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (final t in ProfileType.values)
                      FocusableCard(
                        autofocus: t == _type,
                        selected: t == _type,
                        color: AppColors.surfaceHigh,
                        onTap: () => setState(() {
                          _type = t;
                          _error = null;
                        }),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 12),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(profileIcon(t), size: 20),
                            const SizedBox(width: 8),
                            Text(t.label,
                                style: TextStyle(
                                    fontWeight: t == _type
                                        ? FontWeight.w700
                                        : FontWeight.w500)),
                          ],
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                TvTextField(
                  controller: _name,
                  label: 'Nombre del perfil',
                  hint: 'Ej.: Casa, Mi IPTV…',
                  prefixIcon: const Icon(Icons.badge_outlined),
                ),
                const SizedBox(height: 16),
                ..._typeFields(),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline,
                            color: AppColors.danger),
                        const SizedBox(width: 10),
                        Expanded(child: Text(_error!)),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    TvButton(
                      label: _saving ? 'Guardando…' : 'Guardar',
                      icon: Icons.save_outlined,
                      primary: true,
                      onPressed: _saving ? null : _save,
                    ),
                    TvButton(
                      label: 'Cancelar',
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _typeFields() {
    switch (_type) {
      case ProfileType.xtream:
        return [
          TvTextField(
            controller: _server,
            label: 'URL del servidor',
            hint: 'http://servidor.com:8080',
            keyboardType: TextInputType.url,
            prefixIcon: const Icon(Icons.dns_outlined),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerLeft,
            child: TvButton(
              label: 'Buscar servidor en mi red',
              icon: Icons.wifi_find,
              dense: true,
              onPressed: _saving ? null : _findServer,
            ),
          ),
          const SizedBox(height: 16),
          TvTextField(
            controller: _user,
            focusNode: _userFocus,
            label: 'Usuario',
            prefixIcon: const Icon(Icons.person_outline),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: TvTextField(
                  controller: _pass,
                  label: 'Contraseña',
                  obscure: _obscure,
                  textInputAction: TextInputAction.done,
                  prefixIcon: const Icon(Icons.lock_outline),
                  onSubmitted: (_) => _save(),
                ),
              ),
              const SizedBox(width: 10),
              TvIconButton(
                icon: _obscure ? Icons.visibility : Icons.visibility_off,
                tooltip: _obscure ? 'Mostrar contraseña' : 'Ocultar contraseña',
                color: AppColors.surfaceHigh,
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ],
          ),
        ];
      case ProfileType.m3uUrl:
        return [
          TvTextField(
            controller: _m3u,
            label: 'URL de la lista M3U',
            hint: 'http://servidor.com/get.php?username=…&type=m3u_plus',
            keyboardType: TextInputType.url,
            textInputAction: TextInputAction.done,
            prefixIcon: const Icon(Icons.link),
            onSubmitted: (_) => _save(),
          ),
        ];
      case ProfileType.m3uFile:
        return [
          Row(
            children: [
              TvButton(
                label: 'Seleccionar archivo',
                icon: Icons.folder_open_outlined,
                onPressed: _saving ? null : _pickFile,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  _fileName.isNotEmpty ? _fileName : 'Ningún archivo seleccionado',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'Se guarda una copia del archivo dentro de la aplicación.',
            style: TextStyle(fontSize: 12.5, color: AppColors.textMuted),
          ),
        ];
    }
  }
}
