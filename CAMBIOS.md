# Cambios del panel IPTV

Cada versión nueva del panel se anota aquí. El panel instalado la muestra en *Versión y actualizaciones* cuando
hay una más nueva en GitHub. Para actualizar un servidor:
`curl -fsSL https://raw.githubusercontent.com/Sacxer/iptv-panel/main/install.sh | sudo bash`
(hace un backup y conserva todos los datos).

## 1.1.0 · 2026-09-17
- Qué ve cada cliente: en la ficha y en el cambio masivo se marcan Canales en vivo, Películas y Series. Sin marcar es automático (según sus paquetes). Lo que no se marca no aparece en las apps, sale vacío en apps de terceros y no está en la lista M3U.
- Clientes solo con canales: la app (versión 1.0.3 en adelante) abre directo en el último canal que vieron.
- Las versiones del panel ahora llevan número y en «Versión y actualizaciones» se ven las novedades de cada una.

## 1.0.0 · 2026-09-16
- Instalación en una línea, sin datos, que muestra la dirección del panel, el usuario y la contraseña. Convive con XtreamUI y XUI.one sin tocarlos.
- El mismo servidor queda como nodo de streaming (reenvío y transcodificación) y trae perfiles de transcodificación listos: 1080p, 720p y 480p.
- Copias de seguridad: descarga, Google Drive, programadas y restauración.
- WispHub: revisar ya los clientes suspendidos, actualizar un cliente y elegir cada cuánto se sincroniza.
- Puertos del panel y de clientes separados y configurables desde Servidores; la dirección para clientes sigue a la IP del servidor si cambia.
- La app busca el servidor en la red local y se reconecta sola si cambia la IP.
- Actualizaciones de la app de celular y TV box desde GitHub, con aviso en los equipos.
