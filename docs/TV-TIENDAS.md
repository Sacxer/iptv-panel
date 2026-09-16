# Publicar la app de TV en Samsung y LG

Guía para el operador: cuentas, requisitos, imágenes, cuenta de prueba, revisión y qué escribir en cada
formulario. La parte técnica (compilar, instalar en modo desarrollador) está en [`tv/README.md`](../tv/README.md).

Información revisada el 2026-09-16 en las páginas oficiales de Samsung y LG (enlaces en cada punto y al final).
Donde Samsung o LG no publican un dato, se indica como **no confirmado** o **estimado**.

## Contenido

1. [Estado y próximos pasos](#1-estado-y-próximos-pasos)
2. [Riesgo de rechazo y por qué hay dos compilaciones](#2-riesgo-de-rechazo-y-por-qué-hay-dos-compilaciones)
3. [Dirección pública para la revisión](#3-dirección-pública-para-la-revisión)
4. [Samsung (Tizen)](#4-samsung-tizen)
5. [LG (webOS)](#5-lg-webos)
6. [Imágenes y capturas](#6-imágenes-y-capturas)
7. [Cuenta de prueba, privacidad y contenido](#7-cuenta-de-prueba-privacidad-y-contenido)
8. [Qué escribir en cada formulario](#8-qué-escribir-en-cada-formulario)
9. [Lista de verificación antes de enviar](#9-lista-de-verificación-antes-de-enviar)
10. [Fuentes](#10-fuentes)

---

## 1. Estado y próximos pasos

Ya tiene: **cuenta de Samsung Developer** y **cuenta de LG webOS TV Developer**.

Falta, en este orden:

1. **Samsung TV Seller Office**: entrar con la cuenta Samsung y registrarse como vendedor
   (queda como *Public Seller*).
2. **Samsung, solicitud de partner para Colombia**: un vendedor público solo puede publicar en **Estados Unidos**.
   Para Colombia hay que firmar un contrato con Samsung (Content Manager) y pedir la asociación (*partnership*)
   en Seller Office. Tiempo **estimado**: de 2 semanas a 2 meses (Samsung no publica plazos).
3. **LG Seller Lounge**: registrarse como vendedor (empresa: *Corporate Seller*).
4. Preparar la **dirección pública de revisión** y la **cuenta de prueba** (secciones 3 y 7).
5. Compilar la versión de tienda (`npm run build`), firmar y enviar.

## 2. Riesgo de rechazo y por qué hay dos compilaciones

Samsung y LG no publican una regla explícita sobre reproductores IPTV, pero en la práctica **suelen rechazar
reproductores genéricos** que dejan escribir cualquier servidor o cualquier lista M3U: no pueden verificar
el contenido y se asocian con piratería. LG prohíbe material que infrinja derechos de autor (guía de Seller
Lounge) y Samsung revisa el contenido en la certificación.

Por eso hay dos compilaciones:

| | Tienda (`npm run build`) | Completa (`npm run build -- --full`) |
|---|---|---|
| Uso | Samsung Apps TV y LG Content Store | **Solo** televisores propios en modo desarrollador y pruebas (no se envía a las tiendas) |
| Inicio de sesión | Usuario y contraseña del servicio | Servidor libre (Xtream Codes) o lista M3U, como la app de celular |
| Servidor | El del operador (`serverUrls`) | El que escriba el usuario |

Cómo presentar la app para reducir el riesgo:

- Es **la app del servicio del operador para sus suscriptores**, no un reproductor: nombre, descripción,
  imágenes y soporte del operador.
- **Sin contenido de terceros precargado** ni listas de ejemplo; todo el contenido lo entrega el portal del
  operador con sus derechos.
- **Cuenta de prueba** en el portal del operador (sección 7) que solo vea contenido propio o de prueba.
- **Política de privacidad** publicada (`/privacidad` del portal).
- Decir claramente que **se necesita una suscripción** del operador para usarla.

**Plan B si la rechazan:** la compilación de tienda ya viene restringida (`allowCustomServer: false`,
`allowM3U: false` en `tv/operator.json`). Si el operador hubiera abierto esas opciones, vuelva a ponerlas en
`false`, suba la versión en `tv/package.json`, compile y envíe de nuevo explicando el cambio.

## 3. Dirección pública para la revisión

Los clientes usan el servidor en la red del ISP (`http://192.168.30.100:25461`). **Los revisores de Samsung
(Corea) y de LG no están en esa red** y no pueden llegar a una IP privada: sin una dirección pública la app no
inicia sesión y la rechazan por «no funciona».

La app prueba las direcciones de `serverUrls` en orden, así que basta con agregar una segunda:

```json
"serverUrls": ["http://192.168.30.100:25461", "http://IP-PUBLICA-O-DOMINIO:25461"]
```

Opciones:

1. **Redirección de puerto** (lo más simple): en el router/firewall del ISP, publicar el puerto 25461 de la IP
   pública hacia `192.168.30.100:25461` **durante la revisión**, con la cuenta de prueba (que solo vea
   contenido propio o de prueba). Si hay un dominio, úselo (`http://tv.suempresa.com:25461`).
2. **Portal de demostración** pequeño en un VPS público con contenido propio y la cuenta de prueba.

Después de la aprobación puede quitar la redirección; la dirección pública puede quedar en `serverUrls`
(la app la usa solo si la local no responde) o quitarse en la siguiente versión.

Si la revisión es desde otro país y el portal limita por país o IP, indíquelo (Samsung pide VPN o IP en el
documento de prueba).

**Texto sugerido para las notas de revisión** (inglés, que es lo que leen):

> This is the official app of [EMPRESA], an Internet and TV provider in Cartagena, Colombia. It only works for
> our subscribers with the username and password we give them. It plays our own live TV channels and
> on-demand content delivered by our servers; the app does not include or allow third-party playlists.
> Test account: user `[USUARIO]`, password `[CLAVE]`. The app connects automatically to our public test
> server (`http://[IP-PUBLICA]:25461`). No VPN is required. Privacy policy: `http://[IP-PUBLICA]:25461/privacidad`.
> Support: [CORREO] / [TELÉFONO].

## 4. Samsung (Tizen)

### 4.1 Cuentas y asociación (partner)

- Al registrarse en **Seller Office** con la cuenta Samsung (nombre, correo, país, zona horaria, aceptar
  términos) queda como **Public Seller**, que **solo puede lanzar apps de TV en Estados Unidos**
  ([becoming-seller-office-member](https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html)).
- Para otros países (Colombia) hace falta ser **Partner Seller**
  ([becoming-partner](https://developer.samsung.com/smarttv/develop/distribute/seller-office/membership/becoming-partner.html)):
  1. Contrato con Samsung (sede central o filial local) a través del **Content Manager** de la región.
  2. El administrador del grupo envía la solicitud de asociación en Seller Office con el correo del Content
     Manager y crea el grupo con los datos de la empresa.
  3. Si no conoce al Content Manager, pregunte por **1:1 Q&A** en Seller Office.
- Samsung no publica costos, documentos ni plazos; el soporte es solo por 1:1 Q&A
  ([tv-seller-office-use](https://developer.samsung.com/tv-seller-office/faq/tv-seller-office-use.html)).
  Plazo **estimado**: 2 semanas a 2 meses.
- La tienda que ve un televisor depende de su código de modelo, no del país donde se usa (misma fuente).

### 4.2 Certificados

- En Tizen Studio (Samsung Certificate Extension) se crea un perfil con certificado de **autor** y de
  **distribuidor**. Guarde el certificado de autor: **todas las actualizaciones deben llevar la misma firma**
  ([creating-certificates](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html),
  [launch-checklist](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html)).
- La app solo usa privilegios **públicos** (internet, tv.inputdevice, network.public, productinfo): no necesita
  privilegios de partner.

### 4.3 Pasos de publicación

([application-publication-process](https://developer.samsung.com/tv-seller-office/application-publication-process.html),
[distributing-application](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html))

1. Preparar archivos: `.wgt` firmado (`npm run build tizen -- --profile PERFIL`), imágenes (sección 6),
   capturas, **App UI Description** (documento con las pantallas y la cuenta de prueba) y textos.
2. Crear la app (nombre, tipo, idioma predeterminado). **El nombre en `config.xml` debe coincidir con el título
   de Seller Office** en el idioma predeterminado.
3. Subir el paquete: corre una prueba automática (*pre-test*).
4. Completar imágenes, información del servicio (categoría, clasificación por edad, idiomas, **URL de la
   política de privacidad**, datos del vendedor, correo de contacto) e información de verificación.
5. «Request New Release» y elegir los grupos de modelos (años).
6. Revisión y pruebas de Samsung → *Rejected/Fail* (corregir con «Defect Resolve») o *Waiting Launch* →
   *Launched*. Opcional: lanzamiento gradual 3 % → 10 % → 100 % en unas 3 semanas (modelos 2021+).

Samsung no publica el tiempo de revisión: depende de los probadores y de las rondas
([certification-process](https://developer.samsung.com/tv-seller-office/faq/certification-process.html)).
**Si falta la información de prueba, la certificación falla** (misma fuente).

### 4.4 Requisitos técnicos que la app ya cumple

De la lista común de verificación
([development-checklist/common](https://developer.samsung.com/smarttv/develop/development-checklist/common.html)),
la de lanzamiento ([launch-checklist](https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html))
y las guías de Samsung:

| Requisito | En la app |
|---|---|
| Responde antes de 30 s al abrir; salir y volver a abrir funciona | Pantalla de carga inmediata; se reconecta sola |
| Tecla Atrás (Return) va a la pantalla anterior; en la primera pide confirmación antes de salir ([terminating-applications](https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html)) | Sí; «Salir» llama a `tizen.application.getCurrentApplication().exit()` |
| No registrar la tecla Exit ni las de volumen | No se registran |
| Multitarea: al volver con Smart Hub, el vídeo sigue igual o se muestra la pantalla anterior ([multitasking](https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html)) | Al ocultarse se detiene el canal en vivo (se reanuda al volver) y la película usa `suspend/restore` de AVPlay |
| Si se cae la red: mensaje, detener la reproducción y recuperarse al volver ([checking-network-status](https://developer.samsung.com/smarttv/develop/guides/fundamentals/checking-network-status.html)) | Aviso «Sin conexión a la red», reintento automático |
| Indicador de carga mientras carga el vídeo | Sí |
| Resolución 1920x1080, 16:9 | Sí (se escala a 1280x720) |
| Solo los privilegios que se usan; versión `x.y.z`; `required_version` `x.y` | Sí (ver `tv/tizen/config.xml`) |
| Paquete con `config.xml`, `author-signature.xml`, `signature1.xml` | Los crea `tizen package` al firmar |

Apps alojadas en un servidor (*hosted*) no están permitidas salvo excepciones: esta app va empaquetada
([hosted-applications](https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html)).

### 4.5 Distribución fuera de la tienda (modo desarrollador y USB)

- **Modo desarrollador**: instalación por red con Tizen Studio en televisores cuyos DUID están en el
  certificado; Samsung indica que esas apps se borran al apagar el televisor
  ([application-testing](https://developer.samsung.com/smarttv/develop/faq/application-testing.html)).
  Pasos en `tv/README.md`.
- **Memoria USB (`userwidget`, como SS IPTV)**: Samsung **no** permite instalar un `.wgt` por USB. Solo
  instala un **`.tmg` con su `.license`**, generados con la **USB Demo Packaging Tool** de Seller Office
  ([application-installation](https://developer.samsung.com/smarttv/develop/faq/application-installation.html)),
  que según hilos del foro de Samsung solo ven las **cuentas partner**. Esos paquetes **vencen a los 30 días**
  ([SmartLabs](https://help.smartlabs.tv/docs/demo/apps/samsung)) y la documentación de TizenBrew dice que
  Samsung **ya no los genera** ([TizenBrew](https://github.com/reisxd/TizenBrew/blob/main/docs/README.md)).
  SS IPTV usa el método en Samsung Tizen 2015–2019 (series J, K, M, N, R)
  ([ss-iptv.com](https://ss-iptv.com/en/users/documents/installing)); en 2020+ no está confirmado.
  `npm run build -- --usb` prepara la carpeta y un `README.txt` con los pasos, pero **no es un canal de
  distribución comercial**.
- **Orsay** (Samsung 2012–2014 y algunos 2015) usa el antiguo Samsung Smart TV SDK y otro formato de app:
  **no es compatible** con esta app
  ([legacy](https://developer.samsung.com/smarttv/legacy/overview.html)).
- **Pruebas oficiales en Seller Office**: **beta** (todos los vendedores con aprobación de Samsung,
  televisores 2021+, código de activación, 90 días ampliables a 180) y **alfa** (solo partner, hasta 50
  televisores por DUID, 30 días, televisores 2020+)
  ([distributing-application](https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html),
  [beta-test](https://developer.samsung.com/tv-seller-office/faq/beta-test.html)).

## 5. LG (webOS)

### 5.1 Cuenta

- **Seller Lounge** (<https://seller.lgappstv.com>): vendedor **individual** (se muestra el ID) o
  **corporativo** (se muestra el nombre de la empresa): elegir tipo, aceptar términos, llenar el formulario y
  verificar el correo
  ([app-ecosystem](https://webostv.developer.lge.com/distribute/app-ecosystem),
  [sellerRegistration](https://seller.lgappstv.com/seller/guide/sellerRegistration.lge)).
  LG no publica costo de registro (se considera **gratuito**). Individuos: mayores de 18 años.
- LG Content Store está en 36 países; **Colombia en la lista: no confirmado** (existe `co.lgappstv.com`).
  Al subir la app se eligen los países.

### 5.2 Proceso de aprobación

([app-approval-process](https://webostv.developer.lge.com/distribute/app-approval-process))

1. Subir el `.ipk` (`npm run build webos` con la CLI de webOS) → imágenes → información del servicio →
   información de prueba → vista previa y envío.
2. **Documentos obligatorios**:
   - **Self Checklist** con los resultados reales de sus pruebas; sin ella la app puede ser rechazada sin
     revisión ([app-self-checklist](https://webostv.developer.lge.com/distribute/app-self-checklist)).
   - **Escenario de uso (UX scenario)** para los probadores: pantallas y pasos (JPG/PNG/PDF/DOC/PPT/XLS/ZIP,
     hasta 10 MB).
3. Revisión en tres etapas: *pretest*, prueba funcional y revisión de contenido. Cada actualización se revisa
   de nuevo. Tiempo **estimado**: 5 a 10 días hábiles (LG no publica un plazo; la cifra viene de terceros).
4. Información de prueba: hasta 5 pares usuario/contraseña, y si hay bloqueo por país (Geo-IP).

### 5.3 Lista de verificación de LG que la app ya cumple

([app-self-checklist](https://webostv.developer.lge.com/distribute/app-self-checklist),
[back-button](https://webostv.developer.lge.com/develop/guides/back-button),
[magic-remote](https://webostv.developer.lge.com/develop/guides/magic-remote))

| Requisito | En la app |
|---|---|
| Funciona con las 4 flechas, OK y Atrás (461) | Sí |
| Funciona con el puntero (Magic Remote) | Sí: el puntero enfoca y el clic es OK; `cursorStateChange` |
| Todo lo seleccionable muestra el foco | Sí |
| Indicador de carga | Sí |
| Atrás en la pantalla de entrada: en webOS 23–25 debe mostrar la pantalla de inicio del televisor | Sí: `webOS.platformBack()`; en versiones anteriores, ventana de salida y `window.close()` |
| Sin contraseñas ni claves en el código | Sí (el usuario escribe sus datos; `operator.json` no lleva secretos) |
| `appinfo.json`: id, versión, tipo web, icono 80x80, icono grande 130x130 | Sí (`disableBackHistoryAPI: true`, `handlesRelaunch: true`) |

Canal +/− no llega a las apps en webOS: la app también usa arriba/abajo en el reproductor.
LG tiene documentos contradictorios sobre Atrás en webOS 23–25 (ventana de salida o pantalla de inicio); si el
revisor pide otro comportamiento, se ajusta en `App.backFromHome` (`tv/src/js/app.js`). Conviene preguntar por
1:1 Q&A antes de enviar.

## 6. Imágenes y capturas

Se generan con `npm run icons` en `tv/assets/store/` (el nombre sale de `operator.json` → `appName`).

**Samsung Seller Office**
([entering-application-information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html),
[app-icons-and-screenshots](https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html)):

| Imagen | Tamaño y formato | Archivo |
|---|---|---|
| Icono | 512x423, PNG 24 bits, menos de 300 KB, 72 DPI | `samsung/icon-512x423.png` |
| Logotipo | 1920x1080, PNG 32 bits transparente, menos de 300 KB, dentro del área segura | `samsung/logo-1920x1080.png` |
| Fondo | 1920x1080, PNG/JPG 24 bits, menos de 300 KB | `samsung/background-1920x1080.png` |
| Capturas | **exactamente 4**, JPG 1920x1080, hasta 500 KB cada una | se toman de la app (ver `tv/README.md`) |

La captura 3 puede no verse en algunos modelos; si hubiera compras dentro de la app, la 4 debe mostrar precios.

**LG Seller Lounge**
([app-resources](https://webostv.developer.lge.com/develop/getting-started/app-resources), guía de Seller Lounge v11.5):

| Imagen | Tamaño y formato | Archivo |
|---|---|---|
| Icono | 400x400 (LG la reduce) | `lg/icon-400x400.png` |
| Fondo | 1920x1080, hasta 10 MB | `lg/background-1920x1080.png` |
| Capturas | 1 principal + al menos 2 secundarias (máx. 5), 1920x1080 o 1280x720, JPG/PNG, hasta 20 MB | se toman de la app |

Capturas recomendadas: TV en vivo con vista previa, reproductor a pantalla completa, detalle de una película,
Mensajes/Cuenta. Use contenido propio del operador (nada de terceros).

## 7. Cuenta de prueba, privacidad y contenido

- **Cuenta de prueba**: créela en el portal (Clientes) con un nombre claro (p. ej. `revision-tienda`), sin
  vencimiento durante la revisión, con 2 conexiones y un paquete que solo tenga canales/películas propios o de
  prueba. Samsung pide **al menos tantas cuentas como grupos de modelos** solicitados
  ([entering-application-information](https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html)).
  Anote usuario, contraseña y la dirección pública en el App UI Description (Samsung) y en «Test Info» (LG).
- **Política de privacidad**: el portal la sirve en `http://SERVIDOR:25461/privacidad` y el retiro de datos en
  `/eliminar-datos` (datos de Ajustes: empresa, app, correo y teléfono de soporte). Samsung la exige en la
  lista de lanzamiento. La app envía al portal del operador: identificador aleatorio del equipo, marca, modelo,
  versión de la app, usuario y qué canal se está viendo (para el límite de conexiones). No usa publicidad ni
  terceros.
- **Contenido**: solo el del operador con sus derechos; sin listas ni servidores de ejemplo; la compilación de
  tienda no permite agregar listas M3U ni otros servidores.

## 8. Qué escribir en cada formulario

| Campo | Samsung Seller Office | LG Seller Lounge |
|---|---|---|
| Nombre | Igual a `appName` (ej. «IPTV Player»); debe coincidir con `config.xml` | Igual a `appName` |
| Id / paquete | `appId.tizenPackage` + `.tizenName` (del `.wgt`) | `appId.webos` (del `.ipk`) |
| Categoría | Video / Entretenimiento | Entertainment / Video |
| Descripción corta | «Televisión en vivo, películas y series de [EMPRESA] para sus suscriptores.» | Igual |
| Descripción | Qué ofrece el servicio, que requiere suscripción con usuario y contraseña del operador, cobertura (Cartagena, Colombia) y soporte | Igual |
| Clasificación por edad | Según el contenido del operador | Igual |
| Idiomas | Español | Español |
| Países | Colombia (requiere partner en Samsung) | Colombia (si está disponible) |
| URL de privacidad | `http://…:25461/privacidad` | `http://…:25461/privacidad` |
| Correo / teléfono de soporte | Los de `operator.json` → `support` | Igual |
| Información de prueba | App UI Description con cuenta, dirección pública y notas (sección 3) | Test Info (usuario/contraseña, sin bloqueo Geo-IP) + UX scenario + Self Checklist |
| Imágenes | Sección 6 | Sección 6 |
| Precio | Gratis (el servicio se paga al operador) | Gratis |

## 9. Lista de verificación antes de enviar

- [ ] `tv/operator.json` con `appName`, `vendor`, ids, `serverUrls` (local + pública de revisión), `support`.
- [ ] `allowCustomServer` y `allowM3U` en `false` para la compilación de tienda.
- [ ] Versión nueva en `tv/package.json`; `npm test` y `npm run check` sin errores.
- [ ] `npm run icons` con el nombre final; capturas tomadas.
- [ ] Samsung: `.wgt` firmado con el certificado de autor definitivo (guardar copia). LG: `.ipk`.
- [ ] Probado en un televisor real de cada marca (modo desarrollador): inicio de sesión, canales, películas,
      Atrás y salida, multitarea (Home y volver), quitar el cable de red y volver a conectarlo.
- [ ] Dirección pública abierta y cuenta de prueba funcionando **desde fuera de la red del ISP**.
- [ ] `/privacidad` accesible desde la dirección pública.
- [ ] Samsung: App UI Description; LG: Self Checklist y UX scenario.

## 10. Fuentes

Samsung:
- https://developer.samsung.com/tv-seller-office/guides/membership/becoming-seller-office-member.html
- https://developer.samsung.com/smarttv/develop/distribute/seller-office/membership/becoming-partner.html
- https://developer.samsung.com/tv-seller-office/faq/tv-seller-office-membership.html
- https://developer.samsung.com/tv-seller-office/faq/tv-seller-office-use.html
- https://developer.samsung.com/tv-seller-office/application-publication-process.html
- https://developer.samsung.com/tv-seller-office/guides/applications/distributing-application.html
- https://developer.samsung.com/tv-seller-office/guides/applications/entering-application-information.html
- https://developer.samsung.com/tv-seller-office/checklists-for-distribution/launch-checklist.html
- https://developer.samsung.com/tv-seller-office/faq/certification-process.html
- https://developer.samsung.com/tv-seller-office/faq/beta-test.html
- https://developer.samsung.com/smarttv/design/app-icons-and-screenshots.html
- https://developer.samsung.com/smarttv/develop/development-checklist/common.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/terminating-applications.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/multitasking.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/checking-network-status.html
- https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html
- https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html
- https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html
- https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html
- https://developer.samsung.com/smarttv/develop/faq/application-installation.html
- https://developer.samsung.com/smarttv/develop/faq/application-testing.html
- https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html
- https://developer.samsung.com/smarttv/legacy/overview.html

LG:
- https://webostv.developer.lge.com/distribute/app-ecosystem
- https://seller.lgappstv.com/seller/guide/sellerRegistration.lge
- https://webostv.developer.lge.com/distribute/app-approval-process
- https://webostv.developer.lge.com/distribute/app-self-checklist
- https://webostv.developer.lge.com/develop/references/appinfo-json
- https://webostv.developer.lge.com/develop/getting-started/app-resources
- https://webostv.developer.lge.com/develop/guides/back-button
- https://webostv.developer.lge.com/develop/guides/magic-remote
- https://webostv.developer.lge.com/develop/getting-started/developer-mode-app
- https://webostv.developer.lge.com/develop/tools/cli-installation
- Guía de usuario de Seller Lounge v11.5 (2021), copia en archive.org

Otras (USB en Samsung):
- https://ss-iptv.com/en/users/documents/installing
- https://siptv.app/howto/sammy/
- https://help.smartlabs.tv/docs/demo/apps/samsung
- https://github.com/reisxd/TizenBrew/blob/main/docs/README.md
- https://emby.media/community/topic/106249-expiration-of-validity-period/
