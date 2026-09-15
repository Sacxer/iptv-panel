import { useEffect, useRef, useState } from 'react';
import { CircleCheck, FileUp } from 'lucide-react';
import { api, errorMessage } from '../../api';
import { Modal } from '../../components/Modal';
import { Alert, Checkbox, FormField, Select, Spinner, Tabs } from '../../components/ui';
import type { M3UImportInput, M3UImportResult, Package, StreamType } from '../../types';
import { formatNumber, isValidUrl } from '../../utils/format';

type SourceMode = 'url' | 'paste' | 'file';

interface Props {
  open: boolean;
  defaultType: StreamType;
  packages: Package[];
  onClose: () => void;
  onImported: () => void;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function ImportM3UModal({ open, defaultType, packages, onClose, onImported }: Props) {
  const [mode, setMode] = useState<SourceMode>('url');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [type, setType] = useState<M3UImportInput['type']>('auto');
  const [createCategories, setCreateCategories] = useState(true);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [packageId, setPackageId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<M3UImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode('url');
    setUrl('');
    setContent('');
    setFileName('');
    setType(defaultType === 'movie' ? 'movie' : 'auto');
    setCreateCategories(true);
    setSkipDuplicates(true);
    setPackageId('');
    setError(null);
    setResult(null);
  }, [open, defaultType]);

  const readFile = (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setError('El archivo es demasiado grande (máximo 50 MB). Usa la opción URL.');
      return;
    }
    setReading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setContent(typeof reader.result === 'string' ? reader.result : '');
      setFileName(file.name);
      setReading(false);
    };
    reader.onerror = () => {
      setError('No se pudo leer el archivo');
      setReading(false);
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    setError(null);
    const body: M3UImportInput = {
      type,
      create_categories: createCategories,
      skip_duplicates: skipDuplicates,
    };
    if (mode === 'url') {
      if (!url.trim()) return setError('Indica la URL de la lista M3U');
      if (!isValidUrl(url.trim())) return setError('La URL no es válida');
      body.url = url.trim();
    } else {
      if (!content.trim()) return setError(mode === 'file' ? 'Selecciona un archivo .m3u' : 'Pega el contenido de la lista');
      if (!content.includes('#EXTINF')) return setError('El contenido no parece una lista M3U (no contiene #EXTINF)');
      body.content = content;
    }
    if (packageId) body.package_id = Number(packageId);
    setBusy(true);
    try {
      const res = await api.streams.importM3U(body);
      setResult(res);
      onImported();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const lineCount = content ? (content.match(/#EXTINF/g) ?? []).length : 0;

  return (
    <Modal
      open={open}
      title="Importar lista M3U"
      onClose={onClose}
      size="lg"
      dismissible={!busy}
      onSubmit={result ? undefined : () => void submit()}
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Cerrar
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || reading}>
              {busy && <Spinner size={14} />} {busy ? 'Importando…' : 'Importar'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack">
          <Alert tone="green" icon={<CircleCheck size={18} />} title="Importación completada" />
          <div className="result-grid">
            <div className="result-item">
              <div className="result-value text-green">{formatNumber(result.created)}</div>
              <div className="muted">Creados</div>
            </div>
            <div className="result-item">
              <div className="result-value">{formatNumber(result.skipped)}</div>
              <div className="muted">Omitidos</div>
            </div>
            <div className="result-item">
              <div className="result-value text-blue">{formatNumber(result.categories_created)}</div>
              <div className="muted">Categorías creadas</div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {error && <Alert tone="red">{error}</Alert>}
          <Tabs
            value={mode}
            onChange={setMode}
            tabs={[
              { value: 'url', label: 'Desde URL' },
              { value: 'paste', label: 'Pegar contenido' },
              { value: 'file', label: 'Subir archivo' },
            ]}
          />
          <div className="mt">
            {mode === 'url' && (
              <FormField label="URL de la lista" hint="El servidor descargará la lista directamente." htmlFor="m3u-url">
                <input id="m3u-url" className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://proveedor/get.php?username=…&type=m3u_plus" />
              </FormField>
            )}
            {mode === 'paste' && (
              <FormField label="Contenido M3U" hint={lineCount ? `${formatNumber(lineCount)} entradas detectadas` : undefined}>
                <textarea className="input textarea mono" rows={10} value={content} onChange={(e) => setContent(e.target.value)} placeholder={'#EXTM3U\n#EXTINF:-1 tvg-id="" tvg-logo="" group-title="Noticias",Canal\nhttp://…'} />
              </FormField>
            )}
            {mode === 'file' && (
              <div
                className="dropzone"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) readFile(f);
                }}
              >
                <FileUp size={28} />
                {reading ? (
                  <Spinner label="Leyendo archivo…" />
                ) : fileName ? (
                  <div>
                    <div className="strong">{fileName}</div>
                    <div className="muted text-sm">{formatNumber(lineCount)} entradas detectadas · haz clic para cambiar</div>
                  </div>
                ) : (
                  <div>
                    <div className="strong">Arrastra un archivo .m3u / .m3u8 o haz clic para elegirlo</div>
                    <div className="muted text-sm">El archivo se lee en tu navegador y se envía su contenido.</div>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".m3u,.m3u8,.txt,audio/x-mpegurl,application/vnd.apple.mpegurl"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) readFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
            )}
          </div>

          <div className="grid-2 mt">
            <FormField label="Tipo de contenido" hint={type === 'auto' ? '.mp4/.mkv/.avi/.mov → película; el resto → canal en vivo' : undefined}>
              <Select
                value={type}
                onChange={(v) => setType(v as M3UImportInput['type'])}
                options={[
                  { value: 'auto', label: 'Automático' },
                  { value: 'live', label: 'Todo como canales en vivo' },
                  { value: 'movie', label: 'Todo como películas' },
                ]}
              />
            </FormField>
            <FormField label="Añadir al paquete" hint="Opcional">
              <Select value={packageId} onChange={setPackageId} placeholder="— Ninguno —" options={packages.map((p) => ({ value: String(p.id), label: p.name }))} />
            </FormField>
          </div>
          <div className="stack-sm">
            <Checkbox checked={createCategories} onChange={setCreateCategories} label="Crear categorías" description="Usa group-title de cada entrada para crear las categorías que no existan." />
            <Checkbox checked={skipDuplicates} onChange={setSkipDuplicates} label="Omitir duplicados" description="No importa entradas que ya existan en la plataforma." />
          </div>
        </>
      )}
    </Modal>
  );
}
