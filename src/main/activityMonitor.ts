import { screen } from 'electron';
import { execFile } from 'child_process';

let interval: NodeJS.Timeout | null = null;

function nudge(): void {
  const { x, y } = screen.getCursorScreenPoint();
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', `tell application "System Events" to set position of mouse to {${x + 1}, ${y}}`]);
    setTimeout(() => {
      execFile('osascript', ['-e', `tell application "System Events" to set position of mouse to {${x}, ${y}}`]);
    }, 50);
  } else if (process.platform === 'win32') {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; ` +
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x + 1}, ${y}); ` +
      `Start-Sleep -Milliseconds 50; ` +
      `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
  }
}

export function startMouseMover(): void {
  if (interval) return;
  nudge();
  interval = setInterval(nudge, 60_000);
}

export function stopMouseMover(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
