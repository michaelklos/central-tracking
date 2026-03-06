import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DateRangePicker } from './DateRangePicker';
import { formatDuration } from '../utils/time';
import { generateMarkdownReport } from '../utils/markdownReport';
import type { TimeEntryReport, SummaryReportEntry, Category, TaskStatus, TaskSource } from '../../shared/types';
import './ReportView.css';

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

type ReportMode = 'chart' | 'summary';

export function ReportView() {
  const today = toDateString(new Date());
  const monthStart = toDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [mode, setMode] = useState<ReportMode>('chart');
  const [reportData, setReportData] = useState<TimeEntryReport[]>([]);

  // Summary mode state
  const [summaryData, setSummaryData] = useState<SummaryReportEntry[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | ''>('');
  const [filterSource, setFilterSource] = useState<TaskSource | ''>('');
  const [copied, setCopied] = useState(false);

  const loadReport = useCallback(async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    if (mode === 'chart') {
      const data = await window.api.timeEntries.getReport(start, end);
      setReportData(data);
    } else {
      const data = await window.api.timeEntries.getSummaryReport(start, end);
      setSummaryData(data);
    }
  }, [startDate, endDate, mode]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    window.api.categories.getAll().then(setCategories);
  }, []);

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleExportCsv = async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    await window.api.reports.exportCsv(start, end);
  };

  const toggleCategoryFilter = (catId: string) => {
    setFilterCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Filter summary data
  const filteredSummary = summaryData.filter((entry) => {
    if (filterStatus && entry.taskStatus !== filterStatus) return false;
    if (filterSource && entry.taskSource !== filterSource) return false;
    if (filterCategories.length > 0) {
      const hasMatch = entry.categoryIds.some((id) => filterCategories.includes(id));
      if (!hasMatch) return false;
    }
    return true;
  });

  const selectedCategoryNames = filterCategories
    .map((id) => categories.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[];

  const markdownText = generateMarkdownReport(filteredSummary, {
    startDate,
    endDate,
    categoryNames: selectedCategoryNames.length > 0 ? selectedCategoryNames : undefined,
  });

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdownText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Chart mode data
  const chartData = (() => {
    const byDate: Record<string, Record<string, number>> = {};
    const taskNames = new Set<string>();

    for (const row of reportData) {
      if (!byDate[row.date]) byDate[row.date] = {};
      byDate[row.date][row.taskTitle] = (byDate[row.date][row.taskTitle] ?? 0) + row.totalSeconds;
      taskNames.add(row.taskTitle);
    }

    return {
      data: Object.entries(byDate).map(([date, tasks]) => ({
        date,
        ...Object.fromEntries(
          Object.entries(tasks).map(([name, secs]) => [name, Math.round(secs / 60)])
        ),
      })),
      taskNames: Array.from(taskNames),
    };
  })();

  const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

  const totalSeconds = reportData.reduce((sum, r) => sum + r.totalSeconds, 0);

  return (
    <div className="report-view">
      <div className="report-view__header">
        <h2 className="report-view__title">Time Report</h2>
        <div className="report-view__header-actions">
          <div className="report-view__mode-toggle">
            <button
              className={`report-view__mode-btn ${mode === 'chart' ? 'report-view__mode-btn--active' : ''}`}
              onClick={() => setMode('chart')}
            >
              Chart
            </button>
            <button
              className={`report-view__mode-btn ${mode === 'summary' ? 'report-view__mode-btn--active' : ''}`}
              onClick={() => setMode('summary')}
            >
              Summary
            </button>
          </div>
          {mode === 'chart' && (
            <button className="report-view__export" onClick={handleExportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      <DateRangePicker start={startDate} end={endDate} onChange={handleDateChange} />

      {mode === 'chart' ? (
        <>
          <div className="report-view__summary">
            <span>Total: {formatDuration(totalSeconds)}</span>
            <span>{reportData.length} entries across {chartData.taskNames.length} tasks</span>
          </div>

          <div className="report-view__chart" data-testid="report-chart">
            {chartData.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData.data}>
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis
                    fontSize={11}
                    label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fontSize: 11 }}
                  />
                  <Tooltip />
                  <Legend />
                  {chartData.taskNames.map((name, i) => (
                    <Bar
                      key={name}
                      dataKey={name}
                      stackId="a"
                      fill={colors[i % colors.length]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="report-view__empty">No data for the selected date range.</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="report-view__filters">
            <div className="report-view__filter-group">
              <label className="report-view__filter-label">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as TaskStatus | '')}
              >
                <option value="">All Statuses</option>
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            <div className="report-view__filter-group">
              <label className="report-view__filter-label">Source</label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value as TaskSource | '')}
              >
                <option value="">All Sources</option>
                <option value="ad-hoc">Ad Hoc</option>
                <option value="email">Email</option>
                <option value="meeting-prep">Meeting Prep</option>
                <option value="plugin">External (Plugin)</option>
              </select>
            </div>

            {categories.length > 0 && (
              <div className="report-view__filter-group">
                <label className="report-view__filter-label">Categories</label>
                <div className="report-view__cat-chips">
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      className={`report-view__cat-chip ${filterCategories.includes(cat.id) ? 'report-view__cat-chip--active' : ''}`}
                      onClick={() => toggleCategoryFilter(cat.id)}
                      style={{ '--cat-color': cat.color } as React.CSSProperties}
                    >
                      <span className="report-view__cat-dot" style={{ background: cat.color }} />
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="report-view__summary-actions">
            <button className="report-view__copy-btn" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>

          <pre className="report-view__markdown" data-testid="summary-preview">
            {markdownText}
          </pre>
        </>
      )}
    </div>
  );
}
