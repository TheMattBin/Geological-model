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
  const colors = await page.evaluate(async () => {
    const r = window.volume;
    await r.setActiveVariable(1);
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

test('voxel inspection uses original coordinates, skips hidden classes and respects cuts', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(() => {
    const r = window.volume;
    const texture = r.loadedVolume.textures.get(0);
    texture.image.data.fill(0);
    texture.needsUpdate = true;
    r.setCameraState({ position: [3, 0, 0], target: [0, 0, 0], zoom: 1 });
    const rect = r.renderer.domElement.getBoundingClientRect();
    const pick = () => r.inspect(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const full = pick();
    r.setSection('NS', true, 0.5);
    const clipped = pick();
    r.setVerticalExaggeration(3);
    const exaggerated = pick();
    r.updateColormap(
      0,
      r.metadata.variables[0].colormap.map((c) => ({ ...c, enabled: c.value !== 0 }))
    );
    const hidden = pick();
    r.setSection('NS', true, 0);
    return { full, clipped, exaggerated, hidden, empty: pick() };
  });
  expect(result.full.indices[0]).toBe(63);
  expect(result.full.coordinates[0]).toBeCloseTo(1190.625);
  expect(result.clipped.indices[0]).toBe(31);
  expect(result.clipped.coordinates[0]).toBeCloseTo(590.625);
  expect(result.exaggerated.coordinates).toEqual(result.clipped.coordinates);
  expect(result.full.label).toBe('Clay');
  expect(result.hidden).toBeNull();
  expect(result.empty).toBeNull();
});

test('continuous controls change pixels and histogram excludes missing values', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const r = window.volume;
    await r.setActiveVariable(1);
    const texture = r.loadedVolume.textures.get(1);
    texture.image.data.fill(128);
    texture.needsUpdate = true;
    r.setCameraState({ position: [0, -3, 0], target: [0, 0, 0], zoom: 1 });
    const alpha = () => {
      r.updateCameraUniform();
      r.renderer.render(r.scene, r.camera);
      const gl = r.renderer.getContext(),
        pixel = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3];
    };
    r.setContinuousStyle(1, [0, 1]);
    const visible = alpha();
    r.setContinuousStyle(0, [0, 1]);
    const transparent = alpha();
    r.setContinuousStyle(1, [0.7, 1]);
    const excluded = alpha();
    const { buildHistogram } = await import('/src/three/volumeAnalysis.ts');
    const histogram = buildHistogram(new Uint8Array([0, 127, 254, 255]), {
      ...r.metadata.variables[1],
      range: { min: 10, max: 20 },
      encodingRange: { min: 0, max: 254 / 255 },
      noDataValue: 255
    });
    return { visible, transparent, excluded, histogram };
  });
  expect(result.visible).toBeGreaterThan(200);
  expect(result.transparent).toBe(0);
  expect(result.excluded).toBe(0);
  expect(result.histogram.valid).toBe(3);
  expect(result.histogram.missing).toBe(1);
  expect(result.histogram.bins[0]).toBe(1);
  expect(result.histogram.bins[16]).toBe(1);
  expect(result.histogram.bins[31]).toBe(1);
});

test('variables load on demand, cached revisits avoid downloads, and stale requests cannot win', async ({ page }) => {
  const downloads = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.raw')) downloads.push(request.url());
  });
  await loadRenderer(page);
  expect(downloads).toHaveLength(1);
  expect(downloads[0]).toContain('lithology.raw');
  await page.evaluate(async () => {
    await window.volume.setActiveVariable(1);
    await window.volume.setActiveVariable(0);
    await window.volume.setActiveVariable(1);
  });
  expect(downloads).toHaveLength(2);
  const active = await page.evaluate(async () => {
    const r = window.volume;
    // Evict one entry to force a fetch, then supersede it with a cached selection.
    r.loadedVolume.textures.get(0).dispose();
    r.loadedVolume.textures.delete(0);
    r.loadedVolume.transferFunctions.get(0).dispose();
    r.loadedVolume.transferFunctions.delete(0);
    const pending = r.setActiveVariable(0);
    await r.setActiveVariable(1);
    await pending;
    return r.getState().activeVariableId;
  });
  expect(active).toBe(1);
});

