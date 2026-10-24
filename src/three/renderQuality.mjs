export const QUALITY_PROFILES = Object.freeze([
  Object.freeze({ tier: 'interaction', steps: 48, pixelRatio: 1 }),
  Object.freeze({ tier: 'balanced', steps: 96, pixelRatio: 1.25 }),
  Object.freeze({ tier: 'high', steps: 160, pixelRatio: 1.5 })
]);

const SLOW_FRAME_MS = 20;
const FAST_FRAME_MS = 18;
const RECOVERY_FRAMES = 60;

export function getEffectivePixelRatio(profile, devicePixelRatio) {
  return Math.min(Math.max(devicePixelRatio || 1, 1), profile.pixelRatio);
}

export class AdaptiveQualityController {
  constructor({ devicePixelRatio = 1, initialTier = 'balanced' } = {}) {
    this.devicePixelRatio = devicePixelRatio;
    this.index = QUALITY_PROFILES.findIndex(({ tier }) => tier === initialTier);
    this.index = this.index < 0 ? 1 : this.index;
    this.stableFrames = 0;
    this.profile = QUALITY_PROFILES[this.index];
  }

  update(frameTimeMs, interacting = false) {
    if (interacting) {
      this.index = 0;
      this.stableFrames = 0;
    } else if (frameTimeMs > SLOW_FRAME_MS) {
      this.index = Math.max(this.index - 1, 0);
      this.stableFrames = 0;
    } else if (frameTimeMs < FAST_FRAME_MS) {
      this.stableFrames += 1;
      if (this.stableFrames >= RECOVERY_FRAMES) {
        this.index = Math.min(this.index + 1, QUALITY_PROFILES.length - 1);
        this.stableFrames = 0;
      }
    } else {
      this.stableFrames = 0;
    }

    this.profile = QUALITY_PROFILES[this.index];
    return this.profile;
  }

  get pixelRatio() {
    return getEffectivePixelRatio(this.profile, this.devicePixelRatio);
  }
}
