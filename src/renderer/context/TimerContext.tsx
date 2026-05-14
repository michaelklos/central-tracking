import React, { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import type { TimeEntry } from '../../shared/types';
import { useTaskContext } from './TaskContext';

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
  refreshTodayTotal(): Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

export function useTimerContext(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimerContext must be used within a TimerProvider');
  return ctx;
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { refreshActiveTasks } = useTaskContext();
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [totalTodaySeconds, setTotalTodaySeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshActive = useCallback(async () => {
    const entry = await window.api.timeEntries.getActiveEntry();
    setActiveEntry(entry);
    return entry;
  }, []);

  const refreshTodayTotal = useCallback(async () => {
    const total = await window.api.timeEntries.getTodayTotal();
    setTotalTodaySeconds(total);
  }, []);

  // On mount, check for any running timer and load today total
  useEffect(() => {
    refreshActive();
    refreshTodayTotal();
  }, [refreshActive, refreshTodayTotal]);

  // Refresh when CLI or other external process modifies data
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.api.onDataChanged(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        refreshActive();
        refreshTodayTotal();
      }, 100);
    });
    return () => {
      clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [refreshActive, refreshTodayTotal]);

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
    await Promise.all([refreshTodayTotal(), refreshActiveTasks()]);
  }, [refreshTodayTotal, refreshActiveTasks]);

  const stopTimer = useCallback(async () => {
    await window.api.timeEntries.stopActive();
    setActiveEntry(null);
    setElapsedSeconds(0);
    await Promise.all([refreshTodayTotal(), refreshActiveTasks()]);
  }, [refreshTodayTotal, refreshActiveTasks]);

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
    refreshTodayTotal,
  };

  return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}
