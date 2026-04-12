#!/usr/bin/env node
import yargs, { type Argv } from 'yargs';
import { hideBin } from 'yargs/helpers';
import { registerTaskCommands } from './commands/task';
import { registerTimerCommands } from './commands/timer';
import { registerTimeCommands } from './commands/time';
import { registerReportCommands } from './commands/report';
import { registerCommentCommands } from './commands/comment';
import { registerCategoryCommands } from './commands/category';
import { registerImportCommands } from './commands/import';
import { registerStatusCommands } from './commands/status';

const cli: Argv = yargs(hideBin(process.argv))
  .scriptName('ct')
  .usage('$0 [--json] <command> [subcommand] [args]')
  .option('json', {
    type: 'boolean',
    global: true,
    default: false,
    describe: 'Output in JSON format',
  })
  .strict();

// Register all command groups
registerTaskCommands(cli);
registerTimerCommands(cli);
registerTimeCommands(cli);
registerReportCommands(cli);
registerCommentCommands(cli);
registerCategoryCommands(cli);
registerImportCommands(cli);
registerStatusCommands(cli);

cli
  .demandCommand(1, 'Specify a command. Use --help for available commands.')
  .help()
  .alias('h', 'help')
  .fail((msg, err) => {
    if (err) {
      console.error(err.message);
    } else if (msg) {
      console.error(msg);
      console.error('\nRun "ct --help" for usage.');
    }
    process.exit(1);
  })
  .parse();
