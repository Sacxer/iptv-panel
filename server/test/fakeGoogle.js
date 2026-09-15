// Google (OAuth por código + Drive v3) simulado para pruebas y demos, sin cuenta real.
// Cliente válido: client_id "demo-client", client_secret "demo-secret".
import crypto from 'node:crypto';
import http from 'node:http';

export async function startFakeGoogle({ port = 0, autoApproveAfter = 1, email = 'backups.demo@gmail.com' } = {}) {
  const state = {
    devices: new Map(), // device_code -> { user_code, polls, approved, denied }
    access: new Set(),
    refresh: new Set(),
    files: new Map(), // id -> { id, name, mimeType, parents, appProperties, description, trashed, content, createdTime }
    sessions: new Map(),
    revoked: [],
    uploads: 0,
    chunks: 0,
  };
  const id = () => crypto.randomBytes(8).toString('hex');
  let seq = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const form = () => Object.fromEntries(new URLSearchParams(raw.toString()));
    const json = () => { try { return JSON.parse(raw.toString() || '{}'); } catch { return {}; } };
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const p = url.pathname;

    /* ---------------- OAuth ---------------- */
    if (req.method === 'POST' && p === '/device/code') {
      const f = form();
      if (f.client_id !== 'demo-client') return send(401, { error: 'invalid_client' });
      if (!String(f.scope || '').includes('drive.file')) return send(400, { error: 'invalid_scope' });
      const code = id();
      const userCode = `${crypto.randomBytes(2).toString('hex')}-${crypto.randomBytes(2).toString('hex')}`.toUpperCase();
      state.devices.set(code, { user_code: userCode, polls: 0, approved: false, denied: false });
      return send(200, {
        device_code: code, user_code: userCode, verification_url: `${base}/device`, expires_in: 1800, interval: 0.2,
      });
    }
    if (req.method === 'POST' && p === '/token') {
      const f = form();
      if (f.client_id !== 'demo-client' || f.client_secret !== 'demo-secret') return send(401, { error: 'invalid_client' });
      if (f.grant_type === 'refresh_token') {
        if (!state.refresh.has(f.refresh_token)) return send(400, { error: 'invalid_grant' });
        const access = `a-${id()}`;
        state.access.add(access);
        return send(200, { access_token: access, expires_in: 3600 });
      }
      const dev = state.devices.get(f.device_code);
      if (!dev) return send(400, { error: 'expired_token' });
      dev.polls++;
      if (dev.denied) return send(403, { error: 'access_denied' });
      const auto = autoApproveAfter !== null && dev.polls > autoApproveAfter;
      if (!dev.approved && !auto) return send(428, { error: 'authorization_pending' });
      state.devices.delete(f.device_code);
      const access = `a-${id()}`;
      const refresh = `r-${id()}`;
      state.access.add(access);
      state.refresh.add(refresh);
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      return send(200, {
        access_token: access, refresh_token: refresh, expires_in: 3600, id_token: `${b64({ alg: 'none' })}.${b64({ email })}.x`,
      });
    }
    if (req.method === 'POST' && p === '/revoke') {
      const { token } = form();
      state.revoked.push(token);
      state.refresh.delete(token);
      return send(200, {});
    }
    // Página para aprobar el código (demo en el navegador).
    if (req.method === 'GET' && p === '/device') {
      const rows = [...state.devices.values()].filter((d) => !d.approved && !d.denied)
        .map((d) => `<li><b>${d.user_code}</b> <form method="post" action="/device/approve" style="display:inline"><input type="hidden" name="user_code" value="${d.user_code}"><button>Permitir</button></form>
          <form method="post" action="/device/deny" style="display:inline"><input type="hidden" name="user_code" value="${d.user_code}"><button>Rechazar</button></form></li>`).join('');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<h1>Google simulado</h1><p>Cuenta: ${email}</p><ul>${rows || '<li>No hay códigos pendientes</li>'}</ul>`);
    }
    if (req.method === 'POST' && (p === '/device/approve' || p === '/device/deny')) {
      const code = String(form().user_code || json().user_code || '').toUpperCase();
      const dev = [...state.devices.values()].find((d) => d.user_code === code);
      if (!dev) return send(404, { error: 'unknown code' });
      if (p.endsWith('approve')) dev.approved = true;
      else dev.denied = true;
      res.writeHead(303, { Location: '/device' });
      return res.end();
    }

    /* ---------------- Drive ---------------- */
    const auth = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const needsAuth = p.startsWith('/drive/') || p.startsWith('/upload/');
    if (needsAuth && !state.access.has(auth)) return send(401, { error: { message: 'Invalid Credentials' } });
    const meta = (f) => ({
      id: f.id, name: f.name, mimeType: f.mimeType, parents: f.parents, trashed: f.trashed,
      size: f.content ? String(f.content.length) : undefined, createdTime: f.createdTime, appProperties: f.appProperties, description: f.description,
    });

    if (req.method === 'GET' && p === '/drive/v3/about') {
      const usage = [...state.files.values()].reduce((a, f) => a + (f.content?.length || 0), 0);
      return send(200, { user: { emailAddress: email, displayName: 'Demo' }, storageQuota: { limit: '15000000000', usage: String(usage) } });
    }
    if (req.method === 'GET' && p === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      let list = [...state.files.values()].filter((f) => !f.trashed);
      const name = /name='((?:[^'\\]|\\.)*)'/.exec(q);
      if (q.includes("mimeType='application/vnd.google-apps.folder'")) list = list.filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
      if (name) list = list.filter((f) => f.name === name[1].replace(/\\(.)/g, '$1'));
      const parent = /'([^']+)' in parents/.exec(q);
      if (parent) list = list.filter((f) => f.parents?.includes(parent[1]));
      list.sort((a, b) => b.seq - a.seq);
      const size = Number(url.searchParams.get('pageSize') || 100);
      const start = Number(url.searchParams.get('pageToken') || 0);
      const page = list.slice(start, start + size);
      return send(200, { files: page.map(meta), ...(start + size < list.length ? { nextPageToken: String(start + size) } : {}) });
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(p);
    if (fileMatch) {
      const f = state.files.get(decodeURIComponent(fileMatch[1]));
      if (!f) return send(404, { error: { message: 'File not found' } });
      if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        return res.end(f.content);
      }
      if (req.method === 'GET') return send(200, meta(f));
      if (req.method === 'PATCH') {
        const body = json();
        if (body.trashed !== undefined) f.trashed = Boolean(body.trashed);
        return send(200, meta(f));
      }
    }
    if (req.method === 'POST' && p === '/drive/v3/files') {
      const body = json();
      const f = {
        id: id(), seq: ++seq, name: body.name, mimeType: body.mimeType, parents: body.parents || [], trashed: false, createdTime: new Date().toISOString(),
      };
      state.files.set(f.id, f);
      return send(200, { id: f.id, name: f.name });
    }
    if (req.method === 'POST' && p === '/upload/drive/v3/files') {
      const sid = id();
      state.sessions.set(sid, { meta: json(), total: Number(req.headers['x-upload-content-length'] || 0), parts: [] });
      return send(200, {}, { Location: `${base}/upload/session/${sid}` });
    }
    const sessionMatch = /^\/upload\/session\/([^/]+)$/.exec(p);
    if (sessionMatch && req.method === 'PUT') {
      const s = state.sessions.get(sessionMatch[1]);
      if (!s) return send(404, { error: { message: 'session' } });
      state.chunks++;
      const range = /bytes (\d+)-(\d+)\/(\d+)/.exec(String(req.headers['content-range'] || ''));
      if (range) s.parts.push(raw);
      const received = s.parts.reduce((a, b) => a + b.length, 0);
      if (range && received < s.total) return send(308, undefined, { Range: `bytes=0-${received - 1}` });
      const f = {
        id: id(), seq: ++seq, name: s.meta.name, mimeType: 'application/octet-stream', parents: s.meta.parents || [], appProperties: s.meta.appProperties,
        description: s.meta.description, trashed: false, content: Buffer.concat(s.parts), createdTime: new Date().toISOString(),
      };
      state.files.set(f.id, f);
      state.sessions.delete(sessionMatch[1]);
      state.uploads++;
      return send(200, { id: f.id, name: f.name, size: String(f.content.length) });
    }
    send(404, { error: { message: `no simulado: ${req.method} ${p}` } });
  });

  await new Promise((r) => server.listen(port, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    state,
    close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
