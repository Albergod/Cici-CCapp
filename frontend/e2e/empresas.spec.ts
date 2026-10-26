import { test, expect } from '@playwright/test';
import { uid, uiRegister, uiLogin, apiContext, apiRegister } from './helpers';

async function apiStore(token: string, name: string) {
  const api = await apiContext(token);
  const res = await api.post('/api/stores', {
    data: { name, businessType: 'ROPA' },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

async function apiCompany(token: string, name: string) {
  const api = await apiContext(token);
  const res = await api.post('/api/empresas', { data: { name } });
  expect(res.status()).toBe(201);
  return (await res.json()).id as string;
}

async function apiLinkStore(token: string, empresaId: string, storeId: string) {
  const api = await apiContext(token);
  const res = await api.post(`/api/empresas/${empresaId}/tiendas`, {
    data: { storeId },
  });
  expect(res.status()).toBe(201);
}

async function apiAddMember(
  token: string,
  empresaId: string,
  email: string,
  role: 'ADMIN' | 'VIEWER',
) {
  const api = await apiContext(token);
  const res = await api.post(`/api/empresas/${empresaId}/miembros`, {
    data: { email, role },
  });
  expect(res.status()).toBe(201);
}

test.describe('Cici Empresarios: operación de la empresa', () => {
  test('la dueña crea, vincula, renombra, agrega/quita equipo y desvincula', async ({
    page,
  }) => {
    page.on('dialog', (dialog) => dialog.accept());

    const email = `${uid('e2e-empresa')}@example.com`;
    const memberEmail = `${uid('e2e-miembro')}@example.com`;
    const token = await uiRegister(page, 'E2E Empresa', email);
    await apiRegister(memberEmail, 'E2E Miembro');

    const storeName = `Tienda E2E ${Date.now()}`;
    await apiStore(token, storeName);

    await page.goto('/empresas');
    await expect(page.getByRole('heading', { name: /mi empresa/i })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: /empezar/i }).click();

    const name = `Grupo E2E ${Date.now()}`;
    await page.getByLabel('Nombre de la empresa').fill(name);
    await page.getByRole('button', { name: /^crear$/i }).click();

    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/todavía no hay tiendas vinculadas/i)).toBeVisible();

    await page.getByRole('combobox').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: /^vincular$/i }).click();

    await expect(page.getByText(/tienda vinculada/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(storeName)).toBeVisible();

    await page.getByRole('button', { name: 'Editar nombre' }).click();
    const renamed = `${name} Renombrada`;
    await page.locator('input.text-lg').fill(renamed);
    await page.getByRole('button', { name: /^guardar$/i }).click();
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible({
      timeout: 10000,
    });

    await page.getByPlaceholder('correo@empresa.com').fill(memberEmail);
    await page.getByRole('button', { name: /^agregar$/i }).click();
    await expect(page.getByText(memberEmail)).toBeVisible({ timeout: 10000 });

    const roleSelect = page
      .locator('select')
      .filter({ has: page.locator('option[value="ADMIN"]') })
      .first();
    await roleSelect.selectOption('ADMIN');
    await expect(page.getByText(/rol de .* actualizado/i)).toBeVisible({
      timeout: 10000,
    });
    const memberRow = page.locator('div.p-4').filter({ hasText: memberEmail }).first();
    await expect(memberRow.locator('select')).toHaveValue('ADMIN');
    await memberRow.getByTitle('Quitar del equipo').click();
    await expect(page.getByText(memberEmail)).toHaveCount(0, { timeout: 10000 });

    await page.getByRole('button', { name: /desvincular/i }).click();
    await expect(page.getByText(/tienda desvinculada/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/todavía no hay tiendas vinculadas/i)).toBeVisible();
  });

  test('ADMIN opera su tienda y quita VIEWER; VIEWER solo consulta', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());

    const ownerEmail = `${uid('e2e-owner')}@example.com`;
    const adminEmail = `${uid('e2e-admin')}@example.com`;
    const viewerEmail = `${uid('e2e-viewer')}@example.com`;
    const ownerToken = await apiRegister(ownerEmail, 'Owner E2E');
    const adminToken = await apiRegister(adminEmail, 'Admin E2E');
    const viewerToken = await apiRegister(viewerEmail, 'Viewer E2E');

    const ownerStoreName = `Tienda Owner ${Date.now()}`;
    const adminStoreName = `Tienda Admin ${Date.now()}`;
    const ownerStore = await apiStore(ownerToken, ownerStoreName);
    const adminStore = await apiStore(adminToken, adminStoreName);
    const companyName = `Grupo Roles ${Date.now()}`;
    const empresaId = await apiCompany(ownerToken, companyName);
    await apiLinkStore(ownerToken, empresaId, ownerStore);
    await apiAddMember(ownerToken, empresaId, adminEmail, 'ADMIN');
    await apiAddMember(ownerToken, empresaId, viewerEmail, 'VIEWER');

    await uiLogin(page, adminEmail);
    await page.goto('/empresas');
    await expect(page.getByRole('heading', { name: companyName })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Administrador', { exact: true }).first()).toBeVisible();

    const renamed = `${companyName} Admin`;
    await page.getByRole('button', { name: 'Editar nombre' }).click();
    await page.locator('input.text-lg').fill(renamed);
    await page.getByRole('button', { name: /^guardar$/i }).click();
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible({
      timeout: 10000,
    });

    await page.getByRole('combobox').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: /^vincular$/i }).click();
    await expect(page.getByText(/tienda vinculada/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(adminStoreName)).toBeVisible();

    const viewerRow = page.locator('div.p-4').filter({ hasText: viewerEmail }).first();
    await viewerRow.getByTitle('Quitar del equipo').click();
    await expect(page.getByText(viewerEmail)).toHaveCount(0, { timeout: 10000 });

    await apiAddMember(ownerToken, empresaId, viewerEmail, 'VIEWER');
    await uiLogin(page, viewerEmail);
    await page.goto('/empresas');
    await expect(page.getByRole('heading', { name: renamed })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(ownerStoreName)).toBeVisible();
    await expect(page.getByText(adminStoreName)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar nombre' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^vincular$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /desvincular/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^agregar$/i })).toHaveCount(0);

    void viewerToken;
  });

  test('sin tienda propia no puede crear la empresa y ve el error honesto', async ({
    page,
  }) => {
    const email = `${uid('e2e-sin-tienda')}@example.com`;
    await uiRegister(page, 'Sin Tienda', email);

    await page.goto('/empresas');
    await expect(page.getByRole('heading', { name: /mi empresa/i })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: /empezar/i }).click();
    await page.getByLabel('Nombre de la empresa').fill('Grupo Sin Tienda');
    await page.getByRole('button', { name: /^crear$/i }).click();

    await expect(page.getByText(/primero crea una tienda/i)).toBeVisible({
      timeout: 10000,
    });
  });
});
