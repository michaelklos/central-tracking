import { describe, it, expect } from 'vitest';
import { shouldShowReportedFor, resolveTracksReported, type PluginCapabilityMap } from '../usePluginCapabilities';

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

/**
 * Review finding 7: the settings page resolved this flag on its own and
 * ignored the manifest, so a plugin declaring `tracksReported: false` showed
 * its toggle on while the task list hid the badges. Both surfaces now call
 * this one function.
 */
describe('resolveTracksReported', () => {
  it('falls back to true when neither the manifest nor the user says anything', () => {
    expect(resolveTracksReported(undefined, null)).toBe(true);
  });

  it('honours a manifest default of false when there is no override', () => {
    // The case the two surfaces used to disagree on.
    expect(resolveTracksReported(false, null)).toBe(false);
  });

  it('lets a user override win over the manifest in both directions', () => {
    expect(resolveTracksReported(true, 'false')).toBe(false);
    expect(resolveTracksReported(false, 'true')).toBe(true);
  });

  it('treats any non-"false" override string as true', () => {
    expect(resolveTracksReported(false, 'yes')).toBe(true);
  });

  it('ignores a non-boolean manifest value rather than coercing it', () => {
    // Capabilities are an untyped map; a plugin writing a string must not
    // make this resolve to false via truthiness rules.
    expect(resolveTracksReported('false', null)).toBe(true);
  });
});
