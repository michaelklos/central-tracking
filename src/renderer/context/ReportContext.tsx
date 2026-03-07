import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ReportMode, TaskStatus, TaskSource } from '../../shared/types';

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

interface ReportContextValue {
  mode: ReportMode;
  setMode(mode: ReportMode): void;
  startDate: string;
  endDate: string;
  setDateRange(start: string, end: string): void;
  filterStatus: TaskStatus | '';
  setFilterStatus(s: TaskStatus | ''): void;
  filterSource: TaskSource | '';
  setFilterSource(s: TaskSource | ''): void;
  filterCategories: string[];
  toggleCategoryFilter(catId: string): void;
}

const ReportContext = createContext<ReportContextValue | null>(null);

export function useReportContext(): ReportContextValue {
  const ctx = useContext(ReportContext);
  if (!ctx) throw new Error('useReportContext must be used within a ReportProvider');
  return ctx;
}

export function ReportProvider({ children }: { children: ReactNode }) {
  const today = toDateString(new Date());
  const monthStart = toDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [mode, setMode] = useState<ReportMode>('chart');
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | ''>('');
  const [filterSource, setFilterSource] = useState<TaskSource | ''>('');
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  const setDateRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const toggleCategoryFilter = useCallback((catId: string) => {
    setFilterCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  }, []);

  const value: ReportContextValue = {
    mode,
    setMode,
    startDate,
    endDate,
    setDateRange,
    filterStatus,
    setFilterStatus,
    filterSource,
    setFilterSource,
    filterCategories,
    toggleCategoryFilter,
  };

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}
