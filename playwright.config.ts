import { defineConfig, devices } from '@playwright/test';

const port = 8123;

export default defineConfig({
	testDir: './test/browser',
	// *.pw.ts so Jest's default *.spec.ts pattern does not pick these up.
	testMatch: '*.pw.ts',
	forbidOnly: !!process.env.CI,
	// Audio rendering timing is disturbed by parallel browsers on shared runners.
	workers: process.env.CI ? 1 : undefined,
	timeout: 15_000,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: { baseURL: `http://127.0.0.1:${port}` },
	webServer: {
		command: 'node test/browser/server.mjs',
		url: `http://127.0.0.1:${port}/package.json`,
		env: { PORT: String(port) },
		reuseExistingServer: !process.env.CI,
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				launchOptions: {
					ignoreDefaultArgs: ['--mute-audio'],
					args: ['--autoplay-policy=no-user-gesture-required'],
				},
			},
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				launchOptions: {
					firefoxUserPrefs: {
						'media.autoplay.default': 0,
						'media.autoplay.blocking_policy': 0,
						'media.block-autoplay-until-in-foreground': false,
					},
				},
			},
		},
		// Advisory only: run with `--project=webkit`; not part of `test:browser`.
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
	],
});
