export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface Viewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
}

export interface BrowserSettings {
  userAgent?: string;
  geo?: GeoLocation;
  viewport?: Viewport;
  locale?: string;
  timezone?: string;
  /** Slow-motion delay between actions, ms. */
  slowMoMs?: number;
}

export const DEVICE_PRESETS = {
  'desktop-1080p': { width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false },
  'desktop-720p': { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false },
  'iphone-13': { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true },
  'pixel-5': { width: 393, height: 851, deviceScaleFactor: 2.75, isMobile: true },
  'ipad-pro': { width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true },
} satisfies Record<string, Viewport>;

export type DevicePreset = keyof typeof DEVICE_PRESETS;

export function presetViewport(name: DevicePreset): Viewport {
  return { ...DEVICE_PRESETS[name] };
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function validateSettings(s: BrowserSettings): string[] {
  const errors: string[] = [];
  if (s.geo) {
    if (!isFiniteNumber(s.geo.latitude) || s.geo.latitude < -90 || s.geo.latitude > 90) {
      errors.push('geo.latitude must be in [-90, 90]');
    }
    if (!isFiniteNumber(s.geo.longitude) || s.geo.longitude < -180 || s.geo.longitude > 180) {
      errors.push('geo.longitude must be in [-180, 180]');
    }
    if (s.geo.accuracy !== undefined && (!isFiniteNumber(s.geo.accuracy) || s.geo.accuracy < 0)) {
      errors.push('geo.accuracy must be >= 0');
    }
  }
  if (s.viewport) {
    if (!Number.isInteger(s.viewport.width) || s.viewport.width <= 0) {
      errors.push('viewport.width must be a positive integer');
    }
    if (!Number.isInteger(s.viewport.height) || s.viewport.height <= 0) {
      errors.push('viewport.height must be a positive integer');
    }
  }
  if (s.slowMoMs !== undefined && (!isFiniteNumber(s.slowMoMs) || s.slowMoMs < 0)) {
    errors.push('slowMoMs must be >= 0');
  }
  if (s.userAgent !== undefined && typeof s.userAgent !== 'string') {
    errors.push('userAgent must be a string');
  }
  return errors;
}

/** Build a Playwright `use` config block from settings (returns object, not code). */
export function toPlaywrightUse(s: BrowserSettings): Record<string, unknown> {
  const use: Record<string, unknown> = {};
  if (s.userAgent) use.userAgent = s.userAgent;
  if (s.locale) use.locale = s.locale;
  if (s.timezone) use.timezoneId = s.timezone;
  if (s.viewport) {
    use.viewport = { width: s.viewport.width, height: s.viewport.height };
    if (s.viewport.deviceScaleFactor !== undefined) use.deviceScaleFactor = s.viewport.deviceScaleFactor;
    if (s.viewport.isMobile !== undefined) use.isMobile = s.viewport.isMobile;
  }
  if (s.geo) {
    use.geolocation = {
      latitude: s.geo.latitude,
      longitude: s.geo.longitude,
      ...(s.geo.accuracy !== undefined ? { accuracy: s.geo.accuracy } : {}),
    };
    use.permissions = ['geolocation'];
  }
  return use;
}
