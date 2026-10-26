import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });

test('section rasters preserve Z/Y/X order, elevation direction and endpoint cells', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { sectionLayout, rasterizeSection, inspectSection } = await import('/src/three/sections.ts');
    const metadata = {
      dimensions: { x: 3, y: 2, z: 2 },
      bounds: { x: { min: 100, max: 106 }, y: { min: 200, max: 208 }, z: { min: -10, max: 0 } }
    };
    const data = new Uint8Array([0, 1, 2, 10, 11, 12, 100, 101, 102, 110, 111, 112]);
    const variable = {
      type: 'continuous',
      dtype: 'uint8',
      range: { min: 0, max: 255 },
      colormap: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] }
      ]
    };
    const source = { data, variable, metadata };
    const style = { hiddenClasses: [], displayFault: true, valueWindow: [0, 255] };
    const ns = sectionLayout(metadata, 'NS', 0.5);
    const we = sectionLayout(metadata, 'WE', 0.5);
    const image = async (layout) =>
      [...(await rasterizeSection(source, layout, style, new AbortController().signal))].filter(
        (_, index) => index % 4 === 0
      );
    return {
      ns: await image(ns),
      we: await image(we),
      first: await image(sectionLayout(metadata, 'NS', 0)),
      last: await image(sectionLayout(metadata, 'NS', 1)),
      weFirst: await image(sectionLayout(metadata, 'WE', 0)),
      weLast: await image(sectionLayout(metadata, 'WE', 1)),
      selected: inspectSection(source, ns, style, 1, 0),
      corner: inspectSection(source, we, style, 100, 100),
      shape: { width: ns.physicalWidth, height: ns.physicalHeight, center: ns.center }
    };
  });
  expect(result.ns).toEqual([101, 111, 1, 11]);
  expect(result.we).toEqual([110, 111, 112, 10, 11, 12]);
  expect(result.first).toEqual([100, 110, 0, 10]);
  expect(result.last).toEqual([102, 112, 2, 12]);
  expect(result.weFirst).toEqual([100, 101, 102, 0, 1, 2]);
  expect(result.weLast).toEqual(result.we);
  expect(result.selected.indices).toEqual([1, 1, 1]);
  expect(result.selected.coordinates).toEqual([103, 206, -2.5]);
  expect(result.selected.value).toBe(111);
  expect(result.corner.indices).toEqual([2, 1, 0]);
  expect(result.shape).toEqual({ width: 8, height: 10, center: 103 });
});

test('sections distinguish valid zero, missing, filtered faults and unmapped classes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { sectionLayout, rasterizeSection, inspectSection } = await import('/src/three/sections.ts');
    const metadata = {
      dimensions: { x: 1, y: 4, z: 1 },
      bounds: {
        x: { min: 0, max: 1 },
        y: { min: 0, max: 4 },
        z: { min: 0, max: 1 }
      }
    };
    const source = {
      metadata,
      data: new Uint8Array([0, 4, 255, 7]),
      variable: {
        type: 'discrete',
        dtype: 'uint8',
        noDataValue: 255,
        colormap: [
          { value: 0, label: 'Valid zero', color: [30, 60, 90, 255] },
          { value: 4, label: 'Fault', role: 'fault', color: [255, 0, 0, 255] }
        ]
      }
    };
    const layout = sectionLayout(metadata, 'NS', 0);
    const style = { hiddenClasses: [], displayFault: false, valueWindow: [0, 1] };
    const raster = [...(await rasterizeSection(source, layout, style, new AbortController().signal))];
    const samples = [0, 1, 2, 3].map((x) => inspectSection(source, layout, style, x, 0));
    const hidden = [
      ...(await rasterizeSection(source, layout, { ...style, hiddenClasses: [0] }, new AbortController().signal))
    ];
    return { raster, samples, hidden };
  });
  expect(result.raster.slice(0, 4)).toEqual([30, 60, 90, 255]);
  expect(result.raster.slice(4)).toEqual(Array(12).fill(0));
  expect(result.samples.map((s) => s.status)).toEqual(['visible', 'filtered', 'missing', 'unmapped']);
  expect(result.samples.map((s) => s.value)).toEqual([0, 4, null, 7]);
  expect(result.hidden).toEqual(Array(16).fill(0));
});

