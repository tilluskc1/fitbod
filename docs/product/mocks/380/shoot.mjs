// #380 mocks: renders each option's four states at 390x844 and 360x780.
// Run from the repo root: node docs/product/mocks/380/shoot.mjs <outDir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const out = resolve(process.argv[2] ?? 'shots-380');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!path.startsWith(root)) throw new Error('outside');
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const port = server.address().port;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const sizes = [[390, 844], [360, 780]];
const report = [];
for (const option of ['a', 'b']) {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    for (const state of ['a', 'b', 'c', 'd']) {
      await page.goto(`http://localhost:${port}/docs/product/mocks/380/option-${option}.html?s=${state}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState('networkidle');
      // Nothing may scroll sideways, and nothing in the visible screen may clip its own text.
      const issues = await page.evaluate(() => {
        const found = [];
        if (document.documentElement.scrollWidth > innerWidth) found.push(`page ${document.documentElement.scrollWidth}px wide`);
        const screen = document.querySelector(`.state--${document.body.dataset.s}`);
        for (const el of screen.querySelectorAll('button, .cell, .title, .ex__name, .ss, .next, .warm__text, .row__val, .donesum')) {
          if (el.scrollWidth > el.clientWidth + 1) found.push(`clipped: ${el.textContent.trim().slice(0, 30)}`);
          const box = el.getBoundingClientRect();
          if (box.right > innerWidth + 0.5) found.push(`off right: ${el.textContent.trim().slice(0, 30)}`);
        }
        return found;
      });
      const file = `option-${option}-${state}-${width}x${height}.png`;
      await page.screenshot({ path: join(out, file) });
      report.push(`${file}${issues.length ? '  ISSUES: ' + issues.join('; ') : '  ok'}`);
    }
    await page.close();
  }
}
await browser.close();
server.close();
console.log(report.join('\n'));
