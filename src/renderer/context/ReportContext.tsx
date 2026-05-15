import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ReportMode } from '../../shared/types';
import { toLocalDateString as toDateString } from '../../shared/dateRange';

interface ReportContextValue {
  mode: ReportMode;
  setMode(mode: ReportMode): void;
  startDate: string;
  endDate: string;
  setDateRange(start: string, end: string): void;
  filterStatuses: string[];
  setFilterStatuses(s: string[]): void;
  filterSources: string[];
  setFilterSources(s: string[]): void;
  filterCategories: string[];
  setFilterCategories(ids: string[]): void;
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
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterSources, setFilterSources] = useState<string[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);

  const setDateRange = useCallback((start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  }, []);

  const value: ReportContextValue = {
    mode,
    setMode,
    startDate,
    endDate,
    setDateRange,
    filterStatuses,
    setFilterStatuses,
    filterSources,
    setFilterSources,
    filterCategories,
    setFilterCategories,
  };

  return <ReportContext.Provider value={value}>{children}</ReportContext.Provider>;
}
