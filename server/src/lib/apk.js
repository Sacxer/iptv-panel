// Lee lo básico de un APK sin herramientas externas: paquete, versión, SDK y arquitecturas (ABI).
// Un APK es un ZIP; AndroidManifest.xml va en formato XML binario de Android (AXML).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { HttpError } from './util.js';

const ATTR_IDS = {
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
  0x0101020c: 'minSdkVersion',
  0x01010270: 'targetSdkVersion',
};
export const KNOWN_ABIS = ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86'];

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return n === length ? buf : buf.subarray(0, n);
}

/** Entradas del directorio central del ZIP: [{ name, method, compressedSize, size, offset }]. */
function zipEntries(fd, fileSize) {
  const tailLength = Math.min(fileSize, 65557);
  const tail = readAt(fd, fileSize - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new HttpError(400, 'El archivo no es un APK válido (no es un ZIP)');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  const cd = readAt(fd, cdOffset, cdSize);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const nameLength = cd.readUInt16LE(p + 28);
    const extraLength = cd.readUInt16LE(p + 30);
    const commentLength = cd.readUInt16LE(p + 32);
    entries.push({
      method: cd.readUInt16LE(p + 10),
      compressedSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
      name: cd.toString('utf8', p + 46, p + 46 + nameLength),
    });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(fd, entry) {
  const local = readAt(fd, entry.offset, 30);
  if (local.readUInt32LE(0) !== 0x04034b50) throw new HttpError(400, 'El APK está dañado');
  const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  const data = readAt(fd, start, entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new HttpError(400, 'El APK usa una compresión no soportada');
}

/** Tabla de cadenas de un bloque RES_STRING_POOL. */
function stringPool(buf, start) {
  const count = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = buf.readUInt32LE(start + 20);
  const utf8 = (flags & 0x100) !== 0;
  const strings = [];
  for (let i = 0; i < count; i++) {
    let p = start + stringsStart + buf.readUInt32LE(start + 28 + i * 4);
    if (utf8) {
      p += buf[p] & 0x80 ? 2 : 1; // longitud en caracteres
      let len = buf[p];
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | buf[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      strings.push(buf.toString('utf8', p, p + len));
    } else {
      let len = buf.readUInt16LE(p);
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
        p += 4;
      } else {
        p += 2;
      }
      strings.push(buf.toString('utf16le', p, p + len * 2));
    }
  }
  return strings;
}

/** Atributos de <manifest> y <uses-sdk> del AndroidManifest.xml binario. */
export function parseBinaryManifest(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) throw new HttpError(400, 'El AndroidManifest.xml del APK no es válido');
  let strings = [];
  let resourceIds = [];
  const out = {};
  let p = buf.readUInt16LE(2);
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8) break;
    if (type === 0x0001) strings = stringPool(buf, p);
    else if (type === 0x0180) {
      resourceIds = [];
      for (let i = p + headerSize; i + 4 <= p + size; i += 4) resourceIds.push(buf.readUInt32LE(i));
    } else if (type === 0x0102) {
      const element = strings[buf.readUInt32LE(p + 20)];
      if (element === 'manifest' || element === 'uses-sdk') {
        const attrStart = p + headerSize + buf.readUInt16LE(p + 24);
        const attrSize = buf.readUInt16LE(p + 26) || 20;
        const attrCount = buf.readUInt16LE(p + 28);
        for (let i = 0; i < attrCount; i++) {
          const a = attrStart + i * attrSize;
          const nameIndex = buf.readUInt32LE(a + 4);
          const rawIndex = buf.readInt32LE(a + 8);
          const dataType = buf[a + 15];
          const data = buf.readUInt32LE(a + 16);
          const name = ATTR_IDS[resourceIds[nameIndex]] || strings[nameIndex];
          const value = dataType === 0x03 ? strings[data] : rawIndex >= 0 ? strings[rawIndex] : data;
          if (element === 'manifest' && name === 'package') out.package = String(value);
          if (element === 'manifest' && name === 'versionCode') out.versionCode = Number(value);
          if (element === 'manifest' && name === 'versionName') out.versionName = String(value);
          if (element === 'uses-sdk' && name === 'minSdkVersion') out.minSdk = Number(value);
          if (element === 'uses-sdk' && name === 'targetSdkVersion') out.targetSdk = Number(value);
        }
      }
    }
    p += size;
  }
  return out;
}

/** { package, versionCode, versionName, minSdk, targetSdk, abis: [...], abi: 'arm64-v8a' | 'universal' | 'none' } */
export function readApkInfo(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const entries = zipEntries(fd, fs.fstatSync(fd).size);
    const manifest = entries.find((e) => e.name === 'AndroidManifest.xml');
    if (!manifest) throw new HttpError(400, 'El archivo no es un APK de Android (falta AndroidManifest.xml)');
    const info = parseBinaryManifest(readEntry(fd, manifest));
    if (!info.package || !Number.isInteger(info.versionCode)) throw new HttpError(400, 'No se pudo leer el paquete y la versión del APK');
    const abis = [...new Set(entries.map((e) => /^lib\/([^/]+)\//.exec(e.name)?.[1]).filter(Boolean))]
      .sort((a, b) => KNOWN_ABIS.indexOf(a) - KNOWN_ABIS.indexOf(b));
    const signed = entries.some((e) => /^META-INF\/.+\.(RSA|DSA|EC)$/i.test(e.name));
    return {
      ...info,
      versionName: info.versionName || String(info.versionCode),
      abis,
      abi: abis.length === 0 ? 'none' : abis.length === 1 ? abis[0] : 'universal',
      v1_signed: signed,
    };
  } finally {
    fs.closeSync(fd);
  }
}
