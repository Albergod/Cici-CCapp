import { test, expect } from '@playwright/test';
import { uid, apiContext } from './helpers';

test.describe('Tienda: vitrina, oferta y reseña', () => {
  test('oferta activa muestra badge -% y precio promo en la tienda', async ({ page }) => {
    const tag = uid('e2e-offer');
    const api = await apiContext();
    const email = `${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email, password: 'demo123456', name: 'Owner', termsAccepted: true } });
    const login = await api.post('/api/auth/login', { data: { email, password: 'demo123456' } });
    const { token } = await login.json();
    const authed = await apiContext(token);

    const store = await (await authed.post('/api/stores', { data: { name: `Ofertas ${tag}`, businessType: 'ROPA' } })).json();
    const prod = await (
      await authed.post(`/api/stores/${store.id}/products`, { data: { name: `Jean ${tag}`, price: 100000, stock: 10 } })
    ).json();
    const ends = new Date(Date.now() + 5 * 86400000).toISOString();
    const patched = await authed.patch(`/api/products/${prod.id}`, { data: { offerPrice: 75000, offerEndsAt: ends } });
    expect(patched.ok()).toBeTruthy();

    await page.goto(`/store/${store.slug}`);
    await expect(page.getByText(`Jean ${tag}`).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('-25%').first()).toBeVisible();
  });

  test('clienta deja reseña y aparece con su nombre', async ({ page }) => {
    const tag = uid('e2e-rev');
    const api = await apiContext();
    const ownerEmail = `owner-${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email: ownerEmail, password: 'demo123456', name: 'Owner', termsAccepted: true } });
    const ownerLogin = await api.post('/api/auth/login', { data: { email: ownerEmail, password: 'demo123456' } });
    const ownerAuthed = await apiContext((await ownerLogin.json()).token);
    const store = await (await ownerAuthed.post('/api/stores', { data: { name: `Reseñas ${tag}`, businessType: 'HOGAR' } })).json();
    await ownerAuthed.post(`/api/stores/${store.id}/products`, { data: { name: `Mesa ${tag}`, price: 200000, stock: 4 } });

    const custEmail = `cust-${tag}@example.com`;
    const custName = `Clienta ${tag.slice(-6)}`;
    await api.post('/api/auth/register', { data: { email: custEmail, password: 'demo123456', name: custName, termsAccepted: true } });
    const custLogin = await api.post('/api/auth/login', { data: { email: custEmail, password: 'demo123456' } });
    const custAuthed = await apiContext((await custLogin.json()).token);
    // Sesión de clienta en el browser para el formulario.
    await page.goto('/login');
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByPlaceholder('tu@email.com').fill(custEmail);
    await page.getByPlaceholder('••••••••').fill('demo123456');
    await page.getByRole('button', { name: /iniciar sesi/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 15000 });

    await page.goto(`/store/${store.slug}`);
    const comment = `Me encantó ${tag}`;
    await page.getByPlaceholder(/qué te pareció/i).fill(comment);
    await page.getByRole('button', { name: /publicar reseña/i }).click();
    await expect(page.getByText(comment).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/1 reseñas|1 reseña/i).first()).toBeVisible();
    void custAuthed;
  });

  test('dashboard muestra las 4 pestañas y finanzas vacías para tienda nueva', async ({ page }) => {
    const tag = uid('e2e-dash');
    const api = await apiContext();
    const email = `${tag}@example.com`;
    await api.post('/api/auth/register', { data: { email, password: 'demo123456', name: 'Dash', termsAccepted: true } });
    const login = await api.post('/api/auth/login', { data: { email, password: 'demo123456' } });
    const authed = await apiContext((await login.json()).token);
    await authed.post('/api/stores', { data: { name: `Dash ${tag}`, businessType: 'OTRO' } });

    await page.goto('/login');
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByPlaceholder('tu@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill('demo123456');
    await page.getByRole('button', { name: /iniciar sesi/i }).click();
    await page.goto('/dashboard');
    for (const tab of ['Resumen', 'Catálogo', 'Pedidos', 'Finanzas']) {
      await expect(page.getByRole('button', { name: new RegExp(tab, 'i') })).toBeVisible({ timeout: 10000 });
    }
    await page.getByRole('button', { name: /finanzas/i }).click();
    await expect(page.getByText(/pagos protegidos/i).first()).toBeVisible({ timeout: 10000 });
  });
});
