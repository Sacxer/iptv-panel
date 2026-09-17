import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../constants.dart';
import '../models/media_item.dart';
import '../providers/library_provider.dart';
import '../providers/portal_provider.dart';
import '../providers/session_provider.dart';
import '../services/channel_zapping.dart';
import '../services/content_sections.dart';
import '../services/device.dart';
import '../theme.dart';
import '../widgets/auto_start_widgets.dart';
import '../widgets/common.dart';
import '../widgets/focusable_card.dart';
import '../widgets/portal_widgets.dart';
import 'account_screen.dart';
import 'catalog_screen.dart';
import 'dashboard_screen.dart';
import 'library_screens.dart';
import 'live_screen.dart';
import 'messages_screen.dart';
import 'navigation.dart';
import 'search_screen.dart';

enum HomeSection {
  home,
  live,
  movies,
  series,
  favorites,
  recents,
  search,
  messages,
  account,
  more,
}

extension HomeSectionInfo on HomeSection {
  String get label {
    switch (this) {
      case HomeSection.home:
        return 'Inicio';
      case HomeSection.live:
        return 'TV en vivo';
      case HomeSection.movies:
        return 'Películas';
      case HomeSection.series:
        return 'Series';
      case HomeSection.favorites:
        return 'Favoritos';
      case HomeSection.recents:
        return 'Recientes';
      case HomeSection.search:
        return 'Buscar';
      case HomeSection.messages:
        return 'Mensajes';
      case HomeSection.account:
        return 'Cuenta';
      case HomeSection.more:
        return 'Más';
    }
  }

