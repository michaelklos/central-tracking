import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Argv } from 'yargs';
import { runCommand, output, say, fail } from '../runtime';
import type { Plugin, PluginManifest, PluginConfigSchemaEntry } from '../../shared/types';

/**
 * Rewrite relative path tokens inside the entrypoint string to absolute paths
 * resolved against the manifest's directory. Lets `ct plugin run <id>` work
 * from any CWD, not just the repo root.
 *
 * Heuristic: skip the first token (the executable, e.g. `node`), skip flags,
 * skip already-absolute paths, and resolve anything that contains a path
 * separator or a `.js`/`.cjs`/`.mjs` extension.
 */
function absolutizeEntrypoint(entrypoint: string, manifestDir: string): string {
  const tokens = entrypoint.split(/\s+/);
  return tokens
    .map((t, i) => {
      if (i === 0) return t;
      if (t.startsWith('-')) return t;
      if (path.isAbsolute(t)) return t;
      const looksLikePath = t.includes('/') || t.includes('\\') || /\.(js|cjs|mjs)$/.test(t);
      return looksLikePath ? path.resolve(manifestDir, t) : t;
    })
    .join(' ');
}

function readManifestFile(filePath: string): PluginManifest {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) fail(`Plugin manifest not found: ${abs}`);
  const raw = fs.readFileSync(abs, 'utf-8');
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(raw) as PluginManifest;
  } catch (err) {
    fail(`Invalid JSON in ${abs}: ${(err as Error).message}`);
  }
  if (manifest.entrypoint) {
    manifest.entrypoint = absolutizeEntrypoint(manifest.entrypoint, path.dirname(abs));
  }
  return manifest;
}

async function promptYesNo(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let buf = '';
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      const answer = buf.slice(0, nl).trim().toLowerCase();
      resolve(answer === 'y' || answer === 'yes');
    };
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function statusLabel(s: PluginConfigSchemaEntry['status']): string {
  switch (s) {
    case 'unset': return 'unset';
    case 'set': return 'set';
    case 'encrypted': return 'encrypted';
    case 'plaintext-secret': return 'plaintext-secret ⚠';
  }
}

