// El servidor del portal también es nodo de streaming: el instalador lo registra y lo instala solo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { startTestServer } from './helpers.js';

let ctx;
before(async () => { ctx = await startTestServer(); });
after(async () => ctx.stop());

describe('nodo de streaming en el mismo servidor', () => {
  test('se registra una sola vez y su instalador usa el puerto elegido', async () => {
    const { ensureLocalNode } = await import('../scripts/local-node.js');
    const first = await ensureLocalNode();
    assert.equal(first.created, true);
    assert.equal(first.row.name, 'Este servidor');
    assert.equal(first.row.public_url, '', 'la URL se completa con la IP de la interfaz cuando el nodo se conecta');
    const again = await ensureLocalNode();
    assert.equal(again.created, false);
    assert.equal(again.row.token, first.row.token);
    const servers = (await ctx.api('GET', '/api/admin/servers')).data;
    assert.equal(servers.filter((s) => s.name === 'Este servidor').length, 1);

    const res = await ctx.api('GET', `/api/node/install.sh?token=${first.row.token}&port=8093`, undefined, { auth: false, raw: true });
    assert.equal(res.status, 200);
    const script = await res.text();
    assert.match(script, /^PORT=8093$/m);
    assert.match(script, /^MAIN_URL=http:\/\/127\.0\.0\.1:\d+$/m, 'se conecta al portal por la dirección local');
    assert.match(script, /ufw allow 8093\/tcp/);
    assert.ok(script.includes(`echo '{"type":"module"}' > /opt/iptv-node/package.json`), 'el programa del nodo usa módulos ES');
    const agent = await ctx.api('GET', `/api/node/agent.js?token=${first.row.token}`, undefined, { auth: false, raw: true });
    assert.equal(agent.status, 200, 'el portal entrega el programa del nodo');
    assert.match(await agent.text(), /export const VERSION/);
    const bad = await (await ctx.api('GET', `/api/node/install.sh?token=${first.row.token}&port=99999`, undefined, { auth: false, raw: true })).text();
    assert.match(bad, /^PORT=8090$/m, 'un puerto no válido usa el de siempre');

    // Si borran el nodo desde el panel, el instalador crea otro.
    await ctx.api('DELETE', `/api/admin/servers/${first.row.id}`);
    const recreated = await ensureLocalNode();
    assert.equal(recreated.created, true);
    assert.notEqual(recreated.row.token, first.row.token);
  });

  test('un portal nuevo trae perfiles de transcodificación listos', async () => {
    const profiles = (await ctx.api('GET', '/api/admin/transcode-profiles')).data;
    const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));
    assert.deepEqual(Object.keys(byName).sort(), ['Full HD 1080p (CPU)', 'HD 720p (CPU)', 'SD 480p ahorro (CPU)']);
    assert.equal(byName['HD 720p (CPU)'].resolution, '720');
    assert.equal(byName['HD 720p (CPU)'].hw, 'cpu');
    assert.equal(byName['SD 480p ahorro (CPU)'].video_bitrate_kbps, 1200);
    const { buildFfmpegArgs } = await import('../../node/iptv-node.js');
    const args = buildFfmpegArgs({ mode: 'transcode', profile: byName['HD 720p (CPU)'] }, 'http://fuente/canal.ts').join(' ');
    assert.match(args, /-vf yadif=deint=interlaced,scale=-2:720/);
    assert.match(args, /-c:v libx264 -preset veryfast -b:v 2500k -maxrate 3000k/);
    assert.match(args, /-c:a aac -b:a 128k -ac 2/);
  });

  test('el instalador lo instala por defecto y se puede omitir', () => {
    const installer = fs.readFileSync(new URL('../../deploy/install-ubuntu.sh', import.meta.url), 'utf8');
    assert.match(installer, /--sin-nodo\) LOCAL_NODE=0/);
    assert.match(installer, /-cf - server admin docs node \|/, 'copia el programa del nodo (lo entrega /api/node/agent.js)');
    assert.match(installer, /--exclude='node\/portal\.json'/);
    const demo = fs.readFileSync(new URL('../../deploy/demo-revision.sh', import.meta.url), 'utf8');
    assert.match(demo, /--rehacer\|--forzar\) LOADER_ARGS\+=/, 'el comando de demostración pasa --forzar');
    assert.match(installer, /node scripts\/local-node\.js/);
    assert.match(installer, /api\/node\/install\.sh\?token=\$\{NODE_TOKEN\}&port=\$\{NODE_PORT\}/);
    assert.match(installer, /api\/node\/agent\.js\?token=\$\{NODE_TOKEN\}/, 'al actualizar se actualiza el programa del nodo');
  });
});
