// Servidores de streaming y perfiles de transcodificación.
import { Router } from 'express';
import { db, insertId } from '../../db/index.js';
import { adminOnly } from '../../lib/auth.js';
import { logAction } from '../../lib/log.js';
import { getSettings } from '../../lib/settings.js';
import {
  HttpError, bool, int, now, oneOf, parseJson, requireFields,
} from '../../lib/util.js';
import { generateServerToken, nodeInterfaceOf, serializeProfile } from '../../services/nodes.js';
import { publicBaseUrl, rankAddresses } from '../../services/network.js';

const router = Router();
router.use(adminOnly);

const intOrNull = (v) => int(v, null);

async function serializeServers(rows, req) {
  const settings = await getSettings();
  const offlineAfter = Math.max(10, Number(settings.node_offline_seconds) || 30);
  const assigned = await db('stream_servers').groupBy('server_id').select('server_id').count({ c: '*' });
  const assignedMap = new Map(assigned.map((a) => [a.server_id, Number(a.c)]));
  const portal = await publicBaseUrl(req);
  return rows.map((s) => {
    const lastHb = intOrNull(s.last_heartbeat_at);
    const online = bool(s.enabled) && lastHb !== null && lastHb >= now() - offlineAfter;
    const states = parseJson(s.stream_states, []) || [];
    const metrics = parseJson(s.metrics, {}) || {};
    const network = parseJson(s.network, null);
    const listenPort = Number(network?.listen_port) || Number((/:(\d+)$/.exec(s.public_url || '') || [])[1]) || 8090;
    const typeLabel = { ethernet: 'Ethernet', wifi: 'Wi-Fi', vpn: 'VPN', virtual: 'Virtual', loopback: 'Local (loopback)' };
    const networkPorts = (network?.ports || []).map((p) => ({ ...p, type_label: typeLabel[p.type] || p.type }));
    const urlSuggestions = rankAddresses(networkPorts).map((a) => {
      const host = a.address.includes(':') ? `[${a.address}]` : a.address;
      const url = `http://${host}:${listenPort}`;
      return {
        url, ip: a.address, port: listenPort, interface: a.interface, interface_type: a.interface_type, scope: a.scope,
        default_route: a.default_route, in_use: url === s.public_url,
      };
    });
    return {
      id: s.id,
      name: s.name,
      public_url: s.public_url,
      public_url_auto: bool(s.public_url_auto),
      public_url_interface: s.public_url_interface || null,
      enabled: bool(s.enabled),
      max_clients: Number(s.max_clients),
      weight: Number(s.weight),
      status: !bool(s.enabled) ? 'disabled' : online ? 'online' : lastHb ? 'offline' : 'pending',
      last_heartbeat_at: lastHb,
      last_ip: s.last_ip || null,
      version: s.version || null,
      hardware: parseJson(s.hardware, {}) || {},
      metrics,
      streams_running: states.filter((st) => st.state === 'running').length,
      streams_error: states.filter((st) => st.state === 'error').length,
      clients: Number(metrics.clients_total || 0),
      assigned_streams: assignedMap.get(s.id) || 0,
      notes: s.notes || '',
      network: network ? { hostname: network.hostname || null, listen_port: listenPort, reported_at: network.reported_at || null, ports: networkPorts } : null,
      url_suggestions: urlSuggestions,
      install_command: `curl -fsSL "${portal}/api/node/install.sh?token=${s.token}" | sudo bash`,
      token: s.token,
      created_at: Number(s.created_at),
    };
  });
}

async function loadServer(id) {
  const row = await db('servers').where({ id: int(id, 0) }).first();
  if (!row) throw new HttpError(404, 'Servidor no encontrado');
  return row;
}

function serverFields(body, creating) {
  if (creating) requireFields(body, ['name']);
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 100);
  if (body.public_url !== undefined || creating) {
    // Vacía = se completa sola con la IP de la interfaz principal cuando el nodo se conecte.
    const url = String(body.public_url || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\/[^/]+$/i.test(url)) throw new HttpError(400, 'La URL pública debe ser como http://ip-o-dominio:8090');
    out.public_url = url;
  }
  if (body.enabled !== undefined) out.enabled = bool(body.enabled);
  if (body.max_clients !== undefined) out.max_clients = Math.max(0, int(body.max_clients, 0));
  if (body.weight !== undefined) out.weight = Math.max(1, Math.min(100, int(body.weight, 1)));
  if (body.notes !== undefined) out.notes = String(body.notes ?? '').slice(0, 2000);
  return out;
}

router.get('/servers', async (req, res) => {
  res.json(await serializeServers(await db('servers').orderBy('name'), req));
});

