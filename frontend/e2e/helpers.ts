import { expect, Page, request } from '@playwright/test';

export const API = 'http://localhost:3002';

export const uid = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Registro + login por UI con assert de destino (atrapa redirects rotos). */
export async function uiRegister(page: Page, name: string, email: string, pass = 'demo123456') {
  await page.goto('/register');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/register');
  await page.getByPlaceholder('Tu nombre').fill(name);
  await page.getByPlaceholder('tu@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('checkbox').check({ force: true }).catch(() => {});
  await page.getByRole('button', { name: /crear cuenta/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  const token = await page.evaluate(() => localStorage.getItem('token'));
  expect(token).toBeTruthy();
  return token as string;
}

export async function uiLogin(page: Page, email: string, pass = 'demo123456') {
  await page.goto('/login');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByPlaceholder('tu@email.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(pass);
  await page.getByRole('button', { name: /iniciar sesi|entrar/i }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
}

/** API directa (mismo backend e2e) para setup/teardown de fixtures. */
export function apiContext(token?: string) {
  return request.newContext({
    baseURL: API,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
