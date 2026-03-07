import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { TaskProvider } from './context/TaskContext';
import { TimerProvider } from './context/TimerContext';
import { ReportProvider } from './context/ReportContext';
import { Layout } from './components/Layout';

export function App() {
  return (
    <TaskProvider>
      <TimerProvider>
        <ReportProvider>
          <HashRouter>
            <Routes>
              <Route path="/" element={<Layout />} />
              <Route path="/reports" element={<Layout view="reports" />} />
              <Route path="/timeline" element={<Layout view="timeline" />} />
            </Routes>
          </HashRouter>
        </ReportProvider>
      </TimerProvider>
    </TaskProvider>
  );
}
