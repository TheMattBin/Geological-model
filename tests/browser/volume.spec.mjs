import { test, expect } from '@playwright/test';

async function loadRenderer(page) {
  await page.route('**/renderer-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="volume" style="width:400px;height:400px"></div>'
    })
  );
  await page.goto('/renderer-test');
  await page.evaluate(async () => {
    const { VolumeRenderer } = await import('/src/three/VolumeRenderer.ts');
    window.volume = new VolumeRenderer({ container: document.querySelector('#volume') });
    await window.volume.loadData('/data');
    window.volume.setGridVisible(false);
  });
}

test('the camera and exaggeration share the geological Z-up convention', async ({ page }) => {
  await loadRenderer(page);
  expect(await page.evaluate(() => window.volume.camera.up.toArray())).toEqual([0, 0, 1]);
  expect(
    await page.evaluate(() => {
      window.volume.setVerticalExaggeration(3);
      return window.volume.volumeMesh.scale.toArray();
    })
  ).toEqual([1, 1, 3]);
});

test('section cuts affect the correct axis in the rendered image', async ({ page }) => {
  await loadRenderer(page);
  const areas = await page.evaluate(() => {
    const r = window.volume;
    // A uniform rectangular fixture makes silhouette changes unambiguous.
    r.loadedVolume.textures.get(0).image.data.fill(0);
    r.loadedVolume.textures.get(0).needsUpdate = true;
    r.setCameraState({ position: [3, 0, 0], target: [0, 0, 0], zoom: 1 });
    const area = () => {
      r.updateCameraUniform();
      r.renderer.render(r.scene, r.camera);
      const gl = r.renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels.filter((value, index) => index % 4 === 3 && value > 200).length;
    };
    const full = area();
    r.setSection('WE', true, 0.5);
    const half = area();
    r.setSection('WE', false);
    r.setSection('NS', true, 0.5);
    return { full, half, depthCut: area() };
  });
  expect(areas.full).toBeGreaterThan(1000);
  expect(areas.half / areas.full).toBeCloseTo(0.5, 1);
  expect(areas.depthCut / areas.full).toBeGreaterThan(0.6);
});

