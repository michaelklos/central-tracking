import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { buildTimeline, type TimelineItem, type TimelineOptions } from '../utils/timeline';
import { useTaskContext } from '../context/TaskContext';
import { formatDurationHuman } from '../../shared/duration';
import type { TimeEntryWithTask, TaskSource } from '../../shared/types';
import './TimelineView.css';

function getStringSetting(key: string, defaultValue: string): string {
  return localStorage.getItem(key) ?? defaultValue;
}

function sourcePrefix(source?: string): string {
  switch (source) {
    case 'email': return '[Email] ';
    case 'meeting-prep': return '[Meeting Prep] ';
    case 'plugin': return '[Plugin] ';
    default: return '';
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function toDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function TimelineView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectTask, createTask, setPendingTimeEntry } = useTaskContext();
  const [entries, setEntries] = useState<TimeEntryWithTask[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const viewDate = useMemo(() => {
    const dateParam = searchParams.get('date');
    if (dateParam) {
      const [y, m, d] = dateParam.split('-').map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    return new Date();
  }, [searchParams]);

  const isViewingToday = isSameDay(viewDate, new Date());

  const loadTimeline = useCallback(async () => {
    const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), 0, 0, 0).toISOString();
    const end = new Date(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate(), 23, 59, 59).toISOString();

    const data = await window.api.timeEntries.getByDateRangeWithTasks(start, end);
    setEntries(data);

    const options: TimelineOptions = {
      workStartTime: getStringSetting('ct-option-work-hours-start', '08:00'),
      workEndTime: getStringSetting('ct-option-work-hours-end', '17:00'),
      minGapMinutes: parseInt(getStringSetting('ct-option-min-gap-minutes', '15'), 10),
      gapLabel: getStringSetting('ct-option-gap-label', 'gap'),
    };

    setTimeline(buildTimeline(data, options));
    setLoading(false);
  }, [viewDate]);

  useEffect(() => {
    loadTimeline();
    // Only auto-refresh when viewing today (for active timers)
    if (isViewingToday) {
      const interval = setInterval(loadTimeline, 60000);
      return () => clearInterval(interval);
    }
  }, [loadTimeline, isViewingToday]);

  const goToPreviousDay = () => {
    const prev = new Date(viewDate);
    prev.setDate(prev.getDate() - 1);
    setSearchParams({ date: toDateString(prev) });
  };

  const goToNextDay = () => {
    const next = new Date(viewDate);
    next.setDate(next.getDate() + 1);
    setSearchParams({ date: toDateString(next) });
  };

  const goToToday = () => {
    setSearchParams({});
  };

  const trackedSeconds = entries.reduce((sum, e) => {
    const start = new Date(e.startTime).getTime();
    const end = e.endTime ? new Date(e.endTime).getTime() : Date.now();
    return sum + Math.floor((end - start) / 1000);
  }, 0);

  const untrackedSeconds = timeline
    .filter((i) => i.type === 'gap')
    .reduce((sum, i) => sum + i.durationSeconds, 0);

  const handleItemClick = async (item: TimelineItem) => {
    if (item.type === 'gap') {
      const task = await createTask({ title: 'New task', source: 'ad-hoc' });
      selectTask(task.id);
      setPendingTimeEntry({
        startTime: item.startTime.toISOString(),
        endTime: item.endTime.toISOString(),
      });
      navigate('/');
    } else if (item.taskId) {
      selectTask(item.taskId);
      navigate('/');
    }
  };

  if (loading) {
    return (
      <div className="timeline-view">
        <p className="timeline-view__loading">Loading timeline...</p>
      </div>
    );
  }

  return (
    <div className="timeline-view">
      <div className="timeline-view__header">
        <div className="timeline-view__nav">
          <button className="timeline-view__nav-btn" onClick={goToPreviousDay} title="Previous day">&lsaquo;</button>
          <h2 className="timeline-view__title">
            {isViewingToday ? "Today's Timeline" : formatDateLabel(viewDate)}
          </h2>
          <button className="timeline-view__nav-btn" onClick={goToNextDay} title="Next day">&rsaquo;</button>
        </div>
        {!isViewingToday && (
          <button className="timeline-view__today-btn" onClick={goToToday}>Today</button>
        )}
      </div>

      <div className="timeline-view__totals">
        <span className="timeline-view__tracked">
          Tracked: {formatDurationHuman(trackedSeconds)}
        </span>
        <span className="timeline-view__untracked">
          Untracked: {formatDurationHuman(untrackedSeconds)}
        </span>
      </div>

      {timeline.length === 0 ? (
        <p className="timeline-view__empty">
          No time entries for {isViewingToday ? 'today' : formatDateLabel(viewDate)}.
        </p>
      ) : (
        <div className="timeline-view__list">
          {timeline.map((item, index) => (
            <div
              key={index}
              className={`timeline-view__item ${item.type === 'gap' ? 'timeline-view__item--gap' : 'timeline-view__item--entry'}`}
              onClick={() => handleItemClick(item)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleItemClick(item); } }}
              role="button"
              tabIndex={0}
            >
              <span className="timeline-view__time">{formatTime(item.startTime)}</span>
              <span className="timeline-view__rail">&#x2503;</span>
              {item.type === 'gap' ? (
                <span className="timeline-view__label timeline-view__label--gap">
                  [{item.label}] {formatDurationHuman(item.durationSeconds)} untracked
                </span>
              ) : (
                <span className="timeline-view__label">
                  {sourcePrefix(item.taskSource)}{item.taskTitle} ({formatDurationHuman(item.durationSeconds)})
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
