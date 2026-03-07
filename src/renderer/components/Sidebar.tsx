import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTaskContext, type TaskFilter } from '../context/TaskContext';
import { useTimerContext } from '../context/TimerContext';
import { useReportContext } from '../context/ReportContext';
import { formatDuration } from '../utils/time';
import { DateRangePicker } from './DateRangePicker';
import { OptionsMenu } from './OptionsMenu';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import { BatchActionBar } from './BatchActionBar';
import type { ImportPreview, ImportPreviewItem, ImportResult, ReportMode, TaskStatus, TaskSource } from '../../shared/types';
import './Sidebar.css';

type SidebarTab = 'tasks' | 'settings';

const COLLAPSE_KEY = 'central-tracking:sidebar-collapsed';
const TAB_KEY = 'central-tracking:sidebar-tab';

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getStoredTab(): SidebarTab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === 'tasks' || stored === 'settings') return stored;
  } catch { /* ignore */ }
  return 'tasks';
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

const SOURCE_OPTIONS = [
  { value: '', label: 'All Sources' },
  { value: 'ad-hoc', label: 'Ad Hoc' },
  { value: 'email', label: 'Email' },
  { value: 'meeting-prep', label: 'Meeting Prep' },
  { value: 'plugin', label: 'External (Plugin)' },
];

const REPORT_MODE_OPTIONS: { value: ReportMode; label: string }[] = [
  { value: 'chart', label: 'Chart' },
  { value: 'summary', label: 'Summary' },
  { value: 'categories', label: 'Categories' },
];

