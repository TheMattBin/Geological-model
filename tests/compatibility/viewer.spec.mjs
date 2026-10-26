import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function ready(page) {
  await page.goto('./');
  // No capability-based skips: lack of WebGL2 must fail the supported-browser check.
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('img', { name: '3D geological volume', exact: true })).toHaveAccessibleDescription(
    /2D sections for keyboard cell inspection/
  );
}

async function scan(page, testInfo, name) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  await testInfo.attach(`accessibility-${name}`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json'
  });
  expect(results.violations).toEqual([]);
}

async function tabTo(page, target) {
  for (let step = 0; step < 80; step++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Cannot reach ${(await target.getAttribute('aria-label')) || (await target.textContent())} with Tab`);
}

test('both variables, sections, saved views and downloads work in the production build', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await ready(page);
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.55');
  await page.getByRole('button', { name: 'Share view', exact: true }).click();
  await expect(page).toHaveURL(/#view=/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Permeability', { exact: true })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Opacity', exact: true })).toHaveValue('0.55');
  await page.getByRole('button', { name: '2D sections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '2D sections', exact: true });
  const canvas = dialog.getByRole('img', { name: 'N–S section cells' });
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await scan(page, testInfo, 'continuous-sections');
  await dialog.getByRole('combobox', { name: 'Section variable' }).selectOption({ label: 'Lithology' });
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  for (const orientation of ['N–S', 'W–E']) {
    const position = dialog.getByRole('slider', { name: `${orientation} section position` });
    const cells = dialog.getByRole('img', { name: `${orientation} section cells` });
    for (const endpoint of ['0', '100']) {
      await position.fill(endpoint);
      await expect(cells).toHaveAttribute('aria-busy', 'false');
      expect(
        await cells.evaluate((element) => {
          const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
          return pixels.some((alpha, index) => index % 4 === 3 && alpha > 0);
        })
      ).toBe(true);
    }
  }
  await scan(page, testInfo, 'discrete-sections');
  for (const format of ['PNG', 'CSV']) {
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: `Export ${format} N–S`, exact: true }).click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    if (format === 'PNG') expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    else expect(bytes.toString()).toContain('dataset_fingerprint');
  }
  await page.screenshot({ path: testInfo.outputPath('sections.png') });
  expect(errors).toEqual([]);
});

test('keyboard controls, dialog focus and accessible names remain usable', async ({ page }, testInfo) => {
  await ready(page);
  await scan(page, testInfo, 'desktop');
  await page.screenshot({ path: testInfo.outputPath('desktop.png') });
  const clay = page.getByRole('button', { name: 'Clay', exact: true });
  await tabTo(page, clay);
  await page.keyboard.press('Space');
  await expect(clay).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Space');
  await expect(clay).toHaveAttribute('aria-pressed', 'true');
  const open = page.getByRole('button', { name: '2D sections', exact: true });
  await tabTo(page, open);
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '2D sections', exact: true });
  const close = dialog.getByRole('button', { name: 'Close sections', exact: true });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  const cells = dialog.getByRole('img', { name: 'N–S section cells' });
  await expect(cells).toHaveAttribute('aria-busy', 'false');
  await tabTo(page, cells);
  await expect(cells).toHaveAccessibleDescription(/arrow keys/);
  await page.keyboard.press('Home');
  const inspection = dialog.getByRole('status', { name: 'N–S section inspection' });
  await expect(inspection).toContainText('Center:');
  const first = await inspection.textContent();
  await page.keyboard.press('ArrowRight');
  await expect(inspection).not.toHaveText(first);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  const cut = page.getByRole('slider', { name: /N–S cut/ });
  await tabTo(page, cut);
  await page.keyboard.press('Home');
  await expect(cut).toHaveValue('0');
  await page.keyboard.press('End');
  await expect(cut).toHaveValue('100');
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await scan(page, testInfo, 'continuous-controls');
});

test('mobile panels expose only visible controls to keyboard navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const layers = page.getByRole('button', { name: 'Legend & explore', exact: true });
  const controls = page.getByRole('button', { name: 'Visualization controls', exact: true });
  await tabTo(page, layers);
  await page.keyboard.press('Enter');
  await expect(layers).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await scan(page, testInfo, 'mobile-layers');
  await page.keyboard.press('Tab');
  await expect(controls).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(layers).toHaveAttribute('aria-expanded', 'false');
  await expect(controls).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: '2D sections', exact: true })).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Lithology', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Permeability', exact: true })).toBeChecked();
  await scan(page, testInfo, 'mobile-controls');
  await page.screenshot({ path: testInfo.outputPath('mobile-controls.png') });
});

test('unavailable WebGL reports an accessible error and supports retry', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await page.goto('./');
  await expect(page.getByRole('alert')).toContainText('WebGL initialization failed');
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry loading', exact: true });
  await tabTo(page, retry);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('WebGL initialization failed');
  await expect(page.locator('canvas')).toHaveCount(0);
  await scan(page, testInfo, 'graphics-error');
});
