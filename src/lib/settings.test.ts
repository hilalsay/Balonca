import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settings';

describe('subtitle position', () => {
  it('defaults near the bottom for old data without it', () => {
    expect(sanitizeSettings({ subSize: 30 }).subPos).toBe(DEFAULT_SETTINGS.subPos);
  });
  it('keeps a valid value and clamps a bad one to the video', () => {
    expect(sanitizeSettings({ subPos: 20 }).subPos).toBe(20);
    expect(sanitizeSettings({ subPos: 250 }).subPos).toBe(100);
    expect(sanitizeSettings({ subPos: -5 }).subPos).toBe(0);
    expect(sanitizeSettings({ subPos: 'top' }).subPos).toBe(DEFAULT_SETTINGS.subPos);
  });
});
