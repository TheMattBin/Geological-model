import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('./');
  if (page.viewportSize().width <= 700) {
    await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await page.getByLabel('Display grid', { exact: true }).uncheck();
  if (page.viewportSize().width <= 700) {
    await page.getByRole('button', { name: 'Visualization controls', exact: true }).click();
  }
  await expect(page.getByLabel('Lithology', { exact: true })).toBeChecked();
}

async function modelSnapshot(page, name) {
  // Compare model pixels only. UI/axis fonts differ across Linux distributions.
  // Hiding the overlay does not change the canvas geometry or camera.
  await page.addStyleTag({ content: '[class*="appLayout"] { visibility: hidden !important; }' });
  await expect(page.locator('canvas')).toHaveScreenshot(name);
}

test('lithology without section cuts', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Display sections', { exact: true }).uncheck();
  await modelSnapshot(page, 'lithology.png');
});

test('lithology with section cuts', async ({ page }) => {
  await ready(page);
  await page.getByRole('slider', { name: /N–S cut/ }).fill('45');
  await page.getByRole('slider', { name: /W–E cut/ }).fill('65');
  await modelSnapshot(page, 'sections.png');
});

test('continuous permeability', async ({ page }) => {
  await ready(page);
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await modelSnapshot(page, 'permeability.png');
});

test('mobile model and accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  const slider = page.getByRole('slider', { name: /N–S cut/ });
  await expect(slider).toBeInViewport();
  await slider.fill('55');
  await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top view', exact: true })).not.toBeVisible();
  await modelSnapshot(page, 'mobile.png');
});
