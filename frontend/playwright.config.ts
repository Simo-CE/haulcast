import { defineConfig } from '@playwright/test'

const CI = Boolean(process.env.CI)
const python = process.env.PYTHON ?? '.venv/bin/python'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: { browserName: 'chromium', viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
  // The real Django backend serves /api/demo/storm; every other API call is mocked with saved fixtures in the tests.
  webServer: [
    {
      command: `cd ../backend && ${python} manage.py runserver 127.0.0.1:8000 --noreload`,
      url: 'http://127.0.0.1:8000/api/health',
      reuseExistingServer: !CI,
    },
    { command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: !CI },
  ],
})
