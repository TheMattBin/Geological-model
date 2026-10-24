import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveQualityController, getEffectivePixelRatio } from '../src/three/renderQuality.mjs';

test('starts with a balanced profile and caps the device pixel ratio', () => {
  const controller = new AdaptiveQualityController({ devicePixelRatio: 2 });

  assert.deepEqual(controller.profile, {
    tier: 'balanced',
    steps: 96,
    pixelRatio: 1.25
  });
  assert.equal(getEffectivePixelRatio(controller.profile, 2), 1.25);
});

test('uses the interaction profile while the camera is moving', () => {
  const controller = new AdaptiveQualityController({ devicePixelRatio: 1.5 });

  const profile = controller.update(16, true);

  assert.equal(profile.tier, 'interaction');
  assert.equal(profile.steps, 48);
  assert.equal(getEffectivePixelRatio(profile, 1.5), 1);
});

test('degrades one tier after a slow frame', () => {
  const controller = new AdaptiveQualityController({ devicePixelRatio: 1 });
  controller.update(16, false);

  assert.equal(controller.update(24, false).tier, 'interaction');
});

test('recovers one tier after sustained fast frames', () => {
  const controller = new AdaptiveQualityController({ devicePixelRatio: 1 });

  for (let frame = 0; frame < 60; frame += 1) {
    controller.update(12, false);
  }

  assert.equal(controller.profile.tier, 'high');
  assert.equal(controller.profile.steps, 160);
});

test('recovers using actual 60 Hz animation-frame intervals', () => {
  const controller = new AdaptiveQualityController({ initialTier: 'interaction' });
  for (let frame = 0; frame < 120; frame++) controller.update(1000 / 60, false);
  assert.equal(controller.profile.tier, 'high');
});
