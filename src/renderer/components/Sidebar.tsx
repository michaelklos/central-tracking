import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTaskContext } from '../context/TaskContext';
import { useReportContext } from '../context/ReportContext';
import { DateRangePicker } from './DateRangePicker';
import { OptionsMenu } from './OptionsMenu';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import { BatchActionBar } from './BatchActionBar';
import { HelpPopover } from './HelpPopover';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import type { ImportPreview, ImportPreviewItem, ImportResult, ReportMode } from '../../shared/types';
import './Sidebar.css';

type SidebarTab = 'tasks' | 'settings';

const COLLAPSE_KEY = 'central-tracking:sidebar-collapsed';
const TAB_KEY = 'central-tracking:sidebar-tab';
const WIDTH_KEY = 'central-tracking:sidebar-width';
const SEARCH_MODE_KEY = 'central-tracking:search-mode';
const COLLAPSED_WIDTH = 40;
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  } catch {
    return false;
  }
}

function getStoredWidth(): number {
  try {
    const stored = localStorage.getItem(WIDTH_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

function getStoredTab(): SidebarTab {
  try {
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === 'tasks' || stored === 'settings') return stored;
  } catch { /* ignore */ }
  return 'tasks';
}

type SearchMode = 'title' | 'all';
function getStoredSearchMode(): SearchMode {
  try {
    const stored = localStorage.getItem(SEARCH_MODE_KEY);
    if (stored === 'title' || stored === 'all') return stored;
  } catch { /* ignore */ }
  return 'title';
}

const SEARCH_MODE_OPTIONS: { value: SearchMode; trigger: string; menu: string }[] = [
  { value: 'title', trigger: 'Title', menu: 'Title only' },
  { value: 'all', trigger: 'All', menu: 'Title, description, & notes' },
];

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'blocked', label: 'Blocked' },
];

const SOURCE_OPTIONS = [
  { value: 'ad-hoc', label: 'Ad Hoc' },
  { value: 'email', label: 'Email' },
  { value: 'meeting-prep', label: 'Meeting Prep' },
  { value: 'plugin', label: 'External (Plugin)' },
];

const REPORT_MODE_OPTIONS: { value: ReportMode; label: string }[] = [
  { value: 'chart', label: 'By Day' },
  { value: 'summary', label: 'Summary' },
  { value: 'categories', label: 'By Category' },
];

