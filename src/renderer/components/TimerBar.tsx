import React, { useState, useEffect } from 'react';
import { useTimerContext } from '../context/TimerContext';
import { useTaskContext } from '../context/TaskContext';
import { formatDuration } from '../utils/time';
import './TimerBar.css';

export function TimerBar() {
  const { activeEntry, elapsedSeconds, totalTodaySeconds, stopTimer } = useTimerContext();
  const { tasks } = useTaskContext();
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    window.api.window.getAlwaysOnTop().then(setPinned);
  }, []);

  const handleTogglePin = async () => {
    const next = !pinned;
    await window.api.window.setAlwaysOnTop(next);
    setPinned(next);
  };

  const activeTask = activeEntry ? tasks.find((t) => t.id === activeEntry.taskId) : null;
  const todayDisplay = activeEntry ? totalTodaySeconds + elapsedSeconds : totalTodaySeconds;

  return (
    <div className={`timer-bar ${activeEntry ? 'timer-bar--active' : ''}`}>
      <div className="timer-bar__left">
        {activeEntry ? (
          <>
            <span className="timer-bar__pulse" />
            <span className="timer-bar__label">Tracking:</span>
            <span className="timer-bar__task-name">{activeTask?.title ?? 'Unknown task'}</span>
          </>
        ) : (
          <span className="timer-bar__label">No timer running</span>
        )}
      </div>
      <div className="timer-bar__right">
        <span className="timer-bar__today">Today: {formatDuration(todayDisplay)}</span>
        {activeEntry && (
          <>
            <span className="timer-bar__elapsed">{formatDuration(elapsedSeconds)}</span>
            <button className="timer-bar__stop" onClick={stopTimer}>
              Stop
            </button>
          </>
        )}
        <button
          className={`timer-bar__pin ${pinned ? 'timer-bar__pin--active' : ''}`}
          onClick={handleTogglePin}
          title={pinned ? 'Unpin window' : 'Pin window on top'}
        >
          {pinned ? '\u{1F4CD}' : '\u{1F4CC}'}
        </button>
      </div>
    </div>
  );
}
