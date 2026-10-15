import { defineConfig } from '@playwright/test';

// E2E CiCi: backend real que ADEMÁS sirve el frontend compilado (igual que
// producción: mismo origen, sin proxy). Lo testeado = lo desplegado.
// BD: misma de desarrollo con datos únicos por corrida + limpieza (no hay
// superusuario para crear BD dedicada; documentado como restricción local).
// Puertos fijos e2e (:3002). reuseExistingServer: false — falla fuerte antes
// que mentir con un server viejo.
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  retries: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:3002',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Chromium del sistema (NixOS): el headless-shell de Playwright no trae
    // sus .so aquí. Si falla por versión, quitar executablePath y dejar bundle.
    launchOptions: {
      executablePath: '/home/kaydo/.nix-profile/bin/chromium',
      args: ['--no-sandbox'],
    },
  },
  webServer: [
    {
      // Build primero (falla si el front no compila) y backend sirviendo dist.
      command: 'npm run build && (cd .. && npx tsx src/index.ts)',
      env: {
        ...process.env,
        PORT: '3002',
        NODE_ENV: 'test',
      } as Record<string, string>,
      url: 'http://localhost:3002/health',
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});
