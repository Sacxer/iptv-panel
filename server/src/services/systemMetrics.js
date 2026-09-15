// Consumo físico del servidor: CPU, memoria, disco, red y tiempo encendido, con historial reciente.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

const SAMPLE_MS = 5000;
const HISTORY = 120; // 10 minutos

const history = [];
let lastCpu = null;
let lastNet = null;
let current = { cpu: 0, rx_bps: null, tx_bps: null };

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** Bytes recibidos/enviados por todas las interfaces (solo Linux, vía /proc/net/dev). */
async function netBytes() {
  try {
    const text = await fs.readFile('/proc/net/dev', 'utf8');
    let rx = 0;
    let tx = 0;
    for (const line of text.split('\n').slice(2)) {
      const [iface, data] = line.split(':');
      if (!data || iface.trim() === 'lo') continue;
      const cols = data.trim().split(/\s+/).map(Number);
      rx += cols[0];
      tx += cols[8];
    }
    return { rx, tx, at: Date.now() };
  } catch {
    return null;
  }
}

/** Memoria realmente disponible: en Linux se descuenta la caché usando MemAvailable. */
async function memory() {
  const total = os.totalmem();
  let free = os.freemem();
  try {
    const text = await fs.readFile('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(text);
    if (m) free = Number(m[1]) * 1024;
  } catch {
    // No es Linux: se usa os.freemem().
  }
  const used = total - free;
  return { total, used, free, percent: round((used / total) * 100) };
}

async function disk() {
  const target = config.db.client.includes('sqlite') ? path.dirname(config.db.file) : path.parse(process.cwd()).root;
  try {
    const s = await fs.statfs(target);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { path: target, total, used: total - free, free, percent: round(((total - free) / total) * 100) };
  } catch {
    return null;
  }
}

const round = (n) => Math.round(n * 10) / 10;

async function sample() {
  const cpu = cpuTimes();
  if (lastCpu) {
    const total = cpu.total - lastCpu.total;
    const idle = cpu.idle - lastCpu.idle;
    current.cpu = total > 0 ? round(Math.max(0, Math.min(100, (1 - idle / total) * 100))) : 0;
  }
  lastCpu = cpu;

  const net = await netBytes();
  if (net && lastNet) {
    const secs = (net.at - lastNet.at) / 1000;
    current.rx_bps = Math.max(0, Math.round(((net.rx - lastNet.rx) * 8) / secs));
    current.tx_bps = Math.max(0, Math.round(((net.tx - lastNet.tx) * 8) / secs));
  }
  lastNet = net;

  const mem = await memory();
  history.push({ t: Math.floor(Date.now() / 1000), cpu: current.cpu, mem: mem.percent, rx_bps: current.rx_bps, tx_bps: current.tx_bps });
  if (history.length > HISTORY) history.shift();
}

export function startMetricsSampler() {
  lastCpu = cpuTimes();
  netBytes().then((n) => { lastNet = n; });
  const timer = setInterval(() => sample().catch(() => {}), SAMPLE_MS);
  timer.unref();
  return () => clearInterval(timer);
}

export async function getMetrics() {
  if (!history.length) await sample();
  const cpus = os.cpus();
  const mem = await memory();
  return {
    sampled_at: Math.floor(Date.now() / 1000),
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    node_version: process.version,
    cpu: {
      model: cpus[0]?.model?.trim() || '',
      cores: cpus.length,
      usage_percent: current.cpu,
      load_avg: os.platform() === 'win32' ? null : os.loadavg().map(round),
    },
    memory: { ...mem, process_rss: process.memoryUsage().rss },
    disk: await disk(),
    network: { available: current.rx_bps !== null, rx_bps: current.rx_bps, tx_bps: current.tx_bps },
    uptime: { system: Math.floor(os.uptime()), process: Math.floor(process.uptime()) },
    history,
  };
}
