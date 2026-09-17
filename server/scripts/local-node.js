// Nodo de streaming en este mismo servidor: crea (o reutiliza) su registro y escribe su token en la salida.
// Lo usa el instalador para que el servidor del portal también reenvíe y transcodifique canales.
// Uso: node scripts/local-node.js [nombre]
import { db, insertId, migrate } from '../src/db/index.js';
import { now } from '../src/lib/util.js';
import { generateServerToken } from '../src/services/nodes.js';

export const LOCAL_NODE_KEY = 'local_node_server_id';

export async function ensureLocalNode(name = 'Este servidor') {
  const saved = await db('settings').where({ key: LOCAL_NODE_KEY }).first();
  const savedId = saved ? Number(JSON.parse(saved.value)) : 0;
  let row = savedId ? await db('servers').where({ id: savedId }).first() : null;
  if (row) return { row, created: false };
  const t = now();
  // URL vacía: se completa sola con la IP de la interfaz principal cuando el nodo se conecte.
  const id = await insertId(db, 'servers', {
    name, public_url: '', token: generateServerToken(), status: 'pending',
    notes: 'Nodo instalado en el mismo servidor que el portal.', created_at: t, updated_at: t,
  });
  if (saved) await db('settings').where({ key: LOCAL_NODE_KEY }).update({ value: JSON.stringify(id) });
  else await db('settings').insert({ key: LOCAL_NODE_KEY, value: JSON.stringify(id) });
  row = await db('servers').where({ id }).first();
  return { row, created: true };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('local-node.js')) {
  try {
    await migrate();
    const { row } = await ensureLocalNode(process.argv[2] || undefined);
    process.stdout.write(row.token);
  } catch (err) {
    console.error('No se pudo preparar el nodo local:', err.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
