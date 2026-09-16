// Instalación junto a XtreamUI: lectura de su configuración y scripts que usa el instalador.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import { decodeXtreamUiConfig, detect, parseXuiIni } from '../scripts/detect-xtreamui.js';
import { startTestServer } from './helpers.js';

const KEY = '5709650b0d7806074842c6de575025b1';
const encode = (obj) => {
  const raw = Buffer.from(JSON.stringify(obj));
  return Buffer.from(raw.map((b, i) => b ^ KEY.charCodeAt(i % KEY.length))).toString('base64');
};

let ctx;
let tmp;
before(async () => {
  ctx = await startTestServer();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xtreamui-'));
});
after(async () => {
  await ctx.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const script = (name) => path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', name);

function runScript(name, args = [], input = '') {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script(name), ...args], { env: { ...process.env }, cwd: path.dirname(script(name)) }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

describe('servidor con XtreamUI', () => {
  test('lee la configuración cifrada de XtreamUI y la de XUI.one', () => {
    const conn = decodeXtreamUiConfig(encode({
      host: '127.0.0.1', db_user: 'user_iptvpro', db_pass: 'cl@ve"rara', db_name: 'xtream_iptvpro', server_id: '1', db_port: '7999', pconnect: '0',
    }));
    assert.deepEqual(conn, {
      kind: 'xtreamui', host: '127.0.0.1', port: 7999, user: 'user_iptvpro', password: 'cl@ve"rara', database: 'xtream_iptvpro',
    });
    const xui = parseXuiIni('[XUI]\nhostname    =   "127.0.0.1"\ndatabase    =   "xui"\nport        =   3306\nusername    =   "xui_user"\npassword    =   "abc123"\n');
    assert.deepEqual(xui, {
      kind: 'xui', host: '127.0.0.1', port: 3306, user: 'xui_user', password: 'abc123', database: 'xui',
    });
  });

  test('detecta el archivo que exista y avisa si no se puede leer', () => {
    const good = path.join(tmp, 'config');
    const bad = path.join(tmp, 'config-malo');
    fs.writeFileSync(good, encode({ host: '127.0.0.1', db_user: 'u', db_pass: 'p', db_name: 'xtream_iptvpro', db_port: '7999' }));
    fs.writeFileSync(bad, 'esto no es base64 de nada ###');
    assert.equal(detect([[path.join(tmp, 'no-existe'), decodeXtreamUiConfig]]), null);
    assert.equal(detect([[good, decodeXtreamUiConfig]]).user, 'u');
    assert.equal(detect([[bad, decodeXtreamUiConfig]]).unreadable, true);
  });

  test('el instalador guarda la conexión para la migración sin pisar una existente', async () => {
    const conn = {
      kind: 'xtreamui', host: '127.0.0.1', port: 7999, user: 'user_iptvpro', password: 'secreta', database: 'xtream_iptvpro',
    };
    const out = await runScript('set-xtream-db.js', [], JSON.stringify(conn));
    assert.match(out, /Migración lista/);
    const saved = JSON.parse((await ctx.db('settings').where({ key: 'xtream_db' }).first()).value);
    assert.deepEqual([saved.host, saved.port, saved.user, saved.password, saved.database], ['127.0.0.1', 7999, 'user_iptvpro', 'secreta', 'xtream_iptvpro']);
    assert.ok(!out.includes('secreta'), 'no imprime la contraseña');

    const again = await runScript('set-xtream-db.js', [], JSON.stringify({ ...conn, user: 'otro' }));
    assert.match(again, /no se cambió/);
    assert.equal(JSON.parse((await ctx.db('settings').where({ key: 'xtream_db' }).first()).value).user, 'user_iptvpro');
    assert.match(await runScript('set-xtream-db.js', [], '{}'), /No se pudieron leer/);
  });

  test('cambiar el puerto de clientes actualiza la URL guardada', async () => {
    await ctx.api('PUT', '/api/admin/settings', { public_url: 'http://10.0.0.5:25471' });
    assert.match(await runScript('set-public-port.js', ['25471', '25461']), /25461/);
    assert.equal(JSON.parse((await ctx.db('settings').where({ key: 'public_url' }).first()).value), 'http://10.0.0.5:25461');
    assert.match(await runScript('set-public-port.js', ['25471', '25461']), /no se cambió/);
    await ctx.api('PUT', '/api/admin/settings', { public_url: 'https://tv.midominio.com' });
    assert.match(await runScript('set-public-port.js', ['25461', '8080']), /no se cambió/);
  });
});

