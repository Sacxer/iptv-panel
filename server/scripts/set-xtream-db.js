// Guarda en los ajustes de migración la conexión a MySQL de XtreamUI, leída en JSON por la entrada estándar
// (así la contraseña no aparece en la lista de procesos). No pisa una conexión ya guardada salvo con --force.
// Uso: node scripts/detect-xtreamui.js | node scripts/set-xtream-db.js
import { db, migrate } from '../src/db/index.js';
import { getSettings, saveSettings } from '../src/lib/settings.js';

const input = await new Promise((resolve) => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => { text += d; });
  process.stdin.on('end', () => resolve(text));
});

try {
  const c = JSON.parse(input || '{}');
  if (!c.user || !c.database) {
    console.log('No se pudieron leer los datos de MySQL de XtreamUI: configúralos en el panel (Migración XtreamUI).');
  } else {
    await migrate();
    const current = (await getSettings()).xtream_db;
    if (current.host && current.user && !process.argv.includes('--force')) {
      console.log('Ya había una conexión a XtreamUI guardada: no se cambió.');
    } else {
      await saveSettings({
        xtream_db: {
          host: String(c.host || '127.0.0.1'), port: Number(c.port) || 3306, user: String(c.user), password: String(c.password || ''), database: String(c.database),
        },
      });
      console.log(`Migración lista: base ${c.database} en ${c.host}:${c.port} (usuario ${c.user}).`);
    }
  }
} finally {
  await db.destroy();
}
