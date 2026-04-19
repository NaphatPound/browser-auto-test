import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  toPlaywrightUse,
  presetViewport,
  DEVICE_PRESETS,
} from '../src/settings.js';

describe('settings.validateSettings', () => {
  it('accepts an empty config', () => {
    expect(validateSettings({})).toEqual([]);
  });

  it('accepts a fully valid config', () => {
    expect(
      validateSettings({
        userAgent: 'Mozilla/5.0',
        geo: { latitude: 13.75, longitude: 100.5, accuracy: 10 },
        viewport: { width: 1280, height: 720 },
        slowMoMs: 50,
        locale: 'th-TH',
        timezone: 'Asia/Bangkok',
      }),
    ).toEqual([]);
  });

  it('rejects out-of-range latitude/longitude', () => {
    const errs = validateSettings({ geo: { latitude: 100, longitude: 200 } });
    expect(errs.length).toBe(2);
    expect(errs.some((e) => e.includes('latitude'))).toBe(true);
    expect(errs.some((e) => e.includes('longitude'))).toBe(true);
  });

  it('rejects negative or non-integer viewport dims', () => {
    const errs = validateSettings({ viewport: { width: -10, height: 1.5 } });
    expect(errs.length).toBe(2);
  });

  it('rejects negative slow-mo', () => {
    expect(validateSettings({ slowMoMs: -1 })).toContain('slowMoMs must be >= 0');
  });
});

describe('settings.toPlaywrightUse', () => {
  it('returns empty object when no settings', () => {
    expect(toPlaywrightUse({})).toEqual({});
  });

  it('maps every field properly', () => {
    const out = toPlaywrightUse({
      userAgent: 'UA/1.0',
      locale: 'en-US',
      timezone: 'UTC',
      viewport: { width: 800, height: 600, deviceScaleFactor: 2, isMobile: true },
      geo: { latitude: 1, longitude: 2, accuracy: 5 },
    });
    expect(out.userAgent).toBe('UA/1.0');
    expect(out.locale).toBe('en-US');
    expect(out.timezoneId).toBe('UTC');
    expect(out.viewport).toEqual({ width: 800, height: 600 });
    expect(out.deviceScaleFactor).toBe(2);
    expect(out.isMobile).toBe(true);
    expect(out.geolocation).toEqual({ latitude: 1, longitude: 2, accuracy: 5 });
    expect(out.permissions).toEqual(['geolocation']);
  });

  it('omits optional sub-fields when not provided', () => {
    const out = toPlaywrightUse({ geo: { latitude: 0, longitude: 0 } });
    expect(out.geolocation).toEqual({ latitude: 0, longitude: 0 });
  });
});

describe('settings.presetViewport', () => {
  it('returns a copy (not a reference) of the preset', () => {
    const v = presetViewport('iphone-13');
    v.width = 9999;
    expect(DEVICE_PRESETS['iphone-13'].width).toBe(390);
  });

  it('exposes mobile presets with isMobile=true', () => {
    expect(presetViewport('pixel-5').isMobile).toBe(true);
    expect(presetViewport('desktop-1080p').isMobile).toBe(false);
  });
});
