const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const {
  normalizePageUrl, normalizePublicBase, getPageKey, getPublicationLinks,
  createBadgeSvg, createEmbedCode, createEmbedPage,
} = require('../lib/badge');
const { parseArguments, getScrollPositions, createVisuals, validateCaptureSize, createReportHtml } = require('../black-pixel-analyzer');

function example() {
  return {
    url: 'https://example.com/productos?a=1&b=2',
    createdAt: '2026-11-05T12:00:00.000Z',
    percentage: 68.4, blackPixelCount: 3283200, totalPixels: 4800000,
    publicBase: 'https://evidence.example/blackpixel/',
    publication: getPublicationLinks('https://evidence.example/blackpixel/', 'page-key', 'run-1'),
  };
}

test('la identidad conserva ruta, consulta y protocolo; los fragmentos comparten página', () => {
  assert.equal(normalizePageUrl('https://EXAMPLE.com:443/a#footer'), 'https://example.com/a');
  assert.equal(getPageKey('https://example.com/a#footer'), getPageKey('https://example.com/a'));
  assert.notEqual(getPageKey('https://example.com/a'), getPageKey('https://example.com/b'));
  assert.notEqual(getPageKey('https://example.com/a?view=1'), getPageKey('https://example.com/a?view=2'));
  assert.notEqual(getPageKey('http://example.com/a'), getPageKey('https://example.com/a'));
  assert.match(getPageKey('https://example.com/../../a'), /^[a-z0-9.-]+-[a-f0-9]{20}$/);
});

test('rechaza esquemas y credenciales no publicables', () => {
  for (const url of ['file:///tmp/page', 'javascript:alert(1)', 'ftp://example.com', 'https://user:secret@example.com']) {
    assert.throws(() => normalizePageUrl(url));
  }
});

test('la base pública funciona en subcarpetas y rechaza consultas y fragmentos', () => {
  assert.equal(normalizePublicBase('https://example.com/evidencia'), 'https://example.com/evidencia/');
  assert.throws(() => normalizePublicBase('https://example.com/a?token=1'));
  assert.throws(() => normalizePublicBase('https://example.com/a#b'));
  const links = getPublicationLinks('https://example.com/root/', 'key', 'run');
  assert.equal(links.badge, 'https://example.com/root/key/badge.svg');
  assert.equal(links.evidence, 'https://example.com/root/key/run/reporte.html');
});

test('el SVG contiene porcentaje, cantidad, fecha y texto accesible; escapa datos', () => {
  const result = example();
  result.url += '"><script>alert(1)</script>';
  const svg = createBadgeSvg(result);
  assert.match(svg, /68\.40%/);
  assert.match(svg, /3,283,200 px negros/);
  assert.match(svg, /4,800,000 px analizados/);
  assert.match(svg, /2026/);
  assert.match(svg, /aria-labelledby="title desc"/);
  assert.doesNotMatch(svg, /<script|<foreignObject|<image/);
  assert.match(svg, /&lt;script&gt;/);
  assert.ok(Buffer.byteLength(svg, 'utf8') < 3000);
});

test('el código enlaza al reporte, identifica el distintivo y mantiene un alt estable', () => {
  const result = example();
  const code = createEmbedCode(result);
  assert.match(code, /data-blackpixel-badge/);
  assert.match(code, /href="https:\/\/evidence.example\/blackpixel\/page-key\/reporte.html"/);
  assert.match(code, /loading="lazy"/);
  assert.match(code, /a=1&amp;b=2/);
  assert.doesNotMatch(code, /<script|68\.4/);
  assert.match(createEmbedPage(result), /&lt;a data-blackpixel-badge/);
});

test('el modo local explica cómo publicar sin inventar direcciones de instalación', () => {
  const result = example();
  result.publicBase = null;
  result.publication = getPublicationLinks(null, 'key', 'run');
  assert.equal(createEmbedCode(result), null);
  assert.match(createEmbedPage(result), /Vista previa local/);
  assert.match(createEmbedPage(result), /--public-base/);
});

