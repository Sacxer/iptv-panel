import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState
        icon={<Compass size={32} />}
        title="Página no encontrada"
        description="La dirección que buscas no existe o fue movida."
        action={
          <Link to="/" className="btn btn-primary">
            Ir al panel
          </Link>
        }
      />
    </div>
  );
}
