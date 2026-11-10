const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('playwright-core');
const { PNG } = require('pngjs');
const { randomUUID } = require('node:crypto');
const { version } = require('./package.json');
const {
  escapeHtml, normalizePageUrl, normalizePublicBase, getPageKey,
  getPublicationLinks, createBadgeSvg, createEmbedSection, createEmbedPage, HTML_CSP,
} = require('./lib/badge');

const GREEN_THRESHOLD = 66;
const YELLOW_THRESHOLD = 33;
const REPORTS_DIR = 'reports';
const SCREENSHOT_FILE = 'captura.png';
const MARKED_SCREENSHOT_FILE = 'captura-marcada.png';
const BLACK_MAP_FILE = 'mapa-negro.png';
const REPORT_FILE = 'reporte.html';
const VIEWPORT = { width: 1200, height: 800 };
const SCROLL_STEP = 700;
const SCROLL_DELAY = 120;
const MAX_CAPTURE_PIXELS = 50000000;
const ANALYSIS_TIMEOUT_MS = 120000;

function validateCaptureSize(width, height, maxPixels = MAX_CAPTURE_PIXELS) {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > 100000000) {
    throw new Error('--max-pixels debe ser un entero entre 1 y 100000000.');
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width * height > maxPixels) {
    throw new Error('La captura supera el límite de píxeles. Revisa la página o ajusta --max-pixels para una página de confianza.');
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSustainabilityStatus(percentage) {
  if (percentage >= GREEN_THRESHOLD) {
    return {
      label: 'VERDE',
      className: 'green',
      recommendation: 'Alta presencia de negro puro. Buen punto de partida para interfaces más eficientes en pantallas OLED/AMOLED.',
    };
  }

  if (percentage >= YELLOW_THRESHOLD) {
    return {
      label: 'AMARILLO',
      className: 'yellow',
      recommendation: 'Presencia media de negro puro. Hay oportunidad de oscurecer fondos, secciones y superficies principales.',
    };
  }

  return {
    label: 'ROJO',
    className: 'red',
    recommendation: 'Baja presencia de negro puro. Considera usar más áreas #000000 si el objetivo es reducir consumo en OLED/AMOLED.',
  };
}

async function getPageMetrics(page) {
  return page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: Math.max(
        body.scrollWidth,
        body.offsetWidth,
        html.clientWidth,
        html.scrollWidth,
        html.offsetWidth,
      ),
      scrollHeight: Math.max(
        body.scrollHeight,
        body.offsetHeight,
        html.clientHeight,
        html.scrollHeight,
        html.offsetHeight,
      ),
    };
  });
}

async function loadFullPage(page, maxPixels) {
  const beforeScroll = await getPageMetrics(page);
  validateCaptureSize(beforeScroll.viewportWidth, beforeScroll.scrollHeight, maxPixels);

  const loadError = await page.evaluate(
    ({ step, delay, maxPixels }) => new Promise((resolve) => {
      let previousScrollY = -1;
      let stableTicks = 0;
      const started = Date.now();

      const timer = setInterval(() => {
        window.scrollBy(0, step);

        const body = document.body;
        const html = document.documentElement;
        const scrollHeight = Math.max(
          body.scrollHeight,
          body.offsetHeight,
          html.clientHeight,
          html.scrollHeight,
          html.offsetHeight,
        );
        const currentScrollY = window.scrollY;
        const reachedBottom = window.innerHeight + currentScrollY >= scrollHeight - 2;

        if (scrollHeight * window.innerWidth > maxPixels || Date.now() - started > 60000) {
          clearInterval(timer);
          resolve('La página excedió los límites de carga; el análisis se detuvo sin publicar un resultado incompleto.');
          return;
        }

        if (currentScrollY === previousScrollY) {
          stableTicks++;
        } else {
          stableTicks = 0;
          previousScrollY = currentScrollY;
        }

        if (reachedBottom || stableTicks >= 4) {
          clearInterval(timer);
          resolve();
        }
      }, delay);
    }),
    { step: SCROLL_STEP, delay: SCROLL_DELAY, maxPixels },
  );
  if (loadError) throw new Error(loadError);

  await wait(1200);
  const afterScroll = await getPageMetrics(page);
  validateCaptureSize(afterScroll.viewportWidth, afterScroll.scrollHeight, maxPixels);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(500);

  return { beforeScroll, afterScroll };
}

