const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { analyzeBlackPixels } = require('../black-pixel-analyzer');
const { createEmbedCode } = require('../lib/badge');

test('flujo completo: conteo, historial por URL, publicación estática e instalación del SVG', { timeout: 120000 }, async (t) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blackpixel-integration-'));
  let allBlack = false;
  let embedCode = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/blackpixel/')) {
        const filename = path.resolve(outputDir, decodeURIComponent(url.pathname.slice('/blackpixel/'.length)));
        if (!filename.startsWith(outputDir + path.sep)) { res.writeHead(403).end(); return; }
        const types = { '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
        res.end(await fs.readFile(filename));
      } else if (url.pathname === '/embed') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}</style></head><body>' + embedCode + '</body></html>');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html><head><style>html,body{margin:0;padding:0;scrollbar-width:none}</style></head><body>'
          + '<div style="height:800px;background:' + (allBlack ? '#000' : '#fff') + '"></div>'
          + '<div style="height:800px;background:#000"></div>'
          + '<div data-blackpixel-badge style="position:absolute;top:100px;left:0;width:360px;height:104px;background:#000">'
          + '<div data-blackpixel-badge style="width:100%;height:100%"></div></div></body></html>');
      }
    } catch {
      if (!res.headersSent) res.writeHead(404);
      res.end();
    }
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(outputDir, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const url = origin + '/test-page';
  // Solo para estas páginas locales controladas; la CLI conserva el sandbox de Chrome.
  const launchOptions = { pipe: true, args: ['--no-sandbox', '--disable-gpu'] };
  const options = { outputDir, publicBase: origin + '/blackpixel/', launchOptions };
  const first = await analyzeBlackPixels(url, options);
  assert.equal(first.result.width, 1200);
  assert.equal(first.result.height, 1600);
  assert.equal(first.result.capturedPixels, 1920000);
  assert.equal(first.result.excludedPixelCount, 360 * 104); // Las exclusiones anidadas no se duplican.
  assert.equal(first.result.blackPixelCount, 960000);
  assert.equal(first.result.totalPixels, 1920000 - 360 * 104);
  assert.equal(first.result.percentage, 960000 / (1920000 - 360 * 104) * 100);
  const originalJson = await fs.readFile(path.join(first.reportDir, 'resultado.json'), 'utf8');
  const originalReport = await fs.readFile(path.join(first.reportDir, 'reporte.html'), 'utf8');

  embedCode = createEmbedCode(first.result);
  const browser = await puppeteer.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 360, height: 180, deviceScaleFactor: 1 });
    await page.goto(origin + '/embed', { waitUntil: 'networkidle0' });
    const badge = await page.$eval('img', (image) => ({ loaded: image.complete && image.naturalWidth > 0, width: image.getBoundingClientRect().width }));
    assert.equal(badge.loaded, true);
    assert.equal(badge.width, 360);
    assert.equal(await page.$eval('a', (a) => a.href), first.result.publication.report);
    const parsedSvg = await page.evaluate(async (src) => {
      const svg = await (await fetch(src)).text();
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return !doc.querySelector('parsererror') && doc.documentElement.localName === 'svg';
    }, first.result.publication.badge);
    assert.equal(parsedSvg, true);
    if (process.env.BLACKPIXEL_QA_DIR) {
      await fs.mkdir(process.env.BLACKPIXEL_QA_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.BLACKPIXEL_QA_DIR, 'badge.png') });
    }
    await page.setViewport({ width: 1200, height: 900 });
    await page.goto(first.result.publication.report, { waitUntil: 'networkidle0' });
    assert.ok(await page.$$eval('img', (images) => images.every((image) => image.complete && image.naturalWidth > 0)));
    if (process.env.BLACKPIXEL_QA_DIR) {
      await page.screenshot({ path: path.join(process.env.BLACKPIXEL_QA_DIR, 'report.png') });
    }
  } finally {
    await browser.close();
  }

  allBlack = true;
  const second = await analyzeBlackPixels(url, options);
  assert.equal(second.pageDir, first.pageDir);
  assert.notEqual(second.reportDir, first.reportDir);
  assert.equal(second.result.percentage, 100);
  assert.equal(await fs.readFile(path.join(first.reportDir, 'resultado.json'), 'utf8'), originalJson);
  assert.equal(await fs.readFile(path.join(first.reportDir, 'reporte.html'), 'utf8'), originalReport);
  const latest = await (await fetch(second.result.publication.result)).json();
  assert.equal(latest.measurementId, second.result.measurementId);
  assert.match(await (await fetch(second.result.publication.badge)).text(), /100\.00%/);
  assert.ok((await (await fetch(second.result.publication.report)).text()).includes(second.result.measurementId + '/captura.png'));
  assert.equal((await fetch(first.result.publication.evidence)).status, 200);

  const third = await analyzeBlackPixels(origin + '/other-page?view=2', options);
  assert.notEqual(third.pageDir, first.pageDir);
  assert.equal((await (await fetch(second.result.publication.result)).json()).measurementId, second.result.measurementId);
});
