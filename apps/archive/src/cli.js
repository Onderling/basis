#!/usr/bin/env node
/**
 * archive — CLI entry point.
 *
 * Hand-rolled argv parsing + dispatch (no commander/yargs).  Each command
 * lives in its own module under ./cli/*.
 *
 *   archive init [<db-path>]                     [--force]
 *   archive add-source <pod-root>                [--name <name>]
 *   archive index                                [--source <name|id>] [--force]
 *   archive search "<query>"                     [--limit N] [--source <name|id>]
 *   archive status
 *   archive show <pod-uri>                       [--metadata-only]
 *
 * Exit codes:
 *   0   success
 *   1   command failed at runtime (use ARCHIVE_DEBUG=1 to see stack traces)
 *   2   usage error / unknown command / no command
 */
import { initCmd }      from './cli/initCmd.js';
import { addSourceCmd } from './cli/addSourceCmd.js';
import { indexCmd }     from './cli/indexCmd.js';
import { searchCmd }    from './cli/searchCmd.js';
import { statusCmd }    from './cli/statusCmd.js';
import { showCmd }      from './cli/showCmd.js';

const COMMANDS = {
  'init':       initCmd,
  'add-source': addSourceCmd,
  'index':      indexCmd,
  'search':     searchCmd,
  'status':     statusCmd,
  'show':       showCmd,
};

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd) {
    printHelp();
    process.exit(2);
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printHelp();
    process.exit(0);
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log('archive 0.1.0');
    process.exit(0);
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    process.stderr.write(`archive: unknown command "${cmd}"\n`);
    printHelp();
    process.exit(2);
  }

  try {
    await handler(rest);
  } catch (err) {
    process.stderr.write(`archive ${cmd}: ${err.message}\n`);
    if (process.env.ARCHIVE_DEBUG) process.stderr.write(`${err.stack}\n`);
    if (err.code === 'USAGE' || err.code === 'BAD_FLAG') {
      process.exit(2);
    }
    process.exit(1);
  }
}

function printHelp() {
  process.stdout.write(
    `archive — read-side validator + SQLite FTS5 search over pod content

Usage:  archive <command> [options]

Commands:
  init [<db-path>]              Create config + run schema migration
                                  default db: ~/.local/share/archive/archive.db
                                  --force overwrites an existing config

  add-source <pod-root>         Register a pod root
                                  --name <name>  friendly name (default: hostname)

  index                         Walk every source, refresh the index
                                  --source <name|id>  limit to one source
                                  --force             re-read even if sha256 matches

  search "<query>"              Full-text search via FTS5
                                  --limit N           default 20
                                  --source <name|id>  scope to one source

  status                        Show sources, counts, db size

  show <pod-uri>                Print metadata + indexed content for a resource
                                  --metadata-only     omit the body

  --help, -h                    Show this help
  --version, -v                 Print version
  ARCHIVE_DEBUG=1               Show stack traces on error

v0 caveats:
  - Real-pod OIDC auth is deferred.  Set FOLIO_TEST_MOCK_POD=1 (and
    optionally FOLIO_MOCK_POD_FILE=<path>) to use the in-memory mock.
  - No web UI yet — see apps/archive/README.md for v0 limitations.
`,
  );
}

void main();
