/**
 * Ensures better-sqlite3 native module is compatible with Node.js (not Electron).
 * Skips rebuild if already compatible. Run as pretest hook.
 */
try {
  require('better-sqlite3')(':memory:').close();
} catch {
  const { execSync } = require('child_process');
  const path = require('path');
  console.log('Rebuilding better-sqlite3 for Node.js...');
  execSync('node ' + path.join(__dirname, '..', 'node_modules', '.bin', 'prebuild-install') + ' -r node', {
    cwd: path.join(__dirname, '..', 'node_modules', 'better-sqlite3'),
    stdio: 'inherit',
  });
}
