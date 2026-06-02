// Keep the committed CLI reference (.claude/cli-reference.md) in sync with the
// `ct` command tree. When CLI source changes, regenerate it via `npm run docs`
// and re-stage the result so it lands in the same commit — no manual step, no
// drift. The function form (() => [...]) stops lint-staged from appending the
// matched filenames to the command, since `npm run docs` takes no file args.
module.exports = {
  'src/cli/**/*.{ts,tsx}': () => [
    'npm run docs',
    'git add .claude/cli-reference.md',
  ],
};
