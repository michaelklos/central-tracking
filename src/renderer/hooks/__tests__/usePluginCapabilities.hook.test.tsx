import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { usePluginCapabilities } from '../usePluginCapabilities';

function Probe(): JSX.Element {
  const caps = usePluginCapabilities();
  return <pre data-testid="caps">{JSON.stringify(caps)}</pre>;
}

interface ApiStub {
  plugins: {
    getCapabilities: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
  };
  onDataChanged: ReturnType<typeof vi.fn>;
}

function installApi(stub: ApiStub): () => void {
  const w = window as unknown as { api?: unknown };
  const original = w.api;
  w.api = stub as unknown;
  return () => {
    w.api = original;
  };
}

describe('usePluginCapabilities (hook)', () => {
  let dataChangedCb: (() => void) | null;

  beforeEach(() => {
    dataChangedCb = null;
  });

  it('reads capabilities from getCapabilities and applies the manifest default', async () => {
    const api: ApiStub = {
      plugins: {
        getCapabilities: vi.fn().mockResolvedValue([
          { id: 'a', enabled: true,  capabilities: { tracksReported: false } },
          { id: 'b', enabled: false, capabilities: {} }, // default true
          { id: 'c', enabled: true,  capabilities: { tracksReported: true } },
        ]),
        getConfig: vi.fn().mockResolvedValue(null), // no per-plugin override
      },
      onDataChanged: vi.fn((cb: () => void) => { dataChangedCb = cb; return () => { dataChangedCb = null; }; }),
    };
    const restore = installApi(api);
    try {
      render(<Probe />);
      await waitFor(() => {
        const text = screen.getByTestId('caps').textContent ?? '';
        expect(text).not.toBe('{}');
      });
      const map = JSON.parse(screen.getByTestId('caps').textContent ?? '{}');
      expect(map.a).toEqual({ enabled: true, tracksReported: false });
      expect(map.b).toEqual({ enabled: false, tracksReported: true });
      expect(map.c).toEqual({ enabled: true, tracksReported: true });
    } finally {
      restore();
    }
  });

  it('user-set config key overrides the manifest default', async () => {
    const api: ApiStub = {
      plugins: {
        getCapabilities: vi.fn().mockResolvedValue([
          // Manifest says tracksReported=true; user-set 'false' must win.
          { id: 'ado', enabled: true, capabilities: { tracksReported: true } },
        ]),
        getConfig: vi.fn().mockImplementation(async (id: string, key: string) => {
          if (id === 'ado' && key === 'tracks-reported') return 'false';
          return null;
        }),
      },
      onDataChanged: vi.fn((cb: () => void) => { dataChangedCb = cb; return () => { dataChangedCb = null; }; }),
    };
    const restore = installApi(api);
    try {
      render(<Probe />);
      await waitFor(() => {
        const map = JSON.parse(screen.getByTestId('caps').textContent ?? '{}');
        expect(map.ado).toEqual({ enabled: true, tracksReported: false });
      });
    } finally {
      restore();
    }
  });

  it('refreshes on the data-changed signal', async () => {
    let call = 0;
    const api: ApiStub = {
      plugins: {
        getCapabilities: vi.fn().mockImplementation(async () => {
          call += 1;
          return call === 1
            ? [{ id: 'x', enabled: false, capabilities: {} }]
            : [{ id: 'x', enabled: true,  capabilities: { tracksReported: false } }];
        }),
        getConfig: vi.fn().mockResolvedValue(null),
      },
      onDataChanged: vi.fn((cb: () => void) => { dataChangedCb = cb; return () => { dataChangedCb = null; }; }),
    };
    const restore = installApi(api);
    try {
      render(<Probe />);
      await waitFor(() => {
        const map = JSON.parse(screen.getByTestId('caps').textContent ?? '{}');
        expect(map.x).toEqual({ enabled: false, tracksReported: true });
      });
      // Trigger refresh and let the second batch land.
      await act(async () => {
        dataChangedCb?.();
      });
      await waitFor(() => {
        const map = JSON.parse(screen.getByTestId('caps').textContent ?? '{}');
        expect(map.x).toEqual({ enabled: true, tracksReported: false });
      });
    } finally {
      restore();
    }
  });

  it('swallows IPC errors and keeps the last good map', async () => {
    const api: ApiStub = {
      plugins: {
        getCapabilities: vi.fn().mockRejectedValue(new Error('boom')),
        getConfig: vi.fn().mockResolvedValue(null),
      },
      onDataChanged: vi.fn((cb: () => void) => { dataChangedCb = cb; return () => { dataChangedCb = null; }; }),
    };
    const restore = installApi(api);
    try {
      render(<Probe />);
      // No throw, no unhandled rejection — map stays empty.
      await waitFor(() => {
        expect(api.plugins.getCapabilities).toHaveBeenCalled();
      });
      expect(screen.getByTestId('caps').textContent).toBe('{}');
    } finally {
      restore();
    }
  });
});
