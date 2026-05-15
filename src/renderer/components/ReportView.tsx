import React, { useState, useEffect, useMemo, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useReportContext } from '../context/ReportContext';
import { useTaskContext } from '../context/TaskContext';
import { formatDuration } from '../utils/time';
import { generateMarkdownReport } from '../utils/markdownReport';
import { CategoryPieCharts } from './CategoryPieCharts';
import type { SummaryReportEntry } from '../../shared/types';
import './ReportView.css';

export function ReportView() {
  const { mode, startDate, endDate, filterStatuses, filterSources, filterCategories } = useReportContext();
  const { categories } = useTaskContext();

  const [summaryData, setSummaryData] = useState<SummaryReportEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const loadGenerationRef = useRef(0);

  useEffect(() => {
    if (mode === 'categories') return;
    const myGeneration = ++loadGenerationRef.current;
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    (async () => {
      const data = await window.api.timeEntries.getSummaryReport(start, end);
      // Bail if a newer load has started while we awaited.
      if (loadGenerationRef.current !== myGeneration) return;
      setSummaryData(data);
    })();
  }, [startDate, endDate, mode]);

  const handleExportCsv = async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    await window.api.reports.exportCsv(start, end);
  };

  // Filter summary data
  const filteredSummary = useMemo(() => summaryData.filter((entry) => {
    if (filterStatuses.length > 0 && !filterStatuses.includes(entry.taskStatus)) return false;
    if (filterSources.length > 0 && !filterSources.includes(entry.taskSource)) return false;
    if (filterCategories.length > 0) {
      const hasMatch = entry.categoryIds.some((id) => filterCategories.includes(id));
      if (!hasMatch) return false;
    }
    return true;
  }), [summaryData, filterStatuses, filterSources, filterCategories]);

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

    for (const row of filteredSummary) {
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

  // Build the task→color map once per data change. Pure (no mutation during
  // render), so colors stay stable across re-renders for the same data.
  const taskColorMap = useMemo(() => {
    const fallbackColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
    const map = new Map<string, string>();
    let fallbackIndex = 0;
    for (const row of filteredSummary) {
      if (map.has(row.taskTitle)) continue;
      const cat = categories.find((c) => row.categoryIds.includes(c.id));
      if (cat) {
        map.set(row.taskTitle, cat.color);
      } else {
        map.set(row.taskTitle, fallbackColors[fallbackIndex % fallbackColors.length]);
        fallbackIndex++;
      }
    }
    return map;
  }, [filteredSummary, categories]);

  const taskColor = (name: string): string => taskColorMap.get(name) ?? '#6366f1';

  const totalSeconds = filteredSummary.reduce((sum, r) => sum + r.totalSeconds, 0);

  return (
    <div className="report-view">
      <div className="report-view__header">
        <h2 className="report-view__title">Time Report</h2>
        <div className="report-view__header-actions">
          {mode === 'chart' && (
            <button className="report-view__export" onClick={handleExportCsv}>
              Export CSV
            </button>
          )}
        </div>
      </div>

      {mode === 'chart' && (
        <>
          <div className="report-view__summary">
            <span>Total: {formatDuration(totalSeconds)}</span>
            <span>{filteredSummary.length} entries across {chartData.taskNames.length} tasks</span>
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
                  {chartData.taskNames.map((name) => (
                    <Bar
                      key={name}
                      dataKey={name}
                      stackId="a"
                      fill={taskColor(name)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="report-view__empty">No data for the selected date range.</p>
            )}
          </div>
        </>
      )}

      {mode === 'summary' && (
        <>
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

      {mode === 'categories' && (
        <CategoryPieCharts categories={categories} />
      )}
    </div>
  );
}
