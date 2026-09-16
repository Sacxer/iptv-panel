// Detección del tipo de equipo a partir del User-Agent y de las cabeceras que envían las apps propias.
//
// Las apps propias envían: X-Device-Id (identificador estable), X-Device-Type, X-Device-Brand,
// X-Device-Model, X-Device-Mac (si está disponible) y X-App-Name. Con apps de terceros solo hay User-Agent.

export const DEVICE_TYPES = ['tvbox', 'smart_tv', 'mobile', 'tablet', 'pc', 'stb', 'unknown'];

const SMART_TV = [
  [/Tizen|SMART-TV.*Samsung|SamsungBrowser.*TV/i, 'Samsung'],
  [/Web0S|webOS|NetCast|LG Browser|LGE/i, 'LG'],
  [/VIDAA|Hisense/i, 'Hisense'],
  [/BRAVIA/i, 'Sony'],
  [/Roku/i, 'Roku'],
  [/AppleTV|tvOS/i, 'Apple'],
  [/Philips|NETTV/i, 'Philips'],
  [/SMART-TV|SmartTV|HbbTV|CrKey/i, null],
];

const TVBOX = [
  [/\bAFT[A-Z0-9]{1,6}\b|Fire ?TV/i, 'Amazon', 'Fire TV'],
  [/SHIELD Android TV/i, 'NVIDIA', 'SHIELD'],
  [/MIBOX|Mi ?Box|MiTV-/i, 'Xiaomi', 'Mi Box / Mi TV Stick'],
  [/Chromecast|Google TV/i, 'Google', 'Chromecast'],
  [/Formuler/i, 'Formuler', null],
  [/\b(X96\w*|H96\w*|T95\w*|MXQ\w*|TX[3-9]\w*|A95X\w*|HK1\w*|M8S\w*|Q\+|TVBOX\w*|TV ?BOX)\b/i, null, null],
  [/\b(beelink|ugoos|tanix|vontar|transpeed|magicsee|zidoo|mecool|dolamee|km[1-9]\w*)\b/i, null, null],
  [/\b(p2\d\d|q2\d\d|u2\d\d|rk3\d{3}\w*|s9\d{2}\w*|amlogic|rockchip|allwinner)\b/i, null, null],
  [/Android ?TV|AndroidTV|Leanback|\bATV\b|\bbox\b/i, null, null],
];

const STB = /MAG\d{3}|stbapp|Enigma2|Dreambox|Vu\+|Kodi.*LibreELEC/i;

const PHONE_MODEL = /\b(SM-[AGNSMJFE]\d{2,4}\w*|Redmi[\w ]*|POCO[\w ]*|moto[\w ]*|Pixel[\w ]*|HUAWEI[\w-]*|Nokia[\w ]*|OnePlus\w*|OPPO[\w ]*|vivo[\w ]*|Infinix[\w ]*|TECNO[\w ]*|itel[\w ]*|LM-\w+|CPH\d{4}|RMX\d{4}|M2\d{3}\w+|\d{7,8}[A-Z]{1,3}|iPhone)\b/i;
const TABLET_MODEL = /\b(SM-[TXP]\d{3}\w*|iPad|Tab[\w ]*|MediaPad[\w ]*|Lenovo TB[\w-]*)\b/i;

const APPS = [
  [/IPTV ?Smarters|IPTVSmartersPlayer/i, 'IPTV Smarters'],
  [/TiviMate/i, 'TiviMate'],
  [/XCIPTV/i, 'XCIPTV'],
  [/OTT ?Navigator/i, 'OTT Navigator'],
  [/Perfect ?Player/i, 'Perfect Player'],
  [/GSE ?SMART/i, 'GSE Smart IPTV'],
  [/Kodi/i, 'Kodi'],
  [/MAG\d{3}|stbapp/i, 'Portal MAG'],
  [/VLC|LibVLC/i, 'VLC'],
  [/ExoPlayer/i, 'ExoPlayer'],
  [/Lavf|FFmpeg/i, 'FFmpeg'],
  [/AppleCoreMedia|CFNetwork/i, 'App iOS'],
  [/okhttp/i, 'App Android'],
  [/Dalvik/i, 'App Android'],
  [/Mozilla/i, 'Navegador'],
];

