import { Link } from 'react-router-dom';
import { ArrowLeft, House } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { NetworkPanel } from '../settings/NetworkPanel';

/** Detalle del propio portal: IP / URL para clientes y puertos. */
export function MainServerPage() {
  return (
    <>
      <PageHeader
        title={
          <span className="row-inline">
            <House size={20} /> Servidor principal (este portal)
          </span>
        }
        subtitle="La IP, la URL y los puertos con los que los clientes se conectan a este portal"
        actions={
          <Link to="/servidores" className="btn btn-ghost">
            <ArrowLeft size={16} /> Servidores
          </Link>
        }
      />
      <NetworkPanel />
    </>
  );
}
