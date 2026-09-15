# Publicar IPTV Player en Google Play

Guía para el operador. Lo marcado con **(tú)** solo lo puede hacer el dueño de la cuenta; lo demás ya está
preparado en el proyecto o lo hace el script de publicación.

## 0. Antes de empezar: cómo se reparte la app

La app tiene dos versiones que son **la misma app** (mismo paquete `com.iptvplayer.app` y misma firma):

| Versión | Para | Cómo se actualiza |
|---|---|---|
| **Play** (`.aab`) | Celulares y Android TV con Play Store | Google Play |
| **Portal** (`.apk`) | TV box de la empresa y equipos sin Play Store | Desde el portal: *Actualizaciones de la app* |

Google no permite que una app bajada de Play se actualice por fuera de Play, por eso la versión Play no trae el
actualizador y la versión Portal sí.

## 1. Cuenta de desarrollador (tú)

1. Entra a <https://play.google.com/console/signup> con la cuenta de Google que será la dueña de la app
   (mejor una cuenta de la empresa, no una personal que se pueda perder).
2. Elige el tipo de cuenta:
   - **Organización**: sirve cualquier empresa legalmente constituida (tu S.A.S. del servicio de internet sirve,
     no tiene que ser una empresa de software). Pide el **número D-U-N-S** de la empresa (gratis en
     <https://www.dnb.com/duns-number/get-a-duns.html>; puede tardar varios días). **No** exige la prueba con 12 personas.
   - **Personal**: más rápida de abrir, pero antes de publicar exige una **prueba cerrada con al menos 12 personas
     durante 14 días seguidos** (ver paso 6).
3. Paga la cuota única de **25 USD** y completa la verificación de identidad (documento y, para organización, datos de la empresa).
4. Verifica el correo y el teléfono de contacto que pide la consola.

## 2. Datos públicos en el portal (tú, 5 minutos)

En el portal → **Ajustes → Empresa**:
- Nombre de la empresa, nombre de la app (**IPTV Player**), correo y teléfono de soporte.

Con eso quedan listas las páginas que pide Google:
- Política de privacidad: `https://TU-DOMINIO/privacidad`
- Eliminación de datos: `https://TU-DOMINIO/eliminar-datos`

> Deben ser direcciones **públicas** (que abran desde cualquier internet). Mientras el portal esté solo en la red local
> (`192.168.x.x`), publica el mismo texto en una página gratuita (por ejemplo Google Sites) y usa esa dirección.

## 3. Crear la app en la consola (tú)

1. **Crear app** → nombre `IPTV Player`, idioma predeterminado Español (Latinoamérica), tipo **App**, **Gratis**.
2. Acepta las declaraciones (políticas del programa para desarrolladores y leyes de exportación de EE. UU.).

## 4. Firma de la app — IMPORTANTE, se decide una sola vez (tú + script)

Al subir la primera versión, Play pregunta por la **clave de firma de apps**:

- Elige **"Usar una clave diferente" / "Exportar y subir una clave desde Java KeyStore"** y sube la clave de la app
  (en esa pantalla Google da para descargar `pepk.jar` y una clave pública de cifrado; con esos dos archivos el script
  `app/scripts/clave-para-play.ps1` genera el `.zip` cifrado que se sube ahí mismo).
- Así Google firma con **la misma clave** que los APK del portal, y un equipo puede pasar de una versión a otra.
  Si dejas que Google genere una clave nueva, las versiones Play y Portal quedan como apps incompatibles.

La llave (`app/android/keystore/iptv-player.jks`) y sus contraseñas (`app/android/key.properties`) **no se suben a ningún
lado**. Guarda una copia en un lugar seguro (USB y gestor de contraseñas): si se pierde, no se pueden publicar más
actualizaciones con esa firma.

## 5. Ficha de la tienda y formularios (tú, con los textos preparados)

En **Crecimiento → Presencia en Play Store → Ficha principal** y en **Política → Contenido de la app**:

| Sección | Qué poner |
|---|---|
| Descripción breve (80) | `Mira la TV de tu servicio en el celular, TV y TV box. Solo para suscriptores.` |
| Descripción completa | Ver `docs/play-store/ficha.md` (dice claramente que no incluye canales y es solo para suscriptores) |
| Ícono | 512×512 PNG |
| Imagen destacada | 1024×500 PNG |
| Capturas | Mínimo 2 de celular (y de TV si se publica para Android TV). **No** mostrar logos o programas de canales de terceros |
| Categoría | Video y reproductores (o Entretenimiento) |
| Correo de contacto | El de soporte |
| Política de privacidad | URL del paso 2 |
| Acceso a la app | "Todas las funciones o algunas están restringidas" → usuario y contraseña **de prueba** que funcionen (con 2-3 canales propios o de prueba) e instrucciones: "Elegir Xtream Codes, servidor https://…, usuario…, contraseña…" |
| Anuncios | No contiene anuncios |
| Clasificación de contenido | Cuestionario: app de streaming de video; responde según el contenido del servicio |
| Público objetivo | 18+ (o 13+); **no** dirigida a niños |
| Seguridad de los datos | Ver tabla abajo |
| App gubernamental / financiera / salud / noticias | No |

**Seguridad de los datos** (lo que realmente hace la app):
- Recopila: **Identificadores del dispositivo** (ID generado por la app), **Información de la app y rendimiento** (versión),
  **Actividad en la app** (contenido que se reproduce), **Info personal: nombre de usuario**.
- Finalidad: Funcionalidad de la app, Seguridad y prevención de fraudes, Administración de la cuenta.
- ¿Se comparten con terceros? **No**. ¿Es obligatorio? **Sí**. ¿Cifrado en tránsito? Solo si el servidor usa **https**
  (recomendado en el VPS). ¿Se pueden pedir que se borren? **Sí** (URL `/eliminar-datos`).

## 6. Pruebas y publicación

1. **Pruebas → Prueba interna**: sube el `.aab` y agrega tu correo. Instala desde el enlace y prueba.
2. Solo cuenta **personal**: **Prueba cerrada** con **12 o más** correos de Gmail (clientes o empleados que la usen de
   verdad) durante **14 días seguidos**. Luego, en el panel, **Solicitar acceso a producción** y responde el cuestionario.
3. **Producción → Crear versión** → sube el `.aab` → notas de la versión → revisar → publicar. La primera revisión puede
   tardar desde unas horas hasta varios días.

## 7. Cada actualización

1. Subir el número de versión en `app/pubspec.yaml` (`version: 1.0.1+2`: nombre + número que siempre sube).
2. Ejecutar el script de publicación: compila el `.aab` para Play y los `.apk` para el portal, y sube los `.apk` al portal.
3. En la consola de Play: Producción → Crear versión → subir el `.aab` (más adelante se puede automatizar con una
   cuenta de servicio de Google Play).
4. En el portal: *Actualizaciones de la app* → revisar la versión nueva → **Publicar** (se puede limitar a TV box,
   hacer despliegue gradual o marcarla obligatoria).

## Riesgos a tener en cuenta

- Google ha retirado reproductores IPTV por reclamos de derechos de autor aunque no traigan contenido. Para bajar el
  riesgo: la ficha dice que es solo para suscriptores de tu servicio, la app no trae listas ni canales, las capturas no
  muestran marcas de canales, y conviene tener a mano los contratos o autorizaciones de los canales por si Google los pide.
- Google exige apuntar a una versión reciente de Android: hoy **API 36** (la app ya la cumple).
