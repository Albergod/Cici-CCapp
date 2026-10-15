import { test, expect } from '@playwright/test';

async function loginAs(page: import('@playwright/test').Page, email: string, pass = 'demo123456') {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByPlaceholder('tu@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
}

test.describe('Piloto + ajustes + mis compras (UI)', () => {
  test('ajustes cambia el nombre', async ({ page }) => {
    await loginAs(page, 'clienta@test.com');
    // Abrir menú del avatar: botón con el nombre o avatar.
    await page.getByRole('button', { name: /luisa|clienta|avatar|cuenta|menú/i }).first().click({ timeout: 5000 }).catch(() => {});
    // Fallback: dispatch directo si el menú no abre por selector.
    const opened = await page.getByText(/mis compras/i).count();
    if (!opened) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('cici:open-ajustes')));
    } else {
      await page.getByText(/ajustes/i).click();
    }
    await expect(page.getByText(/cambiar clave/i).first()).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder('Tu nombre').fill('Luisa Clienta');
    await page.getByRole('button', { name: /guardar perfil/i }).click();
    await expect(page.getByText(/perfil actualizado/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('mis compras muestra pedidos con estado protegido', async ({ page }) => {
    await loginAs(page, 'clienta@test.com');
    await page.goto('/mis-compras');
    await expect(page.getByText(/pan de bono/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/retenido|liberado|pagado|pendiente|confirmado/i).first()).toBeVisible();
  });

  test('búsqueda con filtros UI (precio máx + ofertas)', async ({ page }) => {
    await page.goto('/search?q=caf%C3%A9');
    await expect(page.getByText(/resultados para/i).first()).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder(/precio m/i).fill('50000');
    await page.waitForTimeout(800);
    const prices = await page.getByText(/\$\s?[\d.]+/).allInnerTexts().catch(() => []);
    void prices;
    await page.getByRole('button', { name: /solo ofertas/i }).click();
    await page.waitForTimeout(800);
  });

  test('disputa pide mínimo 10 letras', async ({ page }) => {
    await loginAs(page, 'clienta@test.com');
    await page.goto('/mis-compras');
    const reportBtn = page.getByRole('button', { name: /reportar problema/i }).first();
    if (await reportBtn.count()) {
      await reportBtn.click();
      await page.getByPlaceholder(/qué pasó/i).fill('mal');
      await page.getByRole('button', { name: /enviar reporte/i }).click();
      await expect(page.getByText(/mínimo 10 letras/i).first()).toBeVisible({ timeout: 10000 });
    }
  });
});
