/**
 * params — RE-EXPORT SHIM. The parameter register (#36) was homed in `core`, then moved DOWN to the zero-dep
 * base leaf `@onderling/params` (2026-08-09) so lightweight leaves need not depend on the heavy kernel just to
 * declare a param. This shim keeps `core`'s own internal `../params.js` imports and `core`'s barrel working
 * unchanged — everything re-exports from `@onderling/params`. Import from `@onderling/core` (or the leaf
 * directly) as before.
 */
export {
  PARAM_SCOPE, PARAM_KIND, param, createParamRegistry, setParam,
} from '@onderling/params';
