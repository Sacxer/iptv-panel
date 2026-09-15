import { Link, useNavigate } from 'react-router-dom';
import { Package as PackageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { usePackages } from '../../hooks/useResources';
import { useAuth } from '../../context/AuthContext';
import { DataTable } from '../../components/DataTable';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { PageHeader } from '../../components/ui';
import type { Package } from '../../types';
import { formatDate, formatNumber, truncate } from '../../utils/format';

export function PackagesPage() {
  const { packages, loading, error, reload } = usePackages();
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const remove = async (p: Package) => {
    const ok = await confirm({
      title: 'Eliminar paquete',
      message: (
        <>
          ¿Eliminar el paquete <strong>{p.name}</strong>?
          {p.user_count > 0 && (
            <>
              {' '}
              Tiene <strong>{formatNumber(p.user_count)}</strong> cliente(s) asignados que dejarán de tener este contenido.
            </>
          )}
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.packages.remove(p.id);
      toast.success('Paquete eliminado');
      void reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Paquetes"
        subtitle="Agrupaciones de canales, películas y series que se asignan a los clientes (bouquets)"
        actions={
          isAdmin ? (
            <Link to="/paquetes/nuevo" className="btn btn-primary">
              <Plus size={16} /> Nuevo paquete
            </Link>
          ) : undefined
        }
      />
      <DataTable<Package>
        rows={packages}
        rowKey={(p) => p.id}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        onRowClick={isAdmin ? (p) => navigate(`/paquetes/${p.id}`) : undefined}
        emptyTitle="Aún no hay paquetes"
        emptyDescription="Crea paquetes para controlar qué contenido ve cada cliente."
        columns={[
          {
            key: 'name',
            header: 'Nombre',
            render: (p) => (
              <div className="cell-main">
                <span className="strong">
                  <PackageIcon size={14} className="inline-icon" /> {p.name}
                </span>
                {p.description && <span className="muted text-sm">{truncate(p.description, 90)}</span>}
              </div>
            ),
          },
          { key: 'streams', header: 'Canales / películas', render: (p) => formatNumber(p.stream_count) },
          { key: 'series', header: 'Series', render: (p) => formatNumber(p.series_count) },
          { key: 'users', header: 'Clientes', render: (p) => formatNumber(p.user_count) },
          { key: 'created', header: 'Creado', hideOnMobile: true, render: (p) => <span className="muted">{formatDate(p.created_at)}</span> },
          ...(isAdmin ? [{
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (p: Package) => (
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                <Link to={`/paquetes/${p.id}`} className="btn btn-ghost btn-icon btn-sm" title="Editar">
                  <Pencil size={15} />
                </Link>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(p)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          }] : []),
        ]}
      />
    </>
  );
}
