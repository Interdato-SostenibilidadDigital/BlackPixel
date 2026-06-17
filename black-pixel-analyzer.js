const puppeteer = require('puppeteer');
const { Jimp } = require('jimp');

const GREEN_THRESHOLD = 66;
const YELLOW_THRESHOLD = 33;
const SCREENSHOT_PATH = 'page.png';

function getSustainabilityStatus(percentage) {
  if (percentage >= GREEN_THRESHOLD) {
    return {
      label: 'VERDE',
      recommendation: 'Alta presencia de negro puro. Buen punto de partida para interfaces más eficientes en pantallas OLED/AMOLED.',
    };
  }

  if (percentage >= YELLOW_THRESHOLD) {
    return {
      label: 'AMARILLO',
      recommendation: 'Presencia media de negro puro. Hay oportunidad de oscurecer fondos, secciones y superficies principales.',
    };
  }

  return {
    label: 'ROJO',
    recommendation: 'Baja presencia de negro puro. Considera usar más áreas #000000 si el objetivo es reducir consumo en OLED/AMOLED.',
  };
}

async function analyzeBlackPixels(url) {
  let browser;

  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    const image = await Jimp.read(SCREENSHOT_PATH);
    let blackPixelCount = 0;
    const totalPixels = image.bitmap.width * image.bitmap.height;

    image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
      const r = this.bitmap.data[idx];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];

      if (r === 0 && g === 0 && b === 0) {
        blackPixelCount++;
      }
    });

    const percentage = (blackPixelCount / totalPixels) * 100;
    const status = getSustainabilityStatus(percentage);

    console.log(`URL: ${url}`);
    console.log(`Captura: ${SCREENSHOT_PATH}`);
    console.log(`Tamaño de imagen: ${image.bitmap.width}x${image.bitmap.height}`);
    console.log(`Píxeles negros puros (#000000): ${blackPixelCount} / ${totalPixels}`);
    console.log(`Porcentaje de negro puro: ${percentage.toFixed(2)}%`);
    console.log(`Estado BlackPixel: ${status.label}`);
    console.log(`Recomendación: ${status.recommendation}`);
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