function formatPluginSchema(plugin: Plugin, schema: PluginConfigSchemaEntry[]): string {
  const header = `${plugin.id} (${plugin.name}, v${plugin.version})\n`;
  if (schema.length === 0) {
    return `${header}\n  (no configSchema declared in plugin.json — set keys are stored as-is)`;
  }
  const rows = schema.map((s) => ({
    key: s.key,
    required: s.required ? 'yes' : 'no',
    secret: s.secret ? 'yes' : 'no',
    status: statusLabel(s.status),
    env: s.envVarName ?? '',
    desc: s.description ?? '',
  }));
  const widths = {
    key: Math.max(3, ...rows.map((r) => r.key.length)),
    required: Math.max(8, ...rows.map((r) => r.required.length)),
    secret: Math.max(6, ...rows.map((r) => r.secret.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    env: Math.max(12, ...rows.map((r) => r.env.length)),
  };
  const head = `  ${'KEY'.padEnd(widths.key)}  ${'REQUIRED'.padEnd(widths.required)}  ${'SECRET'.padEnd(widths.secret)}  ${'STATUS'.padEnd(widths.status)}  ${'ENV OVERRIDE'.padEnd(widths.env)}  DESCRIPTION`;
  const lines = rows.map((r) =>
    `  ${r.key.padEnd(widths.key)}  ${r.required.padEnd(widths.required)}  ${r.secret.padEnd(widths.secret)}  ${r.status.padEnd(widths.status)}  ${r.env.padEnd(widths.env)}  ${r.desc}`,
  );
  return [header, head, ...lines].join('\n');
}

function formatPluginList(plugins: Plugin[]): string {
  if (plugins.length === 0) return 'No plugins installed.';
  const lines = plugins.map((p) => {
    const status = p.enabled ? 'enabled ' : 'disabled';
    const webhook = p.manifest.webhook?.url ?? '—';
    return `  ${status}  ${p.id.padEnd(16)} ${p.version.padEnd(10)} ${webhook}`;
  });
  return ['Installed plugins:', ...lines].join('\n');
}

export function registerPluginCommands(yargs: Argv): Argv {
  return yargs.command('plugin', 'Manage external plugins', (y) =>
    y
      .command(
        'install <manifest-file>',
        'Install or update a plugin from a manifest JSON file',
        (yy) => yy.positional('manifest-file', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const manifest = readManifestFile(argv['manifest-file'] as string);
            const plugin = await client.plugins.install(manifest);
            output(argv, plugin, (p) => `Installed plugin ${p.id} (${p.name} ${p.version})`);
          }),
      )
      .command(
        'list',
        'List installed plugins',
        () => {},
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const plugins = await client.plugins.list();
            output(argv, plugins, formatPluginList);
          }),
      )
      .command(
        'enable <id>',
        'Enable a plugin (webhook subscriptions become active)',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const plugin = await client.plugins.setEnabled(argv.id as string, true);
            output(argv, plugin, (p) => `Enabled plugin ${p.id}`);
          }),
      )
      .command(
        'disable <id>',
        'Disable a plugin (stops receiving events)',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const plugin = await client.plugins.setEnabled(argv.id as string, false);
            output(argv, plugin, (p) => `Disabled plugin ${p.id}`);
          }),
      )
      .command(
        'uninstall <id>',
        'Remove a plugin and convert its tasks to local ad-hoc',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .option('force', {
              type: 'boolean',
              default: false,
              describe: 'Skip the confirmation prompt (required in --json / non-TTY)',
            }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const id = argv.id as string;
            const preflight = await client.plugins.uninstall(id);
            if (!('requiresConfirmation' in preflight)) {
              // Shouldn't happen — preflight always returns the confirmation shape
              // when convertTasksToAdHoc is absent. Defensive guard.
              say(`Uninstalled plugin ${id}`);
              return;
            }
            const { taskCount } = preflight;
            const force = argv.force as boolean;
            const isJson = (argv as { json?: boolean }).json === true;

            if (taskCount > 0 && !force) {
              if (isJson || !process.stdin.isTTY) {
                fail(
                  `Uninstall of "${id}" would convert ${taskCount} task(s) to local ad-hoc tasks. ` +
                    `This clears their external_id/url/state and is irreversible. ` +
                    `Re-run with --force to confirm.`,
                );
              }
              const answer = await promptYesNo(
                `Uninstall "${id}"? ${taskCount} task(s) will be converted to local ad-hoc tasks ` +
                  `(external_id/url/state cleared). This is irreversible. Continue? [y/N] `,
              );
              if (!answer) {
                say(`Aborted. Plugin "${id}" not uninstalled.`);
                return;
              }
            }

            const result = await client.plugins.uninstall(id, { convertTasksToAdHoc: true });
            output(
              argv,
              result,
              () => {
                if ('uninstalled' in result) {
                  return `Uninstalled plugin ${id} (converted ${result.convertedTasks} task(s) to ad-hoc)`;
                }
                return `Uninstalled plugin ${id}`;
              },
            );
          }),
      )
      .command('config', 'Get or set plugin configuration', (cc) =>
        cc
          .command(
            'get <id> <key>',
            'Read a plugin config value',
            (yy) =>
              yy
                .positional('id', { type: 'string', demandOption: true })
                .positional('key', { type: 'string', demandOption: true })
                .option('reveal', { type: 'boolean', default: false, describe: 'Print cleartext for secret keys (default: masked)' }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                const value = await client.plugins.getConfig(
                  argv.id as string,
                  argv.key as string,
                  { reveal: argv.reveal as boolean },
                );
                output(argv, { key: argv.key, value }, () => (value ?? ''));
              }),
          )
          .command(
            'set <id> <key> [value]',
            'Write a plugin config value',
            (yy) =>
              yy
                .positional('id', { type: 'string', demandOption: true })
                .positional('key', { type: 'string', demandOption: true })
                .positional('value', { type: 'string', describe: 'Value (omit when using --secret-from-stdin)' })
                .option('secret', { type: 'boolean', default: false, describe: 'Force-treat as secret (encrypt via OS keychain)' })
                .option('secret-from-stdin', { type: 'boolean', default: false, describe: 'Read value from stdin; implies --secret; keeps value out of shell history' })
                .option('allow-plaintext', { type: 'boolean', default: false, describe: 'Allow plaintext storage when OS keyring is unavailable' }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                const fromStdin = argv['secret-from-stdin'] as boolean;
                let value = argv.value as string | undefined;
                if (fromStdin && value !== undefined) {
                  fail('Cannot pass <value> when --secret-from-stdin is set.');
                }
                if (fromStdin) {
                  value = await readStdin();
                  if (!value) fail('No value received on stdin.');
                  // Strip a single trailing newline (common when piping `echo`).
                  if (value.endsWith('\n')) value = value.slice(0, -1);
                  if (value.endsWith('\r')) value = value.slice(0, -1);
                }
                if (value === undefined) {
                  fail('Specify <value> or use --secret-from-stdin.');
                }
                const secret = (argv.secret as boolean) || fromStdin;
                const allowPlaintext = argv['allow-plaintext'] as boolean;
                const res = await client.plugins.setConfig(
                  argv.id as string,
                  argv.key as string,
                  value as string,
                  { secret, allowPlaintext },
                );
                const tag = res.stored === 'encrypted' ? ' (encrypted)' : '';
                say(`Set ${argv.id}.${argv.key}${tag}`);
                if (res.warning) say(`⚠  ${res.warning}`);
              }),
          )
          .command(
            'list <id>',
            'List all config keys for a plugin',
            (yy) =>
              yy
                .positional('id', { type: 'string', demandOption: true })
                .option('reveal', { type: 'boolean', default: false, describe: 'Print cleartext for secret keys (default: masked)' }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                const entries = await client.plugins.listConfig(
                  argv.id as string,
                  { reveal: argv.reveal as boolean },
                );
                output(argv, entries, (es) =>
                  es.length === 0
                    ? 'No config set.'
                    : es.map((e) => {
                        const tag = e.secret
                          ? e.stored === 'encrypted' ? ' [encrypted]' : ' [plaintext-secret]'
                          : '';
                        return `  ${e.key} = ${e.value}${tag}`;
                      }).join('\n'),
                );
              }),
          )
          .command(
            'delete <id> <key>',
            'Delete a plugin config key',
            (yy) =>
              yy
                .positional('id', { type: 'string', demandOption: true })
                .positional('key', { type: 'string', demandOption: true }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                await client.plugins.deleteConfig(argv.id as string, argv.key as string);
                say(`Deleted ${argv.id}.${argv.key}`);
              }),
          )
          .demandCommand(1, 'Specify a config subcommand'),
      )
      .command(
        'schema <id>',
        'Show a plugin\'s declared config keys (required/secret/status/env)',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            const plugin = await client.plugins.get(argv.id as string);
            if (!plugin) fail(`Plugin not found: ${argv.id}`);
            const schema = await client.plugins.schema(argv.id as string);
            output(argv, schema, () => formatPluginSchema(plugin, schema));
          }),
      )
      .command(
        'run <id> [pluginArgs..]',
        'Spawn a plugin\'s entrypoint with CT_* env vars (extra args are forwarded)',
        (yy) =>
          yy
            .positional('id', { type: 'string', demandOption: true })
            .positional('pluginArgs', { type: 'string', array: true, default: [] }),
        (argv) =>
          runCommand(argv, async ({ client, server }) => {
            const plugin = await client.plugins.get(argv.id as string);
            if (!plugin) fail(`Plugin not found: ${argv.id}`);
            if (!plugin.manifest.entrypoint && !plugin.manifest.entrypointArgv) {
              fail(`Plugin ${plugin.id} has no entrypoint`);
            }

            // Required-key gating: refuse to spawn if a declared-required key
            // is unset AND no env override is present. Saves the plugin from
            // crashing mid-run with a less helpful error.
            const schema = await client.plugins.schema(plugin.id);
            const missing: string[] = [];
            for (const s of schema) {
              if (!s.required || s.status !== 'unset') continue;
              const envName = s.envVarName ?? null;
              if (envName && process.env[envName]) continue;
              missing.push(s.key);
            }
            if (missing.length > 0) {
              fail(
                `Missing required config for plugin "${plugin.id}": ${missing.join(', ')}.\n` +
                  `Set with:  ct plugin config set ${plugin.id} <key> <value>\n` +
                  `Or run:    ct plugin schema ${plugin.id}   to see all keys.`,
              );
            }

            // Prefer pre-tokenized argv (bundled plugins use this so paths
            // with spaces survive). Fall back to splitting the string form
            // for sideloaded plugins authored by hand.
            const tokens = plugin.manifest.entrypointArgv
              ?? plugin.manifest.entrypoint!.split(/\s+/).filter(Boolean);
            const [cmd, ...args] = tokens;
            const forwarded = (argv.pluginArgs as string[]) ?? [];
            const child = spawn(cmd, [...args, ...forwarded], {
              stdio: 'inherit',
              env: {
                ...process.env,
                ...(plugin.manifest.env ?? {}),
                CT_PLUGIN_ID: plugin.id,
                CT_SERVER_URL: `http://127.0.0.1:${server.port}`,
                CT_TOKEN: server.token,
              },
            });
            await new Promise<void>((resolve) => {
              child.on('exit', (code) => {
                if (code !== 0 && code !== null) process.exitCode = code;
                resolve();
              });
            });
          }),
      )
      .demandCommand(1, 'Specify a plugin subcommand'),
  );
}