test('metadata rejects malformed bounds, palette, encodings and device-sized volumes', async ({ page }) => {
  await loadRenderer(page);
  const failures = await page.evaluate(async () => {
    const { parseMetadata } = await import('/src/three/metadata.ts');
    const { checkVolumeLimits } = await import('/src/three/dataLoader.ts');
    const original = window.volume.getMetadata();
    const mutations = [
      (m) => {
        m.schemaVersion = 42;
      },
      (m) => {
        m.bounds.x.max = m.bounds.x.min;
      },
      (m) => {
        m.variables[0].colormap[0].color[2] = 300;
      },
      (m) => {
        m.variables[0].noDataValue = 0;
      },
      (m) => {
        m.variables[1].encodingRange = { min: 1, max: 0 };
      },
      (m) => {
        m.variables[1].range = { min: 3, max: -1 };
      },
      (m) => {
        m.variables[1].colormap[1].position = m.variables[1].colormap[0].position;
      },
      (m) => {
        m.variables[0].file = '../secret.raw';
      }
    ];
    const errors = mutations.map((mutate) => {
      const m = structuredClone(original);
      mutate(m);
      try {
        parseMetadata(m);
        return null;
      } catch (error) {
        return error.message;
      }
    });
    try {
      checkVolumeLimits(original, 32);
    } catch (error) {
      errors.push(error.message);
    }
    try {
      checkVolumeLimits(original, 2048, 1024);
    } catch (error) {
      errors.push(error.message);
    }
    return errors;
  });
  expect(failures).toHaveLength(10);
  expect(failures.every((error) => typeof error === 'string' && error.length > 15)).toBe(true);
});