  IconData get icon {
    switch (this) {
      case HomeSection.home:
        return Icons.home_rounded;
      case HomeSection.live:
        return Icons.live_tv_rounded;
      case HomeSection.movies:
        return Icons.movie_outlined;
      case HomeSection.series:
        return Icons.video_library_outlined;
      case HomeSection.favorites:
        return Icons.favorite_border_rounded;
      case HomeSection.recents:
        return Icons.history_rounded;
      case HomeSection.search:
        return Icons.search_rounded;
      case HomeSection.messages:
        return Icons.mail_outline_rounded;
      case HomeSection.account:
        return Icons.account_circle_outlined;
      case HomeSection.more:
        return Icons.more_horiz_rounded;
    }
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  HomeSection _section = HomeSection.home;
  final Set<HomeSection> _visited = {HomeSection.home};
  final Map<HomeSection, FocusNode> _navNodes = {
    for (final s in HomeSection.values)
      s: FocusNode(debugLabel: 'nav_${s.name}'),
  };
  bool _sidebarFocused = false;
  bool _showingPopups = false;
  late final PortalProvider _portal;
  late final SessionProvider _session;

  /// Al volver del canal con el que abrió la sesión, TV en vivo enfoca el que se estaba viendo.
  final ChannelFocusRequest _liveFocus = ChannelFocusRequest();

  @override
  void initState() {
    super.initState();
    _portal = context.read<PortalProvider>();
    _session = context.read<SessionProvider>();
    // Clientes solo con canales: la sesión abre en TV en vivo y reproduce el último canal.
    final openLastChannel =
        _session.sectionsWith(_portal.content).opensLastChannel;
    if (openLastChannel) {
      _section = HomeSection.live;
      _visited.add(HomeSection.live);
    }
    _portal.addListener(_onPortalChanged);
    WidgetsBinding.instance
        .addPostFrameCallback((_) => _startup(openLastChannel));
  }

  @override
  void dispose() {
    _portal.removeListener(_onPortalChanged);
    _liveFocus.dispose();
    for (final n in _navNodes.values) {
      n.dispose();
    }
    super.dispose();
  }

  /// Al abrir la sesión (una sola vez): permiso para abrir al encender (TV box), avisos del
  /// portal y, si corresponde, el último canal.
  Future<void> _startup(bool openLastChannel) async {
    if (!mounted) return;
    _showingPopups = true;
    try {
      await maybeAskAutoStartPermission(context);
      if (!mounted) return;
      if (openLastChannel) {
        if (!_portal.userBlocked && _portal.hasPendingPopups) {
          await showPendingPopups(context);
          if (!mounted) return;
        }
        await _openLastChannel();
      }
    } finally {
      _showingPopups = false;
    }
    if (mounted) _onPortalChanged();
  }

  /// La cuenta no puede reproducir (suspendida, vencida, corte con bloqueo…): no se abre el
  /// canal y se ve el aviso que ya existe.
  bool get _playbackBlocked =>
      _portal.userBlocked || _portal.blockingOutage != null;

  /// Reproduce a pantalla completa el último canal visto (o el primero de la lista). Atrás
  /// vuelve a TV en vivo con ese canal enfocado.
  Future<void> _openLastChannel() async {
    final source = _session.source;
    if (source == null || _playbackBlocked) return;
    final List<MediaItem> channels;
    try {
      channels = await source.items(ContentType.live);
    } catch (_) {
      return; // TV en vivo muestra el error con "Reintentar".
    }
    if (!mounted || !identical(_session.source, source)) return;
    final library = context.read<LibraryProvider>();
    final index = startChannelIndex(channels, library.recents);
    if (index < 0) return; // Sin canales: la lista vacía de siempre.
    if (!await _waitUntilOnTop() || _playbackBlocked) return;
    if (!mounted) return;
    await playItems(context, channels, index);
    if (!mounted) return;
    _select(HomeSection.live);
    // El canal que quedó (se pudo cambiar en el reproductor).
    final last = startChannelIndex(channels, library.recents);
    if (last >= 0) _liveFocus.request(channels[last].key);
  }

  /// Espera a que no haya nada encima del inicio (p. ej. el aviso de una actualización).
  Future<bool> _waitUntilOnTop() async {
    final until = DateTime.now().add(const Duration(minutes: 5));
    while (true) {
      if (!mounted) return false;
      if (ModalRoute.of(context)?.isCurrent ?? false) return true;
      if (DateTime.now().isAfter(until)) return false;
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
  }

  Future<void> _onPortalChanged() async {
    if (_showingPopups || !mounted) return;
    if (_portal.userBlocked || !_portal.hasPendingPopups) return;
    _showingPopups = true;
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (mounted && (ModalRoute.of(context)?.isCurrent ?? false)) {
      await showPendingPopups(context);
    }
    _showingPopups = false;
  }

  List<HomeSection> _wideSections(
      ContentSections content, PortalProvider portal) {
    return [
      HomeSection.home,
      if (content.live) HomeSection.live,
      if (content.movies) HomeSection.movies,
      if (content.series) HomeSection.series,
      HomeSection.favorites,
      HomeSection.recents,
      HomeSection.search,
      if (portal.enabled) HomeSection.messages,
      HomeSection.account,
    ];
  }

  List<HomeSection> _phoneSections(ContentSections content) {
    return [
      HomeSection.home,
      if (content.live) HomeSection.live,
      if (content.movies) HomeSection.movies,
      if (content.series) HomeSection.series,
      HomeSection.more,
    ];
  }

  /// Sección a la que vuelve Atrás antes de salir: TV en vivo para los clientes que abren en
  /// el último canal; Inicio para los demás.
  static HomeSection _baseSection(ContentSections content) =>
      content.opensLastChannel ? HomeSection.live : HomeSection.home;

  void _select(HomeSection s) {
    setState(() {
      _section = s;
      _visited.add(s);
    });
  }

  /// Navegación desde el panel de inicio.
  void _navigate(String key, bool wide) {
    final section = HomeSection.values.firstWhere((s) => s.name == key,
        orElse: () => HomeSection.home);
    final phoneTabs = const [
      HomeSection.home,
      HomeSection.live,
      HomeSection.movies,
      HomeSection.series,
    ];
    if (wide || phoneTabs.contains(section)) {
      _select(section);
      return;
    }
    _pushStandalone(section);
  }

  void _pushStandalone(HomeSection s) {
    final Widget page = switch (s) {
      HomeSection.search => const SearchScreen(standalone: true),
      HomeSection.messages => const MessagesScreen(standalone: true),
      HomeSection.account =>
        const AccountScreen(standalone: true, includeSettings: false),
      HomeSection.favorites =>
        const StandalonePage(title: 'Favoritos', child: FavoritesScreen()),
      HomeSection.recents =>
        const StandalonePage(title: 'Recientes', child: RecentsScreen()),
      _ => const SizedBox.shrink(),
    };
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  Future<void> _onBack(bool wide) async {
    final base = _baseSection(readSections(context));
    // Solo canales: desde la lista de canales, Atrás ya es salir.
    final exitFromList = base == HomeSection.live && _section == base;
    if (wide && !_sidebarFocused && !exitFromList) {
      _navNodes[_section]?.requestFocus();
      return;
    }
    if (_section != base) {
      _select(base);
      if (wide) _navNodes[base]?.requestFocus();
      return;
    }
    final exit = await confirmDialog(
      context,
      title: 'Salir',
      message: '¿Desea salir de ${AppConfig.appName}?',
      confirm: 'Salir',
    );
    if (exit) await Device.exitApp();
  }

  Widget _buildSection(HomeSection s, bool wide) {
    switch (s) {
      case HomeSection.home:
        return DashboardScreen(onNavigate: (k) => _navigate(k, wide));
      case HomeSection.live:
        return LiveScreen(focusRequest: _liveFocus);
      case HomeSection.movies:
        return const CatalogScreen(type: ContentType.movie);
      case HomeSection.series:
        return const CatalogScreen(type: ContentType.series);
      case HomeSection.favorites:
        return const FavoritesScreen();
      case HomeSection.recents:
        return const RecentsScreen();
      case HomeSection.search:
        return const SearchScreen();
      case HomeSection.messages:
        return const MessagesScreen();
      case HomeSection.account:
        return const AccountScreen();
      case HomeSection.more:
        return _MoreScreen(onOpen: _pushStandalone);
    }
  }

  Widget _content(List<HomeSection> sections, bool wide) {
    var index = sections.indexOf(_section);
    if (index < 0) index = 0;
    return IndexedStack(
      index: index,
      children: [
        for (final s in sections)
          KeyedSubtree(
            key: ValueKey(s),
            child: FocusTraversalGroup(
              child: _visited.contains(s)
                  ? _buildSection(s, wide)
                  : const SizedBox.shrink(),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final session = context.watch<SessionProvider>();
    final portal = context.watch<PortalProvider>();
    if (session.source == null) {
      return const Scaffold(body: SizedBox.shrink());
    }
    if (portal.userBlocked) {
      return PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) Device.exitApp();
        },
        child: Scaffold(
          body: AccountBlockedView(
            user: portal.info!.user,
            actions: [
              TvButton(
                label: 'Reintentar',
                icon: Icons.refresh,
                primary: true,
                autofocus: true,
                onPressed: portal.refresh,
              ),
              TvButton(
                label: 'Cambiar perfil',
                icon: Icons.switch_account_outlined,
                onPressed: () => switchProfile(context),
              ),
            ],
          ),
        ),
      );
    }

    final wide = Responsive.isWide(context);
    // Solo las secciones que ve el cliente (el portal puede cambiarlas en plena sesión).
    final content = session.sectionsWith(portal.content);
    final sections =
        wide ? _wideSections(content, portal) : _phoneSections(content);
    if (!sections.contains(_section)) {
      final base = _baseSection(content);
      _section = sections.contains(base) ? base : HomeSection.home;
      _visited.add(_section);
    }

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _onBack(wide);
      },
      child: wide
          ? _wideLayout(sections, session, portal)
          : _phoneLayout(sections, portal),
    );
  }

  Widget _wideLayout(List<HomeSection> sections, SessionProvider session,
      PortalProvider portal) {
    final width = MediaQuery.sizeOf(context).width;
    final expanded = _sidebarFocused || (!Device.isTv && width >= 1180);
    return Scaffold(
      body: Row(
        children: [
          FocusTraversalGroup(
            child: Focus(
              canRequestFocus: false,
              skipTraversal: true,
              onFocusChange: (f) => setState(() => _sidebarFocused = f),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: expanded ? 220 : 84,
                color: AppColors.surface,
                child: SafeArea(
                  right: false,
                  child: Column(
                    children: [
                      const SizedBox(height: 18),
                      _SidebarHeader(expanded: expanded),
                      const SizedBox(height: 18),
                      Expanded(
                        child: ListView(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          children: [
                            for (final s in sections)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 4),
                                child: _NavItem(
                                  section: s,
                                  focusNode: _navNodes[s]!,
                                  selected: s == _section,
                                  expanded: expanded,
                                  autofocus: s == _section,
                                  badge: s == HomeSection.messages
                                      ? portal.unreadCount
                                      : 0,
                                  onTap: () => _select(s),
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (expanded)
                        Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: [
                              const Icon(Icons.person_outline,
                                  size: 18, color: AppColors.textSecondary),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  session.profile?.name ?? '',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                      color: AppColors.textSecondary),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: SafeArea(
              left: false,
              child: Column(
                children: [
                  const PortalNoticesBar(),
                  Expanded(child: _content(sections, true)),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _phoneLayout(List<HomeSection> sections, PortalProvider portal) {
    final index = sections.indexOf(_section).clamp(0, sections.length - 1);
    final unread = portal.unreadCount;
    return Scaffold(
      appBar: AppBar(
        title: Text(_section == HomeSection.home
            ? AppConfig.appName
            : _section.label),
        actions: [
          IconButton(
            tooltip: 'Buscar',
            icon: const Icon(Icons.search_rounded),
            onPressed: () => _pushStandalone(HomeSection.search),
          ),
          if (portal.enabled)
            IconButton(
              tooltip: 'Mensajes',
              icon: Badge(
                isLabelVisible: unread > 0,
                label: Text('$unread'),
                child: const Icon(Icons.mail_outline_rounded),
              ),
              onPressed: () => _pushStandalone(HomeSection.messages),
            ),
        ],
      ),
      body: Column(
        children: [
          if (_section == HomeSection.home || _section == HomeSection.live)
            const PortalNoticesBar(),
          Expanded(child: _content(sections, false)),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        height: 66,
        onDestinationSelected: (i) => _select(sections[i]),
        destinations: [
          for (final s in sections)
            NavigationDestination(
              icon: s == HomeSection.more && unread > 0
                  ? Badge(label: Text('$unread'), child: Icon(s.icon))
                  : Icon(s.icon),
              label: s.label,
            ),
        ],
      ),
    );
  }
}

/// Menú "Más" del teléfono.
class _MoreScreen extends StatelessWidget {
  final void Function(HomeSection section) onOpen;
  const _MoreScreen({required this.onOpen});

  @override
  Widget build(BuildContext context) {
    final portal = context.watch<PortalProvider>();
    final session = context.watch<SessionProvider>();
    final unread = portal.unreadCount;

    Widget tile(IconData icon, String title, VoidCallback onTap,
        {String? subtitle, int badge = 0}) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: FocusableCard(
          onTap: onTap,
          focusScale: 1.02,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Icon(icon, color: AppColors.accent),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600)),
                    if (subtitle != null)
                      Text(subtitle,
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.textSecondary)),
                  ],
                ),
              ),
              if (badge > 0)
                Badge(label: Text('$badge'))
              else
                const Icon(Icons.chevron_right, color: AppColors.textSecondary),
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        tile(Icons.favorite_border_rounded, 'Favoritos',
            () => onOpen(HomeSection.favorites)),
        tile(Icons.history_rounded, 'Recientes',
            () => onOpen(HomeSection.recents)),
        if (portal.enabled)
          tile(Icons.mail_outline_rounded, 'Mensajes',
              () => onOpen(HomeSection.messages),
              badge: unread),
        tile(Icons.account_circle_outlined, 'Cuenta',
            () => onOpen(HomeSection.account),
            subtitle: session.profile?.name),
        tile(Icons.switch_account_outlined, 'Perfiles',
            () => switchProfile(context),
            subtitle: 'Cambiar, agregar o editar perfiles'),
        tile(Icons.settings_outlined, 'Ajustes', () {
          Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const SettingsScreen()));
        }),
        const SizedBox(height: 20),
        Center(
          child: Text(
              '${AppConfig.appName} ${Device.appVersion}'
              '${Device.appBuild.isNotEmpty ? ' (${Device.appBuild})' : ''}',
              style: const TextStyle(color: AppColors.textMuted, fontSize: 12)),
        ),
      ],
    );
  }
}

class _SidebarHeader extends StatelessWidget {
  final bool expanded;
  const _SidebarHeader({required this.expanded});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 18),
      child: Row(
        mainAxisAlignment:
            expanded ? MainAxisAlignment.start : MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.accent,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.live_tv_rounded, size: 22),
          ),
          if (expanded) ...[
            const SizedBox(width: 10),
            const Expanded(
              child: Text(
                AppConfig.appName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final HomeSection section;
  final FocusNode focusNode;
  final bool selected;
  final bool expanded;
  final bool autofocus;
  final int badge;
  final VoidCallback onTap;

  const _NavItem({
    required this.section,
    required this.focusNode,
    required this.selected,
    required this.expanded,
    required this.autofocus,
    required this.badge,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Widget icon = Icon(section.icon,
        color: selected ? AppColors.text : AppColors.textSecondary);
    if (badge > 0) {
      icon = Badge(label: Text('$badge'), child: icon);
    }
    return FocusableCard(
      focusNode: focusNode,
      autofocus: autofocus,
      selected: selected,
      color: Colors.transparent,
      focusScale: 1.04,
      borderRadius: 12,
      ensureVisible: false,
      onTap: onTap,
      semanticLabel: section.label,
      child: SizedBox(
        height: 48,
        child: Row(
          mainAxisAlignment:
              expanded ? MainAxisAlignment.start : MainAxisAlignment.center,
          children: [
            if (expanded) const SizedBox(width: 14),
            icon,
            if (expanded) ...[
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  section.label,
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: selected ? AppColors.text : AppColors.textSecondary,
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
