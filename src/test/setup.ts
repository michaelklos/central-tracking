import '@testing-library/jest-dom';
import { createMockApi } from './mocks/api';

// Set up window.api mock before each test
beforeEach(() => {
  (window as Record<string, unknown>).api = createMockApi();
});
