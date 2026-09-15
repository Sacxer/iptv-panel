// Revisión periódica de las fuentes de canales y películas (en línea / caídos).
import { db } from '../db/index.js';
import { getSettings } from '../lib/settings.js';
import { idList, now, parseJson } from '../lib/util.js';

const UA = 'VLC/3.0.20 LibVLC/3.0.20';

const state = {
  running: false,
  progress: { total: 0, done: 0, online: 0, offline: 0 },
  started_at: null,
  finished_at: null,
  last_result: null,
};

export const healthState = () => ({ ...state, progress: { ...state.progress } });

/** Igual que healthState, pero si el servidor se reinició recupera la fecha de la última revisión guardada. */
export async function healthStatus() {
  const current = healthState();
  if (!current.last_result) {
    const row = await db('streams').max({ t: 'health_checked_at' }).first();
    if (row?.t) current.last_result = { finished_at: Number(row.t), restored: true };
  }
  return current;
}

function errorText(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'Tiempo de espera agotado';
  const code = err?.cause?.code || err?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Dominio no encontrado';
  if (code === 'ECONNREFUSED') return 'Conexión rechazada';
  if (code === 'ECONNRESET') return 'Conexión reiniciada por el origen';
  if (code === 'CERT_HAS_EXPIRED' || String(code).includes('CERT')) return 'Certificado SSL inválido';
  return (err?.message || 'Error desconocido').slice(0, 200);
}

/**
 * Comprueba que una URL entregue contenido reproducible leyendo solo los primeros bytes.
 * Devuelve { ok, ms, error }.
 */
export async function probeUrl(url, { timeoutMs = 8000, vod = false } = {}) {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const headers = { 'User-Agent': UA };
    if (vod) headers.Range = 'bytes=0-4095';
    const res = await fetch(url, { headers, signal, redirect: 'follow' });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, ms: Date.now() - started, error: `HTTP ${res.status}` };
    }
    const type = (res.headers.get('content-type') || '').toLowerCase();
    const isPlaylist = /\.m3u8(\?|$)/i.test(url) || type.includes('mpegurl');
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, ms: Date.now() - started, error: 'Respuesta vacía' };
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value || !value.length) return { ok: false, ms: Date.now() - started, error: 'Respuesta vacía' };
    const head = Buffer.from(value.subarray(0, 512)).toString('utf8');
    if (isPlaylist && !head.includes('#EXTM3U')) return { ok: false, ms: Date.now() - started, error: 'Lista HLS inválida' };
    if (!isPlaylist && type.includes('text/html')) return { ok: false, ms: Date.now() - started, error: 'El origen devolvió una página web, no video' };
    return { ok: true, ms: Date.now() - started, error: null };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: errorText(err) };
  }
}

async function checkStream(stream, timeoutMs) {
  const urls = [stream.source_url, ...(parseJson(stream.backup_urls, []) || [])].filter(Boolean);
  if (!urls.length) return { status: 'unknown', ms: null, error: 'Sin URL de origen' };
  let last = null;
  for (const url of urls) {
    last = await probeUrl(url, { timeoutMs, vod: stream.type !== 'live' });
    if (last.ok) return { status: 'online', ms: last.ms, error: null };
  }
  return { status: 'offline', ms: last.ms, error: last.error };
}

/** Ejecuta la revisión. Sin `ids`, revisa primero los que llevan más tiempo sin comprobarse. */
export async function runHealthCheck({ ids = null, types = ['live', 'movie'], limit = null } = {}) {
  if (state.running) return healthState();
  const settings = await getSettings();
  const q = db('streams').whereIn('type', types).where('enabled', true)
    .select('id', 'type', 'source_url', 'backup_urls', 'health_status', 'health_fail_count');
  if (ids) q.whereIn('id', idList(ids));
  else {
    // Los canales importados de Astra con monitoreo activo ya reciben su estado (onair) desde Astra.
    q.whereNotIn('id', db('astra_channels').join('astra_sources', 'astra_sources.id', 'astra_channels.source_id')
      .where('astra_sources.status_poll', true).whereNotNull('astra_channels.stream_id').select('astra_channels.stream_id'));
    q.orderByRaw('health_checked_at IS NOT NULL').orderBy('health_checked_at', 'asc')
      .limit(limit ?? Math.max(1, Number(settings.stream_check_batch) || 500));
  }
  const streams = await q;

  state.running = true;
  state.started_at = now();
  state.finished_at = null;
  state.progress = { total: streams.length, done: 0, online: 0, offline: 0 };
  const timeoutMs = Math.max(2, Number(settings.stream_check_timeout_seconds) || 8) * 1000;
  const concurrency = Math.max(1, Math.min(50, Number(settings.stream_check_concurrency) || 10));
  const results = [];

  try {
    let index = 0;
    const worker = async () => {
      while (index < streams.length) {
        const stream = streams[index++];
        const r = await checkStream(stream, timeoutMs);
        const t = now();
        await db('streams').where({ id: stream.id }).update({
          health_status: r.status,
          health_checked_at: t,
          health_ms: r.ms,
          health_error: r.error ? r.error.slice(0, 255) : null,
          health_fail_count: r.status === 'offline' ? Number(stream.health_fail_count || 0) + 1 : 0,
          ...(r.status === 'offline' && stream.health_status !== 'offline' ? { health_down_since: t } : {}),
          ...(r.status !== 'offline' ? { health_down_since: null } : {}),
        });
        results.push({ id: stream.id, ...r });
        state.progress.done++;
        if (r.status === 'online') state.progress.online++;
        if (r.status === 'offline') state.progress.offline++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, streams.length || 1) }, worker));
  } finally {
    state.running = false;
    state.finished_at = now();
    state.last_result = { ...state.progress, started_at: state.started_at, finished_at: state.finished_at };
  }
  return { ...healthState(), results };
}

export async function healthSummary() {
  const rows = await db('streams').whereIn('type', ['live', 'movie']).where('enabled', true)
    .groupBy('type', 'health_status').select('type', 'health_status').count({ c: '*' });
  const summary = {
    live: { online: 0, offline: 0, unknown: 0, total: 0 },
    movie: { online: 0, offline: 0, unknown: 0, total: 0 },
  };
  for (const r of rows) {
    const bucket = summary[r.type];
    const key = ['online', 'offline'].includes(r.health_status) ? r.health_status : 'unknown';
    bucket[key] += Number(r.c);
    bucket.total += Number(r.c);
  }
  return summary;
}

/** Programa la revisión automática según los ajustes. */
export function startHealthMonitor() {
  let lastRun = 0;
  const tick = async () => {
    const settings = await getSettings().catch(() => null);
    if (!settings?.stream_check_enabled || state.running) return;
    const every = Math.max(5, Number(settings.stream_check_interval_minutes) || 30) * 60;
    if (now() - lastRun < every) return;
    lastRun = now();
    await runHealthCheck().catch((err) => console.error('Revisión de canales fallida:', err.message));
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 20_000).unref();
  return () => clearInterval(timer);
}
