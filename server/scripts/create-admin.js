// Crea un administrador o restablece su contraseña.
// Uso: npm run create-admin -- <usuario> <contraseña> [admin|reseller]
//      ADMIN_USER=… ADMIN_PASS=… node scripts/create-admin.js --from-env   (el instalador: la clave no aparece en la lista de procesos)
import { db, migrate } from '../src/db/index.js';
import { hashPassword } from '../src/lib/auth.js';
import { now } from '../src/lib/util.js';

const args = process.argv.slice(2);
const fromEnv = args[0] === '--from-env';
const [username, password, role = 'admin'] = fromEnv
  ? [process.env.ADMIN_USER, process.env.ADMIN_PASS, process.env.ADMIN_ROLE || 'admin']
  : args;
if (!username || !password) {
  console.error('Uso: npm run create-admin -- <usuario> <contraseña> [admin|reseller]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('La contraseña debe tener al menos 8 caracteres');
  process.exit(1);
}

await migrate();
const existing = await db('admins').where({ username }).first();
const password_hash = await hashPassword(password);
if (existing) {
  await db('admins').where({ id: existing.id }).update({ password_hash, role, enabled: true });
  console.log(`Contraseña actualizada para "${username}" (${role}).`);
} else {
  await db('admins').insert({ username, password_hash, role, enabled: true, created_at: now() });
  console.log(`Administrador "${username}" creado (${role}).`);
}
await db.destroy();
