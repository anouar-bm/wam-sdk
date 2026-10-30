// Runs every page in test/browser/pages/ and checks the result it publishes
// on window.webAudioResult. Pages also work when opened by hand in a browser.
// A page lists the modes it runs in with <meta name="modes" content="plain isolated">
// (default: plain). "isolated" serves it with COOP/COEP so SharedArrayBuffer
// event transport is used.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

const pagesDir = new URL('./pages/', import.meta.url);
const pages = readdirSync(pagesDir).filter((name) => name.endsWith('.html'));

function meta(name: string, key: string): string | undefined {
	const html = readFileSync(new URL(name, pagesDir), 'utf8');
	return html.match(new RegExp(`<meta name="${key}" content="([^"]+)">`))?.[1];
}

test.beforeEach(async ({ page }) => {
	page.on('console', (message) => console.log(`[${message.type()}] ${message.text()}`));
	page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));
});

for (const name of pages) {
	for (const mode of (meta(name, 'modes') ?? 'plain').split(/\s+/)) {
		test(`${name.replace(/\.html$/, '')} [${mode}]`, async ({ page }) => {
			await page.goto(`/test/browser/pages/${name}${mode === 'isolated' ? '?isolated' : ''}`);
			const result = await page.evaluate(() => (window as any).webAudioResult);
			expect(result, 'page did not publish window.webAudioResult').toBeTruthy();
			console.log(`[result] ${name} [${mode}] ${result.skip ? 'SKIP' : result.pass ? 'PASS' : 'FAIL'}: ${result.message}`);
			test.skip(!!result.skip, result.message);
			expect(result.pass, result.message).toBe(true);
		});
	}
}
