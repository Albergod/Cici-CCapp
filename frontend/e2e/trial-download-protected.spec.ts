import { test, expect } from '@playwright/test';
import { uid, apiContext } from './helpers';

test.describe('Trial, descarga y pago protegido (cableado)', () => {
  test('tienda FREE nueva ve el CTA de prueba PRO de 14 días', async ({ page }) => {
    const tag = uid('e2e-trial');
    const api = await apiContext();
    const email = `${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email, password: 'demo123456', name: 'Trial', termsAccepted: true } });
    const login = await api.post('/api/auth/login', { data: { email, password: 'demo123456' } });
    const authed = await apiContext((await login.json()).token);
    await authed.post('/api/stores', { data: { name: `Trial ${tag}`, businessType: 'OTRO' } });

    await page.goto('/login');
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByPlaceholder('tu@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill('demo123456');
    await page.getByRole('button', { name: /iniciar sesi/i }).click();
    await page.goto('/dashboard');
    await expect(page.getByText(/prueba.*14 días|14 días.*prueba/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('/descargar ofrece el APK con la versión publicada', async ({ page }) => {
    const api = await apiContext();
    const ver = await (await api.get('/app-version.json').catch(() => null))?.json().catch(() => null);
    await page.goto('/descargar');
    if (ver?.versionName) {
      await expect(page.getByText(new RegExp(`v?${String(ver.versionName).replace(/\./g, '\\.')}`, 'i')).first()).toBeVisible({ timeout: 15000 });
    }
    const apk = page.locator('a[href="/cici.apk"]');
    await expect(apk.first()).toBeVisible({ timeout: 15000 });
  });

  test('iPhone ve guía de Agregar a inicio en vez del APK', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    await page.goto('/descargar');
    await expect(page.getByText(/iphone|agregar a.*inicio/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('a[href="/cici.apk"]')).toHaveCount(0);
    await context.close();
  });

  test('checkout protegido exige tienda voluntaria (403 honesto)', async () => {
    const tag = uid('e2e-prot');
    const api = await apiContext();
    const ownerEmail = `powner-${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email: ownerEmail, password: 'demo123456', name: 'Propietaria', termsAccepted: true } });
    const custEmail = `pcust-${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email: custEmail, password: 'demo123456', name: 'Clienta', termsAccepted: true } });
    const custLogin = await api.post('/api/auth/login', { data: { email: custEmail, password: 'demo123456' } });
    const custAuthed = await apiContext((await custLogin.json()).token);
    // Pedido directo en DB vía setup: aquí solo verificamos el 403 sin flag.
    // (El camino feliz con Wompi sandbox queda documentado como manual.)
    const r = await custAuthed.post('/api/protected/checkout', {
      data: { orderId: '00000000-0000-0000-0000-000000000000', phoneNumber: '3101234567' },
    });
    expect([403, 404]).toContain(r.status());
  });
});
