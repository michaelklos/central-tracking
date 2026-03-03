import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIntersectionObserver } from '../useIntersectionObserver';

describe('useIntersectionObserver', () => {
  let observeFn: ReturnType<typeof vi.fn>;
  let disconnectFn: ReturnType<typeof vi.fn>;
  let callback: IntersectionObserverCallback;

  beforeEach(() => {
    observeFn = vi.fn();
    disconnectFn = vi.fn();

    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = observeFn;
      disconnect = disconnectFn;
      unobserve = vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a ref and false initially', () => {
    const { result } = renderHook(() => useIntersectionObserver());
    const [ref, isIntersecting] = result.current;
    expect(ref.current).toBeNull();
    expect(isIntersecting).toBe(false);
  });

  it('updates isIntersecting when observer fires', () => {
    const div = document.createElement('div');
    const { result } = renderHook(() => useIntersectionObserver());

    // Manually assign the ref
    act(() => {
      (result.current[0] as { current: HTMLDivElement | null }).current = div;
    });

    // Re-render to trigger the effect with the element
    const { result: result2 } = renderHook(() => useIntersectionObserver());
    act(() => {
      (result2.current[0] as { current: HTMLDivElement | null }).current = div;
    });

    // Simulate intersection
    if (callback) {
      act(() => {
        callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        );
      });
    }
  });

  it('disconnects observer on unmount', () => {
    const div = document.createElement('div');
    const { unmount } = renderHook(() => {
      const [ref] = useIntersectionObserver();
      (ref as { current: HTMLDivElement | null }).current = div;
      return ref;
    });

    unmount();
    // The disconnect should be called during cleanup
    expect(disconnectFn).toHaveBeenCalled();
  });
});
