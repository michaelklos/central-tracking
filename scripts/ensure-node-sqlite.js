/**
 * Ensures the better-sqlite3 native module is compatible with Node.js (not
 * Electron). Skips the rebuild if it already loads. Run as the pretest hook.
 *
 * Tries a prebuilt binary first; if none exists for the current Node version
 * (e.g. a brand-new major before better-sqlite3 ships prebuilds for it), falls
 * back to compiling from source via node-gyp — mirroring better-sqlite3's own
 * install script (`prebuild-install || node-gyp rebuild --release`). Without
 * this fallback the suite can't run on the latest Node majors.
 */
const { execSync } = require('child_process');
const path = require('path');

const bsqliteDir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
// Resolve prebuild-install's JS entrypoint (not the node_modules/.bin shim,
// which is a .cmd on Windows and can't be run via `node`). Resolve from
// better-sqlite3's own directory so it's found whether prebuild-install is
// hoisted to the repo root or nested under better-sqlite3/node_modules.
const prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [bsqliteDir] });

function run(cmd) {
  execSync(cmd, { cwd: bsqliteDir, stdio: 'inherit' });
}

try {
  require('better-sqlite3')(':memory:').close();
} catch {
  console.log('Rebuilding better-sqlite3 for Node.js...');
  try {
    run(`node "${prebuildInstall}" -r node`);
  } catch {
    console.log('No prebuilt binary for this Node version — compiling from source...');
    run('npm run build-release');
  }
}