router.post('/servers', async (req, res) => {
  const t = now();
  const id = await insertId(db, 'servers', {
    ...serverFields(req.body || {}, true), token: generateServerToken(), status: 'pending', created_at: t, updated_at: t,
  });
  await logAction(req.admin, 'server.create', 'server', id, { name: req.body.name });
  res.status(201).json((await serializeServers([await db('servers').where({ id }).first()], req))[0]);
});

router.get('/servers/:id', async (req, res) => {
  res.json((await serializeServers([await loadServer(req.params.id)], req))[0]);
});

router.put('/servers/:id', async (req, res) => {
  const row = await loadServer(req.params.id);
  const fields = serverFields(req.body || {}, false);
  if (fields.public_url !== undefined) {
    // Una IP de las interfaces del nodo sigue a su interfaz; un dominio o una IP externa se quedan fijos.
    const iface = fields.public_url ? nodeInterfaceOf(fields.public_url, parseJson(row.network, null)) : null;
    fields.public_url_interface = iface;
    fields.public_url_auto = req.body.public_url_auto === undefined ? (!fields.public_url || Boolean(iface)) : bool(req.body.public_url_auto);
  } else if (req.body?.public_url_auto !== undefined) {
    fields.public_url_auto = bool(req.body.public_url_auto);
  }
  if (Object.keys(fields).length) await db('servers').where({ id: row.id }).update({ ...fields, updated_at: now() });
  await logAction(req.admin, 'server.update', 'server', row.id, fields);
  res.json((await serializeServers([await db('servers').where({ id: row.id }).first()], req))[0]);
});

/** Usa la IP de una de las interfaces que informó el nodo (con su puerto) como URL pública del servidor. */
router.post('/servers/:id/use-ip', async (req, res) => {
  const row = await loadServer(req.params.id);
  const network = parseJson(row.network, null);
  const ip = String(req.body?.ip || '').trim();
  const known = (network?.ports || []).some((p) => (p.addresses || []).some((a) => a.address === ip));
  if (!known) throw new HttpError(400, 'Esa IP no está entre las interfaces que informó el nodo');
  const port = int(req.body?.port, 0) || Number(network?.listen_port) || 8090;
  const url = `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`;
  const iface = (network?.ports || []).find((p) => (p.addresses || []).some((a) => a.address === ip))?.name || null;
  await db('servers').where({ id: row.id }).update({
    public_url: url, public_url_auto: true, public_url_interface: iface, updated_at: now(),
  });
  await logAction(req.admin, 'server.use_ip', 'server', row.id, { url });
  res.json((await serializeServers([await db('servers').where({ id: row.id }).first()], req))[0]);
});

router.post('/servers/:id/token', async (req, res) => {
  const row = await loadServer(req.params.id);
  await db('servers').where({ id: row.id }).update({ token: generateServerToken(), updated_at: now() });
  await logAction(req.admin, 'server.token', 'server', row.id, { name: row.name });
  res.json((await serializeServers([await db('servers').where({ id: row.id }).first()], req))[0]);
});

router.delete('/servers/:id', async (req, res) => {
  const row = await loadServer(req.params.id);
  await db('servers').where({ id: row.id }).del();
  await logAction(req.admin, 'server.delete', 'server', row.id, { name: row.name });
  res.json({ ok: true });
});

/** Canales que el nodo está emitiendo ahora, con nombre y modo. */
router.get('/servers/:id/streams', async (req, res) => {
  const row = await loadServer(req.params.id);
  const states = parseJson(row.stream_states, []) || [];
  const assigned = await db('stream_servers').join('streams', 'streams.id', 'stream_servers.stream_id')
    .where('stream_servers.server_id', row.id)
    .select('streams.id', 'streams.name', 'streams.delivery_mode', 'streams.always_on', 'stream_servers.priority');
  const stateMap = new Map(states.map((s) => [Number(s.id), s]));
  const byId = new Map(assigned.map((a) => [a.id, a]));
  const ids = [...new Set([...assigned.map((a) => a.id), ...states.map((s) => Number(s.id))])];
  const names = new Map((ids.length ? await db('streams').whereIn('id', ids).select('id', 'name', 'delivery_mode') : []).map((s) => [s.id, s]));
  res.json(ids.map((id) => {
    const st = stateMap.get(id) || {};
    return {
      stream_id: id,
      name: names.get(id)?.name || st.name || `#${id}`,
      delivery_mode: names.get(id)?.delivery_mode || st.mode || null,
      assigned: byId.has(id),
      priority: byId.get(id)?.priority ?? null,
      always_on: bool(byId.get(id)?.always_on),
      state: st.state || 'idle',
      uptime: st.uptime || 0,
      bitrate_kbps: st.bitrate_kbps || 0,
      clients: st.clients || 0,
      restarts: st.restarts || 0,
      last_error: st.last_error || null,
    };
  }).sort((a, b) => (b.clients - a.clients) || a.name.localeCompare(b.name)));
});

