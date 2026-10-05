// Runs web/ in headless Chrome under the app's headers and prints the log.
import { chromium } from '../../node_modules/@playwright/test/index.mjs';
import { serve } from './serve.mjs';
const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.exposeFunction('noop', () => {});
await page.addInitScript("document.addEventListener('securitypolicyviolation', e => console.error('CSP', e.violatedDirective, e.blockedURI))");
await page.goto(url);
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => window.__log), null, 1));
console.log('console errors / CSP:', problems);
await browser.close();
server.close();
