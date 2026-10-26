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

  test('envía una solicitud completa y confirma la recepción', async ({ page }) => {
    await page.goto('/empresarios');

    await page.getByPlaceholder('Nombre de tu empresa').fill('Grupo E2E');
    await page.getByPlaceholder('¿Con quién hablamos?').fill('Ana E2E');
    await page.getByPlaceholder('tu@empresa.com').fill(`empresarios-e2e-${Date.now()}@example.com`);
    await page.getByPlaceholder('Opcional').fill('3001234567');
    await page.getByPlaceholder('Ej. 5').fill('4');
    await page.getByPlaceholder('https://...').fill('https://grupo-e2e.example.com');
    await page
      .getByPlaceholder(/marcas, tiendas, equipos/i)
      .fill('Cuatro tiendas y un equipo central.');

    await page.getByRole('button', { name: /solicitar información/i }).click();

    await expect(page.getByRole('heading', { name: /solicitud recibida/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/te contactaremos/i)).toBeVisible();

    await page.getByRole('button', { name: /enviar otra solicitud/i }).click();
    await expect(page.getByPlaceholder('Nombre de tu empresa')).toBeVisible();
  });

  test('el footer del inicio enlaza a la landing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /cici empresarios/i }).click();
    await expect(page).toHaveURL(/\/empresarios/, { timeout: 10000 });
  });
});
