import { describe, it, expect } from 'vitest';
import { shouldShowReportedFor, type PluginCapabilityMap } from '../usePluginCapabilities';

describe('shouldShowReportedFor', () => {
  const caps: PluginCapabilityMap = {
    ado: { enabled: true, tracksReported: true },
    quiet: { enabled: true, tracksReported: false },
  };

  it('returns true when pluginId is null (no external link)', () => {
    expect(shouldShowReportedFor(null, caps)).toBe(true);
  });

  it('returns true when pluginId is unknown to the map', () => {
    expect(shouldShowReportedFor('unknown', caps)).toBe(true);
  });

  it('returns true when the plugin tracks reported state', () => {
    expect(shouldShowReportedFor('ado', caps)).toBe(true);
  });

  it('returns false when the plugin does not track reported state', () => {
    expect(shouldShowReportedFor('quiet', caps)).toBe(false);
  });
});
