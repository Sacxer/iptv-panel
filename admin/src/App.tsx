import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { PageLoader } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';

// Páginas cargadas bajo demanda para reducir el tamaño inicial.
const UsersPage = lazy(() => import('./pages/users/UsersPage').then((m) => ({ default: m.UsersPage })));
const PackagesPage = lazy(() => import('./pages/packages/PackagesPage').then((m) => ({ default: m.PackagesPage })));
const PackageEditorPage = lazy(() => import('./pages/packages/PackageEditorPage').then((m) => ({ default: m.PackageEditorPage })));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const StreamsPage = lazy(() => import('./pages/streams/StreamsPage').then((m) => ({ default: m.StreamsPage })));
const SeriesPage = lazy(() => import('./pages/series/SeriesPage').then((m) => ({ default: m.SeriesPage })));
const EpisodesPage = lazy(() => import('./pages/series/EpisodesPage').then((m) => ({ default: m.EpisodesPage })));
const MessagesPage = lazy(() => import('./pages/messages/MessagesPage').then((m) => ({ default: m.MessagesPage })));
const NoticesPage = lazy(() => import('./pages/NoticesPage').then((m) => ({ default: m.NoticesPage })));
const OutagesPage = lazy(() => import('./pages/outages/OutagesPage').then((m) => ({ default: m.OutagesPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then((m) => ({ default: m.ConnectionsPage })));
const ChannelOrderPage = lazy(() => import('./pages/streams/ChannelOrderPage').then((m) => ({ default: m.ChannelOrderPage })));
const VersionPage = lazy(() => import('./pages/version/VersionPage').then((m) => ({ default: m.VersionPage })));
const AppReleasesPage = lazy(() => import('./pages/appReleases/AppReleasesPage').then((m) => ({ default: m.AppReleasesPage })));
const BackupsPage = lazy(() => import('./pages/backups/BackupsPage').then((m) => ({ default: m.BackupsPage })));
const EpgPage = lazy(() => import('./pages/epg/EpgPage').then((m) => ({ default: m.EpgPage })));
const MigrationPage = lazy(() => import('./pages/migration/MigrationPage').then((m) => ({ default: m.MigrationPage })));
const WisphubMigrationPage = lazy(() => import('./pages/wisphub/WisphubMigrationPage').then((m) => ({ default: m.WisphubMigrationPage })));
const AdminsPage = lazy(() => import('./pages/AdminsPage').then((m) => ({ default: m.AdminsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then((m) => ({ default: m.LogsPage })));
const DevicesPage = lazy(() => import('./pages/devices/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const ServersPage = lazy(() => import('./pages/streaming/ServersPage').then((m) => ({ default: m.ServersPage })));
const ServerDetailPage = lazy(() => import('./pages/streaming/ServerDetailPage').then((m) => ({ default: m.ServerDetailPage })));
const ProfilesPage = lazy(() => import('./pages/streaming/ProfilesPage').then((m) => ({ default: m.ProfilesPage })));
const AstraPage = lazy(() => import('./pages/streaming/AstraPage').then((m) => ({ default: m.AstraPage })));
const AstraSourcePage = lazy(() => import('./pages/streaming/AstraSourcePage').then((m) => ({ default: m.AstraSourcePage })));
import { NotFoundPage } from './pages/NotFoundPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, checking } = useAuth();
  const location = useLocation();
  if (checking) return <PageLoader label="Verificando sesión…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Redirección que conserva la cadena de consulta (?status=… etc.). */
function RedirectKeepQuery({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="clientes" element={<UsersPage />} />
        <Route path="usuarios" element={<RedirectKeepQuery to="/clientes" />} />
        <Route path="dispositivos" element={<DevicesPage />} />
        <Route path="administradores" element={<RedirectKeepQuery to="/usuarios-panel" />} />
        <Route path="conexiones" element={<ConnectionsPage />} />
        <Route path="paquetes" element={<PackagesPage />} />
        <Route path="paquetes/nuevo" element={<RequireAdmin><PackageEditorPage /></RequireAdmin>} />
        <Route path="paquetes/:id" element={<RequireAdmin><PackageEditorPage /></RequireAdmin>} />
        <Route path="categorias" element={<RequireAdmin><CategoriesPage /></RequireAdmin>} />
        <Route path="canales" element={<RequireAdmin><StreamsPage key="live" type="live" /></RequireAdmin>} />
        <Route path="peliculas" element={<RequireAdmin><StreamsPage key="movie" type="movie" /></RequireAdmin>} />
        <Route path="series" element={<RequireAdmin><SeriesPage /></RequireAdmin>} />
        <Route path="series/:id/episodios" element={<RequireAdmin><EpisodesPage /></RequireAdmin>} />
        <Route path="mensajes" element={<RequireAdmin><MessagesPage /></RequireAdmin>} />
        <Route path="avisos" element={<RequireAdmin><NoticesPage /></RequireAdmin>} />
        <Route path="cortes" element={<RequireAdmin><OutagesPage /></RequireAdmin>} />
        <Route path="guia-epg" element={<RequireAdmin><EpgPage /></RequireAdmin>} />
        <Route path="copias-de-seguridad" element={<RequireAdmin><BackupsPage /></RequireAdmin>} />
        <Route path="actualizaciones-app" element={<RequireAdmin><AppReleasesPage /></RequireAdmin>} />
        <Route path="version" element={<RequireAdmin><VersionPage /></RequireAdmin>} />
        <Route path="ordenar-canales" element={<RequireAdmin><ChannelOrderPage /></RequireAdmin>} />
        <Route path="servidores" element={<RequireAdmin><ServersPage /></RequireAdmin>} />
        <Route path="servidores/:id" element={<RequireAdmin><ServerDetailPage /></RequireAdmin>} />
        <Route path="perfiles" element={<RequireAdmin><ProfilesPage /></RequireAdmin>} />
        <Route path="astra" element={<RequireAdmin><AstraPage /></RequireAdmin>} />
        <Route path="astra/:id" element={<RequireAdmin><AstraSourcePage /></RequireAdmin>} />
        <Route
          path="migracion"
          element={
            <RequireAdmin>
              <MigrationPage />
            </RequireAdmin>
          }
        />
        <Route path="migracion-wisphub" element={<RequireAdmin><WisphubMigrationPage /></RequireAdmin>} />
        <Route
          path="usuarios-panel"
          element={
            <RequireAdmin>
              <AdminsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="ajustes"
          element={
            <RequireAdmin>
              <SettingsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="registro"
          element={
            <RequireAdmin>
              <LogsPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
