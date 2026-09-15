import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Cpu, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { useProfiles, useServers } from '../../hooks/useStreaming';
import { DataTable } from '../../components/DataTable';
import { Modal } from '../../components/Modal';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { Alert, Badge, FormField, PageHeader, Select, Spinner, Switch } from '../../components/ui';
import type { StreamingServer, TranscodeHw, TranscodeProfile, TranscodeProfileInput } from '../../types';
import { formatNumber } from '../../utils/format';
import { TRANSCODE_HW } from '../../utils/labels';

const RESOLUTIONS: { value: TranscodeProfile['resolution']; label: string }[] = [
  { value: 'source', label: 'Original' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '576', label: '576p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
];

const resolutionLabel = (r: string) => RESOLUTIONS.find((x) => x.value === r)?.label ?? r;

function emptyProfile(): TranscodeProfileInput {
  return {
    name: '',
    hw: 'cpu',
    video_codec: 'h264',
    preset: '',
    resolution: '720',
    video_bitrate_kbps: 2500,
    max_bitrate_kbps: null,
    fps: null,
    gop: 50,
    deinterlace: false,
    audio_codec: 'aac',
    audio_bitrate_kbps: 128,
    audio_channels: 2,
    extra_args: '',
  };
}

const PRESETS: { label: string; values: Partial<TranscodeProfileInput> }[] = [
  { label: '720p CPU 2.5 Mbps', values: { name: '720p CPU 2.5 Mbps', hw: 'cpu', video_codec: 'h264', preset: 'veryfast', resolution: '720', video_bitrate_kbps: 2500, max_bitrate_kbps: 3000, gop: 50, audio_codec: 'aac', audio_bitrate_kbps: 128, audio_channels: 2 } },
  { label: '1080p NVIDIA 5 Mbps', values: { name: '1080p NVIDIA 5 Mbps', hw: 'nvenc', video_codec: 'h264', preset: 'p4', resolution: '1080', video_bitrate_kbps: 5000, max_bitrate_kbps: 6000, gop: 50, audio_codec: 'aac', audio_bitrate_kbps: 160, audio_channels: 2 } },
  { label: '480p móvil 1.2 Mbps', values: { name: '480p móvil 1.2 Mbps', hw: 'cpu', video_codec: 'h264', preset: 'veryfast', resolution: '480', video_bitrate_kbps: 1200, max_bitrate_kbps: 1500, gop: 50, audio_codec: 'aac', audio_bitrate_kbps: 96, audio_channels: 2 } },
];

export function ProfilesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { profiles, loading, error, reload } = useProfiles();
  const { servers } = useServers();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TranscodeProfile | null>(null);

  const remove = async (p: TranscodeProfile) => {
    const ok = await confirm({
      title: 'Eliminar perfil',
      message: (
        <>
          ¿Eliminar <strong>{p.name}</strong>?{p.stream_count > 0 && <> Lo usan {formatNumber(p.stream_count)} canal(es), que pasarán a Reenvío sin transcodificar.</>}
        </>
      ),
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.profiles.remove(p.id);
      toast.success('Perfil eliminado');
      void reload(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <PageHeader
        title="Perfiles de transcodificación"
        subtitle="Cómo convierten los servidores la señal: resolución, bitrate y hardware (CPU o GPU)"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus size={16} /> Nuevo perfil
          </button>
        }
      />
      <DataTable<TranscodeProfile>
        rows={profiles}
        rowKey={(p) => p.id}
        loading={loading}
        error={error}
        onRetry={() => void reload()}
        emptyTitle="Aún no hay perfiles"
        emptyDescription="Crea un perfil para poder transcodificar canales (por ejemplo 720p para ahorrar ancho de banda)."
        columns={[
          {
            key: 'name',
            header: 'Perfil',
            render: (p) => (
              <div className="cell-main">
                <span className="strong">{p.name}</span>
                <span className="muted text-xs">
                  {p.video_codec === 'hevc' ? 'H.265' : 'H.264'} · {resolutionLabel(p.resolution)} · {formatNumber(p.video_bitrate_kbps)} kbps
                  {p.fps ? ` · ${p.fps} fps` : ''}
                </span>
              </div>
            ),
          },
          {
            key: 'hw',
            header: 'Hardware',
            render: (p) => (
              <Badge tone={p.hw === 'cpu' ? 'blue' : 'purple'}>
                {p.hw === 'cpu' ? <Cpu size={12} /> : <Zap size={12} />} {TRANSCODE_HW[p.hw]?.label ?? p.hw}
              </Badge>
            ),
          },
          {
            key: 'audio',
            header: 'Audio',
            hideOnMobile: true,
            render: (p) => (p.audio_codec === 'copy' ? 'Copiar' : `AAC ${p.audio_bitrate_kbps} kbps${p.audio_channels ? ` · ${p.audio_channels} canales` : ''}`),
          },
          { key: 'streams', header: 'Canales', render: (p) => formatNumber(p.stream_count) },
          {
            key: 'actions',
            header: '',
            className: 'col-actions',
            render: (p) => (
              <div className="row-actions">
                <button type="button" className="btn btn-ghost btn-icon btn-sm" title="Editar" onClick={() => { setEditing(p); setFormOpen(true); }}>
                  <Pencil size={15} />
                </button>
                <button type="button" className="btn btn-ghost btn-icon btn-sm text-red" title="Eliminar" onClick={() => void remove(p)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ),
          },
        ]}
      />
      <ProfileEditor
        open={formOpen}
        profile={editing}
        servers={servers}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void reload(true);
        }}
      />
    </>
  );
}

function ProfileEditor({
  open,
  profile,
  servers,
  onClose,
  onSaved,
}: {
  open: boolean;
  profile: TranscodeProfile | null;
  servers: StreamingServer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<TranscodeProfileInput>(emptyProfile);
  const [advanced, setAdvanced] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; bitrate?: string; extra?: string }>({});
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (profile) {
      const { id: _i, stream_count: _s, created_at: _c, ...rest } = profile;
      void _i;
      void _s;
      void _c;
      setForm(rest);
      setAdvanced(Boolean(profile.extra_args));
    } else {
      setForm(emptyProfile());
      setAdvanced(false);
    }
    setErrors({});
    setServerError(null);
  }, [open, profile]);

  const set = <K extends keyof TranscodeProfileInput>(k: K, v: TranscodeProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const onlineEncoders = useMemo(() => new Set(servers.filter((s) => s.status === 'online').flatMap((s) => s.hardware?.encoders ?? [])), [servers]);
  const hwSupported = TRANSCODE_HW[form.hw].encoders.some((e) => onlineEncoders.has(e));

  const submit = async () => {
    const e: typeof errors = {};
    if (!form.name.trim()) e.name = 'El nombre es obligatorio';
    if (!Number.isInteger(form.video_bitrate_kbps) || form.video_bitrate_kbps < 100) e.bitrate = 'Mínimo 100 kbps';
    else if (form.max_bitrate_kbps && form.max_bitrate_kbps < form.video_bitrate_kbps) e.bitrate = 'El máximo debe ser mayor o igual al bitrate';
    if (/[;&|`$<>]/.test(form.extra_args)) e.extra = 'No puede contener ; & | ` $ < >';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setServerError(null);
    try {
      const body = { ...form, name: form.name.trim(), extra_args: form.extra_args.trim() };
      if (profile) await api.profiles.update(profile.id, body);
      else await api.profiles.create(body);
      toast.success(profile ? 'Perfil actualizado' : 'Perfil creado');
      onSaved();
    } catch (err) {
      setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const numOrNull = (v: string) => (v === '' ? null : Math.floor(Number(v)));

  return (
    <Modal
      open={open}
      title={profile ? `Editar perfil: ${profile.name}` : 'Nuevo perfil de transcodificación'}
      onClose={onClose}
      size="lg"
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
      {!profile && (
        <div className="preset-row">
          <span className="muted text-sm">Plantillas rápidas:</span>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, ...p.values }))}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <FormField label="Nombre" required error={errors.name}>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
      </FormField>
      <FormField label="Hardware">
        <div className="segmented">
          {(Object.keys(TRANSCODE_HW) as TranscodeHw[]).map((hw) => (
            <button key={hw} type="button" className={`segment ${form.hw === hw ? 'is-active' : ''}`} onClick={() => set('hw', hw)}>
              {TRANSCODE_HW[hw].label}
            </button>
          ))}
        </div>
      </FormField>
      {!hwSupported && (
        <Alert tone="amber">
          Ningún servidor en línea reporta un encoder de <strong>{TRANSCODE_HW[form.hw].label}</strong> ({TRANSCODE_HW[form.hw].encoders.join(', ')}). Los
          canales con este perfil no podrán transcodificarse hasta que haya uno.
        </Alert>
      )}
      <div className="grid-3">
        <FormField label="Códec de video">
          <Select
            value={form.video_codec}
            onChange={(v) => set('video_codec', v as 'h264' | 'hevc')}
            options={[
              { value: 'h264', label: 'H.264 (compatible)' },
              { value: 'hevc', label: 'H.265 / HEVC' },
            ]}
          />
        </FormField>
        <FormField label="Resolución">
          <Select value={form.resolution} onChange={(v) => set('resolution', v as TranscodeProfile['resolution'])} options={RESOLUTIONS} />
        </FormField>
        <FormField label="Preset" hint="p. ej. veryfast (CPU), p4 (NVENC)">
          <input className="input" value={form.preset} onChange={(e) => set('preset', e.target.value)} />
        </FormField>
        <FormField label="Bitrate (kbps)" error={errors.bitrate}>
          <input className="input" type="number" min={100} value={form.video_bitrate_kbps} onChange={(e) => set('video_bitrate_kbps', Math.floor(Number(e.target.value)))} />
        </FormField>
        <FormField label="Bitrate máximo (kbps)" hint="Vacío = igual al bitrate">
          <input className="input" type="number" min={100} value={form.max_bitrate_kbps ?? ''} onChange={(e) => set('max_bitrate_kbps', numOrNull(e.target.value))} />
        </FormField>
        <FormField label="FPS" hint="Vacío = original">
          <input className="input" type="number" min={10} max={120} value={form.fps ?? ''} onChange={(e) => set('fps', numOrNull(e.target.value))} />
        </FormField>
        <FormField label="GOP (fotogramas)" hint="Distancia entre fotogramas clave">
          <input className="input" type="number" min={10} max={600} value={form.gop} onChange={(e) => set('gop', Math.floor(Number(e.target.value)))} />
        </FormField>
        <div className="field field-switches">
          <Switch checked={form.deinterlace} onChange={(v) => set('deinterlace', v)} label="Desentrelazar" />
        </div>
      </div>
      <h3 className="form-section-title">Audio</h3>
      <div className="grid-3">
        <FormField label="Audio">
          <Select
            value={form.audio_codec}
            onChange={(v) => set('audio_codec', v as 'copy' | 'aac')}
            options={[
              { value: 'copy', label: 'Copiar (sin convertir)' },
              { value: 'aac', label: 'AAC' },
            ]}
          />
        </FormField>
        {form.audio_codec === 'aac' && (
          <>
            <FormField label="Bitrate de audio (kbps)">
              <input className="input" type="number" min={32} max={512} value={form.audio_bitrate_kbps} onChange={(e) => set('audio_bitrate_kbps', Math.floor(Number(e.target.value)))} />
            </FormField>
            <FormField label="Canales" hint="Vacío = original">
              <Select
                value={form.audio_channels === null ? '' : String(form.audio_channels)}
                onChange={(v) => set('audio_channels', v ? Number(v) : null)}
                placeholder="Original"
                options={[
                  { value: '1', label: 'Mono (1)' },
                  { value: '2', label: 'Estéreo (2)' },
                  { value: '6', label: '5.1 (6)' },
                ]}
              />
            </FormField>
          </>
        )}
      </div>
      <button type="button" className="collapse-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
        {advanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />} Avanzado
      </button>
      {advanced && (
        <FormField label="Argumentos extra de FFmpeg" error={errors.extra} hint="Se añaden al comando del codificador. Úsalo solo si sabes lo que haces.">
          <input className="input mono" value={form.extra_args} onChange={(e) => set('extra_args', e.target.value)} placeholder="-tune zerolatency" />
        </FormField>
      )}
    </Modal>
  );
}
