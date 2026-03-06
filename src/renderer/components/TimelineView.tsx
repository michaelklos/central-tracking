import React, { useState, useEffect, useCallback } from 'react';
import { buildTimeline, type TimelineItem, type TimelineOptions } from '../utils/timeline';
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

export function TimelineView() {
  const [entries, setEntries] = useState<TimeEntryWithTask[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTimeline = useCallback(async () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0).toISOString();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString();

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
  }, []);

  useEffect(() => {
    loadTimeline();
    // Refresh every 60 seconds for active timers
    const interval = setInterval(loadTimeline, 60000);
    return () => clearInterval(interval);
  }, [loadTimeline]);

  const trackedSeconds = entries.reduce((sum, e) => {
    const start = new Date(e.startTime).getTime();
    const end = e.endTime ? new Date(e.endTime).getTime() : Date.now();
    return sum + Math.floor((end - start) / 1000);
  }, 0);

  const untrackedSeconds = timeline
    .filter((i) => i.type === 'gap')
    .reduce((sum, i) => sum + i.durationSeconds, 0);

  if (loading) {
    return (
      <div className="timeline-view">
        <p className="timeline-view__loading">Loading timeline...</p>
      </div>
    );
  }

  return (
    <div className="timeline-view">
      <h2 className="timeline-view__title">Today's Timeline</h2>

      <div className="timeline-view__totals">
        <span className="timeline-view__tracked">
          Tracked: {formatDurationHuman(trackedSeconds)}
        </span>
        <span className="timeline-view__untracked">
          Untracked: {formatDurationHuman(untrackedSeconds)}
        </span>
      </div>

      {timeline.length === 0 ? (
        <p className="timeline-view__empty">No time entries for today.</p>
      ) : (
        <div className="timeline-view__list">
          {timeline.map((item, index) => (
            <div
              key={index}
              className={`timeline-view__item ${item.type === 'gap' ? 'timeline-view__item--gap' : 'timeline-view__item--entry'}`}
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
