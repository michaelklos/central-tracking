import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { TaskList } from './TaskList';
import { TaskDetail } from './TaskDetail';
import { TimerBar } from './TimerBar';
import { useTaskContext } from '../context/TaskContext';
import './Layout.css';

export function Layout() {
  const { selectedTaskId } = useTaskContext();

  return (
    <div className="layout">
      <Sidebar />
      <div className="layout__main">
        <TimerBar />
        <div className="layout__content">
          <TaskList />
          {selectedTaskId && <TaskDetail />}
        </div>
      </div>
    </div>
  );
}
