import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { TimeEntry } from '../../shared/types';

interface TimerContextValue {
  /** Currently running time entry (null if timer is stopped) */
  activeEntry: TimeEntry | null;
  /** Elapsed seconds for the active entry (live-updating) */
  elapsedSeconds: number;
  /** Total elapsed seconds across all entries today */
  totalTodaySeconds: number;

  startTimer(taskId: string): Promise<void>;
  stopTimer(): Promise<void>;
  isRunningForTask(taskId: string): boolean;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimerContext(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimerContext must be used within a TimerProvider');
  return ctx;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalTodaySeconds, setTotalTodaySeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshActive = useCallback(async () => {
    const entry = await window.api.timeEntries.getActiveEntry();
    setActiveEntry(entry);
    return entry;
  }, []);

  // On mount, check for any running timer
  useEffect(() => {
    refreshActive();
  }, [refreshActive]);

  // Tick the elapsed counter every second while timer is active
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (activeEntry) {
      const startMs = new Date(activeEntry.startTime).getTime();
      const tick = () => {
        setElapsedSeconds(Math.floor((Date.now() - startMs) / 1000));
      };
      tick();
      intervalRef.current = setInterval(tick, 1000);
    } else {
      setElapsedSeconds(0);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [activeEntry]);

  const startTimer = useCallback(async (taskId: string) => {
    const entry = await window.api.timeEntries.create({ taskId });
    setActiveEntry(entry);
  }, []);

  const stopTimer = useCallback(async () => {
    await window.api.timeEntries.stopActive();
    setActiveEntry(null);
    setElapsedSeconds(0);
  }, []);

  const isRunningForTask = useCallback(
    (taskId: string) => activeEntry?.taskId === taskId,
    [activeEntry]
  );

  const value: TimerContextValue = {
    activeEntry,
    elapsedSeconds,
    totalTodaySeconds,
    startTimer,
    stopTimer,
    isRunningForTask,
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