/* ------------------------------ Perfiles de transcodificación ------------------------------ */

function profileFields(body, creating) {
  if (creating) requireFields(body, ['name']);
  const out = {};
  if (body.name !== undefined) out.name = String(body.name).trim().slice(0, 100);
  if (body.hw !== undefined || creating) out.hw = oneOf(body.hw || 'cpu', ['cpu', 'nvenc', 'qsv', 'vaapi'], 'hw');
  if (body.video_codec !== undefined || creating) out.video_codec = oneOf(body.video_codec || 'h264', ['h264', 'hevc'], 'video_codec');
  if (body.preset !== undefined) out.preset = String(body.preset || '').slice(0, 32);
  if (body.resolution !== undefined || creating) {
    out.resolution = oneOf(String(body.resolution || 'source'), ['source', '2160', '1080', '720', '576', '480', '360'], 'resolution');
  }
  if (body.video_bitrate_kbps !== undefined) out.video_bitrate_kbps = Math.max(100, Math.min(50000, int(body.video_bitrate_kbps, 3000)));
  if (body.max_bitrate_kbps !== undefined) out.max_bitrate_kbps = body.max_bitrate_kbps ? Math.max(100, int(body.max_bitrate_kbps, 0)) : null;
  if (body.fps !== undefined) out.fps = body.fps ? Math.max(10, Math.min(120, int(body.fps, 25))) : null;
  if (body.gop !== undefined) out.gop = Math.max(10, Math.min(600, int(body.gop, 50)));
  if (body.deinterlace !== undefined) out.deinterlace = bool(body.deinterlace);
  if (body.audio_codec !== undefined) out.audio_codec = oneOf(body.audio_codec, ['copy', 'aac'], 'audio_codec');
  if (body.audio_bitrate_kbps !== undefined) out.audio_bitrate_kbps = Math.max(32, Math.min(512, int(body.audio_bitrate_kbps, 128)));
  if (body.audio_channels !== undefined) out.audio_channels = body.audio_channels ? Math.max(1, Math.min(8, int(body.audio_channels, 2))) : null;
  if (body.extra_args !== undefined) {
    const extra = String(body.extra_args || '').trim();
    if (/[;&|`$<>]/.test(extra)) throw new HttpError(400, 'Los argumentos extra no pueden contener ; & | ` $ < >');
    out.extra_args = extra.slice(0, 500);
  }
  return out;
}

async function serializeProfiles(rows) {
  const usage = await db('streams').whereNotNull('transcode_profile_id').groupBy('transcode_profile_id')
    .select('transcode_profile_id').count({ c: '*' });
  const map = new Map(usage.map((u) => [u.transcode_profile_id, Number(u.c)]));
  return rows.map((p) => ({ ...serializeProfile(p), stream_count: map.get(p.id) || 0, created_at: Number(p.created_at) }));
}

router.get('/transcode-profiles', async (_req, res) => {
  res.json(await serializeProfiles(await db('transcode_profiles').orderBy('name')));
});

router.post('/transcode-profiles', async (req, res) => {
  const t = now();
  const id = await insertId(db, 'transcode_profiles', { ...profileFields(req.body || {}, true), created_at: t, updated_at: t });
  await logAction(req.admin, 'profile.create', 'profile', id, { name: req.body.name });
  res.status(201).json((await serializeProfiles([await db('transcode_profiles').where({ id }).first()]))[0]);
});

router.put('/transcode-profiles/:id', async (req, res) => {
  const row = await db('transcode_profiles').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Perfil no encontrado');
  const fields = profileFields(req.body || {}, false);
  if (Object.keys(fields).length) await db('transcode_profiles').where({ id: row.id }).update({ ...fields, updated_at: now() });
  await logAction(req.admin, 'profile.update', 'profile', row.id, fields);
  res.json((await serializeProfiles([await db('transcode_profiles').where({ id: row.id }).first()]))[0]);
});

router.delete('/transcode-profiles/:id', async (req, res) => {
  const row = await db('transcode_profiles').where({ id: int(req.params.id, 0) }).first();
  if (!row) throw new HttpError(404, 'Perfil no encontrado');
  await db('transcode_profiles').where({ id: row.id }).del();
  await logAction(req.admin, 'profile.delete', 'profile', row.id, { name: row.name });
  res.json({ ok: true });
});

export default router;