test('saved views restore filters, classes, visibility and camera; exported PNG contains a footer', async ({
  page
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Share view' })).toBeEnabled();
  await page.getByRole('button', { name: 'Clay', exact: true }).click();
  await page.getByLabel('Display grid', { exact: true }).uncheck();
  await page.getByLabel('Display fault', { exact: true }).uncheck();
  await page.getByLabel('Permeability', { exact: true }).check();
  await page.getByRole('slider', { name: 'Opacity', exact: true }).fill('0.55');
  await page.getByRole('slider', { name: /Minimum value/ }).fill('0.2');
  await page.getByRole('slider', { name: /Maximum value/ }).fill('0.9');
  await page.getByRole('slider', { name: /N–S cut/ }).fill('45');
  await page.getByRole('slider', { name: 'Vertical exaggeration' }).fill('3');
  await page.getByLabel('Isosurface', { exact: true }).check();
  await page.getByRole('slider', { name: /Isosurface value/ }).fill('0.6');
  await page.getByRole('button', { name: 'Front view' }).click();
  await page.getByRole('button', { name: 'Share view' }).click();
  await expect(page).toHaveURL(/#view=/);
  const saved = new URL(page.url()).hash;
  const restoredDownloads = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.raw')) restoredDownloads.push(new URL(request.url()).pathname);
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Share view' })).toBeEnabled();
  await expect(page.getByLabel('Permeability', { exact: true })).toBeChecked();
  await expect(page.getByRole('slider', { name: 'Opacity', exact: true })).toHaveValue('0.55');
  await expect(page.getByRole('slider', { name: /Minimum value/ })).toHaveValue('0.2');
  await expect(page.getByRole('slider', { name: /Maximum value/ })).toHaveValue('0.9');
  await expect(page.getByRole('slider', { name: /Isosurface value/ })).toHaveValue('0.6');
  await expect(page.getByRole('slider', { name: /N–S cut/ })).toHaveValue('45');
  await expect(page.getByRole('slider', { name: 'Vertical exaggeration' })).toHaveValue('3');
  await expect(page.getByLabel('Display grid', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Share view' }).click();
  const before = JSON.parse(decodeURIComponent(saved.slice(6)));
  const after = JSON.parse(decodeURIComponent(new URL(page.url()).hash.slice(6)));
  expect(restoredDownloads).toEqual(['/data/permeability.raw']);
  expect(after.datasetFingerprint).toBe(before.datasetFingerprint);
  expect(after.settings).toEqual(before.settings);
  expect(after.display).toEqual(before.display);
  for (let i = 0; i < 3; i++) {
    expect(after.camera.position[i]).toBeCloseTo(before.camera.position[i], 10);
    expect(after.camera.target[i]).toBeCloseTo(before.camera.target[i], 10);
  }
  expect(after.camera.zoom).toBe(before.camera.zoom);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('geological-view.png');
  await download.saveAs('test-results/exported-view.png');
  await page.getByLabel('Lithology', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Clay', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByLabel('Display fault', { exact: true })).not.toBeChecked();
  expect(errors).toEqual([]);
});

test('inspection and distribution are available in the application', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reset camera' })).toBeEnabled();
  await page.mouse.click(720, 500);
  await expect(page.getByRole('status', { name: 'Voxel inspection result' })).toBeVisible();
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/exploration.png' });
});

test('malformed or incompatible saved URLs are ignored safely', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const { readSavedView, writeSavedView, defaultView } = await import('/src/three/savedView.ts');
    const valid = {
      version: 2,
      datasetFingerprint: 'a'.repeat(64),
      dataset: './data',
      settings: { ...defaultView, variableId: 0 },
      display: { enableGrid: true, displayLegend: true, displayFault: true },
      camera: { position: [1, 1, 1], target: [0, 0, 0], zoom: 1 }
    };
    const variants = [
      null,
      { ...valid, version: 1 },
      { ...valid, dataset: '/other' },
      { ...valid, camera: { ...valid.camera, zoom: 0 } },
      { ...valid, settings: { ...valid.settings, valueWindow: [1, 0] } }
    ];
    return {
      roundTrip: readSavedView(writeSavedView(valid), './data'),
      rejected: variants.map((v) => readSavedView(writeSavedView(v), './data')),
      malformed: readSavedView('#view=%INVALID', './data')
    };
  });
  expect(result.roundTrip.settings.variableId).toBe(0);
  expect(result.rejected).toEqual([null, null, null, null, null]);
  expect(result.malformed).toBeNull();
});

test('mobile users can reach visualization controls and camera presets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Visualization controls', exact: true }).click();
  await expect(page.getByLabel('Lithology', { exact: true })).toBeChecked();
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('slider', { name: 'Opacity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  await page.getByRole('button', { name: 'Top view', exact: true }).click();
  await page.getByRole('button', { name: 'Legend & explore', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Top view', exact: true })).not.toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-model.png' });
});