test('the application loads both variables and has working visibility controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Clay', exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/lithology-sections.png' });
  await page.evaluate(async () => {
    const { VolumeRenderer } = await import('/src/three/VolumeRenderer.ts');
    window.calls = [];
    for (const method of ['setGridVisible', 'updateColormap', 'setSection', 'setIsosurface']) {
      const original = VolumeRenderer.prototype[method];
      VolumeRenderer.prototype[method] = function (...args) {
        window.calls.push({ method, args });
        return original.apply(this, args);
      };
    }
  });
  await page.getByLabel('Display grid', { exact: true }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.some((call) => call.method === 'setGridVisible' && call.args[0] === false))
    )
    .toBe(true);
  await page.getByLabel('Display fault', { exact: true }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.calls.some(
          (call) =>
            call.method === 'updateColormap' && call.args[1].some((entry) => entry.role === 'fault' && !entry.enabled)
        )
      )
    )
    .toBe(true);
  await page.getByRole('slider', { name: /N–S cut/ }).focus();
  await page.keyboard.press('End');
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.calls.some(
          (call) => call.method === 'setSection' && call.args[0] === 'NS' && call.args[1] && call.args[2] === 1
        )
      )
    )
    .toBe(true);
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByText('Permeability', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/permeability.png' });
  await page.getByLabel('Isosurface', { exact: true }).check();
  await expect
    .poll(() =>
      page.evaluate(() => window.calls.some((call) => call.method === 'setIsosurface' && call.args[0] === true))
    )
    .toBe(true);
  await page.screenshot({ path: 'test-results/isosurface.png' });
  await page.getByLabel('Lithology', { exact: true }).check();
  await page.getByLabel('Display fault', { exact: true }).check();
  await page.getByLabel('Display grid', { exact: true }).check();
  await page.getByLabel('Display sections', { exact: true }).uncheck();
  await page.getByRole('slider', { name: 'Vertical exaggeration' }).press('End');
  await expect(page.getByText('5x', { exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Vertical exaggeration' }).press('Home');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250); // Let CSS toggle transitions settle for the review artifact.
  await page.screenshot({ path: 'test-results/lithology.png' });
  expect(errors).toEqual([]);
});

test('missing voxels are transparent while class zero remains visible', async ({ page }) => {
  await loadRenderer(page);
  const alpha = await page.evaluate(() => {
    const r = window.volume;
    r.volumeMaterial.uniforms.uHasNoData.value = true;
    r.volumeMaterial.uniforms.uNoDataValue.value = 1;
    r.setCameraState({ position: [0, -3, 0], target: [0, 0, 0], zoom: 1 });
    return [255, 0].map((value) => {
      r.loadedVolume.textures.get(0).image.data.fill(value);
      r.loadedVolume.textures.get(0).needsUpdate = true;
      r.updateCameraUniform();
      r.renderer.render(r.scene, r.camera);
      const gl = r.renderer.getContext();
      const pixel = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3];
    });
  });
  expect(alpha).toEqual([0, 255]);
});

test('metadata drives the variable selector for a continuous-only dataset', async ({ page }) => {
  await page.route('**/data/metadata.json', async (route) => {
    const response = await route.fetch();
    const metadata = await response.json();
    metadata.variables = [{ ...metadata.variables[1], id: 7, name: 'Hydraulic conductivity' }];
    await route.fulfill({ json: metadata });
  });
  await page.goto('/');
  await expect(page.getByLabel('Hydraulic conductivity', { exact: true })).toBeChecked();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await expect(page.getByLabel('Isosurface', { exact: true })).toBeVisible();
});

test('continuous opacity stays stable across ray budgets', async ({ page }) => {
  await loadRenderer(page);
  const colors = await page.evaluate(() => {
    const r = window.volume;
    r.setActiveVariable(1);
    r.loadedVolume.textures.get(1).image.data.fill(128);
    r.loadedVolume.textures.get(1).needsUpdate = true;
    r.volumeMaterial.uniforms.uDensity.value = 0.01;
    r.setCameraState({ position: [0, -3, 0], target: [0, 0, 0], zoom: 1 });
    return [24, 192].map((steps) => {
      r.volumeMaterial.uniforms.uSteps.value = steps;
      r.updateCameraUniform();
      r.renderer.render(r.scene, r.camera);
      const gl = r.renderer.getContext();
      const pixel = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    });
  });
  expect(colors[0][3]).toBeGreaterThan(30);
  expect(colors[0][3]).toBeLessThan(230);
  for (let channel = 0; channel < 4; channel++) {
    expect(Math.abs(colors[0][channel] - colors[1][channel])).toBeLessThanOrEqual(2);
  }
});

test('truncated volume data is rejected before texture upload', async ({ page }) => {
  await loadRenderer(page);
  const error = await page.evaluate(async () => {
    const { createVolumeTexture } = await import('/src/three/dataLoader.ts');
    try {
      createVolumeTexture(new ArrayBuffer(3), { x: 2, y: 3, z: 4 });
    } catch (error) {
      return error.message;
    }
  });
  expect(error).toContain('expected 24 bytes, got 3');
});

test('disposing during a load prevents late scene and canvas creation', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const { VolumeRenderer } = await import('/src/three/VolumeRenderer.ts');
    const container = document.createElement('div');
    container.style.cssText = 'width:100px;height:100px';
    document.body.appendChild(container);
    const renderer = new VolumeRenderer({ container });
    const pending = renderer.loadData('/data');
    renderer.dispose();
    await pending;
    return {
      canvases: container.querySelectorAll('canvas').length,
      loaded: renderer.loadedVolume !== null,
      meshes: renderer.scene.children.length
    };
  });
  expect(result).toEqual({ canvases: 0, loaded: false, meshes: 0 });
});
