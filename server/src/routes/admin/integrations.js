// Integración de cortes con plataformas externas (WispHub u otras).
import { Router } from 'express';
import { db, whereSearch } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings, publicSettings, saveSettings } from '../../lib/settings.js';
import {
  HttpError, bool, int, oneOf, paging, parseJson,
} from '../../lib/util.js';
import {
  WISPHUB_PRESET, autoSyncInfo, isSyncRunning, mapStatus, refreshUserFromPlatform, regenerateWebhookToken, runBillingSync, testConnection,
} from '../../services/billingSync.js';
import { serializeUsers } from '../../lib/serialize.js';
import { bulkLink } from '../../services/billingBulkLink.js';

const router = Router();
router.use(adminOnly);

const strList = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

/** Valida y normaliza un parche de configuración de la integración. */
function configPatch(body) {
  const out = {};
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  if (body.provider !== undefined) out.provider = oneOf(body.provider, ['wisphub', 'custom'], 'provider');
  for (const k of ['base_url', 'list_path', 'auth_header', 'auth_prefix', 'results_path', 'suspension_reason']) {
    if (body[k] !== undefined) out[k] = String(body[k] ?? '').slice(0, 500);
  }
  if (out.base_url !== undefined) out.base_url = out.base_url.trim().replace(/\/+$/, '');
  if (out.base_url && !/^https?:\/\//i.test(out.base_url)) throw new HttpError(400, 'La URL de consulta debe empezar por http:// o https://');
  // Se acepta la clave con o sin el prefijo "Api-Key " por si se pega completa.
  if (body.api_key) out.api_key = String(body.api_key).trim().replace(/^Api-Key\s+/i, '');
  if (body.page_size !== undefined) out.page_size = Math.max(1, Math.min(1000, int(body.page_size, 300)));
  if (body.interval_minutes !== undefined) out.interval_minutes = Math.max(1, Math.min(1440, int(body.interval_minutes, 15)));
  if (body.auto_link !== undefined) out.auto_link = bool(body.auto_link);
  if (body.reactivate !== undefined) out.reactivate = bool(body.reactivate);
  if (body.match_by !== undefined) {
    out.match_by = strList(body.match_by).filter((m) => ['document', 'email', 'phone', 'username'].includes(m));
  }
  if (body.fields && typeof body.fields === 'object') {
    out.fields = {};
    for (const k of ['id', 'status', 'document', 'username', 'name', 'email', 'phone', 'plan']) {
      if (body.fields[k] !== undefined) out.fields[k] = String(body.fields[k] ?? '').trim();
    }
  }
  if (body.status_map && typeof body.status_map === 'object') {
    out.status_map = {};
    for (const k of ['free', 'active', 'suspended', 'disabled']) {
      if (body.status_map[k] !== undefined) out.status_map[k] = strList(body.status_map[k]);
    }
    // Un mismo estado no puede estar en dos listas: "free" manda (p. ej. quitar "Gratis" de activos).
    if (out.status_map.free) {
      const free = new Set(out.status_map.free.map((x) => x.toLowerCase()));
      for (const k of ['active', 'suspended', 'disabled']) {
        if (out.status_map[k]) out.status_map[k] = out.status_map[k].filter((x) => !free.has(x.toLowerCase()));
      }
    }
  }
  return out;
}

async function overview() {
  const settings = await getSettings();
  const config = publicSettings(settings).billing_integration;
  const provider = settings.billing_integration.provider;
  const count = async (q) => Number((await q.count({ c: '*' }).first()).c);
  const lastRun = await db('integration_runs').whereNot('trigger', 'webhook').orderBy('id', 'desc').first();
  return {
    cut_mode: settings.cut_mode,
    config,
    presets: { wisphub: WISPHUB_PRESET },
    running: isSyncRunning(),
    counts: {
      external_clients: await count(db('external_clients').where({ provider })),
      linked: await count(db('external_clients').where({ provider }).whereNotNull('user_id')),
      unlinked_external: await count(db('external_clients').where({ provider }).whereNull('user_id')),
      iptv_unlinked: await count(db('users').whereNull('external_id')),
      suspended_by_external: await count(db('users').where('suspension_source', 'external')),
      // Cuentas vinculadas que hoy están cortadas (lo que revisa "Revisar suspendidos").
      cut_linked: await count(db('users').whereIn('id', db('external_clients').where({ provider }).whereNotNull('user_id').select('user_id'))
        .where((w) => w.where('suspended', true).orWhere('enabled', false))),
    },
    auto_sync: await autoSyncInfo(),
    last_run: lastRun ? serializeRun(lastRun, false) : null,
    webhook_path: config.webhook_token ? `/api/integrations/billing/webhook/${settings.billing_integration.webhook_token}` : null,
  };
}

function serializeRun(r, withChanges = true) {
  return {
    id: r.id,
    provider: r.provider,
    trigger: r.trigger,
    status: r.status,
    stats: parseJson(r.stats, {}),
    ...(withChanges ? { changes: parseJson(r.changes, []) } : {}),
    error: r.error || null,
    started_at: Number(r.started_at),
    finished_at: r.finished_at ? Number(r.finished_at) : null,
  };
}

router.get('/billing', async (_req, res) => res.json(await overview()));

router.put('/billing', async (req, res) => {
  const body = req.body || {};
  const patch = {};
  if (body.cut_mode !== undefined) patch.cut_mode = oneOf(body.cut_mode, ['manual', 'external', 'both'], 'cut_mode');
  const config = configPatch(body.config || {});
  if (Object.keys(config).length) patch.billing_integration = config;
  await saveSettings(patch);
  const settings = await getSettings();
  if (settings.billing_integration.enabled && !settings.billing_integration.webhook_token) await regenerateWebhookToken();
  await logAction(req.admin, 'billing.config', 'integration', null, { cut_mode: patch.cut_mode, ...config, api_key: config.api_key ? '***' : undefined });
  res.json(await overview());
});

router.post('/billing/test', async (req, res) => {
  const settings = await getSettings();
  const draft = configPatch(req.body || {});
  const config = {
    ...settings.billing_integration,
    ...draft,
    fields: { ...settings.billing_integration.fields, ...(draft.fields || {}) },
    status_map: { ...settings.billing_integration.status_map, ...(draft.status_map || {}) },
  };
  if (!config.api_key) throw new HttpError(400, 'Indica la API Key');
  res.json(await testConnection(config));
});

router.post('/billing/sync', async (req, res) => {
  const run = await runBillingSync({ trigger: 'manual', dryRun: bool(req.body?.dry_run), admin: req.admin });
  res.json(run);
});

/** Revisa ya mismo solo las cuentas cortadas: reactiva a quienes la plataforma ya marca activos. */
router.post('/billing/check-suspended', async (req, res) => {
  const run = await runBillingSync({ trigger: 'check_suspended', scope: 'suspended', admin: req.admin });
  res.json(run);
});

/** Actualiza un cliente desde la plataforma (un pago recién registrado, por ejemplo). */
router.post('/billing/users/:id/refresh', async (req, res) => {
  const result = await refreshUserFromPlatform(int(req.params.id, 0), { admin: req.admin });
  const [user] = await serializeUsers([await db('users').where({ id: int(req.params.id, 0) }).first()]);
  res.json({ ...result, user });
});

router.post('/billing/webhook-token', async (req, res) => {
  await regenerateWebhookToken();
  await logAction(req.admin, 'billing.webhook_token', 'integration', null);
  res.json(await overview());
});

router.get('/billing/runs', async (req, res) => {
  const { page, limit, offset } = paging(req.query, 20);
  const total = Number((await db('integration_runs').count({ c: '*' }).first()).c);
  const rows = await db('integration_runs').orderBy('id', 'desc').limit(limit).offset(offset);
  res.json({ data: rows.map((r) => serializeRun(r, false)), total, page, limit });
});

router.get('/billing/runs/:id', async (req, res) => {
  const row = await db('integration_runs').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Ejecución no encontrada');
  res.json(serializeRun(row));
});

router.get('/billing/external-clients', async (req, res) => {
  const settings = await getSettings();
  const config = settings.billing_integration;
  const { page, limit, offset } = paging(req.query);
  const q = db('external_clients').leftJoin('users', 'users.id', 'external_clients.user_id')
    .where('external_clients.provider', config.provider);
  whereSearch(q, ['external_clients.name', 'external_clients.document_id', 'external_clients.username',
    'external_clients.email', 'external_clients.phone', 'external_clients.external_id'], req.query.search);
  if (req.query.linked === 'true') q.whereNotNull('external_clients.user_id');
  if (req.query.linked === 'false') q.whereNull('external_clients.user_id');
  if (req.query.status) q.where('external_clients.status', String(req.query.status));
  if (['free', 'active', 'suspended', 'disabled'].includes(req.query.mapped_status)) {
    q.whereIn('external_clients.status', config.status_map?.[req.query.mapped_status] || []);
  }
  if (req.query.plan) whereSearch(q, ['external_clients.plan'], req.query.plan);
  const total = Number((await q.clone().count({ c: '*' }).first()).c);
  const rows = await q.select('external_clients.*', 'users.username as iptv_username', 'users.suspended as iptv_suspended',
    'users.enabled as iptv_enabled', 'users.suspension_source as iptv_suspension_source')
    .orderBy('external_clients.name').limit(limit).offset(offset);
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      external_id: r.external_id,
      name: r.name || '',
      document_id: r.document_id || '',
      username: r.username || '',
      email: r.email || '',
      phone: r.phone || '',
      plan: r.plan || '',
      status: r.status || '',
      status_mapped: mapStatus(r.status, config),
      user_id: r.user_id ?? null,
      iptv_username: r.iptv_username || null,
      iptv_status: r.user_id ? (bool(r.iptv_suspended) ? 'suspended' : bool(r.iptv_enabled) ? 'active' : 'disabled') : null,
      iptv_suspension_source: r.iptv_suspension_source || null,
      link_method: r.link_method || null,
      synced_at: Number(r.synced_at),
    })),
    total, page, limit,
  });
});