export function Sidebar() {
  const { filter, setFilter, categories, refreshTasks, batchMode, enterBatchMode } = useTaskContext();
  const reportContext = useReportContext();
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(getStoredWidth);
  const isResizing = useRef(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>(getStoredTab);
  const [localSearch, setLocalSearch] = useState(filter.search ?? '');
  const [searchMode, setSearchMode] = useState<SearchMode>(getStoredSearchMode);
  const [searchModeOpen, setSearchModeOpen] = useState(false);
  const searchModeRef = useRef<HTMLDivElement>(null);

  // Sync local search when filter is cleared externally (e.g. "Clear filters")
  useEffect(() => {
    setLocalSearch(filter.search ?? '');
  }, [filter.search]);

  // Debounce: push search to context only after typing pauses 200ms.
  // Uses a functional setFilter so it merges with any concurrent filter changes
  // (e.g., category selection) instead of clobbering them via a stale closure.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter((prev) => {
        if ((prev.search ?? '') === localSearch) return prev;
        return { ...prev, search: localSearch || undefined };
      });
    }, 200);
    return () => clearTimeout(timer);
  }, [localSearch, setFilter]);

  // Push search mode into filter whenever it changes, and persist it.
  useEffect(() => {
    try { localStorage.setItem(SEARCH_MODE_KEY, searchMode); } catch { /* ignore */ }
    setFilter((prev) => (prev.searchIn === searchMode ? prev : { ...prev, searchIn: searchMode }));
  }, [searchMode, setFilter]);

  // Close search-mode dropdown on outside click / Escape
  useEffect(() => {
    if (!searchModeOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (searchModeRef.current && !searchModeRef.current.contains(e.target as Node)) {
        setSearchModeOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearchModeOpen(false); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [searchModeOpen]);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const navigate = useNavigate();
  const location = useLocation();

  const isOnReports = location.pathname.includes('/reports');
  const isOnTimeline = location.pathname.includes('/timeline');
  const isOnSubpage = isOnReports || isOnTimeline;

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, String(next)); } catch { /* ignore */ }
  };

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(Math.round(sidebarWidth)));
    } catch { /* ignore */ }
  }, [sidebarWidth]);

  const handleTabClick = (tab: SidebarTab) => {
    setActiveTab(tab);
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
    if (isOnSubpage) navigate('/');
  };

  const handleReportsClick = () => {
    navigate('/reports');
  };

  const handleTimelineClick = () => {
    navigate('/timeline');
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
    const items = importPreview.items.map((item, i) => {
      if (i !== index) return item;
      // Items with an existing task toggle between 'update' and 'skip'
      // New items toggle between 'create' and 'skip'
      let nextAction: ImportPreviewItem['action'];
      if (item.existingTask) {
        nextAction = item.action === 'skip' ? 'update' : 'skip';
      } else {
        nextAction = item.action === 'skip' ? 'create' : 'skip';
      }
      return { ...item, action: nextAction };
    });
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

  // Determine which tab icon is visually active
  const tasksTabActive = !isOnSubpage && activeTab === 'tasks';
  const reportsTabActive = isOnReports;
  const timelineTabActive = isOnTimeline;
  const settingsTabActive = !isOnSubpage && activeTab === 'settings';

  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}
      style={{ width: collapsed ? COLLAPSED_WIDTH : sidebarWidth }}
    >
      {!collapsed && (
        <div className="sidebar__header">
          <h1 className="sidebar__title">Central Tracking <span className="sidebar__version">v{__APP_VERSION__}</span></h1>
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
                  <h3 className="sidebar__section-title">Filter</h3>
                  <div className="sidebar__search-row">
                    <input
                      className="sidebar__search"
                      type="text"
                      placeholder={searchMode === 'all' ? 'Search title, description, notes...' : 'Search task titles...'}
                      value={localSearch}
                      onChange={(e) => setLocalSearch(e.target.value)}
                    />
                    <div className="sidebar__search-mode" ref={searchModeRef}>
                      <button
                        type="button"
                        className="sidebar__search-mode-btn"
                        onClick={() => setSearchModeOpen((o) => !o)}
                        title="Change search scope"
                      >
                        {SEARCH_MODE_OPTIONS.find((o) => o.value === searchMode)?.trigger}
                        <span className="sidebar__search-mode-chevron">{searchModeOpen ? '▴' : '▾'}</span>
                      </button>
                      {searchModeOpen && (
                        <div className="sidebar__search-mode-menu">
                          {SEARCH_MODE_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              className={`sidebar__search-mode-item ${opt.value === searchMode ? 'sidebar__search-mode-item--active' : ''}`}
                              onClick={() => { setSearchMode(opt.value); setSearchModeOpen(false); }}
                            >
                              <span className="sidebar__search-mode-check">{opt.value === searchMode ? '✓' : ' '}</span>
                              {opt.menu}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <MultiSelectDropdown
                    label="Status"
                    options={STATUS_OPTIONS}
                    selected={filter.statuses ?? []}
                    onChange={(v) => setFilter((prev) => ({ ...prev, statuses: v }))}
                  />
                  <MultiSelectDropdown
                    label="Source"
                    options={SOURCE_OPTIONS}
                    selected={filter.sources ?? []}
                    onChange={(v) => setFilter((prev) => ({ ...prev, sources: v }))}
                  />
                  <MultiSelectDropdown
                    label="Category"
                    options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
                    selected={filter.categoryIds ?? []}
                    onChange={(v) => setFilter((prev) => ({ ...prev, categoryIds: v }))}
                  />
                  <label className="sidebar__toggle-row" title="Hide tasks whose time entries are all reported">
                    <input
                      type="checkbox"
                      checked={filter.hasUnreportedTime ?? false}
                      onChange={(e) =>
                        setFilter((prev) => ({
                          ...prev,
                          hasUnreportedTime: e.target.checked ? true : undefined,
                        }))
                      }
                    />
                    <span>Only show unreported time</span>
                  </label>
                  <label className="sidebar__toggle-row" title="Show only tasks with no categories">
                    <input
                      type="checkbox"
                      checked={filter.uncategorized ?? false}
                      onChange={(e) =>
                        setFilter((prev) => ({
                          ...prev,
                          uncategorized: e.target.checked ? true : undefined,
                        }))
                      }
                    />
                    <span>Only show uncategorized</span>
                  </label>
                  {(filter.search || filter.statuses?.length || filter.sources?.length || filter.categoryIds?.length || filter.hasUnreportedTime || filter.uncategorized) && (
                    <button
                      className="sidebar__clear-filters"
                      onClick={() => { setFilter({}); setLocalSearch(''); }}
                    >
                      Reset filters
                    </button>
                  )}
                </div>

                <div className="sidebar__import">
                  <div className="sidebar__import-row">
                    <button className="sidebar__import-btn" onClick={handleImportClick}>
                      Import Tasks
                    </button>
                    <HelpPopover title="Import File Format">
                      <p>Select a <code>.md</code> or <code>.txt</code> file with this structure:</p>
                      <pre>{`# YYYY-MM-DD
* Task Name: HH:MM (duration)
* [TICKET] Task Name: HH:MM (1h 30m)`}</pre>
                      <ul>
                        <li><strong>Date header</strong> — <code># 2024-03-20</code></li>
                        <li><strong>Start time</strong> — 24-hour, e.g. <code>14:30</code></li>
                        <li><strong>Duration</strong> — e.g. <code>45m</code>, <code>1h</code>, <code>1h 30m</code></li>
                        <li><strong>Ticket</strong> (optional) — number for ADO, <code>ABC-123</code> for Jira</li>
                      </ul>
                      <p>Lines starting with <code>//</code> are treated as comments.</p>
                    </HelpPopover>
                  </div>
                  <button className="sidebar__batch-btn" onClick={enterBatchMode}>
                    Select Tasks
                  </button>
                  {importResult && (
                    <p className="sidebar__import-result">
                      Imported {importResult.created} new, {importResult.updated} appended, {importResult.skipped} skipped
                    </p>
                  )}
                </div>
              </>
            )
          )}

          {isOnReports && (
            <>
              <div className="sidebar__section">
                <h3 className="sidebar__section-title">Report Type</h3>
                <div className="sidebar__report-types">
                  {REPORT_MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      className={`sidebar__report-type-btn ${reportContext.mode === opt.value ? 'sidebar__report-type-btn--active' : ''}`}
                      onClick={() => reportContext.setMode(opt.value)}
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
                    <MultiSelectDropdown
                      label="Status"
                      options={STATUS_OPTIONS}
                      selected={reportContext.filterStatuses}
                      onChange={reportContext.setFilterStatuses}
                    />
                    <MultiSelectDropdown
                      label="Source"
                      options={SOURCE_OPTIONS}
                      selected={reportContext.filterSources}
                      onChange={reportContext.setFilterSources}
                    />
                    <MultiSelectDropdown
                      label="Category"
                      options={categories.map((c) => ({ value: c.id, label: c.name, color: c.color }))}
                      selected={reportContext.filterCategories}
                      onChange={reportContext.setFilterCategories}
                    />
                    {(reportContext.filterStatuses.length > 0 || reportContext.filterSources.length > 0 || reportContext.filterCategories.length > 0) && (
                      <button
                        className="sidebar__clear-filters"
                        onClick={() => {
                          reportContext.setFilterStatuses([]);
                          reportContext.setFilterSources([]);
                          reportContext.setFilterCategories([]);
                        }}
                      >
                        Reset filters
                      </button>
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

      {!collapsed && (
        <div className="sidebar__resize-handle" onMouseDown={handleResizeStart} />
      )}

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