function header(headers, name) {
  const v = headers?.[name];
  return v ? String(Array.isArray(v) ? v[0] : v).trim().slice(0, 255) : '';
}

function osOf(ua) {
  let m = /Android[ /]?([\d.]+)?/i.exec(ua);
  if (m) return m[1] ? `Android ${m[1]}` : 'Android';
  if (/Tizen/i.test(ua)) return `Tizen${(/Tizen ([\d.]+)/i.exec(ua) || [])[1] ? ` ${/Tizen ([\d.]+)/i.exec(ua)[1]}` : ''}`;
  if (/Web0S|webOS/i.test(ua)) return 'webOS';
  if ((m = /(?:iPhone|CPU) OS ([\d_]+)/i.exec(ua))) return `iOS ${m[1].replace(/_/g, '.')}`;
  if (/Windows NT 10/i.test(ua)) return 'Windows 10/11';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return '';
}

/** Modelo declarado en User-Agents de Android: "(Linux; U; Android 9; X96Max_Plus Build/…)". */
function androidModel(ua) {
  const m = /Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/i.exec(ua);
  if (!m) return '';
  const model = m[1].trim();
  return /^(wv|U|Mobile|K)$/i.test(model) ? '' : model;
}

export function detectDevice(userAgent, headers = {}) {
  const ua = String(userAgent || '');
  const declaredType = header(headers, 'x-device-type').toLowerCase();
  const result = {
    type: 'unknown',
    brand: header(headers, 'x-device-brand'),
    model: header(headers, 'x-device-model'),
    os: osOf(ua),
    app: header(headers, 'x-app-name') || '',
    appVersion: header(headers, 'x-app-version').slice(0, 32),
    appBuild: /^\d{1,10}$/.test(header(headers, 'x-app-build')) ? Number(header(headers, 'x-app-build')) : null,
    appDistribution: ['play', 'portal', 'tizen', 'webos'].includes(header(headers, 'x-app-distribution').toLowerCase()) ? header(headers, 'x-app-distribution').toLowerCase() : '',
    uid: header(headers, 'x-device-id'),
    mac: header(headers, 'x-device-mac').toUpperCase(),
    // high: el User-Agent identifica el tipo de equipo; low: solo nombra la app o el reproductor (VLC, okhttp…)
    confidence: 'high',
  };

  if (!result.app) result.app = (APPS.find(([re]) => re.test(ua)) || [null, ''])[1];
  if (!result.model && /Android/i.test(ua)) result.model = androidModel(ua);

  if (DEVICE_TYPES.includes(declaredType)) {
    result.type = declaredType;
    return result;
  }

  const probe = `${ua} ${result.model}`;
  if (STB.test(probe)) {
    result.type = 'stb';
    return result;
  }
  for (const [re, brand, model] of TVBOX) {
    if (re.test(probe)) {
      result.type = 'tvbox';
      result.brand ||= brand || '';
      if (model && !result.model) result.model = model;
      return result;
    }
  }
  for (const [re, brand] of SMART_TV) {
    if (re.test(ua)) {
      result.type = 'smart_tv';
      result.brand ||= brand || '';
      return result;
    }
  }
  if (/iPad/i.test(ua) || TABLET_MODEL.test(result.model)) {
    result.type = 'tablet';
    if (/iPad/i.test(ua)) result.brand ||= 'Apple';
  } else if (/iPhone/i.test(ua) || PHONE_MODEL.test(result.model) || /Android.*Mobile/i.test(ua)) {
    result.type = 'mobile';
    if (/iPhone/i.test(ua)) result.brand ||= 'Apple';
  } else if (/TiviMate/i.test(ua)) {
    result.type = 'tvbox'; // TiviMate solo existe para Android TV
    result.confidence = 'low';
  } else if (/Windows NT|Macintosh|Mac OS X|CrOS|X11; (Linux|Ubuntu)/i.test(ua)) {
    result.type = 'pc';
  } else if (/^VLC\//i.test(ua)) {
    result.type = 'pc'; // VLC usa el mismo User-Agent en PC, Android y TV Box
    result.confidence = 'low';
  }
  if (result.type === 'unknown') result.confidence = 'low';
  if (!result.brand && /SM-|Samsung/i.test(result.model)) result.brand = 'Samsung';
  return result;
}
