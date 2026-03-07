import React, { useState, useEffect, useCallback } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatDuration } from '../utils/time';
import type { Category, SummaryReportEntry } from '../../shared/types';
import './CategoryPieCharts.css';

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

interface PanelConfig {
  label: string;
  defaultStart: () => string;
  defaultEnd: () => string;
}

const PANELS: PanelConfig[] = [
  {
    label: 'Today',
    defaultStart: () => toDateString(new Date()),
    defaultEnd: () => toDateString(new Date()),
  },
  {
    label: 'Past 7 Days',
    defaultStart: () => {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      return toDateString(d);
    },
    defaultEnd: () => toDateString(new Date()),
  },
  {
    label: 'Past 30 Days',
    defaultStart: () => {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      return toDateString(d);
    },
    defaultEnd: () => toDateString(new Date()),
  },
];

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#a855f7'];
const UNCATEGORIZED_COLOR = '#6b7280';

interface CategorySlice {
  name: string;
  value: number;
  color: string;
}

function aggregateByCategory(
  data: SummaryReportEntry[],
  categories: Category[],
  filterCategories: string[]
): CategorySlice[] {
  const catMap = new Map<string, { name: string; color: string; seconds: number }>();
  let uncategorizedSeconds = 0;

  for (const entry of data) {
    if (entry.categoryIds.length === 0) {
      uncategorizedSeconds += entry.totalSeconds;
    } else {
      const share = entry.totalSeconds / entry.categoryIds.length;
      for (const catId of entry.categoryIds) {
        if (filterCategories.length > 0 && !filterCategories.includes(catId)) continue;
        const cat = categories.find((c) => c.id === catId);
        if (!cat) continue;
        const existing = catMap.get(catId);
        if (existing) {
          existing.seconds += share;
        } else {
          catMap.set(catId, { name: cat.name, color: cat.color, seconds: share });
        }
      }
    }
  }

  const slices: CategorySlice[] = [];
  for (const [, val] of catMap) {
    slices.push({ name: val.name, value: Math.round(val.seconds), color: val.color });
  }

  if (filterCategories.length === 0 && uncategorizedSeconds > 0) {
    slices.push({ name: 'Uncategorized', value: Math.round(uncategorizedSeconds), color: UNCATEGORIZED_COLOR });
  }

  slices.sort((a, b) => b.value - a.value);
  return slices;
}

interface Props {
  categories: Category[];
}

