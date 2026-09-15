# Panel de administración IPTV

Portal web (React 18 + TypeScript + Vite) para administrar la plataforma: usuarios, paquetes,
contenido, mensajes, avisos, cortes, conexiones, migración desde XtreamUI y WispHub, y ajustes.
Consume la API descrita en `../docs/API.md` (sección 3, `/api/admin`).

## Desarrollo

```bash
npm install
npm run dev
```

Abre http://localhost:5173/admin/. Las peticiones a `/api` se redirigen (proxy de Vite) al
servidor en `http://localhost:8080`, que debe estar en marcha.

## Compilación

```bash
npm run build
```

Genera la carpeta `dist/`, que el servidor (`server/`) publica en la ruta `/admin`
(por ejemplo `http://tu-servidor:8080/admin`).

## Estructura

- `src/api.ts` – cliente HTTP tipado (token Bearer, cierre de sesión automático en 401).
- `src/types.ts` – tipos del contrato de la API.
- `src/context/` – sesión (AuthContext).
- `src/components/` – componentes reutilizables (tabla, modal, confirmación, avisos, formularios…).
- `src/hooks/` – hooks de datos y utilidades.
- `src/pages/` – pantallas del panel.
