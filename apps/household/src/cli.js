#!/usr/bin/env node
/**
 * household — CLI entry point.
 *
 * Phase 0: only `help` works.  Phase 5 fills in `init` / `serve` /
 * `doctor` / `install-service`.
 */

const HELP = `household — Telegram-driven household-state agent (H2 — scaffold)

Usage:
  household help            Show this message.
  household serve           [Phase 5] Run the agent.
  household init            [Phase 5] One-time setup wizard.
  household doctor          [Phase 5] Sanity check config + connectivity.
  household install-service [Phase 5] Install systemd / launchd unit.

This is a scaffold.  See apps/household/README.md for the plan.
`;

function main(argv) {
  const cmd = argv[2] ?? 'help';
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  process.stderr.write(`household: '${cmd}' is not implemented yet (scaffold).  Try 'household help'.\n`);
  process.exit(1);
}

main(process.argv);
