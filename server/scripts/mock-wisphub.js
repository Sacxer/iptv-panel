// WispHub simulado para probar la integración de cortes sin una cuenta real.
// Uso: node scripts/mock-wisphub.js [puerto]   (API Key: DEMO.KEY)
// Cambiar el estado de un cliente: POST http://localhost:4010/demo/estado  {"id_servicio": 101, "estado": "Activo"}
import http from 'node:http';

const port = Number(process.argv[2] || 4010);
const clientes = [
  { id_servicio: 101, usuario: 'carlos.gomez', nombre: 'Carlos Gómez', cedula: '1010101010', email: 'carlos@demo.co', telefono: '3001234567', estado: 'Activo', plan_internet: { nombre: 'Fibra 200 + TV' } },
  { id_servicio: 102, usuario: 'maria.lopez', nombre: 'María López', cedula: '2020202020', email: 'maria@demo.co', telefono: '3017654321', estado: 'Suspendido', plan_internet: { nombre: 'Fibra 100 + TV' } },
  { id_servicio: 103, usuario: 'jperez', nombre: 'Juan Pérez', cedula: '3030303030', email: 'juan@demo.co', telefono: '3029998877', estado: 'Activo', plan_internet: { nombre: 'TV Básico' } },
  { id_servicio: 104, usuario: 'luisa.r', nombre: 'Luisa Rincón', cedula: '4040404040', email: 'luisa@demo.co', telefono: '3041112233', estado: 'Cancelado', plan_internet: { nombre: 'Internet 50' } },
  { id_servicio: 105, usuario: 'pedro.s', nombre: 'Pedro Suárez', cedula: '5050505050', email: 'pedro@demo.co', telefono: '3054445566', estado: 'Activo', plan_internet: { nombre: 'Fibra 300 + TV' } },
];

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && url.pathname === '/demo/estado') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const { id_servicio: id, estado } = JSON.parse(raw || '{}');
      const c = clientes.find((x) => x.id_servicio === Number(id));
      if (!c) return send(404, { error: 'No existe' });
      c.estado = estado;
      console.log(`Cliente ${id} → ${estado}`);
      return send(200, c);
    });
    return;
  }
  if (req.headers.authorization !== 'Api-Key DEMO.KEY') return send(401, { detail: 'API Key inválida' });
  const detail = /^\/api\/clientes\/(\d+)\/$/.exec(url.pathname);
  if (detail) {
    const c = clientes.find((x) => x.id_servicio === Number(detail[1]));
    // Como WispHub real: el detalle trae estado y plan, no los datos personales.
    return c ? send(200, { id_servicio: c.id_servicio, estado: c.estado, plan_internet: c.plan_internet }) : send(404, { detail: 'No encontrado' });
  }
  if (url.pathname === '/api/clientes/') {
    const limit = Number(url.searchParams.get('limit') || 300);
    const offset = Number(url.searchParams.get('offset') || 0);
    return send(200, {
      count: clientes.length,
      next: offset + limit < clientes.length ? `${url.origin}/api/clientes/?limit=${limit}&offset=${offset + limit}` : null,
      previous: null,
      results: clientes.slice(offset, offset + limit),
    });
  }
  return send(404, { detail: 'No encontrado' });
}).listen(port, () => console.log(`WispHub simulado en http://localhost:${port}/api  (API Key: DEMO.KEY)`));
