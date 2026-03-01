import type { CentralTrackingAPI } from '../shared/types';

declare global {
  interface Window {
    api: CentralTrackingAPI;
  }
}
