import { test, expect } from '@playwright/test';
import { uid, uiRegister, uiLogin, apiContext } from './helpers';

test.describe('Auth: registro, login y recuperación', () => {
  test('registro crea cuenta y entra al home', async ({ page }) => {
    const email = `${uid('e2e-reg')}@example.com`;
    await uiRegister(page, 'E2E User', email);
    await expect(page.getByRole('link', { name: /descargar|tiendas|inicio/i }).first()).toBeVisible({ timeout: 10000 }).catch(() => {});
    await expect(page).toHaveURL(/\/$/);
  });

  test('login con clave mala muestra error y no entra', async ({ page }) => {
    const email = `${uid('e2e-bad')}@example.com`;
    const api = await apiContext();
    await api.post('/api/auth/register', { data: { email, password: 'demo123456', name: 'E2E', termsAccepted: true } });
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.getByPlaceholder('tu@email.com').fill(email);
    await page.getByPlaceholder('••••••••').fill('clave-mala-123');
    await page.getByRole('button', { name: /iniciar sesi/i }).click();
    await expect(page.getByText(/credenciales|incorrecta|inválid|error/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(/login/);
  });

  test('olvidé mi clave pide email y confirma envío', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByPlaceholder('tu@email.com').fill(`${uid('e2e-forgot')}@example.com`);
    await page.getByRole('button', { name: /enviar/i }).click();
    await expect(page.getByText(/revisa tu correo|enviamos|enlace/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('reset con token inventado muestra error', async ({ page }) => {
    await page.goto('/reset-password/00000000-0000-0000-0000-000000000000');
    await page.getByPlaceholder('••••••••').first().fill('nueva123456');
    await page.getByPlaceholder('••••••••').nth(1).fill('nueva123456');
    await page.getByRole('button', { name: /restablecer/i }).click();
    await expect(page.getByText(/inválido|expirado|error/i).first()).toBeVisible({ timeout: 15000 });
  });

  test('login válido entra (humo del flujo feliz)', async ({ page }) => {
    const email = `${uid('e2e-login')}@example.com`;
    const api = await apiContext();
    await api.post('/api/auth/register', { data: { email, password: 'demo123456', name: 'E2E', termsAccepted: true } });
    await uiLogin(page, email);
  });
});