async function hideFloatingOverlays(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const floatingElements = [];

    for (const element of document.querySelectorAll('body *')) {
      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const isFloating = styles.position === 'fixed' || styles.position === 'sticky';
      const isTopBar = rect.top <= 5 && rect.left <= 5 && rect.width >= viewportWidth * 0.8;

      if (isFloating && !isTopBar && !element.closest('[data-blackpixel-badge]')) {
        element.setAttribute('data-blackpixel-hidden-overlay', 'true');
        floatingElements.push(element);
      }
    }

    for (const element of floatingElements) {
      element.style.setProperty('visibility', 'hidden', 'important');
    }

    return floatingElements.length;
  });
}

function getScrollPositions(scrollHeight, viewportHeight) {
  if (scrollHeight <= viewportHeight) {
    return [0];
  }

  const positions = [];
  for (let y = 0; y <= scrollHeight - viewportHeight; y += viewportHeight) {
    positions.push(y);
  }

  const lastPosition = scrollHeight - viewportHeight;
  if (positions[positions.length - 1] !== lastPosition) {
    positions.push(lastPosition);
  }

  return [...new Set(positions)].sort((a, b) => a - b);
}

async function captureStitchedFullPage(page, metrics, outputPath) {
  const width = metrics.viewportWidth;
  const height = metrics.scrollHeight;
  const stitched = new PNG({ width, height });
  stitched.data.fill(255);
  const positions = getScrollPositions(height, metrics.viewportHeight);
  let exclusionMask = null;

  for (const targetY of positions) {
    const actualY = await page.evaluate((y) => {
      window.scrollTo({ top: y, behavior: 'instant' });
      return window.scrollY;
    }, targetY);

    await wait(350);
    // Se excluye el rectángulo visible del distintivo sin cambiar el layout.
    const badgeRects = await page.evaluate(() => {
      return [...document.querySelectorAll('[data-blackpixel-badge]')].flatMap((element) => {
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none') return [];
        const rect = element.getBoundingClientRect();
        const left = Math.max(0, Math.floor(rect.left));
        const top = Math.max(0, Math.floor(rect.top));
        const right = Math.min(innerWidth, Math.ceil(rect.right));
        const bottom = Math.min(innerHeight, Math.ceil(rect.bottom));
        return right > left && bottom > top ? [{ left, top, right, bottom }] : [];
      });
    });
    const screenshotBuffer = await page.screenshot({ type: 'png', fullPage: false });
    const segment = PNG.sync.read(Buffer.from(screenshotBuffer));
    if (segment.width !== width) throw new Error('La captura cambió de escala durante el análisis.');
    const segmentHeight = Math.min(segment.height, height - actualY);
    for (let row = 0; row < segmentHeight; row++) {
      segment.data.copy(stitched.data, (actualY + row) * width * 4, row * width * 4, (row + 1) * width * 4);
    }
    if (badgeRects.length && !exclusionMask) exclusionMask = new Uint8Array(width * height);
    if (exclusionMask) {
      // Las secciones solapadas deben reemplazar tanto imagen como exclusiones.
      exclusionMask.fill(0, actualY * width, (actualY + segmentHeight) * width);
      for (const rect of badgeRects) {
        for (let y = rect.top; y < Math.min(rect.bottom, segmentHeight); y++) {
          exclusionMask.fill(1, (actualY + y) * width + rect.left, (actualY + y) * width + rect.right);
        }
      }
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await fs.writeFile(outputPath, PNG.sync.write(stitched));
  return { image: stitched, exclusionMask };
}

async function createVisuals(image, blackMapPath, markedScreenshotPath, exclusionMask = null) {
  const blackMap = new PNG({ width: image.width, height: image.height });
  const markedScreenshot = { width: image.width, height: image.height, data: Buffer.from(image.data) };

  let blackPixelCount = 0;
  let excludedPixelCount = 0;
  const excludedColor = Buffer.from([125, 211, 252, 255]);
  const highlightColor = Buffer.from([255, 0, 255, 255]);
  const backgroundColor = Buffer.from([238, 242, 247, 255]);
  for (let pixel = 0; pixel < image.width * image.height; pixel++) {
    const idx = pixel * 4;
    if (exclusionMask && exclusionMask[pixel]) {
      excludedPixelCount++;
      blackMap.data.set(excludedColor, idx);
    } else if (image.data[idx] === 0 && image.data[idx + 1] === 0 && image.data[idx + 2] === 0) {
      blackPixelCount++;
      blackMap.data.set(highlightColor, idx);
      markedScreenshot.data.set(highlightColor, idx);
    } else {
      blackMap.data.set(backgroundColor, idx);
    }
  }

  await Promise.all([
    fs.writeFile(blackMapPath, PNG.sync.write(blackMap)),
    fs.writeFile(markedScreenshotPath, PNG.sync.write(markedScreenshot)),
  ]);

  return { blackPixelCount, excludedPixelCount };
}

function createReportHtml(result, imagePrefix = './') {
  const capturedAt = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'medium',
    timeZone: 'America/Mexico_City',
  }).format(new Date(result.createdAt));

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${HTML_CSP}">
  <title>Reporte BlackPixel - ${escapeHtml(result.hostname)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --surface: #ffffff;
      --text: #111827;
      --muted: #5b6472;
      --line: #d9dee8;
      --green: #16a34a;
      --yellow: #d97706;
      --red: #dc2626;
      --black: #000000;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      line-height: 1.5;
    }

    header {
      background: var(--black);
      color: #ffffff;
      padding: 32px 24px;
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 24px auto 48px;
    }

    h1,
    h2,
    p {
      margin-top: 0;
    }

    h1 {
      margin-bottom: 8px;
      font-size: 32px;
    }

    h2 {
      font-size: 20px;
    }

    header .note { color: #e5e7eb; }

    .header-inner {
      width: min(1180px, 100%);
      margin: 0 auto;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }

    .card,
    .panel {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }

    .metric-label {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 6px;
    }

    .metric-value {
      font-size: 28px;
      font-weight: 700;
    }

    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      padding: 8px 12px;
    }

    .status::before {
      content: "";
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: currentColor;
      border: 2px solid rgba(255, 255, 255, 0.85);
    }

    .status.green {
      background: var(--green);
    }

    .status.yellow {
      background: var(--yellow);
    }

    .status.red {
      background: var(--red);
    }

    .details {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .detail {
      border-top: 1px solid var(--line);
      padding-top: 12px;
    }

    .full-preview,
    .preview {
      display: block;
      width: 100%;
      height: auto;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 6px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      gap: 20px;
      margin-top: 24px;
    }

    .note {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 0;
    }

    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin: 10px 0 0;
    }

    a {
      color: inherit;
      overflow-wrap: anywhere;
    }

    @media (max-width: 860px) {
      .summary,
      .grid,
      .details {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <h1>Reporte BlackPixel</h1>
      <p class="note">Análisis de presencia de negro puro (#000000) en una captura completa de la página analizada.</p>
    </div>
  </header>

  <main>
    <section class="summary" aria-label="Resumen del análisis">
      <div class="card">
        <div class="metric-label">Estado</div>
        <div class="metric-value">
          <span class="status ${result.status.className}">${result.status.label}</span>
        </div>
      </div>
      <div class="card">
        <div class="metric-label">Negro puro</div>
        <div class="metric-value">${result.percentage.toFixed(2)}%</div>
      </div>
      <div class="card">
        <div class="metric-label">Píxeles negros</div>
        <div class="metric-value">${result.blackPixelCount.toLocaleString('es-MX')}</div>
      </div>
      <div class="card">
        <div class="metric-label">Píxeles analizados</div>
        <div class="metric-value">${result.totalPixels.toLocaleString('es-MX')}</div>
      </div>
    </section>

    <section class="panel">
      <h2>Resultado</h2>
      <p>${escapeHtml(result.status.recommendation)}</p>
      <div class="details">
        <div class="detail">
          <div class="metric-label">URL analizada</div>
          <a href="${escapeHtml(result.url)}">${escapeHtml(result.url)}</a>
        </div>
        <div class="detail">
          <div class="metric-label">Fecha del reporte</div>
          <div>${escapeHtml(capturedAt)}</div>
        </div>
        <div class="detail">
          <div class="metric-label">Tamaño de captura</div>
          <div>${result.width}x${result.height}px</div>
        </div>
        <div class="detail">
          <div class="metric-label">Modo de captura</div>
          <div>Página completa capturada por secciones y unida en una sola imagen.</div>
        </div>
        <div class="detail">
          <div class="metric-label">Alto total detectado</div>
          <div>${result.pageMetrics.afterScroll.scrollHeight.toLocaleString('es-MX')}px</div>
        </div>
        <div class="detail">
          <div class="metric-label">Reportes anteriores</div>
          <div>Se conservan las mediciones anteriores para esta URL, con su fecha e imágenes.</div>
        </div>
        <div class="detail">
          <div class="metric-label">Píxeles excluidos del distintivo</div>
          <div>${result.excludedPixelCount.toLocaleString('es-MX')} de ${result.capturedPixels.toLocaleString('es-MX')} píxeles capturados</div>
        </div>
        <div class="detail">
          <div class="metric-label">Método y versión</div>
          <div>RGB exacto (0, 0, 0) · BlackPixel ${escapeHtml(result.analyzerVersion)} · ${result.viewport.width} × ${result.viewport.height}px · escala ${result.viewport.deviceScaleFactor}</div>
        </div>
        <div class="detail">
          <div class="metric-label">Identificador de medición</div>
          <div>${escapeHtml(result.measurementId)}</div>
        </div>
        <div class="detail">
          <div class="metric-label">URL final del navegador</div>
          <div>${escapeHtml(result.resolvedUrl)}</div>
        </div>
        <div class="detail">
          <div class="metric-label">Elementos flotantes ocultos</div>
          <div>${result.hiddenOverlayCount.toLocaleString('es-MX')}</div>
        </div>
      </div>
    </section>

    <section class="panel" style="margin-top: 24px;">
      <h2>Pantallazo completo con zonas negras marcadas</h2>
      <img class="full-preview" src="${imagePrefix}${MARKED_SCREENSHOT_FILE}" alt="Captura completa con píxeles negros marcados en fucsia">
      <p class="links">
        <a href="${imagePrefix}${MARKED_SCREENSHOT_FILE}" target="_blank" rel="noreferrer">Abrir pantallazo marcado completo</a>
        <a href="${imagePrefix}${SCREENSHOT_FILE}" target="_blank" rel="noreferrer">Abrir captura original completa</a>
      </p>
      <p class="note">Las áreas fucsia son píxeles que originalmente eran exactamente #000000.</p>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Captura original</h2>
        <img class="preview" src="${imagePrefix}${SCREENSHOT_FILE}" alt="Captura completa de la página analizada">
      </div>
      <div class="panel">
        <h2>Mapa de negro detectado</h2>
        <img class="preview" src="${imagePrefix}${BLACK_MAP_FILE}" alt="Mapa de píxeles negros detectados">
        <p class="note">Las zonas fucsia representan píxeles exactamente #000000. Las zonas grises no fueron contabilizadas como negro puro. Las zonas azules corresponden al rectángulo del distintivo, excluido del numerador y del denominador.</p>
      </div>
    </section>

    <section class="panel" style="margin-top: 24px;">
      ${createEmbedSection(result, imagePrefix)}
      <p><a href="${imagePrefix}resultado.json">Descargar datos de esta medición (JSON)</a></p>
    </section>

    <section class="panel" style="margin-top: 24px;">
      <h2>Lectura Responsable</h2>
      <p class="note">BlackPixel es una métrica visual por URL y fecha, basada en una captura de escritorio. El semáforo usa umbrales internos del proyecto y no es una certificación ambiental. Porcentaje = píxeles negros / píxeles analizados × 100; los rectángulos del distintivo identificado se excluyen de ambas cantidades. No sustituye una medición eléctrica real del dispositivo. El beneficio energético del negro puro aplica especialmente a pantallas OLED/AMOLED; en LCD el ahorro suele ser menor por la retroiluminación.</p>
    </section>
  </main>
</body>
</html>`;
}

async function analyzeBlackPixels(url, options = {}) {
  const normalizedUrl = normalizePageUrl(url);
  const publicBase = normalizePublicBase(options.publicBase);
  const reportsDir = path.resolve(options.outputDir || REPORTS_DIR);
  const pageKey = getPageKey(normalizedUrl);
  const createdAt = new Date().toISOString();
  const measurementId = createdAt.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const pageDir = path.join(reportsDir, pageKey);
  const reportDir = path.join(pageDir, measurementId);
  const maxPixels = options.maxPixels ?? MAX_CAPTURE_PIXELS;
  validateCaptureSize(VIEWPORT.width, VIEWPORT.height, maxPixels);
  let browser;
  let analysisTimer;
  let timedOut = false;

  try {
    await fs.mkdir(reportDir, { recursive: true });
    browser = await chromium.launch({ chromiumSandbox: true, ...options.launchOptions });
    analysisTimer = setTimeout(() => {
      timedOut = true;
      browser.close().catch(() => {});
    }, ANALYSIS_TIMEOUT_MS);
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
    await page.goto(normalizedUrl, { waitUntil: 'networkidle', timeout: 60000 });

    const pageMetrics = await loadFullPage(page, maxPixels);
    const hiddenOverlayCount = await hideFloatingOverlays(page);
    const { image, exclusionMask } = await captureStitchedFullPage(
      page, pageMetrics.afterScroll, path.join(reportDir, SCREENSHOT_FILE),
    );
    const { blackPixelCount, excludedPixelCount } = await createVisuals(
      image, path.join(reportDir, BLACK_MAP_FILE),
      path.join(reportDir, MARKED_SCREENSHOT_FILE), exclusionMask,
    );
    const capturedPixels = image.width * image.height;
    const totalPixels = capturedPixels - excludedPixelCount;
    if (!totalPixels) throw new Error('No quedan píxeles analizables fuera del distintivo.');
    const percentage = (blackPixelCount / totalPixels) * 100;
    const result = {
      schemaVersion: 1,
      analyzerVersion: version,
      measurementId,
      pageKey,
      url: normalizedUrl,
      resolvedUrl: page.url(),
      hostname: new URL(normalizedUrl).hostname,
      createdAt,
      width: image.width,
      height: image.height,
      viewport: { ...VIEWPORT, deviceScaleFactor: 1 },
      capturedPixels,
      excludedPixelCount,
      totalPixels,
      blackPixelCount,
      percentage,
      status: getSustainabilityStatus(percentage),
      methodology: {
        name: 'exact-rgb-black',
        black: '#000000',
        scope: 'single-url-full-page-desktop',
        badgeExclusion: 'visible-bounding-rectangles',
        formula: 'blackPixelCount / totalPixels * 100',
        thresholds: { green: GREEN_THRESHOLD, yellow: YELLOW_THRESHOLD },
        disclaimer: 'Indicador visual. No mide energía ni emisiones y no es una certificación ambiental.',
      },
      pageMetrics,
      hiddenOverlayCount,
      publicBase,
      publication: getPublicationLinks(publicBase, pageKey, measurementId),
    };

    const svg = createBadgeSvg(result);
    const json = JSON.stringify(result, null, 2) + '\n';
    // Cada carpeta fechada conserva su evidencia. Las rutas estables se actualizan al terminar.
    await Promise.all([
      fs.writeFile(path.join(reportDir, REPORT_FILE), createReportHtml(result), 'utf8'),
      fs.writeFile(path.join(reportDir, 'resultado.json'), json, 'utf8'),
      fs.writeFile(path.join(reportDir, 'badge.svg'), svg, 'utf8'),
    ]);
    await Promise.all([
      fs.writeFile(path.join(pageDir, REPORT_FILE), createReportHtml(result, './' + measurementId + '/'), 'utf8'),
      fs.writeFile(path.join(pageDir, 'resultado.json'), json, 'utf8'),
      fs.writeFile(path.join(pageDir, 'insertar.html'), createEmbedPage(result), 'utf8'),
    ]);
    await fs.writeFile(path.join(pageDir, 'badge.svg'), svg, 'utf8');

    console.log('Reporte generado: ' + path.join(reportDir, REPORT_FILE));
    console.log('Distintivo e instrucciones: ' + path.join(pageDir, 'insertar.html'));
    if (publicBase) console.log('Publica el contenido de ' + reportsDir + ' en ' + publicBase);
    return { result, reportDir, pageDir };
  } catch (error) {
    if (timedOut) throw new Error('El análisis excedió el límite de 120 segundos y se detuvo.');
    throw error;
  } finally {
    clearTimeout(analysisTimer);
    if (browser) await browser.close();
  }
}

function parseArguments(args) {
  const options = {};
  let url;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--public-base' || arg === '--output-dir' || arg === '--max-pixels') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('Falta un valor para ' + arg);
      if (arg === '--max-pixels') {
        options.maxPixels = Number(value);
        validateCaptureSize(1, 1, options.maxPixels);
      } else {
        options[arg === '--public-base' ? 'publicBase' : 'outputDir'] = value;
      }
    } else if (arg.startsWith('-')) {
      throw new Error('Opción desconocida: ' + arg);
    } else if (url) {
      throw new Error('Analiza una URL por ejecución.');
    } else {
      url = arg;
    }
  }
  if (!url) throw new Error('Falta la URL de la página.');
  return { url: normalizePageUrl(url), options: {
    ...options, publicBase: normalizePublicBase(options.publicBase),
  } };
}

function printUsage() {
  console.log('Uso: node black-pixel-analyzer.js <url> [--public-base <url>] [--output-dir <carpeta>] [--max-pixels <entero>]');
  console.log('Ejemplo: npm run analyze -- https://example.com --public-base https://example.com/blackpixel/');
  console.log('Sube la carpeta de resultados a --public-base para activar el distintivo público.');
}

if (require.main === module) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      printUsage();
    } else {
      analyzeBlackPixels(args.url, args.options).catch((error) => {
        console.error('No se pudo completar el análisis: ' + error.message);
        process.exitCode = 1;
      });
    }
  } catch (error) {
    console.error(error.message);
    printUsage();
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeBlackPixels, parseArguments, getScrollPositions, getSustainabilityStatus,
  createVisuals, createReportHtml,
  validateCaptureSize,
};

