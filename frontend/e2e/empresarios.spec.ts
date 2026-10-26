import { test, expect } from '@playwright/test';

test.describe('Cici Empresarios: landing de validación', () => {
  test('muestra la propuesta, el formulario y no enseña precios', async ({ page }) => {
    await page.goto('/empresarios');

    await expect(
      page.getByRole('heading', { name: /todos tus negocios.*una sola visión/i }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/varias tiendas, una organización/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /solicitar información/i })).toBeVisible();
    await expect(page.getByText(/no mostramos precios todavía/i)).toBeVisible();
  });

  test('el footer del inicio enlaza a la landing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /cici empresarios/i }).click();
    await expect(page).toHaveURL(/\/empresarios/, { timeout: 10000 });
  });
});
