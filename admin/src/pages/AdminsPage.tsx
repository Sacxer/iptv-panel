import { useEffect, useState } from 'react';
import { Dices, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useAuth } from '../context/AuthContext';
import { useAdmins } from '../hooks/useResources';
import { DataTable } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { EnabledBadge } from '../components/StatusBadge';
import { Alert, Badge, FormField, PageHeader, Select, Spinner, Switch } from '../components/ui';
import type { AdminAccount, AdminInput, Role } from '../types';
import { formatDate, formatNumber, generatePassword } from '../utils/format';
import { ROLE_LABEL } from '../utils/labels';

export function AdminsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { admins, loading, error, reload } = useAdmins(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAccount | null>(null);

  const remove = async (a: AdminAccount) => {
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: (
        <>
          ¿Eliminar el usuario del panel <strong>{a.username}</strong>?
          {a.user_count > 0 && <> Tiene {formatNumber(a.user_count)} cliente(s) asignados.</>}
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.admins.remove(a.id);
      toast.success('Usuario eliminado');
      void reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Usuarios"
        subtitle="Cuentas con acceso al panel (administradores y revendedores)"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Nuevo usuario
          </button>
        }
      />
      <DataTable<AdminAccount>
        rows={admins}
        rowKey={(a) => a.id}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        emptyTitle="No hay usuarios del panel"
        columns={[
          {
            key: 'username',
            header: 'Usuario',
            render: (a) => (
              <span className="strong">
                {a.username} {a.id === user?.id && <span className="muted text-xs">(tú)</span>}
              </span>
            ),
          },
          { key: 'role', header: 'Rol', render: (a) => <Badge tone={a.role === 'admin' ? 'purple' : 'blue'}>{ROLE_LABEL[a.role] ?? a.role}</Badge> },
          { key: 'enabled', header: 'Estado', render: (a) => <EnabledBadge enabled={a.enabled} /> },
          { key: 'users', header: 'Clientes', render: (a) => formatNumber(a.user_count) },
          { key: 'created', header: 'Creado', hideOnMobile: true, render: (a) => <span className="muted">{formatDate(a.created_at)}</span> },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (a) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(a); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm text-red"
                  title={a.id === user?.id ? 'No puedes eliminar tu propia cuenta' : 'Eliminar'}
                  disabled={a.id === user?.id}
                  onClick={() => void remove(a)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      <AdminFormModal
        open={formOpen}
        admin={editing}
        isSelf={editing !== null && editing.id === user?.id}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void reload(true);
        }}
      />
    </>
  );
}

function AdminFormModal({
  open,
  admin,
  isSelf,
  onClose,
  onSaved,
}: {
  open: boolean;
  admin: AdminAccount | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('reseller');
  const [enabled, setEnabled] = useState(true);
  const [errors, setErrors] = useState<{ username?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUsername(admin?.username ?? '');
    setPassword('');
    setRole(admin?.role ?? 'reseller');
    setEnabled(admin?.enabled ?? true);
    setErrors({});
    setServerError(null);
  }, [open, admin]);

  const submit = async () => {
    const e: typeof errors = {};
    if (!username.trim()) e.username = 'El usuario es obligatorio';
    else if (!/^[A-Za-z0-9._@-]{3,}$/.test(username.trim())) e.username = 'Mínimo 3 caracteres, sin espacios';
    if (!admin && !password) e.password = 'La contraseña es obligatoria';
    else if (password && password.length < 6) e.password = 'Mínimo 6 caracteres';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    const body: AdminInput = { username: username.trim(), role, enabled };
    if (password) body.password = password;
    try {
      if (admin) await api.admins.update(admin.id, body);
      else await api.admins.create(body);
      toast.success(admin ? 'Usuario actualizado' : 'Usuario creado');
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={admin ? `Editar usuario: ${admin.username}` : 'Nuevo usuario'}
      onClose={onClose}
      size="sm"
      dismissible={!busy}
      onSubmit={() => void submit()}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner size={14} />} Guardar
          </button>
        </>
      }
    >
      {serverError && <Alert tone="red">{serverError}</Alert>}
      <FormField label="Usuario" required error={errors.username}>
        <input className="input" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
      </FormField>
      <FormField label="Contraseña" required={!admin} error={errors.password} hint={admin ? 'Déjala vacía para no cambiarla' : undefined}>
        <div className="input-group">
          <input className="input mono" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPassword(generatePassword(12))}>
            <Dices size={15} /> Generar
          </button>
        </div>
      </FormField>
      <FormField label="Rol">
        <Select
          value={role}
          onChange={(v) => setRole(v as Role)}
          disabled={isSelf}
          options={[
            { value: 'reseller', label: ROLE_LABEL.reseller },
            { value: 'admin', label: ROLE_LABEL.admin },
          ]}
        />
      </FormField>
      <p className="muted text-sm">
        {role === 'admin'
          ? 'Acceso total: contenido, ajustes, migración, registro y todos los clientes.'
          : 'Solo ve y gestiona los clientes que crea o que se le asignan.'}
      </p>
      <Switch checked={enabled} onChange={setEnabled} disabled={isSelf} label="Habilitada" description="Una cuenta deshabilitada no puede iniciar sesión." />
    </Modal>
  );
}
