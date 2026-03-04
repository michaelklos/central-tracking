import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTaskContext, type TaskFilter } from '../context/TaskContext';
import { OptionsMenu } from './OptionsMenu';
import { ImportPreviewDialog } from './ImportPreviewDialog';
import type { ImportPreview, ImportPreviewItem, ImportResult } from '../../shared/types';
import './Sidebar.css';

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

export function Sidebar() {
  const { filter, setFilter, categories, createCategory, deleteCategory, refreshTasks } = useTaskContext();
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

  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <h1 className="sidebar__title">Central Tracking</h1>
      </div>

      {navigate && (
        <div className="sidebar__nav">
          <button
            className={`sidebar__nav-btn ${!location?.pathname.includes('/reports') ? 'sidebar__nav-btn--active' : ''}`}
            onClick={() => navigate!('/')}
          >
            Tasks
          </button>
          <button
            className={`sidebar__nav-btn ${location?.pathname.includes('/reports') ? 'sidebar__nav-btn--active' : ''}`}
            onClick={() => navigate!('/reports')}
          >
            Reports
          </button>
        </div>
      )}

      <div className="sidebar__import">
        <button className="sidebar__import-btn" onClick={handleImportClick}>
          Import Tasks
        </button>
        {importResult && (
          <p className="sidebar__import-result">
            Imported {importResult.created}, skipped {importResult.skipped}
          </p>
        )}
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

      <OptionsMenu />

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