test('continuous sections decode quantization, filter physical values and cancel large draws', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { sectionLayout, rasterizeSection, inspectSection } = await import('/src/three/sections.ts');
    const metadata = {
      dimensions: { x: 1, y: 4, z: 1 },
      bounds: {
        x: { min: 0, max: 1 },
        y: { min: 0, max: 4 },
        z: { min: 0, max: 1 }
      }
    };
    const variable = {
      type: 'continuous',
      dtype: 'uint8',
      range: { min: 10, max: 20 },
      encodingRange: { min: 0, max: 254 / 255 },
      noDataValue: 255,
      colormap: [
        { position: 0, color: [0, 0, 0, 255] },
        { position: 1, color: [255, 255, 255, 255] }
      ]
    };
    const source = { metadata, variable, data: new Uint8Array([0, 127, 254, 255]) };
    const layout = sectionLayout(metadata, 'NS', 0);
    const style = { hiddenClasses: [], displayFault: true, valueWindow: [14, 16] };
    const raster = [...(await rasterizeSection(source, layout, style, new AbortController().signal))];
    const samples = [0, 1, 2, 3].map((x) => inspectSection(source, layout, style, x, 0));
    const large = {
      ...source,
      metadata: { ...metadata, dimensions: { x: 1, y: 1024, z: 64 } },
      data: new Uint8Array(65536)
    };
    const controller = new AbortController();
    const pending = rasterizeSection(large, sectionLayout(large.metadata, 'NS', 0), style, controller.signal).catch(
      (error) => error.name
    );
    controller.abort();
    const float = {
      ...source,
      variable: { ...variable, dtype: 'float32', noDataValue: -999 },
      data: new Float32Array([15, 20, NaN, -999])
    };
    return {
      raster,
      samples,
      cancelled: await pending,
      float: [0, 1, 2, 3].map((x) => inspectSection(float, layout, style, x, 0))
    };
  });
  expect(result.raster.filter((_, i) => i % 4 === 3)).toEqual([0, 255, 0, 0]);
  expect(result.samples.map((s) => s.value)).toEqual([10, 15, 20, null]);
  expect(result.samples.map((s) => s.status)).toEqual(['filtered', 'visible', 'filtered', 'missing']);
  expect(result.float.map((s) => s.status)).toEqual(['visible', 'filtered', 'missing', 'missing']);
  expect(result.cancelled).toBe('AbortError');
});

test('2D sections synchronize controls, inspect with keyboard and preserve physical coordinates under exaggeration', async ({
  page
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const open = page.getByRole('button', { name: '2D sections', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '2D sections', exact: true });
  await expect(dialog).toBeVisible();
  const ns = dialog.getByRole('img', { name: 'N–S section cells' });
  await expect(ns).toHaveAttribute('aria-busy', 'false');
  await ns.focus();
  await ns.press('Home');
  const inspection = dialog.getByRole('status', { name: 'N–S section inspection' });
  await expect(inspection).toContainText('Cell (X, Y, Z): 43, 0, 39');
  const coordinates = await inspection.textContent();
  const before = await ns.boundingBox();
  await dialog.getByRole('slider', { name: 'Section exaggeration' }).fill('3');
  const after = await ns.boundingBox();
  expect(after.height / after.width).toBeCloseTo((3 * before.height) / before.width, 2);
  await expect(inspection).toHaveText(coordinates);
  await dialog.getByRole('slider', { name: 'N–S section position' }).fill('100');
  await expect(ns).toHaveAttribute('aria-busy', 'false');
  await ns.focus();
  await ns.press('End');
  await expect(inspection).toContainText('Cell (X, Y, Z): 63, 47, 0');
  await dialog.getByRole('slider', { name: 'W–E section position' }).fill('0');
  await page.screenshot({ path: 'test-results/sections-desktop.png' });
  await dialog.getByRole('combobox', { name: 'Section variable', exact: true }).selectOption('1');
  await expect(dialog.getByRole('heading', { name: 'N–S section · Permeability' })).toBeVisible();
  await expect(ns).toHaveAttribute('aria-busy', 'false');
  await ns.focus();
  await ns.press('Enter');
  await expect(dialog.getByRole('status', { name: 'N–S section inspection' })).toContainText('relative');
  await page.screenshot({ path: 'test-results/sections-continuous.png' });
  for (const [id, name] of [
    ['0', 'Lithology'],
    ['1', 'Permeability']
  ]) {
    await dialog.getByRole('combobox', { name: 'Section variable', exact: true }).selectOption(id);
    await expect(dialog.getByRole('heading', { name: `N–S section · ${name}` })).toBeVisible();
    await expect(ns).toHaveAttribute('aria-busy', 'false');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(page.getByRole('slider', { name: /N–S cut/ })).toHaveValue('100');
  await expect(page.getByRole('slider', { name: /W–E cut/ })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Vertical exaggeration' })).toHaveValue('3');
  expect(errors).toEqual([]);
});

test('mobile sections fit the viewport and support touch cell inspection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  await page.getByRole('button', { name: '2D sections', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '2D sections', exact: true });
  const canvas = dialog.getByRole('img', { name: 'N–S section cells' });
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await canvas.tap();
  await expect(dialog.getByRole('status', { name: 'N–S section inspection' })).toContainText('Center:');
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/sections-mobile.png' });
  await dialog.getByRole('button', { name: 'Close sections' }).click();
  await expect(dialog).toHaveCount(0);
});
