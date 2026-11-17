// Rasterize the source SVG for Chrome's PNG-only extension icons.
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(resolve('extension/icons/agentlane.svg')).href);
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.evaluate((size) => {
      document.documentElement.setAttribute('width', String(size));
      document.documentElement.setAttribute('height', String(size));
    }, size);
    await page.screenshot({ path: `extension/icons/icon-${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
