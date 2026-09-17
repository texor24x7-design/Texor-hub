/**
 * HTML → PDF through a headless Chromium that Puppeteer installs with npm.
 *
 * One browser per process, started on first use and reused; each PDF gets its
 * own page, closed when it is done. Pages cannot reach the network except the
 * API's own file and font routes, so a design cannot be used to make the server
 * fetch arbitrary URLs.
 */
import puppeteer from 'puppeteer';
import env from '../config/env.js';
import logger from '../utils/logger.js';

let browserPromise = null;

function browser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
    }).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    }).catch((error) => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

export async function htmlToPdf(html, { allowedOrigin, thermalWidthMm = null } = {}) {
  const page = await (await browser()).newPage();
  try {
    // The rendered HTML never contains scripts; turning JavaScript off makes that a guarantee.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || (allowedOrigin && url.startsWith(allowedOrigin))) request.continue();
      else request.abort();
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.evaluateHandle('document.fonts.ready');

    if (thermalWidthMm) {
      const heightPx = await page.evaluate(() => document.querySelector('.page')?.scrollHeight ?? document.body.scrollHeight);
      return Buffer.from(await page.pdf({ width: `${thermalWidthMm}mm`, height: `${Math.ceil(heightPx * 0.2646) + 2}mm`, printBackground: true, pageRanges: '1' }));
    }
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    await (await browserPromise).close();
  } catch (error) {
    logger.warn('closing pdf browser failed', { message: error.message });
  }
}
