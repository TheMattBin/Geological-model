import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

test('the deployed revision matches the tested commit', async ({ request, baseURL }) => {
  test.skip(!process.env.EXPECTED_REVISION, 'Set EXPECTED_REVISION to verify a CI deployment.');
  const url = new URL('revision.json', baseURL);
  // Bypass intermediary caches while Pages propagates the new release.
  url.searchParams.set('commit', process.env.EXPECTED_REVISION);
  await expect(async () => {
    const response = await request.get(url.href, { headers: { 'Cache-Control': 'no-cache' } });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ commit: process.env.EXPECTED_REVISION });
  }).toPass({ timeout: 45000, intervals: [1000, 2000, 5000] });
});

test('production assets load, both variables work, saved views restore, and PNG export succeeds', async ({
  page
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Clay', exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  // Exercise the visible model through the public UI, without importing development source modules.
  await page.mouse.click(720, 500);
  await expect(page.getByRole('status', { name: 'Voxel inspection result' })).toBeVisible();
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.55');
  await page.getByRole('slider', { name: /N–S cut/ }).fill('45');
  await page.getByRole('button', { name: 'Front view', exact: true }).click();
  await page.getByRole('button', { name: 'Share view', exact: true }).click();
  await expect(page).toHaveURL(/#view=/);
  const saved = JSON.parse(decodeURIComponent(new URL(page.url()).hash.slice(6)));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Permeability', { exact: true })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Opacity', exact: true })).toHaveValue('0.55');
  await expect(page.getByRole('slider', { name: /N–S cut/ })).toHaveValue('45');
  await page.getByRole('button', { name: 'Share view', exact: true }).click();
  const restored = JSON.parse(decodeURIComponent(new URL(page.url()).hash.slice(6)));
  expect(restored.settings).toEqual(saved.settings);
  for (const vector of ['position', 'target']) {
    saved.camera[vector].forEach((value, i) => expect(restored.camera[vector][i]).toBeCloseTo(value, 8));
  }
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('geological-view.png');
  const path = testInfo.outputPath('exported-view.png');
  await download.saveAs(path);
  const png = await readFile(path);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBe(1440);
  expect(png.readUInt32BE(20)).toBeGreaterThan(1000); // Export includes a provenance/legend footer.
  await page.getByLabel('Lithology', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Clay', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});
