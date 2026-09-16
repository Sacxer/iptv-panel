/*
 * Configuración de la compilación. ES5.
 *
 * Este archivo es el valor por defecto (modo desarrollo, al abrir index.html directamente).
 * `npm run serve` y `npm run build` lo reemplazan por uno generado con `operator.json`
 * y la versión de package.json (ver scripts/lib/appconfig.js).
 */
(function (root) {
  'use strict';
  var IPTV = root.IPTV = root.IPTV || {};

  IPTV.config = {
    appName: 'IPTV Player',
    version: '0.0.0',
    build: 0,
    /* tizen | webos | browser */
    distribution: 'browser',
    /* true: compilación de desarrollo (servidor manual y listas M3U) */
    dev: true,
    allowCustomServer: true,
    allowM3U: true,
    /* Direcciones del portal del operador, en orden de preferencia */
    serverUrls: [],
    /* Identificador del portal (install_id). Opcional: si se indica, solo se acepta ese portal */
    portalId: '',
    support: { name: '', phone: '', whatsapp: '', email: '', web: '' },
    /* Puertos del barrido en la red local */
    lanPorts: [25461, 8080, 80],
    /* Redes para el barrido cuando el equipo no informa la suya (navegador), p. ej. ["192.168.1.0/24"] */
    lanFallback: []
  };
})(typeof window !== 'undefined' ? window : global);
