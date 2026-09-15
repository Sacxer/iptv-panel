// Genera APK mínimos para pruebas: ZIP con AndroidManifest.xml binario (AXML) y librerías por arquitectura.
import zlib from 'node:zlib';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

function stringPool(strings) {
  const data = [];
  const offsets = [];
  let pos = 0;
  for (const s of strings) {
    offsets.push(pos);
    const chars = Buffer.from(s, 'utf16le');
    const item = Buffer.concat([u16(s.length), chars, u16(0)]);
    data.push(item);
    pos += item.length;
  }
  let body = Buffer.concat(data);
  if (body.length % 4) body = Buffer.concat([body, Buffer.alloc(4 - (body.length % 4))]);
  const headerSize = 28;
  const stringsStart = headerSize + offsets.length * 4;
  const size = stringsStart + body.length;
  return Buffer.concat([
    u16(0x0001), u16(headerSize), u32(size), u32(strings.length), u32(0), u32(0), u32(stringsStart), u32(0),
    ...offsets.map(u32), body,
  ]);
}

function startElement(nameIdx, attrs) {
  const attrBufs = attrs.map((a) => Buffer.concat([
    u32(0xffffffff), u32(a.name), u32(a.raw ?? 0xffffffff), u16(8), Buffer.from([0, a.type]), u32(a.data),
  ]));
  const size = 36 + attrBufs.length * 20;
  return Buffer.concat([
    u16(0x0102), u16(16), u32(size), u32(1), u32(0xffffffff),
    u32(0xffffffff), u32(nameIdx), u16(20), u16(20), u16(attrs.length), u16(0), u16(0), u16(0), ...attrBufs,
  ]);
}

function endElement(nameIdx) {
  return Buffer.concat([u16(0x0103), u16(16), u32(24), u32(1), u32(0xffffffff), u32(0xffffffff), u32(nameIdx)]);
}

export function binaryManifest({ pkg, versionCode, versionName, minSdk = 24, targetSdk = 36 }) {
  const strings = ['versionCode', 'versionName', 'minSdkVersion', 'targetSdkVersion', 'package', 'manifest', 'uses-sdk', pkg, versionName];
  const pool = stringPool(strings);
  const resMap = Buffer.concat([u16(0x0180), u16(8), u32(8 + 16), u32(0x0101021b), u32(0x0101021c), u32(0x0101020c), u32(0x01010270)]);
  const manifest = startElement(5, [
    { name: 0, type: 0x10, data: versionCode },
    { name: 1, raw: 8, type: 0x03, data: 8 },
    { name: 4, raw: 7, type: 0x03, data: 7 },
  ]);
  const usesSdk = startElement(6, [{ name: 2, type: 0x10, data: minSdk }, { name: 3, type: 0x10, data: targetSdk }]);
  const body = Buffer.concat([pool, resMap, manifest, usesSdk, endElement(6), endElement(5)]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

/** ZIP con las entradas dadas ({ name, data, deflate }). */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const data = e.deflate ? zlib.deflateRawSync(e.data) : e.data;
    const method = e.deflate ? 8 : 0;
    const crc = zlib.crc32 ? zlib.crc32(e.data) : 0;
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(e.data.length),
      u16(name.length), u16(0), name, data,
    ]);
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0), u32(crc), u32(data.length), u32(e.data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cd.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, cd, eocd]);
}

export function fakeApk({ pkg = 'com.iptvplayer.app', versionCode, versionName, abis = ['arm64-v8a'], minSdk = 24 }) {
  return zip([
    { name: 'AndroidManifest.xml', data: binaryManifest({ pkg, versionCode, versionName, minSdk }), deflate: true },
    { name: 'classes.dex', data: Buffer.from(`dex ${versionName} ${versionCode}`) },
    ...abis.map((abi) => ({ name: `lib/${abi}/libapp.so`, data: Buffer.from(`so ${abi}`), deflate: true })),
  ]);
}