test('la CLI acepta opciones y detecta argumentos incompletos antes de analizar', () => {
  const args = parseArguments(['https://example.com/a#b', '--public-base', 'https://example.com/reports', '--output-dir', 'out']);
  assert.equal(args.url, 'https://example.com/a');
  assert.equal(args.options.publicBase, 'https://example.com/reports/');
  assert.equal(args.options.outputDir, 'out');
  assert.deepEqual(parseArguments(['--help']), { help: true });
  for (const values of [[], ['https://example.com', '--public-base'], ['https://example.com', '--wat'], ['https://a.com', 'https://b.com']]) {
    assert.throws(() => parseArguments(values));
  }
});

test('las secciones no sobrepasan el final de la página', () => {
  assert.deepEqual(getScrollPositions(2500, 800), [0, 800, 1600, 1700]);
  assert.deepEqual(getScrollPositions(1600, 800), [0, 800]);
  assert.deepEqual(getScrollPositions(400, 800), [0]);
});

test('el conteo omite las exclusiones y distingue negro puro de gris oscuro', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blackpixel-unit-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const image = new PNG({ width: 2, height: 2 });
  image.data.set([0, 0, 0, 255, 1, 1, 1, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  const map = path.join(dir, 'map.png');
  const marked = path.join(dir, 'marked.png');
  const result = await createVisuals(image, map, marked, Uint8Array.from([1, 0, 0, 0]));
  assert.deepEqual(result, { blackPixelCount: 1, excludedPixelCount: 1 });
  const markedImage = PNG.sync.read(await fs.readFile(marked));
  assert.deepEqual([...markedImage.data.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...markedImage.data.subarray(12, 16)], [255, 0, 255, 255]);
  const mapImage = PNG.sync.read(await fs.readFile(map));
  assert.deepEqual([...mapImage.data.subarray(0, 4)], [125, 211, 252, 255]);
});

test('el footer rechaza enlaces ejecutables y evita enviar la URL de la página visitante', () => {
  const result = example();
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'https://user:secret@example.com/']) {
    assert.throws(() => createEmbedCode({ ...result, publication: { ...result.publication, badge: bad } }));
    assert.throws(() => createEmbedCode({ ...result, publication: { ...result.publication, report: bad } }));
  }
  const embed = createEmbedCode(result);
  assert.equal((embed.match(/referrerpolicy="no-referrer"/g) || []).length, 2);
  assert.match(embed, /rel="noopener noreferrer"/);
});

test('los reportes escapan datos hostiles y bloquean scripts mediante CSP', () => {
  const result = {
    ...example(), hostname: 'example.com', analyzerVersion: '1.1.1',
    width: 1200, height: 4000, viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    excludedPixelCount: 0, capturedPixels: 4800000, hiddenOverlayCount: 0,
    measurementId: 'fixture', pageMetrics: { afterScroll: { scrollHeight: 4000 } },
    status: { label: 'VERDE', className: 'green', recommendation: 'Fixture' },
    resolvedUrl: '\"><script>window.comprometido=true</script>',
  };
  const html = createReportHtml(result);
  assert.doesNotMatch(html, /<script|onerror=/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src 'none'/);
  assert.match(createEmbedPage(result), /Content-Security-Policy/);
});

test('la captura rechaza tamaños y límites que podrían agotar memoria', () => {
  assert.doesNotThrow(() => validateCaptureSize(1200, 1600));
  for (const args of [[1200, 100000000], [0, 800], [1200, NaN], [1200, -1], [1, 1, Infinity]]) {
    assert.throws(() => validateCaptureSize(...args));
  }
  assert.equal(parseArguments(['https://example.com', '--max-pixels', '60000000']).options.maxPixels, 60000000);
  assert.throws(() => parseArguments(['https://example.com', '--max-pixels', 'no']));
  assert.throws(() => parseArguments(['https://example.com', '--max-pixels', '100000001']));
});
