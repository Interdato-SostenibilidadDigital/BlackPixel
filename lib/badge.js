const { createHash } = require('node:crypto');

const BADGE_WIDTH = 360;
const BADGE_HEIGHT = 104;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePageUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Usa una URL http:// o https:// sin credenciales.');
  }
  // El fragmento identifica una posición, no otra página. Ruta y consulta se conservan.
  url.hash = '';
  return url.href;
}

function normalizePublicBase(value) {
  if (!value) return null;
  const url = new URL(normalizePageUrl(value));
  if (url.search || new URL(value).hash) {
    throw new Error('--public-base debe ser una carpeta pública sin consulta ni fragmento.');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

function getPageKey(url) {
  const normalized = normalizePageUrl(url);
  const hostname = new URL(normalized).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 20);
  return hostname + '-' + hash;
}

function getPublicationLinks(publicBase, pageKey, measurementId) {
  const pageBase = publicBase ? new URL(pageKey + '/', publicBase) : null;
  const at = (file) => pageBase ? new URL(file, pageBase).href : null;
  return {
    badge: at('badge.svg'),
    report: at('reporte.html'),
    result: at('resultado.json'),
    evidence: at(measurementId + '/reporte.html'),
  };
}

function formatDate(value) {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'medium', timeZone: 'America/Mexico_City',
  }).format(new Date(value));
}

function createBadgeSvg(result) {
  const percentage = result.percentage.toFixed(2) + '%';
  const count = result.blackPixelCount.toLocaleString('es-MX');
  const total = result.totalPixels.toLocaleString('es-MX');
  const date = formatDate(result.createdAt);
  const description = percentage + ' de negro puro; ' + count + ' de ' + total
    + ' píxeles analizados. URL: ' + result.url + '. Medición: ' + result.createdAt
    + '. Indicador visual, no medición de energía ni certificación ambiental.';

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="104" viewBox="0 0 360 104" role="img" aria-labelledby="title desc">',
    '<title id="title">BlackPixel: ' + escapeHtml(percentage) + ' de negro puro</title>',
    '<desc id="desc">' + escapeHtml(description) + '</desc>',
    '<rect x="0.5" y="0.5" width="359" height="103" rx="10" fill="#000000" stroke="#737373"/>',
    '<g fill="#ffffff" font-family="Arial, Helvetica, sans-serif">',
    '<text x="16" y="22" font-size="14" font-weight="700">BlackPixel</text>',
    '<text x="344" y="21" text-anchor="end" font-size="9" letter-spacing="0.8">NEGRO PURO · #000000</text>',
    '<text x="16" y="60" font-size="32" font-weight="700">' + percentage + '</text>',
    '<text x="344" y="46" text-anchor="end" font-size="13" font-weight="700">' + count + ' px negros</text>',
    '<text x="344" y="62" text-anchor="end" font-size="10">de ' + total + ' px analizados</text>',
    '<path d="M16 74H344" stroke="#737373"/>',
    '<text x="16" y="91" font-size="10">Medición visual · ' + escapeHtml(date) + '</text>',
    '<text x="344" y="91" text-anchor="end" font-size="11">Ver reporte →</text>',
    '</g></svg>',
  ].join('\n');
}

function createEmbedCode(result) {
  if (!result.publication.badge) return null;
  // El alt es estable: el porcentaje del SVG cambia con la siguiente medición.
  const alt = 'BlackPixel: consultar porcentaje y cantidad de negro puro de ' + result.url;
  return '<a data-blackpixel-badge href="' + escapeHtml(result.publication.report)
    + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;max-width:100%">\n'
    + '  <img src="' + escapeHtml(result.publication.badge) + '" alt="' + escapeHtml(alt)
    + '" width="' + BADGE_WIDTH + '" height="' + BADGE_HEIGHT
    + '" loading="lazy" decoding="async" style="display:block;max-width:100%;height:auto">\n</a>';
}

function createEmbedSection(result, imagePrefix = './') {
  const code = createEmbedCode(result);
  const preview = '<img src="' + escapeHtml(imagePrefix + 'badge.svg')
    + '" alt="Vista previa del distintivo BlackPixel" width="360" height="104"'
    + ' style="display:block;max-width:100%;height:auto;margin:16px 0">';
  const instructions = code
    ? '<p>Publica la carpeta de resultados en <strong>' + escapeHtml(result.publicBase)
      + '</strong>, conservando sus subcarpetas. Después pega este código en el footer de la página analizada:</p>'
      + '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f1f5f9;color:#111827;border-radius:6px"><code>'
      + escapeHtml(code) + '</code></pre>'
      + '<p>El distintivo y su enlace estable mostrarán la última medición que publiques para esta URL. '
      + 'Para citar esta medición concreta: <a href="' + escapeHtml(result.publication.evidence)
      + '">abrir evidencia con fecha</a>.</p>'
    : '<p>Vista previa local. Para obtener un código con direcciones públicas, repite el análisis con '
      + '<code>--public-base https://tu-dominio.com/blackpixel/</code> y publica allí la carpeta de resultados.</p>';
  return '<h2>Distintivo para tu sitio</h2>' + preview + instructions
    + '<p>Alcance: una URL y la fecha indicada. Mide negro puro en la captura; no acredita ahorro energético ni certificación ambiental.</p>';
}

function createEmbedPage(result) {
  return '<!doctype html><html lang="es"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>Instalar distintivo BlackPixel</title>'
    + '<style>body{font:16px/1.6 Arial,sans-serif;background:#f5f7fb;color:#111827;margin:0;padding:24px}'
    + 'main{max-width:900px;margin:auto;background:white;padding:24px;border:1px solid #d9dee8;border-radius:8px}'
    + 'a{color:#1255a5;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style></head><body><main>'
    + createEmbedSection(result) + '<p><a href="./reporte.html">Consultar reporte completo</a> · '
    + '<a href="./badge.svg" download>Descargar SVG</a></p></main></body></html>';
}

module.exports = {
  escapeHtml, normalizePageUrl, normalizePublicBase, getPageKey,
  getPublicationLinks, createBadgeSvg, createEmbedCode, createEmbedSection, createEmbedPage,
};
