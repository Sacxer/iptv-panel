import { db } from '../db/index.js';
import { now } from './util.js';

/** Registra una acción de un administrador. Nunca lanza: el registro no debe romper la operación. */
export async function logAction(admin, action, entity = null, entityId = null, details = null) {
  try {
    await db('logs').insert({
      admin_id: admin?.id ?? null,
      admin_username: admin?.username ?? 'sistema',
      action,
      entity,
      entity_id: entityId === null ? null : String(entityId),
      details: details === null ? null : typeof details === 'string' ? details : JSON.stringify(details),
      created_at: now(),
    });
  } catch (err) {
    console.error('No se pudo registrar la acción', action, err.message);
  }
}
