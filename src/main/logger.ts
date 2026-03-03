const isDebug = process.argv.includes('--debug');

export const log = {
  debug(...args: unknown[]) {
    if (isDebug) {
      process.stderr.write(`[DEBUG] ${args.map(String).join(' ')}\n`);
    }
  },
  info(...args: unknown[]) {
    process.stderr.write(`[INFO] ${args.map(String).join(' ')}\n`);
  },
  warn(...args: unknown[]) {
    process.stderr.write(`[WARN] ${args.map(String).join(' ')}\n`);
  },
  error(...args: unknown[]) {
    process.stderr.write(`[ERROR] ${args.map(String).join(' ')}\n`);
  },
};
