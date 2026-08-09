/**
 * @onderling/params — the parameter register (#36), the zero-dependency base leaf.
 *
 * `param()` declares a tunable at its site (scope drives sync, kind is the security gate); the register is the
 * DI home for settable values; `setParam` is the one kind-enforcing set op. Homed at the true base so every
 * layer can declare params. `PARAM_HOME_FOR` stays internal to params.js (used by the register + its test).
 */
export {
  PARAM_SCOPE, PARAM_KIND, param, createParamRegistry, setParam,
} from './params.js';