test('small float measurements are filtered in physical units without being mistaken for missing', async ({ page }) => {
  await loadRenderer(page);
  const metadata = {
    schemaVersion: 1,
    dimensions: { x: 2, y: 2, z: 2 },
    bounds: { x: { min: 0, max: 2 }, y: { min: 0, max: 2 }, z: { min: 0, max: 2 } },
    variables: [
      {
        id: 7,
        name: 'Small measurements',
        file: 'values.raw',
        dtype: 'float32',
        type: 'continuous',
        range: { min: 0, max: 1e-10 },
        noDataValue: 0,
        colormap: [
          { position: 0, color: [30, 160, 200, 255] },
          { position: 1, color: [220, 220, 20, 255] }
        ]
      }
    ]
  };
  await page.route('**/float/metadata.json', (route) => route.fulfill({ json: metadata }));
  await page.route('**/float/values.raw', (route) =>
    route.fulfill({
      body: Buffer.from(new Float32Array(8).fill(1e-11).buffer),
      contentType: 'application/octet-stream'
    })
  );
  const result = await page.evaluate(async () => {
    const r = window.volume;
    await r.loadData('/float');
    r.setContinuousStyle(1, [0.5e-11, 2e-11]);
    r.setCameraState({ position: [0, -3, 0], target: [0, 0, 0], zoom: 1 });
    r.updateCameraUniform();
    r.renderer.render(r.scene, r.camera);
    const gl = r.renderer.getContext(),
      pixel = new Uint8Array(4);
    gl.readPixels(gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const { isMissing } = await import('/src/three/volumeAnalysis.ts');
    return {
      alpha: pixel[3],
      histogram: await r.getHistogram(),
      roundedSentinel: isMissing(Math.fround(0.1), { dtype: 'float32', noDataValue: 0.1 })
    };
  });
  expect(result.alpha).toBeGreaterThan(20);
  expect(result.histogram.valid).toBe(8);
  expect(result.histogram.missing).toBe(0);
  expect(result.roundedSentinel).toBe(true);
});

test('failed variable loads can be retried without leaving a stale selection', async ({ page }) => {
  let fail = true;
  await page.route('**/data/permeability.raw', async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, body: 'Unavailable' });
    } else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Share view' })).toBeEnabled();
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByRole('button', { name: 'Share view' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /valid voxels/ })).toBeVisible();
  await expect(page.getByLabel('Permeability', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Share view' })).toBeEnabled();
});

test('a lost WebGL context recovers the current view without user interaction', async ({ page }) => {
  await loadRenderer(page);
  await page.evaluate(() => {
    const r = window.volume;
    r.setVerticalExaggeration(2);
    r.setSection('NS', true, 0.42);
    window.cameraBefore = r.getCameraState();
    window.loss = r.renderer.getContext().getExtension('WEBGL_lose_context');
    window.loss.loseContext();
  });
  await expect.poll(() => page.evaluate(() => window.volume.contextLost)).toBe(true);
  expect(await page.evaluate(() => window.volume.animationFrameId)).toBeNull();
  await page.evaluate(() => window.loss.restoreContext());
  await expect.poll(() => page.evaluate(() => window.volume.contextLost)).toBe(false);
  await expect.poll(() => page.evaluate(() => window.volume.renderer.info.render.calls)).toBeGreaterThan(0);
  const result = await page.evaluate(() => {
    const r = window.volume;
    r.updateCameraUniform();
    r.renderer.render(r.scene, r.camera);
    const gl = r.renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return {
      visible: pixels.some((v, i) => i % 4 === 3 && v > 50),
      camera: r.getCameraState(),
      before: window.cameraBefore,
      state: r.getState()
    };
  });
  expect(result.visible).toBe(true);
  for (const key of ['position', 'target'])
    result.before[key].forEach((value, index) => expect(result.camera[key][index]).toBeCloseTo(value, 10));
  expect(result.camera.zoom).toBe(result.before.zoom);
  expect(result.state.verticalExaggeration).toBe(2);
  expect(result.state.sections.NS.position).toBe(0.42);
  await page.screenshot({ path: 'test-results/context-restored.png' });
});

test('context loss is visible in the application and offers a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reset camera' })).toBeEnabled();
  await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    window.loss = gl.getExtension('WEBGL_lose_context');
    window.loss.loseContext();
  });
  await expect(page.getByText('Graphics connection lost. Waiting for recovery…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload viewer' })).toBeVisible();
  await page.screenshot({ path: 'test-results/context-loss-message.png' });
  await page.evaluate(() => window.loss.restoreContext());
  await expect(page.getByText('Graphics connection lost. Waiting for recovery…')).toHaveCount(0);
  await page.mouse.click(720, 500);
  await expect(page.getByRole('status', { name: 'Voxel inspection result' })).toBeVisible();
});