export function Sidebar() {
  const { filter, setFilter, categories, createCategory, deleteCategory, refreshTasks, batchMode, enterBatchMode } = useTaskContext();
  const { activeEntry, elapsedSeconds, totalTodaySeconds } = useTimerContext();

  let reportContext: ReturnType<typeof useReportContext> | null = null;
  try {
    reportContext = useReportContext();
  } catch {
    // Not inside a ReportProvider (e.g., in tests)
  }
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [activeTab, setActiveTab] = useState<SidebarTab>(getStoredTab);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  let navigate: ReturnType<typeof useNavigate> | null = null;
  let location: ReturnType<typeof useLocation> | null = null;
  try {
    navigate = useNavigate();
    location = useLocation();
  } catch {
    // Not inside a router (e.g., in tests)
  }

  const isOnReports = location?.pathname.includes('/reports') ?? false;
  const isOnTimeline = location?.pathname.includes('/timeline') ?? false;
  const isOnSubpage = isOnReports || isOnTimeline;
  const todayDisplay = activeEntry ? totalTodaySeconds + elapsedSeconds : totalTodaySeconds;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* ignore */ }
  };

  const handleTabClick = (tab: SidebarTab) => {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
    if (navigate && isOnSubpage) {
      navigate('/');
    }
  };

  const handleReportsClick = () => {
    if (navigate) {
      navigate('/reports');
    }
  };

  const handleTimelineClick = () => {
    if (navigate) {
      navigate('/timeline');
    }
  };

  const handleCreateCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    await createCategory({ name, color: newCatColor });
    setNewCatName('');
  };

  const handleImportClick = async () => {
    const preview = await window.api.import.selectAndParse();
    if (preview) {
      setImportPreview(preview);
      setImportResult(null);
    }
  };

  const handleToggleAction = (index: number) => {
    if (!importPreview) return;
    const items = importPreview.items.map((item, i) =>
      i === index
        ? { ...item, action: (item.action === 'create' ? 'skip' : 'create') as ImportPreviewItem['action'] }
        : item
    );
    setImportPreview({ ...importPreview, items });
  };

  const handleImportConfirm = async () => {
    if (!importPreview) return;
    const result = await window.api.import.execute(importPreview.items);
    setImportResult(result);
    setImportPreview(null);
    await refreshTasks();
  };

  const handleImportCancel = () => {
    setImportPreview(null);
  };

  const updateFilter = (partial: Partial<TaskFilter>) => {
    setFilter({ ...filter, ...partial });
  };

  // Determine which tab icon is visually active
  const tasksTabActive = !isOnSubpage && activeTab === 'tasks';
  const reportsTabActive = isOnReports;
  const timelineTabActive = isOnTimeline;
  const settingsTabActive = !isOnSubpage && activeTab === 'settings';

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      {!collapsed && (
        <div className="sidebar__header">
          <h1 className="sidebar__title">Central Tracking</h1>
          <div className="sidebar__today">
            <span className="sidebar__today-label">Today:</span>{' '}
            <span className="sidebar__today-value">{formatDuration(todayDisplay)}</span>
          </div>
        </div>
      )}

      <div className={`sidebar__tabs ${collapsed ? 'sidebar__tabs--vertical' : ''}`}>
        <button
          className={`sidebar__tab ${tasksTabActive ? 'sidebar__tab--active' : ''}`}
          onClick={() => handleTabClick('tasks')}
          title="Tasks"
        >
          {'\u2630'}
        </button>
        <button
          className={`sidebar__tab ${timelineTabActive ? 'sidebar__tab--active' : ''}`}
          onClick={handleTimelineClick}
          title="Timeline"
        >
          {'\u23F1'}
        </button>
        <button
          className={`sidebar__tab ${reportsTabActive ? 'sidebar__tab--active' : ''}`}
          onClick={handleReportsClick}
          title="Reports"
        >
          {'\u25A6'}
        </button>
        <button
          className={`sidebar__tab ${settingsTabActive ? 'sidebar__tab--active' : ''}`}
          onClick={() => handleTabClick('settings')}
          title="Settings"
        >
          {'\u2699'}
        </button>
      </div>

      {!collapsed && (
        <div className="sidebar__content">
          {activeTab === 'tasks' && !isOnSubpage && (
            batchMode ? (
              <BatchActionBar />
            ) : (
              <>
                <div className="sidebar__section">
                  <h3 className="sidebar__section-title">Categories</h3>
                  <ul className="sidebar__cat-list">
                    {categories.map((cat) => (
                      <li key={cat.id} className="sidebar__cat-item">
                        <span className="sidebar__cat-dot" style={{ background: cat.color }} />
                        <span className="sidebar__cat-name">{cat.name}</span>
                        <button
                          className="sidebar__cat-delete"
                          onClick={() => deleteCategory(cat.id)}
                          title="Delete category"
                        >
                          &times;
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="sidebar__cat-form">
                    <input
                      type="text"
                      placeholder="New category..."
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                    />
                    <input
                      type="color"
                      value={newCatColor}
                      onChange={(e) => setNewCatColor(e.target.value)}
                      className="sidebar__cat-color"
                    />
                    <button className="sidebar__cat-add" onClick={handleCreateCategory}>+</button>
                  </div>
                </div>

                <div className="sidebar__section">
                  <h3 className="sidebar__section-title">Filter</h3>
                  <input
                    className="sidebar__search"
                    type="text"
                    placeholder="Search tasks..."
                    value={filter.search ?? ''}
                    onChange={(e) => updateFilter({ search: e.target.value })}
                  />
                  <select
                    value={filter.status ?? ''}
                    onChange={(e) => updateFilter({ status: e.target.value || undefined })}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <select
                    value={filter.source ?? ''}
                    onChange={(e) => updateFilter({ source: e.target.value || undefined })}
                  >
                    {SOURCE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <select
                    value={filter.categoryId ?? ''}
                    onChange={(e) => updateFilter({ categoryId: e.target.value || undefined })}
                  >
                    <option value="">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="sidebar__import">
                  <button className="sidebar__import-btn" onClick={handleImportClick}>
                    Import Tasks
                  </button>
                  <button className="sidebar__batch-btn" onClick={enterBatchMode}>
                    Select Tasks
                  </button>
                  {importResult && (
                    <p className="sidebar__import-result">
                      Imported {importResult.created}, skipped {importResult.skipped}
                    </p>
                  )}
                </div>
              </>
            )
          )}

          {isOnReports && reportContext && (
            <>
              <div className="sidebar__section">
                <h3 className="sidebar__section-title">Report Type</h3>
                <div className="sidebar__report-types">
                  {REPORT_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`sidebar__report-type-btn ${reportContext!.mode === opt.value ? 'sidebar__report-type-btn--active' : ''}`}
                      onClick={() => reportContext!.setMode(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {reportContext.mode !== 'categories' && (
                <>
                  <div className="sidebar__section">
                    <h3 className="sidebar__section-title">Date Range</h3>
                    <DateRangePicker
                      start={reportContext.startDate}
                      end={reportContext.endDate}
                      onChange={reportContext.setDateRange}
                    />
                  </div>

                  <div className="sidebar__section">
                    <h3 className="sidebar__section-title">Filters</h3>
                    <select
                      value={reportContext.filterStatus}
                      onChange={(e) => reportContext!.setFilterStatus(e.target.value as TaskStatus | '')}
                    >
                      {STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <select
                      value={reportContext.filterSource}
                      onChange={(e) => reportContext!.setFilterSource(e.target.value as TaskSource | '')}
                    >
                      {SOURCE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    {categories.length > 0 && (
                      <div className="sidebar__report-cat-chips">
                        {categories.map((cat) => (
                          <button
                            key={cat.id}
                            className={`sidebar__report-cat-chip ${reportContext!.filterCategories.includes(cat.id) ? 'sidebar__report-cat-chip--active' : ''}`}
                            onClick={() => reportContext!.toggleCategoryFilter(cat.id)}
                          >
                            <span className="sidebar__cat-dot" style={{ background: cat.color }} />
                            {cat.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {activeTab === 'settings' && !isOnSubpage && (
            <OptionsMenu />
          )}
        </div>
      )}

      <div className="sidebar__footer">
        <button
          className="sidebar__collapse-btn"
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u203A' : '\u2039'}
        </button>
      </div>

      {importPreview && (
        <ImportPreviewDialog
          items={importPreview.items}
          errors={importPreview.errors}
          filePath={importPreview.filePath}
          onToggleAction={handleToggleAction}
          onConfirm={handleImportConfirm}
          onCancel={handleImportCancel}
        />
      )}
    </aside>
  );
}
