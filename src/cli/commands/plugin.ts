import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import type { Argv } from 'yargs';
import { runCommand, output, say, fail } from '../runtime';
import type { Plugin, PluginManifest } from '../../shared/types';

function readManifestFile(filePath: string): PluginManifest {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) fail(`Plugin manifest not found: ${abs}`);
  const raw = fs.readFileSync(abs, 'utf-8');
  try {
    return JSON.parse(raw) as PluginManifest;
  } catch (err) {
    fail(`Invalid JSON in ${abs}: ${(err as Error).message}`);
  }
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
        'Remove a plugin and its config',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client }) => {
            await client.plugins.uninstall(argv.id as string);
            say(`Uninstalled plugin ${argv.id}`);
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
                .positional('key', { type: 'string', demandOption: true }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                const value = await client.plugins.getConfig(argv.id as string, argv.key as string);
                output(argv, { key: argv.key, value }, () => (value ?? ''));
              }),
          )
          .command(
            'set <id> <key> <value>',
            'Write a plugin config value',
            (yy) =>
              yy
                .positional('id', { type: 'string', demandOption: true })
                .positional('key', { type: 'string', demandOption: true })
                .positional('value', { type: 'string', demandOption: true }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                await client.plugins.setConfig(argv.id as string, argv.key as string, argv.value as string);
                say(`Set ${argv.id}.${argv.key}`);
              }),
          )
          .command(
            'list <id>',
            'List all config keys for a plugin',
            (yy) => yy.positional('id', { type: 'string', demandOption: true }),
            (argv) =>
              runCommand(argv, async ({ client }) => {
                const entries = await client.plugins.listConfig(argv.id as string);
                output(argv, entries, (es) =>
                  es.length === 0 ? 'No config set.' : es.map((e) => `  ${e.key} = ${e.value}`).join('\n'),
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
        'run <id>',
        'Spawn a plugin\'s entrypoint with CT_* env vars',
        (yy) => yy.positional('id', { type: 'string', demandOption: true }),
        (argv) =>
          runCommand(argv, async ({ client, server }) => {
            const plugin = await client.plugins.get(argv.id as string);
            if (!plugin) fail(`Plugin not found: ${argv.id}`);
            if (!plugin.manifest.entrypoint) fail(`Plugin ${plugin.id} has no entrypoint`);

            const [cmd, ...args] = plugin.manifest.entrypoint.split(/\s+/);
            const child = spawn(cmd, args, {
              stdio: 'inherit',
              env: {
                ...process.env,
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
