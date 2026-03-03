import React, { useEffect, useMemo } from 'react';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

interface TimeEntryScrollSentinelProps {
  onVisible: () => void;
}

export function TimeEntryScrollSentinel({ onVisible }: TimeEntryScrollSentinelProps) {
  const options = useMemo(() => ({ rootMargin: '200px' }), []);
  const [ref, isIntersecting] = useIntersectionObserver(options);

  useEffect(() => {
    if (isIntersecting) {
      onVisible();
    }
  }, [isIntersecting, onVisible]);

  return <div ref={ref} className="scroll-sentinel" />;
}
