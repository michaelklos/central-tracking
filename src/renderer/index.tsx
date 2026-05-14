import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

// Forward unhandled renderer errors to the main process log file
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason instanceof Error
    ? `${event.reason.message}\n${event.reason.stack ?? ''}`
    : String(event.reason);
  window.api.log.error(`Unhandled promise rejection: ${msg}`);
});
window.addEventListener('error', (event) => {
  const msg = event.error instanceof Error
    ? `${event.error.message}\n${event.error.stack ?? ''}`
    : `${event.message} (${event.filename}:${event.lineno})`;
  window.api.log.error(`Uncaught error: ${msg}`);
});

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