export function CategoryPieCharts({ categories }: Props) {
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [panelOverrides, setPanelOverrides] = useState<Record<number, { start: string; end: string } | null>>({});
  const [expandedOverrides, setExpandedOverrides] = useState<Set<number>>(new Set());
  const [panelData, setPanelData] = useState<Record<number, SummaryReportEntry[]>>({});

  const toggleCategoryFilter = (catId: string) => {
    setFilterCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const loadPanelData = useCallback(async () => {
    const results: Record<number, SummaryReportEntry[]> = {};
    for (let i = 0; i < PANELS.length; i++) {
      const override = panelOverrides[i];
      const start = override ? override.start : PANELS[i].defaultStart();
      const end = override ? override.end : PANELS[i].defaultEnd();
      const data = await window.api.timeEntries.getSummaryReport(
        `${start}T00:00:00Z`,
        `${end}T23:59:59Z`
      );
      results[i] = data;
    }
    setPanelData(results);
  }, [panelOverrides]);

  useEffect(() => {
    loadPanelData();
  }, [loadPanelData]);

  const toggleDateOverride = (panelIndex: number) => {
    setExpandedOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(panelIndex)) {
        next.delete(panelIndex);
      } else {
        next.add(panelIndex);
      }
      return next;
    });
  };

  const setPanelDate = (panelIndex: number, field: 'start' | 'end', value: string) => {
    setPanelOverrides((prev) => {
      const existing = prev[panelIndex] ?? {
        start: PANELS[panelIndex].defaultStart(),
        end: PANELS[panelIndex].defaultEnd(),
      };
      return { ...prev, [panelIndex]: { ...existing, [field]: value } };
    });
  };

  const resetPanelDate = (panelIndex: number) => {
    setPanelOverrides((prev) => {
      const next = { ...prev };
      delete next[panelIndex];
      return next;
    });
    setExpandedOverrides((prev) => {
      const next = new Set(prev);
      next.delete(panelIndex);
      return next;
    });
  };

  const renderTooltip = (props: { payload?: Array<{ payload: CategorySlice }> }) => {
    const entry = props.payload?.[0]?.payload;
    if (!entry) return null;
    return (
      <div className="category-pie-charts__tooltip">
        <span style={{ color: entry.color }}>{entry.name}</span>
        <span>{formatDuration(entry.value)}</span>
      </div>
    );
  };

  const renderLabel = (props: { name: string; percent: number; x: number; y: number }) => {
    const { name, percent, x, y } = props;
    if (percent < 0.05) return null;
    return (
      <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--color-text)">
        {name} {Math.round(percent * 100)}%
      </text>
    );
  };

  return (
    <div className="category-pie-charts" data-testid="category-pie-charts">
      {categories.length > 0 && (
        <div className="category-pie-charts__filters">
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`category-pie-charts__chip ${filterCategories.includes(cat.id) ? 'category-pie-charts__chip--active' : ''}`}
              onClick={() => toggleCategoryFilter(cat.id)}
            >
              <span className="category-pie-charts__chip-dot" style={{ background: cat.color }} />
              {cat.name}
            </button>
          ))}
        </div>
      )}

      <div className="category-pie-charts__grid">
        {PANELS.map((panel, i) => {
          const data = panelData[i] ?? [];
          const slices = aggregateByCategory(data, categories, filterCategories);
          const totalSeconds = slices.reduce((sum, s) => sum + s.value, 0);
          const override = panelOverrides[i];
          const isExpanded = expandedOverrides.has(i);

          return (
            <div key={i} className="category-pie-charts__panel" data-testid={`pie-panel-${i}`}>
              <div className="category-pie-charts__panel-header">
                <span className="category-pie-charts__panel-label">{panel.label}</span>
                <span className="category-pie-charts__panel-total">{formatDuration(totalSeconds)}</span>
              </div>

              <button
                className="category-pie-charts__custom-toggle"
                onClick={() => toggleDateOverride(i)}
              >
                {isExpanded ? 'Hide dates' : 'Custom dates'}
              </button>

              {isExpanded && (
                <div className="category-pie-charts__date-override">
                  <input
                    type="date"
                    value={override?.start ?? panel.defaultStart()}
                    onChange={(e) => setPanelDate(i, 'start', e.target.value)}
                  />
                  <input
                    type="date"
                    value={override?.end ?? panel.defaultEnd()}
                    onChange={(e) => setPanelDate(i, 'end', e.target.value)}
                  />
                  {override && (
                    <button
                      className="category-pie-charts__reset-btn"
                      onClick={() => resetPanelDate(i)}
                    >
                      Reset
                    </button>
                  )}
                </div>
              )}

              <div className="category-pie-charts__chart">
                {slices.length > 0 ? (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={70}
                        label={renderLabel}
                        labelLine={false}
                      >
                        {slices.map((slice, j) => (
                          <Cell key={j} fill={slice.color} />
                        ))}
                      </Pie>
                      <Tooltip content={renderTooltip} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="category-pie-charts__empty">No data</p>
                )}
              </div>

              <div className="category-pie-charts__legend">
                {slices.map((slice, j) => (
                  <div key={j} className="category-pie-charts__legend-row">
                    <span className="category-pie-charts__legend-dot" style={{ background: slice.color }} />
                    <span className="category-pie-charts__legend-name">{slice.name}</span>
                    <span className="category-pie-charts__legend-time">{formatDuration(slice.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
