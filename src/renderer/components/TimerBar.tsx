import React from 'react';
import { useTimerContext } from '../context/TimerContext';
import { useTaskContext } from '../context/TaskContext';
import { formatDuration } from '../utils/time';
import './TimerBar.css';

export function TimerBar() {
  const { activeEntry, elapsedSeconds, stopTimer } = useTimerContext();
  const { tasks } = useTaskContext();

  const activeTask = activeEntry ? tasks.find((t) => t.id === activeEntry.taskId) : null;

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
        {activeEntry && (
          <>
            <span className="timer-bar__elapsed">{formatDuration(elapsedSeconds)}</span>
            <button className="timer-bar__stop" onClick={stopTimer}>
              Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
