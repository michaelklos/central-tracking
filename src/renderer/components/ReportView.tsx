import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { DateRangePicker } from './DateRangePicker';
import { formatDuration } from '../utils/time';
import type { TimeEntryReport } from '../../shared/types';
import './ReportView.css';

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function ReportView() {
  const today = toDateString(new Date());
  const monthStart = toDateString(new Date(new Date().getFullYear(), new Date().getMonth(), 1));

  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);
  const [reportData, setReportData] = useState<TimeEntryReport[]>([]);

  const loadReport = useCallback(async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    const data = await window.api.timeEntries.getReport(start, end);
    setReportData(data);
  }, [startDate, endDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleExportCsv = async () => {
    const start = `${startDate}T00:00:00Z`;
    const end = `${endDate}T23:59:59Z`;
    await window.api.reports.exportCsv(start, end);
  };

  // Transform report data for chart: group by date, sum per task
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

  // Summary totals
  const totalSeconds = reportData.reduce((sum, r) => sum + r.totalSeconds, 0);

  return (
    <div className="report-view">
      <div className="report-view__header">
        <h2 className="report-view__title">Time Report</h2>
        <button className="report-view__export" onClick={handleExportCsv}>
          Export CSV
        </button>
      </div>

      <DateRangePicker start={startDate} end={endDate} onChange={handleDateChange} />

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
    </div>
  );
}
