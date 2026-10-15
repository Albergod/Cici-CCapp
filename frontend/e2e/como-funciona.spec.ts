import { test, expect } from '@playwright/test';

test.describe('Confianza: tutorial y cómo funciona', () => {
  test('/como-funciona explica pago protegido a compradoras y tenderas', async ({ page }) => {
    await page.goto('/como-funciona');
    await expect(page.getByRole('heading', { name: /cómo funciona cici/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/tu plata queda retenida/i).first()).toBeVisible();
    await expect(page.getByText(/crear mi cuenta gratis/i).first()).toBeVisible();
  });

  test('home abre el tutorial re-abrible y muestra pasos', async ({ page }) => {
    await page.goto('/?tutorial=1');
    await expect(page.getByText(/página principal/i).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /siguiente/i }).click();
    await expect(page.getByText(/tu espacio/i).first()).toBeVisible();
  });

  test('refresh con el parámetro ya consumido NO reabre el tutorial', async ({ page }) => {
    await page.goto('/?tutorial=1');
    await expect(page.getByText(/página principal/i).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /cerrar/i }).click();
    await page.waitForTimeout(400);
    expect(page.url()).not.toContain('tutorial=1');
    await page.reload();
    await page.waitForTimeout(1200);
    await expect(page.getByText(/página principal/i)).toHaveCount(0);
  });

  test('footer lleva a cómo funciona y descargar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /cómo funciona/i }).click();
    await expect(page).toHaveURL(/como-funciona/, { timeout: 10000 });
  });
});
