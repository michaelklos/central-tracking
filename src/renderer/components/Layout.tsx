import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import { TaskDetail } from './TaskDetail';
import { TimerBar } from './TimerBar';
import { ReportView } from './ReportView';
import { useTaskContext } from '../context/TaskContext';
import './Layout.css';

const STORAGE_KEY = 'central-tracking:detail-width';
const DEFAULT_WIDTH = 500;
const MIN_WIDTH = 350;
const TASK_LIST_MIN_WIDTH = 400;

function getInitialWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

interface LayoutProps {
  view?: 'tasks' | 'reports';
}

export function Layout({ view = 'tasks' }: LayoutProps) {
  const { selectedTaskId } = useTaskContext();
  const [detailWidth, setDetailWidth] = useState(getInitialWidth);
  const isResizing = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const contentRect = contentRef.current?.getBoundingClientRect();
      const contentRight = contentRect ? contentRect.right : window.innerWidth;
      const contentWidth = contentRect ? contentRect.width : window.innerWidth;
      const maxWidth = contentWidth - TASK_LIST_MIN_WIDTH;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, contentRight - moveEvent.clientX));
      setDetailWidth(newWidth);
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
      localStorage.setItem(STORAGE_KEY, String(Math.round(detailWidth)));
    } catch { /* ignore */ }
  }, [detailWidth]);

  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__main">
        <TimerBar />
        <div className="layout__content" ref={contentRef}>
          {view === 'reports' ? (
            <ReportView />
          ) : (
            <>
              <TaskList />
              {selectedTaskId && (
                <div className="layout__detail" style={{ width: detailWidth }}>
                  <div className="layout__resize-handle" onMouseDown={handleResizeStart} />
                  <TaskDetail />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
