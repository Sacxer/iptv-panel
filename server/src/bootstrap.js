import { config } from './config.js';
import { db, migrate } from './db/index.js';
import { purgeStaleConnections } from './lib/access.js';
import { hashPassword, setJwtSecret } from './lib/auth.js';
import { getJwtSecret, saveSettings } from './lib/settings.js';
import { autoConfigurePublicUrl } from './services/network.js';
import { now, randomString } from './lib/util.js';
import { markInterruptedBackups, startBackupScheduler } from './services/backup.js';
import { startBillingScheduler } from './services/billingSync.js';
import { startDeviceMonitor } from './services/devices.js';
import { startReminderScheduler } from './services/reminders.js';
import { startAstraScheduler } from './services/astra.js';
import { startEpgScheduler } from './services/epg.js';
import { markOfflineServers } from './services/nodes.js';
import { startHealthMonitor } from './services/streamHealth.js';
import { startMetricsSampler } from './services/systemMetrics.js';
import { markInterruptedJobs } from './services/xtreamMigrator.js';

/** Prepara la base de datos y el estado inicial. Devuelve una función para detener tareas periódicas. */
export async function bootstrap({ quiet = false } = {}) {
  await migrate();
  setJwtSecret(await getJwtSecret(config.jwtSecret));
  await markInterruptedJobs();
  await markInterruptedBackups();
  await autoConfigurePublicUrl(saveSettings, quiet ? () => {} : console.log).catch(() => {});

  const admins = Number((await db('admins').count({ c: '*' }).first()).c);
  if (admins === 0) {
    const password = config.adminPassword || randomString(14);
    await db('admins').insert({
      username: 'admin', password_hash: await hashPassword(password), role: 'admin', enabled: true, created_at: now(),
    });
    if (!quiet) {
      console.log('──────────────────────────────────────────────');
      console.log(' Administrador inicial creado');
      console.log('   usuario:    admin');
      console.log(`   contraseña: ${config.adminPassword ? '(la definida en ADMIN_PASSWORD)' : password}`);
      console.log(' Cámbiala desde Ajustes al iniciar sesión.');
      console.log('──────────────────────────────────────────────');
    }
  }

  const timer = setInterval(() => {
    purgeStaleConnections().catch(() => {});
    markOfflineServers().catch(() => {});
  }, 30_000);
  timer.unref();
  const stops = [startDeviceMonitor(), startMetricsSampler(), startHealthMonitor(), startBillingScheduler(), startReminderScheduler(), startAstraScheduler(), startEpgScheduler(), startBackupScheduler()];
  return () => {
    clearInterval(timer);
    stops.forEach((stop) => stop());
  };
}
