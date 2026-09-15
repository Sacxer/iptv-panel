// Google (OAuth por código + Drive) simulado para probar los backups en Drive sin una cuenta real.
// Uso: node scripts/mock-google.js [puerto]   ID de cliente: demo-client · secreto: demo-secret
// El código se aprueba abriendo http://localhost:<puerto>/device y pulsando "Permitir".
import { startFakeGoogle } from '../test/fakeGoogle.js';

const port = Number(process.argv[2] || 4020);
const google = await startFakeGoogle({ port, autoApproveAfter: null });
console.log(`Google simulado en ${google.base}  (cliente: demo-client / demo-secret, aprobar en ${google.base}/device)`);
