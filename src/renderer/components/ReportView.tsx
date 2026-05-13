import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useReportContext } from '../context/ReportContext';
import { useTaskContext } from '../context/TaskContext';
import { formatDuration } from '../utils/time';
import { generateMarkdownReport } from '../utils/markdownReport';
import { CategoryPieCharts } from './CategoryPieCharts';
import type { SummaryReportEntry } from '../../shared/types';
import './ReportView.css';

export function ReportView() {
  const { mode, startDate, endDate, filterStatus, filterSource, filterCategories } = useReportContext();
  const { categories } = useTaskContext();

  const [summaryData, setSummaryData] = useState<SummaryReportEntry[]>([]);
  const [copied, setCopied] = useState(false);

  const loadReport = useCallback(async () => {
    if (mode === 'categories') return;
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    const data = await window.api.timeEntries.getSummaryReport(start, end);
    setSummaryData(data);
  }, [startDate, endDate, mode]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExportCsv = async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    await window.api.reports.exportCsv(start, end);
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

  const colors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];

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
