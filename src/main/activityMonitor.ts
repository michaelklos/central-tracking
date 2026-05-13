import { screen } from 'electron';
import { execFile } from 'child_process';

let interval: NodeJS.Timeout | null = null;

function nudge(): void {
  if (process.platform === 'darwin') {
    const { x, y } = screen.getCursorScreenPoint();
    execFile('osascript', ['-e', `tell application "System Events" to set position of mouse to {${x + 1}, ${y}}`]);
    setTimeout(() => {
      execFile('osascript', ['-e', `tell application "System Events" to set position of mouse to {${x}, ${y}}`]);
    }, 50);
  } else if (process.platform === 'win32') {
    // Use mouse_event Win32 API directly so Windows registers genuine input activity
    // and resets the idle timer. High-level Cursor.Position moves don't reliably do this.
    const ps =
      'Add-Type -TypeDefinition @"\n' +
      'using System; using System.Runtime.InteropServices;\n' +
      'public class MouseUtils {\n' +
      '  [DllImport(\\"user32.dll\\")]\n' +
      '  public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);\n' +
      '}" @; [MouseUtils]::mouse_event(0x0001, 0, 0, 0, 0)';
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
