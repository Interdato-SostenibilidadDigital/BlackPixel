const puppeteer = require('puppeteer');
const Jimp = require('jimp');

async function analyzeBlackPixels(url) {
  let browser;

  try {
    browser = await puppeteer.launch();
    const page = await browser.newPage();

    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });

    const screenshotPath = 'page.png';
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const image = await Jimp.read(screenshotPath);
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

    console.log(`URL: ${url}`);
    console.log(`Screenshot: ${screenshotPath}`);
    console.log(`Image size: ${image.bitmap.width}x${image.bitmap.height}`);
    console.log(`Black pixels (#000000): ${blackPixelCount} / ${totalPixels}`);
    console.log(`Black pixel percentage: ${percentage.toFixed(2)}%`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const url = process.argv[2];

if (!url) {
  console.error('Usage: node black-pixel-analyzer.js <website-url>');
  console.error('Example: node black-pixel-analyzer.js https://example.com');
  process.exit(1);
}

analyzeBlackPixels(url).catch((error) => {
  console.error(`Could not analyze ${url}`);
  console.error(error.message);
  process.exit(1);
});