test('histogram workers preserve data, yield between chunks, and cancel cleanly', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const { computeHistogram } = await import('/src/three/histogram.ts');
    const data = new Uint8Array(4 * 1024 * 1024).fill(254);
    data[0] = 0;
    data[1] = 255;
    const variable = {
      type: 'continuous',
      dtype: 'uint8',
      range: { min: 10, max: 20 },
      encodingRange: { min: 0, max: 254 / 255 },
      noDataValue: 255
    };
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    const histogram = await computeHistogram(data, variable, new AbortController().signal);
    clearInterval(timer);
    const abort = new AbortController();
    const cancelled = computeHistogram(data, variable, abort.signal).catch((error) => error.name);
    abort.abort();
    const float = await computeHistogram(
      new Float32Array([0, 1, 2, NaN, -999]),
      { type: 'continuous', dtype: 'float32', range: { min: 0, max: 2 }, noDataValue: -999 },
      new AbortController().signal
    );
    return {
      histogram,
      ticks,
      cancelled: await cancelled,
      byteLength: data.byteLength,
      first: [...data.slice(0, 3)],
      float
    };
  });
  expect(result.histogram.valid).toBe(4 * 1024 * 1024 - 1);
  expect(result.histogram.missing).toBe(1);
  expect(result.histogram.bins[0]).toBe(1);
  expect(result.histogram.bins[31]).toBe(4 * 1024 * 1024 - 2);
  expect(result.ticks).toBeGreaterThan(0);
  expect(result.cancelled).toBe('AbortError');
  expect(result.byteLength).toBe(4 * 1024 * 1024);
  expect(result.first).toEqual([0, 255, 254]);
  expect(result.float.valid).toBe(3);
  expect(result.float.missing).toBe(2);
});

test('saved views reject a replaced dataset and legacy links', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Permeability', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Share view', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Share view', exact: true }).click();
  const original = page.url();
  await page.route('**/data/metadata.json', async (route) => {
    const response = await route.fetch();
    const metadata = await response.json();
    metadata.description = 'A different survey at the same path';
    await route.fulfill({ json: metadata });
  });
  await page.reload();
  await expect(
    page.getByText('This dataset has changed or cannot be verified. Showing the default view.')
  ).toBeVisible();
  await expect(page.getByLabel('Lithology', { exact: true })).toBeChecked();
  await page.screenshot({ path: 'test-results/dataset-changed-message.png' });
  const legacy = JSON.parse(decodeURIComponent(new URL(original).hash.slice(6)));
  legacy.version = 1;
  await page.goto('/#view=' + encodeURIComponent(JSON.stringify(legacy)));
  await page.reload();
  await expect(
    page.getByText('This saved link is invalid or predates dataset verification. Showing the default view.')
  ).toBeVisible();
});

test('fingerprints ignore key order and raw corruption is rejected', async ({ page }) => {
  await loadRenderer(page);
  const result = await page.evaluate(async () => {
    const { fingerprintMetadata } = await import('/src/three/datasetIdentity.ts');
    const metadata = window.volume.getMetadata();
    const reordered = Object.fromEntries(Object.entries(metadata).reverse());
    const changed = structuredClone(metadata);
    changed.variables[0].sha256 = '0'.repeat(64);
    const legacy = structuredClone(metadata);
    delete legacy.variables[0].sha256;
    return {
      original: metadata.datasetFingerprint,
      reordered: await fingerprintMetadata(reordered),
      changed: await fingerprintMetadata(changed),
      legacy: (await fingerprintMetadata(legacy)) ?? null
    };
  });
  expect(result.reordered).toBe(result.original);
  expect(result.changed).not.toBe(result.original);
  expect(result.legacy).toBeNull();
  await page.route('**/data/lithology.raw', async (route) => {
    const response = await route.fetch();
    const bytes = await response.body();
    bytes[0] ^= 1;
    await route.fulfill({ body: bytes });
  });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('checksum mismatch');
});
