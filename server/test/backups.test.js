import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { startFakeGoogle } from './fakeGoogle.js';
import { startTestServer } from './helpers.js';

let ctx;
let google;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  google = await startFakeGoogle();
  process.env.GOOGLE_OAUTH_URL = google.base;
  process.env.GOOGLE_API_URL = google.base;
  process.env.GOOGLE_UPLOAD_CHUNK = '512'; // obliga a subir en varias partes
  ctx = await startTestServer();
});

after(async () => {
  await ctx.stop();
  await google.close();
});

const backupPath = (b) => path.join(process.env.BACKUP_DIR, b.filename);

async function newBackup(body = {}) {
  const r = await ctx.api('POST', '/api/admin/backups?wait=true', body);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

async function uploadRaw(buffer, name = 'subido.iptvbak') {
  const res = await fetch(`${ctx.base}/api/admin/backups/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${await token()}` },
    body: buffer,
  });
  return { status: res.status, data: await res.json() };
}

async function token() {
  return (await ctx.api('POST', '/api/admin/auth/login', { username: 'admin', password: 'admin12345' })).data.token;
}

async function createClient(username) {
  const r = await ctx.api('POST', '/api/admin/users', { username, password: 'clave12345' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

describe('Copias de seguridad', () => {
  let first;

  test('crea una copia completa sin los secretos propios del servidor', async () => {
    await createClient('zz-prueba-antes');
    await ctx.api('PUT', '/api/admin/settings', { server_name: 'Servidor Original' });
    first = await newBackup({ note: 'primera' });
    assert.equal(first.status, 'ok');
    assert.equal(first.local, true);
    assert.equal(first.encrypted, false);
    assert.ok(first.tables.users >= 1 && first.tables.settings >= 1);
    assert.equal(first.tables.backups, undefined, 'el registro de backups no se incluye');
    assert.equal(first.tables.connections, undefined);
    assert.equal(first.note, 'primera');

    const raw = fs.readFileSync(backupPath(first));
    assert.equal(raw.subarray(0, 9).toString(), 'IPTVBAK1\n');
    const zlib = await import('node:zlib');
    const nl = raw.indexOf(0x0a, 9);
    const content = zlib.gunzipSync(raw.subarray(nl + 1)).toString();
    assert.ok(!content.includes('jwt_secret'), 'no exporta el secreto de sesión');
    assert.ok(!content.includes('"backup"'), 'no exporta los ajustes de backup');
    assert.ok(content.includes('zz-prueba-antes'));
    assert.ok(content.trim().endsWith('"type":"end","tables":' + JSON.stringify(first.tables) + '}'));
  });

  test('descarga con sesión y con enlace firmado', async () => {
    const withAuth = await ctx.api('GET', `/api/admin/backups/${first.id}/download`, undefined, { raw: true });
    assert.equal(withAuth.status, 200);
    assert.match(withAuth.headers.get('content-disposition'), /attachment/);
    const bytes = Buffer.from(await withAuth.arrayBuffer());
    assert.deepEqual(bytes, fs.readFileSync(backupPath(first)));

    const link = (await ctx.api('POST', `/api/admin/backups/${first.id}/download-link`)).data;
    const res = await fetch(ctx.base + link.url);
    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes);
    const bad = await fetch(`${ctx.base}/api/admin/backups/file/no-valido`);
    assert.equal(bad.status, 401);
    const noAuth = await ctx.api('GET', `/api/admin/backups/${first.id}/download`, undefined, { auth: false });
    assert.equal(noAuth.status, 401);
  });

  test('restaurar vuelve al estado de la copia y conserva los ajustes de backup', async () => {
    const before = (await ctx.api('GET', '/api/admin/users?search=zz-prueba')).data;
    const original = before.data.find((u) => u.username === 'zz-prueba-antes');
    await ctx.api('DELETE', `/api/admin/users/${original.id}`);
    await createClient('zz-prueba-despues');
    await ctx.api('PUT', '/api/admin/settings', { server_name: 'Nombre Cambiado' });
    await ctx.api('PUT', '/api/admin/backups/settings', { keep_local: 7 });

    const noConfirm = await ctx.api('POST', `/api/admin/backups/${first.id}/restore`, {});
    assert.equal(noConfirm.status, 400);

    const r = await ctx.api('POST', `/api/admin/backups/${first.id}/restore`, { confirm: 'RESTAURAR' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.ok, true);
    assert.equal(r.data.relogin_required, false);
    assert.equal(r.data.safety_backup.trigger, 'pre_restore');
    assert.equal(r.data.tables.users, first.tables.users);

    const users = (await ctx.api('GET', '/api/admin/users?search=zz-prueba')).data.data.map((u) => u.username);
    assert.deepEqual(users, ['zz-prueba-antes']);
    const created = await ctx.api('POST', '/api/admin/users', { username: 'zz-prueba-nuevo-id', password: 'clave12345' });
    assert.equal(created.status, 201, 'los ids siguen funcionando tras restaurar');
    assert.equal((await ctx.api('GET', '/api/admin/settings')).data.server_name, 'Servidor Original');
    const overview = (await ctx.api('GET', '/api/admin/backups')).data;
    assert.equal(overview.settings.keep_local, 7, 'los ajustes de backup del servidor no se pisan');
    assert.ok(overview.items.some((b) => b.id === r.data.safety_backup.id && b.local));
    assert.ok(overview.items.find((b) => b.id === first.id).restored_at);

    // La copia previa permite deshacer la restauración.
    const undo = await ctx.api('POST', `/api/admin/backups/${r.data.safety_backup.id}/restore`, { confirm: 'restaurar', safety_backup: false });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    const afterUndo = (await ctx.api('GET', '/api/admin/users?search=zz-prueba')).data.data.map((u) => u.username).sort();
    assert.deepEqual(afterUndo, ['zz-prueba-despues']);
    assert.equal((await ctx.api('GET', '/api/admin/settings')).data.server_name, 'Nombre Cambiado');
  });

  test('copias cifradas: contraseña obligatoria y archivo alterado se rechaza sin tocar datos', async () => {
    const weak = await ctx.api('PUT', '/api/admin/backups/settings', { encrypt: true, password: 'corta' });
    assert.equal(weak.status, 400);
    const noPass = await ctx.api('PUT', '/api/admin/backups/settings', { encrypt: true });
    assert.equal(noPass.status, 400);
    const ok = await ctx.api('PUT', '/api/admin/backups/settings', { encrypt: true, password: 'ClaveSegura123' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.settings.password_set, true);
    assert.equal(JSON.stringify(ok.data).includes('ClaveSegura123'), false, 'la contraseña nunca se devuelve');

    const enc = await newBackup();
    assert.equal(enc.encrypted, true);
    const raw = fs.readFileSync(backupPath(enc));
    assert.ok(!raw.includes(Buffer.from('zz-prueba')), 'el contenido no se lee sin la contraseña');

    assert.equal((await ctx.api('POST', `/api/admin/backups/${enc.id}/check-password`, { password: 'otra-clave-mala' })).status, 400);
    assert.equal((await ctx.api('POST', `/api/admin/backups/${enc.id}/check-password`, { password: 'ClaveSegura123' })).data.ok, true);
    const wrong = await ctx.api('POST', `/api/admin/backups/${enc.id}/restore`, { confirm: 'RESTAURAR', password: 'otra-clave-mala', safety_backup: false });
    assert.equal(wrong.status, 400);
    assert.match(wrong.data.error, /contraseña/i);

    // Sin contraseña usa la guardada en este servidor.
    const saved = await ctx.api('POST', `/api/admin/backups/${enc.id}/restore`, { confirm: 'RESTAURAR', safety_backup: false });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));

    // Archivo alterado: se rechaza y no cambia nada.
    await createClient('zz-prueba-tras-cifrado');
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 40] ^= 0xff;
    const up = await uploadRaw(tampered, 'alterado.iptvbak');
    assert.equal(up.status, 201, JSON.stringify(up.data));
    const bad = await ctx.api('POST', `/api/admin/backups/${up.data.id}/restore`, { confirm: 'RESTAURAR', safety_backup: false });
    assert.equal(bad.status, 400, JSON.stringify(bad.data));
    assert.match(bad.data.error, /dañado|incompleto|modificado/);
    const users = (await ctx.api('GET', '/api/admin/users?search=zz-prueba-tras-cifrado')).data.data;
    assert.equal(users.length, 1, 'la restauración fallida no borró nada');

    await ctx.api('PUT', '/api/admin/backups/settings', { clear_password: true });
    const cleared = (await ctx.api('GET', '/api/admin/backups')).data.settings;
    assert.equal(cleared.encrypt, false);
    assert.equal(cleared.password_set, false);
  });

  test('subir archivos: valida el formato y rechaza backups de versiones más nuevas', async () => {
    const junk = await uploadRaw(Buffer.from('esto no es un backup'), 'basura.iptvbak');
    assert.equal(junk.status, 400);
    assert.match(junk.data.error, /no es un backup/);
    assert.equal(fs.readdirSync(process.env.BACKUP_DIR).filter((f) => f.startsWith('.subida-')).length, 0, 'no deja temporales');

    const plain = await newBackup();
    const raw = fs.readFileSync(backupPath(plain));
    const nl = raw.indexOf(0x0a, 9);
    const meta = JSON.parse(raw.subarray(9, nl).toString());
    meta.migrations.push('999_futuro');
    const future = Buffer.concat([Buffer.from(`IPTVBAK1\n${JSON.stringify(meta)}\n`), raw.subarray(nl + 1)]);
    const up = await uploadRaw(future, 'futuro.iptvbak');
    assert.equal(up.status, 201);
    assert.equal(up.data.trigger, 'upload');
    const r = await ctx.api('POST', `/api/admin/backups/${up.data.id}/restore`, { confirm: 'RESTAURAR' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /versión más nueva/);
  });

  test('limpieza: conserva solo las N más nuevas y respeta las fijadas', async () => {
    const items = (await ctx.api('GET', '/api/admin/backups')).data.items.filter((b) => b.local);
    const pinned = items[items.length - 1];
    await ctx.api('PATCH', `/api/admin/backups/${pinned.id}`, { pinned: true, note: 'no borrar' });
    await ctx.api('PUT', '/api/admin/backups/settings', { keep_local: 2 });
    await newBackup();
    const newest = await newBackup();
    const local = (await ctx.api('GET', '/api/admin/backups')).data.items.filter((b) => b.local);
    assert.equal(local.filter((b) => !b.pinned).length, 2);
    assert.ok(local.some((b) => b.id === pinned.id && b.pinned && b.note === 'no borrar'));
    assert.ok(local.some((b) => b.id === newest.id));
    const files = fs.readdirSync(process.env.BACKUP_DIR).filter((f) => f.endsWith('.iptvbak'));
    assert.equal(files.length, 3);
    await ctx.api('PUT', '/api/admin/backups/settings', { keep_local: 10 });
  });

  test('horario: diario, semanal y cada N horas en la zona horaria configurada', async () => {
    const { nextScheduledRun } = await import('../src/services/backup.js');
    const tz = 'America/Bogota'; // UTC-5
    const from = Date.UTC(2026, 8, 15, 12, 0) / 1000; // martes 15/09/2026 07:00 en Bogotá
    const daily = nextScheduledRun({ schedule_enabled: true, frequency: 'daily', time: '03:00', last_scheduled_at: from }, tz, from);
    assert.equal(daily, Date.UTC(2026, 8, 16, 8, 0) / 1000);
    const later = nextScheduledRun({ schedule_enabled: true, frequency: 'daily', time: '22:30', last_scheduled_at: from }, tz, from);
    assert.equal(later, Date.UTC(2026, 8, 16, 3, 30) / 1000);
    const weekly = nextScheduledRun({ schedule_enabled: true, frequency: 'weekly', time: '03:00', weekdays: [7], last_scheduled_at: from }, tz, from);
    assert.equal(weekly, Date.UTC(2026, 8, 20, 8, 0) / 1000, 'domingo 20/09 03:00');
    const hours = nextScheduledRun({ schedule_enabled: true, frequency: 'hours', every_hours: 6, last_scheduled_at: from }, tz, from);
    assert.equal(hours, from + 6 * 3600);
    assert.equal(nextScheduledRun({ schedule_enabled: false }, tz, from), null);
  });

  test('copia programada: se activa sin copiar al instante y corre al llegar la hora', async () => {
    const { backupTick } = await import('../src/services/backup.js');
    const on = await ctx.api('PUT', '/api/admin/backups/settings', { schedule_enabled: true, frequency: 'hours', every_hours: 1 });
    assert.equal(on.status, 200);
    assert.ok(on.data.next_run_at > Date.now() / 1000 + 3000);
    const preview = await ctx.api('POST', '/api/admin/backups/settings/preview', { frequency: 'daily', time: '03:00' });
    assert.equal(preview.data.runs.length, 5);

    const count = async () => (await ctx.api('GET', '/api/admin/backups')).data.items.filter((b) => b.trigger === 'scheduled').length;
    await backupTick(Math.floor(Date.now() / 1000));
    assert.equal(await count(), 0, 'aún no toca');
    await backupTick(Math.floor(Date.now() / 1000) + 3700);
    assert.equal(await count(), 1);
    const dash = (await ctx.api('GET', '/api/admin/dashboard')).data.backups;
    assert.equal(dash.schedule_enabled, true);
    assert.equal(dash.last_status, 'ok');
    await ctx.api('PUT', '/api/admin/backups/settings', { schedule_enabled: false });
  });

  describe('Google Drive', () => {
    test('conexión por código y ajustes sin secretos', async () => {
      const bad = await ctx.api('POST', '/api/admin/backups/drive/connect', { client_id: 'otro', client_secret: 'x' });
      assert.equal(bad.status, 400);
      assert.match(bad.data.error, /ID o el secreto/);

      const start = await ctx.api('POST', '/api/admin/backups/drive/connect', { client_id: 'demo-client', client_secret: 'demo-secret' });
      assert.equal(start.status, 200, JSON.stringify(start.data));
      assert.equal(start.data.status, 'pending');
      assert.match(start.data.user_code, /^[A-F0-9]{4}-[A-F0-9]{4}$/);
      assert.equal(start.data.verification_url, `${google.base}/device`);

      let state;
      for (let i = 0; i < 40; i++) {
        state = (await ctx.api('GET', '/api/admin/backups/drive/connect')).data;
        if (state.status !== 'pending') break;
        await sleep(100);
      }
      assert.equal(state.status, 'connected', JSON.stringify(state));
      assert.equal(state.account_email, 'backups.demo@gmail.com');

      const overview = (await ctx.api('GET', '/api/admin/backups')).data;
      assert.equal(overview.drive.connected, true);
      const text = JSON.stringify(overview) + JSON.stringify((await ctx.api('GET', '/api/admin/settings')).data);
      assert.equal(text.includes('demo-secret'), false);
      assert.equal(/"r-[a-f0-9]+"/.test(text), false, 'el token de Google nunca sale del servidor');
      assert.equal(overview.settings.google_drive.client_secret_set, true);

      const t = await ctx.api('POST', '/api/admin/backups/drive/test');
      assert.equal(t.status, 200, JSON.stringify(t.data));
      assert.equal(t.data.folder_name, 'Backups IPTV');
      const folders = [...google.state.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
      assert.equal(folders.length, 1, 'una sola carpeta aunque se pruebe varias veces');
    });

    test('sube cada copia por partes, lista, borra del servidor y la vuelve a bajar', async () => {
      const chunksBefore = google.state.chunks;
      const b = await newBackup();
      assert.equal(b.drive.status, 'ok', JSON.stringify(b.drive));
      assert.ok(google.state.chunks - chunksBefore > 1, 'subida reanudable en varias partes');
      const remote = google.state.files.get(b.drive.file_id);
      assert.deepEqual(remote.content, fs.readFileSync(backupPath(b)));
      assert.equal(remote.appProperties.iptv_backup, '1');

      const list = (await ctx.api('GET', '/api/admin/backups/drive/files')).data.items;
      assert.ok(list.some((f) => f.id === b.drive.file_id && f.local_backup_id === b.id && f.local));

      const del = await ctx.api('DELETE', `/api/admin/backups/${b.id}?from=server`);
      assert.equal(del.data.deleted, false);
      assert.equal(del.data.backup.local, false);
      assert.equal(del.data.backup.drive.status, 'ok');
      const noLocal = await ctx.api('POST', `/api/admin/backups/${b.id}/restore`, { confirm: 'RESTAURAR' });
      assert.equal(noLocal.status, 400);
      assert.match(noLocal.data.error, /Google Drive/);

      const imported = await ctx.api('POST', `/api/admin/backups/drive/files/${b.drive.file_id}/import`);
      assert.equal(imported.status, 201, JSON.stringify(imported.data));
      assert.equal(imported.data.id, b.id);
      assert.equal(imported.data.local, true);
      assert.deepEqual(fs.readFileSync(backupPath(b)), remote.content);
      const restored = await ctx.api('POST', `/api/admin/backups/${b.id}/restore`, { confirm: 'RESTAURAR', safety_backup: false });
      assert.equal(restored.status, 200, JSON.stringify(restored.data));
    });

    test('limpieza en Drive y desconexión', async () => {
      await ctx.api('PUT', '/api/admin/backups/settings', { google_drive: { keep: 1 } });
      const b = await newBackup();
      const alive = [...google.state.files.values()].filter((f) => f.appProperties?.iptv_backup === '1' && !f.trashed);
      assert.equal(alive.length, 1);
      assert.equal(alive[0].id, b.drive.file_id);

      const off = await ctx.api('POST', '/api/admin/backups/drive/disconnect');
      assert.equal(off.status, 200);
      assert.equal(off.data.drive.connected, false);
      assert.equal(google.state.revoked.length, 1);
      const noDrive = await ctx.api('POST', `/api/admin/backups/${b.id}/drive?wait=true`);
      assert.equal(noDrive.status, 400);
    });
  });
});
