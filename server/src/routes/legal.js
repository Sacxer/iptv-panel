// Páginas públicas que exigen las tiendas (Google Play): política de privacidad y eliminación de datos.
import { Router } from 'express';
import { getSettings } from '../lib/settings.js';

const router = Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

function page(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px 16px;background:#f7f7f8;color:#1d1d1f}
main{max-width:760px;margin:0 auto;background:#fff;padding:28px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:1.6rem;margin-top:0}h2{font-size:1.15rem;margin-top:1.6em}li{margin:.3em 0}.muted{color:#666;font-size:.9rem}
</style></head><body><main>${body}</main></body></html>`;
}

function contact(s) {
  const parts = [];
  if (s.support_email) parts.push(`correo <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>`);
  if (s.support_phone) parts.push(`teléfono/WhatsApp ${esc(s.support_phone)}`);
  return parts.length ? parts.join(' o ') : 'los canales de atención de tu proveedor';
}

router.get(['/privacidad', '/privacy'], async (_req, res) => {
  const s = await getSettings();
  const company = esc(s.company_name || s.server_name);
  const app = esc(s.app_name || 'IPTV Player');
  res.type('html').send(page(`Política de privacidad · ${app}`, `
<h1>Política de privacidad de ${app}</h1>
<p class="muted">Responsable: ${company.replace(/\.+$/, '')}. Última actualización: ${esc(s.privacy_updated_at || '15/09/2026')}.</p>
<p>${app} es la aplicación con la que los suscriptores de ${company} ven el servicio de televisión contratado.
La app no incluye canales ni contenido propio: muestra el contenido del servicio de tu proveedor después de iniciar sesión.</p>

<h2>Datos que se tratan</h2>
<ul>
<li><b>Datos de la cuenta</b>: usuario y contraseña del servicio, para iniciar sesión.</li>
<li><b>Datos del equipo</b>: marca, modelo, tipo de equipo (celular, TV, TV box), versión de la app y un identificador
generado por la app. Sirven para mostrar tus equipos, respetar el número de conexiones simultáneas del plan y dar soporte técnico.</li>
<li><b>Dirección IP</b> y <b>actividad de reproducción</b> (qué canal o contenido se está viendo en ese momento y cuándo),
para controlar las conexiones simultáneas, detectar fallas y evitar el uso no autorizado de la cuenta.</li>
<li><b>Mensajes y avisos</b> que tu proveedor te envía y si los leíste.</li>
</ul>
<p>Los favoritos, el historial de lo visto y los perfiles se guardan solo en tu equipo.</p>

<h2>Para qué se usan</h2>
<ul>
<li>Prestar el servicio contratado, verificar tu suscripción y aplicar cortes o reactivaciones según tu estado de pago.</li>
<li>Soporte técnico, seguridad de la cuenta y mejora del servicio.</li>
</ul>
<p>No se usan para publicidad, no se venden ni se comparten con terceros para fines comerciales.</p>

<h2>Dónde se guardan y por cuánto tiempo</h2>
<p>En los servidores de ${company}. Las conexiones en vivo se borran al cerrar la reproducción; los datos de los equipos y la
actividad se conservan mientras tengas el servicio y hasta 12 meses después, salvo que la ley exija otra cosa.
La comunicación entre la app y el servidor puede no estar cifrada en redes locales; no uses la misma contraseña que en otros servicios.</p>

<h2>Tus derechos</h2>
<p>Puedes pedir conocer, corregir o eliminar tus datos, o dar de baja tu cuenta, escribiendo a ${contact(s)}.
Más información en <a href="/eliminar-datos">cómo eliminar tus datos</a>.</p>

<h2>Menores de edad</h2>
<p>El servicio lo contrata un adulto. La app no está dirigida a menores de 13 años.</p>

<h2>Cambios</h2>
<p>Si esta política cambia, se publicará en esta misma dirección con la fecha de actualización.</p>`));
});

router.get(['/eliminar-datos', '/delete-data'], async (_req, res) => {
  const s = await getSettings();
  const company = esc(s.company_name || s.server_name);
  const app = esc(s.app_name || 'IPTV Player');
  res.type('html').send(page(`Eliminar datos · ${app}`, `
<h1>Eliminar tu cuenta y tus datos de ${app}</h1>
<p>${app} es la app de los suscriptores de ${company}. Para eliminar tu cuenta y los datos asociados
(equipos registrados, actividad de reproducción y mensajes):</p>
<ol>
<li>Escribe a ${contact(s)} desde el correo o teléfono registrado en tu servicio.</li>
<li>Indica tu usuario y que quieres eliminar tu cuenta de ${app}.</li>
<li>Confirmaremos tu identidad y eliminaremos los datos en un máximo de 30 días.</li>
</ol>
<p>Para borrar solo los datos guardados en tu equipo (favoritos, historial y perfiles), desinstala la app o borra sus datos
desde los ajustes de Android.</p>
<p>Los datos de facturación del servicio de internet se rigen por el contrato con ${company}.</p>`));
});

export default router;
