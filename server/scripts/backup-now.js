// Hace una copia de seguridad ya mismo (el instalador la usa antes de actualizar el programa).
// Uso: node scripts/backup-now.js [nota]
import { db } from '../src/db/index.js';
import { createBackup } from '../src/services/backup.js';

const note = process.argv.slice(2).join(' ') || 'Copia manual desde la consola';
try {
  const job = await createBackup({ trigger: 'manual', note, upload: false });
  const backup = await job.promise;
  console.log(`Backup listo: ${backup.filename} (${Math.round(backup.size / 1024)} KB, ${backup.total_rows} filas)`);
} catch (err) {
  console.error('No se pudo hacer el backup:', err.message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
