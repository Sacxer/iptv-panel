const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)(\?|$)/i;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

/**
 * Analiza una lista M3U/M3U8 extendida.
 * Devuelve [{ name, url, logo, group, epgId, duration, kind: 'live'|'movie'|'series' }].
 */
export function parseM3U(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const entries = [];
  let pending = null;
  let groupOverride = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const commaAt = findTitleComma(line);
      const head = commaAt >= 0 ? line.slice(0, commaAt) : line;
      const title = commaAt >= 0 ? line.slice(commaAt + 1).trim() : '';
      const attrs = {};
      for (const m of head.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2];
      pending = {
        name: title || attrs['tvg-name'] || 'Sin nombre',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        epgId: attrs['tvg-id'] || '',
        duration: Number.parseInt(head.slice(8), 10) || -1,
      };
      groupOverride = null;
    } else if (line.startsWith('#EXTGRP:')) {
      groupOverride = line.slice(8).trim();
    } else if (line.startsWith('#')) {
      continue; // #EXTM3U, #EXTVLCOPT, #KODIPROP, etc.
    } else if (pending) {
      const url = line;
      const group = pending.group || groupOverride || 'Sin categoría';
      entries.push({ ...pending, group, url, kind: classify(url, pending.duration) });
      pending = null;
    }
  }
  return entries;
}

/** La coma que separa atributos y título es la primera fuera de comillas. */
function findTitleComma(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) return i;
  }
  return -1;
}

export function classify(url, duration = -1) {
  if (/\/series\//i.test(url)) return 'series';
  if (/\/movie\//i.test(url) || VOD_EXT.test(url)) return 'movie';
  if (duration > 0) return 'movie';
  return 'live';
}

export function extensionOf(url, fallback) {
  const m = /\.([a-z0-9]{2,5})(\?|$)/i.exec(url.split('#')[0]);
  return m ? m[1].toLowerCase() : fallback;
}
