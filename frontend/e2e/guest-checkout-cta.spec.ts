import { test, expect } from '@playwright/test';
import { uid, apiContext } from './helpers';
import { execSync } from 'node:child_process';

test.describe('Guest checkout CTA (compra sin registro)', () => {
  test('tienda con pago en linea: CTA es Comprar y no manda a /login', async ({ page }) => {
    const tag = uid('e2e-cta');
    const api = await apiContext();
    const ownerEmail = `cta-owner-${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email: ownerEmail, password: 'demo123456', name: 'CTA Owner', termsAccepted: true } });
    const ownerLogin = await api.post('/api/auth/login', { data: { email: ownerEmail, password: 'demo123456' } });
    const ownerAuthed = await apiContext((await ownerLogin.json()).token);
    const storeRes = await ownerAuthed.post('/api/stores', { data: { name: `CTA ${tag}`, businessType: 'OTRO' } });
    const storeBody = (await storeRes.json()) as { id: string; slug: string };
    const storeId = storeBody.id;
    await ownerAuthed.post(`/api/stores/${storeId}/products`, { data: { name: `Producto CTA ${tag}`, price: 10000, stock: 5 } });

    execSync('/home/kaydo/.nvm/versions/node/v20.20.2/bin/npx', ['tsx', '/home/kaydo/Desktop/cc-platform/scripts/set-protected-enabled.ts', storeId], { stdio: 'inherit' });

    await page.goto(`/store/${storeBody.slug}`);
    const buy = page.getByRole('button', { name: /comprar/i }).first();
    await expect(buy).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /contactar/i })).toHaveCount(0);

    await buy.click();
    await expect(page).toHaveURL(/\/comprar\//, { timeout: 15000 });
  });
});
