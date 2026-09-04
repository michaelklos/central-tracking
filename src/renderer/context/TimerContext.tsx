import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type { TimeEntry } from '../../shared/types';
import { useTaskContext } from './TaskContext';

interface TimerContextValue {
  /** Currently running time entry (null if timer is stopped) */
  activeEntry: TimeEntry | null;
  /** Total elapsed seconds across all entries today */
  totalTodaySeconds: number;

  startTimer(taskId: string): Promise<void>;
  stopTimer(): Promise<void>;
  isRunningForTask(taskId: string): boolean;
  refreshTodayTotal(): Promise<void>;
  /**
   * Re-fetch the active entry from the database. Call this after editing the
   * running entry directly (e.g. nudging its start time) so the live
   * elapsed counter reanchors instead of ticking off the stale start.
   */
  refreshActiveEntry(): Promise<void>;
}

const TimerContext = createContext<TimerContextValue | null>(null);

/**
 * The live elapsed counter lives in its own context. It changes every second
 * while a timer runs; keeping it out of `TimerContextValue` means only the
 * few components that display a ticking number re-render on each tick,
 * instead of every consumer (the whole task list among them).
 */
const ElapsedSecondsContext = createContext<number>(0);

export function useTimerContext(): TimerContextValue {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error('useTimerContext must be used within a TimerProvider');
  return ctx;
}

/** Elapsed seconds for the active entry (live-updating, 0 when stopped). */
export function useElapsedSeconds(): number {
  return useContext(ElapsedSecondsContext);
}

export function TimerProvider({ children }: { children: ReactNode }) {
  const { refreshActiveTasks, updateTask } = useTaskContext();
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
    // Tracking time on a to-do means it is in progress. Read the status back
    // rather than looking it up in the loaded pages — the task may be past
    // the first page — and route the change through updateTask, never a
    // direct write: that is what runs the ADO transition check and sets
    // state_dirty, so the change is pushed instead of being reverted by the
    // next pull.
    const task = await window.api.tasks.getById(taskId);
    if (task?.status === 'todo') {
      await updateTask(taskId, { status: 'in-progress' });
    }
    await Promise.all([refreshTodayTotal(), refreshActiveTasks()]);
  }, [refreshTodayTotal, refreshActiveTasks, updateTask]);

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

  const refreshActiveEntry = useCallback(async () => {
    await refreshActive();
  }, [refreshActive]);

  const value: TimerContextValue = useMemo(() => ({
    activeEntry,
    totalTodaySeconds,
    startTimer,
    stopTimer,
    isRunningForTask,
    refreshTodayTotal,
    refreshActiveEntry,
  }), [
    activeEntry, totalTodaySeconds, startTimer, stopTimer, isRunningForTask,
    refreshTodayTotal, refreshActiveEntry,
  ]);

  return (
    <TimerContext.Provider value={value}>
      <ElapsedSecondsContext.Provider value={elapsedSeconds}>
        {children}
      </ElapsedSecondsContext.Provider>
    </TimerContext.Provider>
  );
}
