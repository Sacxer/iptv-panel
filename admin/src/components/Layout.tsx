import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { PageLoader } from './ui';
import { api } from '../api';
import { useInterval } from '../hooks/useInterval';
import { DEVICES_CHANGED_EVENT } from './DeviceIcon';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowRightLeft,
  Rocket,
  DatabaseBackup,
  ListOrdered,
  CalendarClock,
  Activity,
  Antenna,
  Cpu,
  Server,
  MonitorSmartphone,
  ContactRound,
  Clapperboard,
  DatabaseZap,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Moon,
  Package as PackageIcon,
  ScrollText,
  Settings as SettingsIcon,
  Sun,
  Tv,
  Users,
  Film,
  X,
  ZapOff,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../hooks/useTheme';
import { ROLE_LABEL } from '../utils/labels';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  adminOnly?: boolean;
  end?: boolean;
  badge?: 'devices';
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    title: 'General',
    items: [
      { to: '/', label: 'Panel', icon: <LayoutDashboard size={18} />, end: true },
      { to: '/clientes', label: 'Clientes', icon: <ContactRound size={18} /> },
      { to: '/dispositivos', label: 'Dispositivos', icon: <MonitorSmartphone size={18} />, badge: 'devices' },
      { to: '/conexiones', label: 'Conexiones', icon: <Activity size={18} /> },
    ],
  },
  {
    title: 'Contenido',
    items: [
      { to: '/paquetes', label: 'Paquetes', icon: <PackageIcon size={18} /> },
      { to: '/categorias', label: 'Categorías', icon: <FolderTree size={18} />, adminOnly: true },
      { to: '/canales', label: 'Canales', icon: <Tv size={18} />, adminOnly: true },
      { to: '/ordenar-canales', label: 'Ordenar canales', icon: <ListOrdered size={18} />, adminOnly: true },
      { to: '/peliculas', label: 'Películas', icon: <Film size={18} />, adminOnly: true },
      { to: '/series', label: 'Series', icon: <Clapperboard size={18} />, adminOnly: true },
      { to: '/guia-epg', label: 'Guía EPG', icon: <CalendarClock size={18} />, adminOnly: true },
    ],
  },
  {
    title: 'Streaming',
    items: [
      { to: '/servidores', label: 'Servidores', icon: <Server size={18} />, adminOnly: true },
      { to: '/perfiles', label: 'Perfiles de transcodificación', icon: <Cpu size={18} />, adminOnly: true },
      { to: '/astra', label: 'Astra', icon: <Antenna size={18} />, adminOnly: true },
    ],
  },
  {
    title: 'Comunicación',
    items: [
      { to: '/mensajes', label: 'Mensajes', icon: <MessageSquare size={18} />, adminOnly: true },
      { to: '/avisos', label: 'Avisos', icon: <Megaphone size={18} />, adminOnly: true },
      { to: '/cortes', label: 'Cortes', icon: <ZapOff size={18} />, adminOnly: true },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: '/migracion', label: 'Migración XtreamUI', icon: <DatabaseZap size={18} />, adminOnly: true },
      { to: '/migracion-wisphub', label: 'Migración WispHub', icon: <ArrowRightLeft size={18} />, adminOnly: true },
      { to: '/usuarios-panel', label: 'Usuarios', icon: <Users size={18} />, adminOnly: true },
      { to: '/ajustes', label: 'Ajustes', icon: <SettingsIcon size={18} />, adminOnly: true },
      { to: '/copias-de-seguridad', label: 'Copias de seguridad', icon: <DatabaseBackup size={18} />, adminOnly: true },
      { to: '/actualizaciones-app', label: 'Actualizaciones de la app', icon: <Rocket size={18} />, adminOnly: true },
      { to: '/registro', label: 'Registro de actividad', icon: <ScrollText size={18} />, adminOnly: true },
    ],
  },
];

export function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const [openAlerts, setOpenAlerts] = useState(0);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Insignia de alertas de dispositivos abiertas (se refresca cada 60 s o al cambiar algo).
  const loadAlerts = () => {
    api.devices
      .stats()
      .then((s) => setOpenAlerts(s?.open_alerts ?? 0))
      .catch(() => undefined);
  };
  useEffect(() => {
    loadAlerts();
    window.addEventListener(DEVICES_CHANGED_EVENT, loadAlerts);
    return () => window.removeEventListener(DEVICES_CHANGED_EVENT, loadAlerts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useInterval(loadAlerts, 60000);

  return (
    <div className={`app ${open ? 'sidebar-open' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">
            <Tv size={18} />
          </span>
          <span className="brand-name">Panel IPTV</span>
          <button type="button" className="btn btn-ghost btn-icon sidebar-close" onClick={() => setOpen(false)} aria-label="Cerrar menú">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={group.title} className="nav-group">
                <div className="nav-group-title">{group.title}</div>
                {items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge === 'devices' && openAlerts > 0 && (
                      <span className="nav-badge" title={`${openAlerts} alerta(s) de dispositivos abiertas`}>
                        {openAlerts > 99 ? '99+' : openAlerts}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="sidebar-overlay" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="btn btn-ghost btn-icon menu-toggle" onClick={() => setOpen(true)} aria-label="Abrir menú">
            <Menu size={20} />
          </button>
          <div className="topbar-spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={toggle}
            title={theme === 'dark' ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {user && (
            <div className="topbar-user">
              <span className="avatar">
                <UserRound size={16} />
              </span>
              <span className="topbar-user-text">
                <span className="topbar-username">{user.username}</span>
                <span className="topbar-role">{ROLE_LABEL[user.role] ?? user.role}</span>
              </span>
            </div>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout} title="Cerrar sesión">
            <LogOut size={16} />
            <span className="hide-mobile">Salir</span>
          </button>
        </header>
        <main className="content">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
