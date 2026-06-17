const fs = require('fs/promises');
const path = require('path');
const puppeteer = require('puppeteer');
const { Jimp, rgbaToInt } = require('jimp');

const GREEN_THRESHOLD = 66;
const YELLOW_THRESHOLD = 33;
const REPORTS_DIR = 'reports';
const SCREENSHOT_FILE = 'captura.png';
const BLACK_MAP_FILE = 'mapa-negro.png';
const REPORT_FILE = 'reporte.html';
const VIEWPORT = { width: 1200, height: 800 };
const SCROLL_STEP = 700;
const SCROLL_DELAY = 120;

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getReportDirectory(url) {
  const hostname = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '-');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(REPORTS_DIR, `${timestamp}-${hostname}`);
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

async function loadFullPage(page) {
  const beforeScroll = await getPageMetrics(page);

  await page.evaluate(
    ({ step, delay }) => new Promise((resolve) => {
      let previousScrollY = -1;
      let stableTicks = 0;

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
    { step: SCROLL_STEP, delay: SCROLL_DELAY },
  );

  await wait(1200);
  const afterScroll = await getPageMetrics(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(500);

  return { beforeScroll, afterScroll };
}

async function createBlackMap(image, outputPath) {
  const blackMap = new Jimp({
    width: image.bitmap.width,
    height: image.bitmap.height,
    color: rgbaToInt(238, 242, 247, 255),
  });

  let blackPixelCount = 0;
  const highlightColor = rgbaToInt(22, 163, 74, 255);

  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const r = this.bitmap.data[idx];
    const g = this.bitmap.data[idx + 1];
    const b = this.bitmap.data[idx + 2];

    if (r === 0 && g === 0 && b === 0) {
      blackPixelCount++;
      blackMap.setPixelColor(highlightColor, x, y);
    }
  });

  await blackMap.write(outputPath);
  return blackPixelCount;
}

function createReportHtml(result) {
  const capturedAt = new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(result.createdAt);

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
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

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      align-items: start;
      gap: 20px;
      margin-top: 24px;
    }

    .preview {
      display: block;
      width: 100%;
      height: auto;
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 6px;
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

    .note {
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 0;
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
      <p class="note">Análisis de presencia de negro puro (#000000) en una captura completa del sitio.</p>
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
        <div class="metric-label">Píxeles totales</div>
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
          <div>Página completa después de recorrer el sitio hasta el final.</div>
        </div>
        <div class="detail">
          <div class="metric-label">Alto total detectado</div>
          <div>${result.pageMetrics.afterScroll.scrollHeight.toLocaleString('es-MX')}px</div>
        </div>
        <div class="detail">
          <div class="metric-label">Criterio</div>
          <div>Verde: ≥66%, amarillo: 33% a 65.99%, rojo: &lt;33%.</div>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Captura de la página</h2>
        <img class="preview" src="./${SCREENSHOT_FILE}" alt="Captura completa de la página analizada">
        <p class="note"><a href="./${SCREENSHOT_FILE}" target="_blank" rel="noreferrer">Abrir captura completa</a></p>
      </div>
      <div class="panel">
        <h2>Mapa de negro detectado</h2>
        <img class="preview" src="./${BLACK_MAP_FILE}" alt="Mapa de píxeles negros detectados">
        <p class="note"><a href="./${BLACK_MAP_FILE}" target="_blank" rel="noreferrer">Abrir mapa completo</a></p>
        <p class="note">Las zonas verdes representan píxeles exactamente #000000. Las zonas grises no fueron contabilizadas como negro puro.</p>
      </div>
    </section>

    <section class="panel" style="margin-top: 24px;">
      <h2>Lectura Responsable</h2>
      <p class="note">BlackPixel es una métrica visual para crear conciencia de diseño. No sustituye una medición eléctrica real del dispositivo. El beneficio energético del negro puro aplica especialmente a pantallas OLED/AMOLED; en LCD el ahorro suele ser menor por la retroiluminación.</p>
    </section>
  </main>
</body>
</html>`;
}

async function analyzeBlackPixels(url) {
  let browser;

  try {
    const reportDir = getReportDirectory(url);
    const screenshotPath = path.join(reportDir, SCREENSHOT_FILE);
    const blackMapPath = path.join(reportDir, BLACK_MAP_FILE);
    const reportPath = path.join(reportDir, REPORT_FILE);

    await fs.mkdir(reportDir, { recursive: true });

    browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport(VIEWPORT);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    const pageMetrics = await loadFullPage(page);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const image = await Jimp.read(screenshotPath);
    const totalPixels = image.bitmap.width * image.bitmap.height;
    const blackPixelCount = await createBlackMap(image, blackMapPath);
    const percentage = (blackPixelCount / totalPixels) * 100;
    const status = getSustainabilityStatus(percentage);
    const report = {
      url,
      hostname: new URL(url).hostname,
      createdAt: new Date(),
      width: image.bitmap.width,
      height: image.bitmap.height,
      totalPixels,
      blackPixelCount,
      percentage,
      status,
      pageMetrics,
    };

    await fs.writeFile(reportPath, createReportHtml(report), 'utf8');

    console.log(`Reporte generado: ${path.resolve(reportPath)}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const url = process.argv[2];

if (!url) {
  console.error('Uso: node black-pixel-analyzer.js <url-del-sitio>');
  console.error('Ejemplo: node black-pixel-analyzer.js https://example.com');
  process.exit(1);
}

try {
  new URL(url);
} catch {
  console.error(`URL inválida: ${url}`);
  console.error('Incluye el protocolo, por ejemplo: https://example.com');
  process.exit(1);
}

analyzeBlackPixels(url).catch((error) => {
  console.error(`No se pudo analizar ${url}`);
  console.error(error.message);
  process.exit(1);
});
