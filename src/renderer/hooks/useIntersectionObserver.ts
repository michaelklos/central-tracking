import { useRef, useState, useEffect, type RefObject } from 'react';

/**
 * `options.threshold` may be `number | number[]`. A fresh array literal from
 * the caller would be reference-different each render, tearing down and
 * rebuilding the observer every time. We serialize threshold (along with
 * root/rootMargin) so the effect only re-runs on value changes.
 */
function thresholdKey(t: IntersectionObserverInit['threshold']): string {
  if (t == null) return '';
  if (Array.isArray(t)) return t.join(',');
  return String(t);
}

export function useIntersectionObserver(
  options?: IntersectionObserverInit
): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const tKey = thresholdKey(options?.threshold);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, optionsRef.current);

    observer.observe(el);
    return () => observer.disconnect();
  }, [options?.root, options?.rootMargin, tKey]);

  return [ref, isIntersecting];
}