/** Resumen para la vinculación en lote: cuántos hay sin vincular por estado y los planes disponibles. */
router.get('/billing/external-clients/summary', async (_req, res) => {
  const settings = await getSettings();
  const config = settings.billing_integration;
  const rows = await db('external_clients').where({ provider: config.provider }).select('status', 'plan', 'user_id');
  const byStatus = { free: 0, active: 0, suspended: 0, disabled: 0, unknown: 0 };
  const unlinkedByStatus = { free: 0, active: 0, suspended: 0, disabled: 0, unknown: 0 };
  const plans = new Map();
  for (const r of rows) {
    const s = mapStatus(r.status, config);
    byStatus[s]++;
    if (!r.user_id) unlinkedByStatus[s]++;
    if (r.plan) plans.set(r.plan, (plans.get(r.plan) || 0) + 1);
  }
  res.json({
    total: rows.length,
    linked: rows.filter((r) => r.user_id).length,
    by_status: byStatus,
    unlinked_by_status: unlinkedByStatus,
    plans: [...plans.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  });
});

/** Vincula en lote (y opcionalmente crea las cuentas IPTV que falten). */
router.post('/billing/external-clients/bulk-link', async (req, res) => {
  res.json(await bulkLink(req.body || {}, req.admin));
});

router.post('/billing/external-clients/:id/link', async (req, res) => {
  const ext = await db('external_clients').where({ id: int(req.params.id, 0) }).first();
  if (!ext) throw new HttpError(404, 'Cliente externo no encontrado');
  const user = await db('users').where({ id: int(req.body?.user_id, 0) }).first();
  if (!user) throw new HttpError(400, 'Cliente IPTV no válido');
  // Una cuenta IPTV puede tener varios servicios (misma persona).
  await db.transaction(async (trx) => {
    const previousUser = ext.user_id && ext.user_id !== user.id ? ext.user_id : null;
    await trx('external_clients').where({ id: ext.id }).update({ user_id: user.id, link_method: 'manual' });
    await trx('users').where({ id: user.id }).whereNull('external_id').update({ external_id: ext.external_id, external_status: ext.status });
    if (previousUser) {
      const other = await trx('external_clients').where({ provider: ext.provider, user_id: previousUser }).first();
      await trx('users').where({ id: previousUser }).update({ external_id: other ? other.external_id : null });
    }
  });
  await logAction(req.admin, 'billing.link', 'user', user.id, { username: user.username, external_id: ext.external_id });
  res.json({ ok: true });
});

router.delete('/billing/external-clients/:id/link', async (req, res) => {
  const ext = await db('external_clients').where({ id: int(req.params.id, 0) }).first();
  if (!ext) throw new HttpError(404, 'Cliente externo no encontrado');
  await db.transaction(async (trx) => {
    await trx('external_clients').where({ id: ext.id }).update({ user_id: null, link_method: null });
    if (ext.user_id) {
      const other = await trx('external_clients').where({ provider: ext.provider, user_id: ext.user_id }).first();
      if (other) {
        // La cuenta conserva sus otros servicios.
        await trx('users').where({ id: ext.user_id, external_id: ext.external_id }).update({ external_id: other.external_id });
      } else {
        await trx('users').where({ id: ext.user_id }).update({ external_id: null, external_status: null });
        // Si la plataforma lo había suspendido, pasa a considerarse un corte manual para no dejarlo en un limbo.
        await trx('users').where({ id: ext.user_id, suspension_source: 'external' }).update({ suspension_source: 'manual' });
      }
    }
  });
  await logAction(req.admin, 'billing.unlink', 'user', ext.user_id, { external_id: ext.external_id });
  res.json({ ok: true });
});

export default router;
