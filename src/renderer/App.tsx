import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { TaskProvider } from './context/TaskContext';
import { TimerProvider } from './context/TimerContext';
import { Layout } from './components/Layout';
import { ReportView } from './components/ReportView';

export function App() {
  return (
    <TaskProvider>
      <TimerProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Layout />} />
            <Route path="/reports" element={<Layout view="reports" />} />
          </Routes>
        </HashRouter>
      </TimerProvider>
    </TaskProvider>
  );
}
