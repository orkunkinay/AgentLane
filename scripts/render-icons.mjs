// Prepare the supplied transparent artwork for the UI and Chrome's PNG-only icons.
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile('extension/icons/agentlane.png');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = image.width;
    let top = image.height;
    let right = 0;
    let bottom = 0;
    // Ignore almost-transparent specks when finding the artwork's visible bounds.
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] <= 16) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }
    const side = Math.max(right - left, bottom - top) / 0.9;
    const x = (left + right - side) / 2;
    const y = (top + bottom - side) / 2;
    return [16, 32, 48, 128, 512].map((size) => {
      canvas.width = size;
      canvas.height = size;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, x, y, side, side, 0, 0, size, size);
      return { size, data: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, source.toString('base64'));
  for (const { size, data } of images) {
    const name = size === 512 ? 'logo' : `icon-${size}`;
    await writeFile(`extension/icons/${name}.png`, Buffer.from(data, 'base64'));
  }
} finally {
  await browser.close();
}
