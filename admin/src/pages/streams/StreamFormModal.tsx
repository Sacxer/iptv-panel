import { useEffect, useState } from 'react';
import { Lock, LockOpen, Plus, Search, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { DeliverySelector, validateDelivery } from '../../components/DeliverySelector';
import { useProfiles, useServers } from '../../hooks/useStreaming';
import { PackageChecklist } from '../../components/PackageChecklist';
import { useToast } from '../../components/Toast';
import { Alert, Badge, FormField, Select, Spinner, Switch, Thumb } from '../../components/ui';
import { EpgSearchModal } from '../epg/EpgShared';
import type { Category, DeliveryValue, Package, Stream, StreamInput, StreamType } from '../../types';
import { isValidUrl } from '../../utils/format';

interface Props {
  open: boolean;
  type: StreamType;
  stream: Stream | null;
  categories: Category[];
  packages: Package[];
  onClose: () => void;
  onSaved: () => void;
}

const EXTENSIONS: Record<StreamType, string[]> = {
  live: ['ts', 'm3u8'],
  movie: ['mp4', 'mkv', 'avi', 'mov', 'm3u8', 'ts'],
};

function emptyInput(type: StreamType): StreamInput {
  return {
    type,
    name: '',
    category_id: null,
    logo: '',
    source_url: '',
    backup_urls: [],
    epg_channel_id: '',
    container_extension: type === 'live' ? 'ts' : 'mp4',
    tv_archive_duration: 0,
    sort_order: 0,
    enabled: true,
    info: { plot: '', genre: '', rating: '', releasedate: '', duration: '', cover: '' },
    package_ids: [],
    delivery_mode: 'default',
    transcode_profile_id: null,
    always_on: false,
    server_ids: [],
  };
}

function fromStream(s: Stream): StreamInput {
  return {
    type: s.type,
    name: s.name ?? '',
    category_id: s.category_id ?? null,
    logo: s.logo ?? '',
    source_url: s.source_url ?? '',
    backup_urls: s.backup_urls ?? [],
    epg_channel_id: s.epg_channel_id ?? '',
    container_extension: s.container_extension ?? '',
    tv_archive_duration: s.tv_archive_duration ?? 0,
    sort_order: s.sort_order ?? 0,
    enabled: s.enabled,
    info: {
      plot: s.info?.plot ?? '',
      genre: s.info?.genre ?? '',
      rating: s.info?.rating ?? '',
      releasedate: s.info?.releasedate ?? '',
      duration: s.info?.duration ?? '',
      cover: s.info?.cover ?? '',
    },
    package_ids: s.package_ids ?? [],
    delivery_mode: s.delivery_mode ?? 'default',
    transcode_profile_id: s.transcode_profile_id ?? null,
    always_on: s.always_on ?? false,
    server_ids: s.server_ids ?? [],
  };
}

type Errors = Partial<Record<'name' | 'source_url' | 'logo' | 'backup' | 'sort_order' | 'cover' | 'delivery', string>>;

export function StreamFormModal({ open, type, stream, categories, packages, onClose, onSaved }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<StreamInput>(() => (stream ? fromStream(stream) : emptyInput(type)));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const isMovie = type === 'movie';
  const noun = isMovie ? 'película' : 'canal';
  const { servers } = useServers(open);
  const { profiles } = useProfiles(open);
  /** EPG asignado a mano (el emparejamiento automático no lo cambia). */
  const [epgLocked, setEpgLocked] = useState(Boolean(stream?.epg_locked));
  const [epgSearchOpen, setEpgSearchOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(stream ? fromStream(stream) : emptyInput(type));
    setEpgLocked(Boolean(stream?.epg_locked));
    setErrors({});
    setServerError(null);
  }, [open, stream, type]);

  const set = <K extends keyof StreamInput>(key: K, value: StreamInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const deliveryValue: DeliveryValue = {
    delivery_mode: form.delivery_mode ?? 'default',
    transcode_profile_id: form.transcode_profile_id ?? null,
    server_ids: form.server_ids ?? [],
    always_on: form.always_on ?? false,
  };
  const setInfo = (key: keyof StreamInput['info'], value: string) => setForm((f) => ({ ...f, info: { ...f.info, [key]: value } }));

  const submit = async () => {
    const e: Errors = {};
    if (!form.name.trim()) e.name = 'El nombre es obligatorio';
    if (!form.source_url.trim()) e.source_url = 'La URL de origen es obligatoria';
    else if (!isValidUrl(form.source_url.trim())) e.source_url = 'URL no válida (debe empezar por http://, https://, rtmp://…)';
    if (form.logo.trim() && !isValidUrl(form.logo.trim())) e.logo = 'URL de imagen no válida';
    if (form.info.cover.trim() && !isValidUrl(form.info.cover.trim())) e.cover = 'URL de imagen no válida';
    if (form.backup_urls.some((u) => u.trim() && !isValidUrl(u.trim()))) e.backup = 'Hay URLs de respaldo no válidas';
    if (!Number.isInteger(form.sort_order)) e.sort_order = 'Debe ser un número entero';
    const deliveryError = validateDelivery(deliveryValue);
    if (deliveryError) e.delivery = deliveryError;
    setErrors(e);
    if (Object.keys(e).length) return;

    setBusy(true);
    setServerError(null);
    const body: StreamInput = {
      ...form,
      name: form.name.trim(),
      source_url: form.source_url.trim(),
      logo: form.logo.trim(),
      backup_urls: form.backup_urls.map((u) => u.trim()).filter(Boolean),
      epg_channel_id: form.epg_channel_id.trim(),
      container_extension: form.container_extension.trim(),
      // Se envía siempre el bloqueo para que guardar otros cambios no bloquee un EPG emparejado automáticamente.
      ...(isMovie ? {} : { epg_locked: form.epg_channel_id.trim() ? epgLocked : false }),
    };
    try {
      if (stream) await api.streams.update(stream.id, body);
      else await api.streams.create(body);
      toast.success(stream ? `${isMovie ? 'Película actualizada' : 'Canal actualizado'}` : `${isMovie ? 'Película creada' : 'Canal creado'}`);
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
      title={stream ? `Editar ${noun}` : `Nuevo ${isMovie ? 'película' : 'canal'}`}
      onClose={onClose}
      size="xl"
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
      <div className="grid-2">
        <div className="stack">
          <FormField label="Nombre" required error={errors.name} htmlFor="st-name">
            <input id="st-name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
          </FormField>
          <div className="grid-2">
            <FormField label="Categoría" htmlFor="st-cat">
              <Select
                id="st-cat"
                value={form.category_id === null ? '' : String(form.category_id)}
                onChange={(v) => set('category_id', v ? Number(v) : null)}
                placeholder="Sin categoría"
                options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              />
            </FormField>
            <FormField label="Orden" error={errors.sort_order} htmlFor="st-order">
              <input id="st-order" className="input" type="number" value={form.sort_order} onChange={(e) => set('sort_order', Math.floor(Number(e.target.value)))} />
            </FormField>
          </div>
          <FormField label={isMovie ? 'Logo / miniatura (URL)' : 'Logo (URL)'} error={errors.logo} htmlFor="st-logo">
            <div className="input-with-preview">
              <input id="st-logo" className="input" value={form.logo} onChange={(e) => set('logo', e.target.value)} placeholder="https://…/logo.png" />
              <Thumb src={form.logo.trim() || null} alt="Vista previa del logo" />
            </div>
          </FormField>
          <FormField label="URL de origen" required error={errors.source_url} htmlFor="st-src" hint="Dirección de la fuente que se reproduce o redirige.">
            <input id="st-src" className="input mono" value={form.source_url} onChange={(e) => set('source_url', e.target.value)} placeholder="http://origen:8080/stream.ts" />
          </FormField>
          <FormField label="URLs de respaldo" error={errors.backup} hint="Se usan si la fuente principal falla.">
            <div className="stack-sm">
              {form.backup_urls.map((url, i) => (
                <div key={i} className="input-group">
                  <input
                    className="input mono"
                    value={url}
                    onChange={(e) => set('backup_urls', form.backup_urls.map((u, j) => (j === i ? e.target.value : u)))}
                    placeholder="http://respaldo/…"
                  />
                  <button type="button" className="btn btn-ghost btn-icon" title="Quitar" onClick={() => set('backup_urls', form.backup_urls.filter((_, j) => j !== i))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm self-start" onClick={() => set('backup_urls', [...form.backup_urls, ''])}>
                <Plus size={14} /> Añadir respaldo
              </button>
            </div>
          </FormField>
          <div className="grid-2">
            {!isMovie && (
              <FormField
                label={
                  <span className="row-inline">
                    ID de canal EPG
                    {epgLocked && form.epg_channel_id.trim() && (
                      <span title="Asignado a mano: el emparejamiento automático no lo cambia">
                        <Badge tone="purple">
                          <Lock size={10} /> manual
                        </Badge>
                      </span>
                    )}
                  </span>
                }
                htmlFor="st-epg"
                hint={
                  epgLocked && form.epg_channel_id.trim() ? (
                    <span>
                      Bloqueado.{' '}
                      <button type="button" className="btn btn-link btn-sm inline-link" onClick={() => setEpgLocked(false)}>
                        <LockOpen size={12} /> Desbloquear
                      </button>{' '}
                      para que el emparejamiento automático pueda cambiarlo.
                    </span>
                  ) : stream?.epg_match_score && form.epg_channel_id.trim() === (stream.epg_channel_id ?? '') ? (
                    `Emparejado con la guía (puntuación ${stream.epg_match_score})`
                  ) : (
                    'tvg-id de la guía XMLTV'
                  )
                }
              >
                <div className="input-group">
                  <input
                    id="st-epg"
                    className="input"
                    value={form.epg_channel_id}
                    onChange={(e) => {
                      set('epg_channel_id', e.target.value);
                      setEpgLocked(Boolean(e.target.value.trim()));
                    }}
                  />
                  <button type="button" className="btn btn-secondary btn-sm nowrap" onClick={() => setEpgSearchOpen(true)} title="Buscar en la guía">
                    <Search size={14} /> <span className="hide-mobile">Buscar en la guía</span>
                  </button>
                </div>
              </FormField>
            )}
            <FormField label="Extensión del contenedor" htmlFor="st-ext">
              <input id="st-ext" className="input" list={`ext-${type}`} value={form.container_extension} onChange={(e) => set('container_extension', e.target.value)} />
              <datalist id={`ext-${type}`}>
                {EXTENSIONS[type].map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </FormField>
            {!isMovie && (
              <FormField label="Archivo (días de catch-up)" htmlFor="st-archive">
                <input id="st-archive" className="input" type="number" min={0} value={form.tv_archive_duration} onChange={(e) => set('tv_archive_duration', Math.max(0, Math.floor(Number(e.target.value))))} />
              </FormField>
            )}
          </div>
          <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label="Habilitado" description={`Si se deshabilita, el ${noun} no aparece en las listas de los clientes.`} />
        </div>

        <div className="stack">
          {isMovie && (
            <div className="subcard stack">
              <h3 className="form-section-title no-margin">Información de la película</h3>
              <div className="movie-info-top">
                <Thumb src={form.info.cover.trim() || form.logo.trim() || null} alt="Portada" variant="poster" />
                <div className="stack grow">
                  <FormField label="Portada (URL)" error={errors.cover}>
                    <input className="input" value={form.info.cover} onChange={(e) => setInfo('cover', e.target.value)} />
                  </FormField>
                  <div className="grid-2">
                    <FormField label="Género">
                      <input className="input" value={form.info.genre} onChange={(e) => setInfo('genre', e.target.value)} />
                    </FormField>
                    <FormField label="Calificación">
                      <input className="input" value={form.info.rating} onChange={(e) => setInfo('rating', e.target.value)} placeholder="7.5" />
                    </FormField>
                    <FormField label="Fecha de estreno">
                      <input className="input" value={form.info.releasedate} onChange={(e) => setInfo('releasedate', e.target.value)} placeholder="2024-05-01" />
                    </FormField>
                    <FormField label="Duración">
                      <input className="input" value={form.info.duration} onChange={(e) => setInfo('duration', e.target.value)} placeholder="01:45:00" />
                    </FormField>
                  </div>
                </div>
              </div>
              <FormField label="Sinopsis">
                <textarea className="input textarea" rows={4} value={form.info.plot} onChange={(e) => setInfo('plot', e.target.value)} />
              </FormField>
            </div>
          )}
          <div className="subcard">
            <h3 className="form-section-title no-margin">Modo de entrega</h3>
            <DeliverySelector
              compact
              value={deliveryValue}
              onChange={(v) => {
                setForm((f) => ({ ...f, ...v }));
                setErrors((x) => ({ ...x, delivery: undefined }));
              }}
              servers={servers}
              profiles={profiles}
              error={errors.delivery}
            />
          </div>
          <div className="subcard">
            <h3 className="form-section-title no-margin">Paquetes</h3>
            <PackageChecklist packages={packages} value={form.package_ids} onChange={(ids) => set('package_ids', ids)} />
          </div>
        </div>
      </div>
      {!isMovie && (
        <EpgSearchModal
          open={epgSearchOpen}
          title="Buscar EPG en las guías"
          initialSearch={form.name}
          confirmLabel="Usar esta"
          onClose={() => setEpgSearchOpen(false)}
          onPick={(ch) => {
            set('epg_channel_id', ch.xmltv_id);
            setEpgLocked(true);
            setEpgSearchOpen(false);
          }}
        />
      )}
    </Modal>
  );
}
