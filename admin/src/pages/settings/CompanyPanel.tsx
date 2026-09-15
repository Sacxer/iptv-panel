import { useEffect, useState } from 'react';
import { Building2, ExternalLink, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useAsync } from '../../hooks/useAsync';
import { useToast } from '../../components/Toast';
import { Alert, CopyButton, ErrorState, FormField, PageLoader, Spinner } from '../../components/ui';
import type { Settings } from '../../types';
import { isValidEmail } from '../../utils/format';

interface Form {
  company_name: string;
  app_name: string;
  support_email: string;
  support_phone: string;
}

function toForm(s: Settings): Form {
  return {
    company_name: s.company_name ?? '',
    app_name: s.app_name || 'IPTV Player',
    support_email: s.support_email ?? '',
    support_phone: s.support_phone ?? '',
  };
}

/** true si la dirección no es accesible desde internet (IP privada, CGNAT o local). */
export function isPrivateHost(url: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return true;
  }
  if (!host || host === 'localhost' || host.endsWith('.local')) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254);
  }
  return host === '::1' || /^f[cd]/i.test(host) || /^fe80/i.test(host);
}

export function CompanyPanel({ onSaved }: { onSaved?: (s: Settings) => void }) {
  const toast = useToast();
  const settings = useAsync(() => api.settings.get(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.data) setForm(toForm(settings.data));
  }, [settings.data]);

  if (!settings.data || !form) return settings.error ? <ErrorState message={settings.error} onRetry={() => void settings.reload()} /> : <PageLoader />;

  const s = settings.data;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(s));

  const save = async () => {
    const e: typeof errors = {};
    if (form.support_email.trim() && !isValidEmail(form.support_email.trim())) e.support_email = 'Email no válido';
    if (!form.app_name.trim()) e.app_name = 'Indica el nombre de la app';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const next = await api.settings.update({
        company_name: form.company_name.trim(),
        app_name: form.app_name.trim(),
        support_email: form.support_email.trim(),
        support_phone: form.support_phone.trim(),
      });
      settings.setData(next);
      onSaved?.(next);
      toast.success('Datos de la empresa guardados');
    } catch (err) {
      const msg = errorMessage(err);
      // El servidor valida el email: el error se muestra en el campo.
      if (/correo|email/i.test(msg)) setErrors({ support_email: msg });
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const base = (s.public_url || window.location.origin).replace(/\/+$/, '');
  const links = [
    { label: 'Política de privacidad', url: `${base}/privacidad` },
    { label: 'Eliminación de datos', url: `${base}/eliminar-datos` },
  ];
  const privateUrl = isPrivateHost(base);

  return (
    <div className="settings-grid">
      <section className="card">
        <h2 className="card-title">
          <Building2 size={18} /> Empresa
        </h2>
        <p className="muted text-sm">Aparece en la política de privacidad, en la página de eliminación de datos y como contacto de soporte.</p>
        <FormField label="Nombre de la empresa" htmlFor="co-name">
          <input id="co-name" className="input" value={form.company_name} onChange={(e) => set('company_name', e.target.value)} placeholder="Mi ISP S.A.S." />
        </FormField>
        <FormField label="Nombre de la app" htmlFor="co-app" error={errors.app_name} hint="Como aparece en la tienda y en los equipos.">
          <input id="co-app" className="input" value={form.app_name} onChange={(e) => set('app_name', e.target.value)} placeholder="IPTV Player" />
        </FormField>
        <div className="grid-2 align-start">
          <FormField label="Email de soporte" htmlFor="co-email" error={errors.support_email}>
            <input id="co-email" className="input" type="email" value={form.support_email} onChange={(e) => set('support_email', e.target.value)} placeholder="soporte@miempresa.com" />
          </FormField>
          <FormField label="Teléfono de soporte" htmlFor="co-phone">
            <input id="co-phone" className="input" type="tel" value={form.support_phone} onChange={(e) => set('support_phone', e.target.value)} placeholder="+57 300 000 0000" />
          </FormField>
        </div>
        <div className="row row-end mt">
          {dirty && <span className="muted text-sm">Hay cambios sin guardar</span>}
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? <Spinner size={14} /> : <Save size={16} />} Guardar
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          <ShieldCheck size={18} /> Enlaces públicos para las tiendas
        </h2>
        <p className="muted text-sm">Google Play pide estas direcciones al publicar la app. Se generan con los datos de la empresa.</p>
        <div className="stack">
          {links.map((l) => (
            <FormField key={l.url} label={l.label}>
              <div className="input-group">
                <input className="input mono" readOnly value={l.url} onFocus={(e) => e.target.select()} />
                <CopyButton text={l.url} />
                <a className="btn btn-ghost btn-sm" href={l.url} target="_blank" rel="noreferrer" title="Abrir en otra pestaña">
                  <ExternalLink size={14} />
                </a>
              </div>
            </FormField>
          ))}
        </div>
        {!s.public_url && <p className="muted text-xs">Aún no hay URL para clientes guardada: se usa la dirección con la que abriste el panel.</p>}
        {privateUrl && (
          <Alert tone="amber" icon={<TriangleAlert size={18} />} title="Google no podrá abrir estas páginas">
            La dirección del portal es privada (red local o VPN). Google Play necesita que sean públicas en internet: publica el portal en el VPS con
            un dominio, o copia el texto de las páginas en una página gratuita como Google Sites y usa ese enlace.
          </Alert>
        )}
      </section>
    </div>
  );
}
