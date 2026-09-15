/**
 * Which verifier each signed lane's rail folds with — declared beside the kinds table, in the app that wires it.
 *
 * `ENTRY_KINDS` says per kind what a receiver ACCEPTS it with; the rails choose their verifier at wiring time
 * (`makeTaskRail` defaults to `rosterBindingVerifier`, `makeKeyRail` to `keyBindingVerifier`, …). Two layers,
 * one fact. This module names the rail-side answer so a test can pin the agreement: change a rail's default
 * verifier, or a kind's `accepts` cell, and the other must follow or the test says so.
 *
 * Read by no runtime path yet — the rails still pick their verifier themselves. The later step reads the table.
 */
import { ACCEPTS } from '@onderling/item-store';
import { CHAT_LANE } from './chatManifest.js';
import { TASK_LANE } from './taskManifest.js';
import { GOVERNANCE_LANE } from './governanceManifest.js';
import { MEMBERSHIP_LANE } from './membershipManifest.js';
import { KEY_LANE } from './keyManifest.js';
import { GRANTS_LANE } from './grantsManifest.js';

/** lane kind → the ACCEPTS name of the verifier its rail defaults to. */
export const LANE_ACCEPTS = Object.freeze({
  [CHAT_LANE]:       ACCEPTS.ROSTER,
  [TASK_LANE]:       ACCEPTS.ROSTER,
  [GOVERNANCE_LANE]: ACCEPTS.ROSTER,
  [MEMBERSHIP_LANE]: ACCEPTS.MEMBERSHIP,
  [KEY_LANE]:        ACCEPTS.KEY,
  [GRANTS_LANE]:     ACCEPTS.DEVICE_SET,
});
