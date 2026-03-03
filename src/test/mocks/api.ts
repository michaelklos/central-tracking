import { vi } from 'vitest';
import type { CentralTrackingAPI } from '../../shared/types';

export function createMockApi(): CentralTrackingAPI {
  return {
    tasks: {
      getAll: vi.fn().mockResolvedValue([]),
      getById: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      reorder: vi.fn().mockResolvedValue(undefined),
    },
    timeEntries: {
      getByTask: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      getActiveEntry: vi.fn().mockResolvedValue(null),
      stopActive: vi.fn().mockResolvedValue(null),
      getTodayTotal: vi.fn().mockResolvedValue(0),
      getByDateRange: vi.fn().mockResolvedValue([]),
      getReport: vi.fn().mockResolvedValue([]),
    },
    comments: {
      getByTask: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    categories: {
      getAll: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue(undefined),
      assignToTask: vi.fn().mockResolvedValue(undefined),
    },
    plugins: {
      list: vi.fn().mockResolvedValue([]),
      sync: vi.fn().mockResolvedValue({ created: 0, updated: 0, errors: [] }),
    },
    window: {
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      getAlwaysOnTop: vi.fn().mockResolvedValue(false),
    },
    reports: {
      exportCsv: vi.fn().mockResolvedValue(null),
    },
  } as unknown as CentralTrackingAPI;
}
