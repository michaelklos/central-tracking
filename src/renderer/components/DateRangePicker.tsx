import React from 'react';
import { toLocalDateString as toDateString } from '../../shared/dateRange';
import './DateRangePicker.css';

interface DateRangePickerProps {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  return d;
}

export function DateRangePicker({ start, end, onChange }: DateRangePickerProps) {
  const handleToday = () => {
    const today = toDateString(new Date());
    onChange(today, today);
  };

  const handleThisWeek = () => {
    const now = new Date();
    const weekStart = getStartOfWeek(now);
    onChange(toDateString(weekStart), toDateString(now));
  };

  const handleThisMonth = () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    onChange(toDateString(monthStart), toDateString(now));
  };

  return (
    <div className="date-range-picker">
      <div className="date-range-picker__inputs">
        <input
          type="date"
          value={start}
          onChange={(e) => onChange(e.target.value, end)}
        />
        <span className="date-range-picker__separator">to</span>
        <input
          type="date"
          value={end}
          onChange={(e) => onChange(start, e.target.value)}
        />
      </div>
      <div className="date-range-picker__presets">
        <button onClick={handleToday}>Today</button>
        <button onClick={handleThisWeek}>This Week</button>
        <button onClick={handleThisMonth}>This Month</button>
      </div>
    </div>
  );
}
