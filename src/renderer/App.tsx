import React from 'react';
import { TaskProvider } from './context/TaskContext';
import { TimerProvider } from './context/TimerContext';
import { Layout } from './components/Layout';

export function App() {
  return (
    <TaskProvider>
      <TimerProvider>
        <Layout />
      </TimerProvider>
    </TaskProvider>
  );
}
