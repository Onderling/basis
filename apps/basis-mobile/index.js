// CRITICAL: polyfills MUST be the first import (Hermes resolves crypto
// at module-load time; later imports that need crypto.getRandomValues,
// globalThis.Buffer, Blob.arrayBuffer / .text, or Blob constructor for
// ArrayBuffer parts will crash silently if this lands second).  Same
// substrate as stoop-mobile + folio-mobile + tasks-mobile (see
// apps/stoop-mobile/index.js for the canonical comment).
import '@onderling/react-native/platform/polyfills';

// @expo/metro-runtime adds the fast-refresh + web-only runtime hooks
// required by metro-web (Phase A). Native bundles ignore it.
import '@expo/metro-runtime';

import 'expo-dev-client';
import { registerRootComponent } from 'expo';

import * as TaskManager from 'expo-task-manager';
import { defineBackgroundTask, bgRunOnce } from '@onderling/sync-engine-rn';

import App from './App.js';

// Background-fetch task definition — MUST be at JS-bundle load time per Expo's
// TaskManager API (salvaged from tasks-mobile at its retirement). The task body
// calls `bgRunOnce()` from the substrate's module-level singleton; the chat shell
// wires the actual runOnce (the pod/peer catch-ups) via `wireBackgroundSync` once
// the agent bundle is up. When the OS fires this before that point, `bgRunOnce`
// resolves null and the task reports NoData — a safe miss, retried next interval.
export const BASIS_BG_TASK_NAME = 'basis-mobile-sync-background';

defineBackgroundTask({
  TaskManager,
  taskName: BASIS_BG_TASK_NAME,
  runOnce:  bgRunOnce,
});

registerRootComponent(App);
