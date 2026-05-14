import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';

const isDebug = process.argv.includes('--debug');
let logFilePath: string | null = null;

function ts(): string {
  return new Date().toISOString();
}

function writeLine(line: string): void {
  process.stderr.write(line + '\n');
  if (logFilePath) {
    try {
      appendFileSync(logFilePath, line + '\n');
    } catch { /* ignore if fs unavailable */ }
  }
}

export function initLogFile(filePath: string): void {
  logFilePath = filePath;

  // Trim to last 2000 lines if file is getting large
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      if (lines.length > 2500) {
        writeFileSync(filePath, lines.slice(-2000).join('\n') + '\n');
      }
    } catch { /* ignore */ }
  }

  writeLine(`[${ts()}] [INFO] ── session start ──────────────────────`);
}

export const log = {
  debug(...args: unknown[]) {
    if (isDebug) {
      writeLine(`[${ts()}] [DEBUG] ${args.map(String).join(' ')}`);
    }
  },
  info(...args: unknown[]) {
    writeLine(`[${ts()}] [INFO] ${args.map(String).join(' ')}`);
  },
  warn(...args: unknown[]) {
    writeLine(`[${ts()}] [WARN] ${args.map(String).join(' ')}`);
  },
  error(...args: unknown[]) {
    writeLine(`[${ts()}] [ERROR] ${args.map(String).join(' ')}`);
  },
};
