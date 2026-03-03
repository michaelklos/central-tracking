import React from 'react';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import { TaskDetail } from './TaskDetail';
import { TimerBar } from './TimerBar';
import { ReportView } from './ReportView';
import { useTaskContext } from '../context/TaskContext';
import './Layout.css';

interface LayoutProps {
  view?: 'tasks' | 'reports';
}

export function Layout({ view = 'tasks' }: LayoutProps) {
  const { selectedTaskId } = useTaskContext();

  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__main">
        <TimerBar />
        <div className="layout__content">
          {view === 'reports' ? (
            <ReportView />
          ) : (
            <>
              <TaskList />
              {selectedTaskId && <TaskDetail />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
