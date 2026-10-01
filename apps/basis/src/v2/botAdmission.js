/**
 * botAdmission — who may start talking to a household bot: a person with a code the bot's admin handed out.
 *
 * The door was open (anyone who found the bot could use it) or an allow-list of chat ids nobody could find. Now the
 * admin opens a COHORT (how many people, until when) and hands out codes; a person sends `/start <code>` and is
 * admitted — once per code. The shape is feedback's amnesic cohort: a code is `<nonce>-<sig>`, the signature an HMAC
 * over the cohort and the nonce with a secret only the bot holds, so the bot can check a code WITHOUT keeping the
 * codes it issued. It keeps only the cohort (ceiling, expiry, how many came in) and the hashes of spent codes.
 *
 *   - the SECRET lives in the bot's sealed vault (`secretVault`), generated once;
 *   - the STATE (cohort, count, spent hashes) lives in a sealed store (`store`);
 *   - a new cohort replaces the old one: its codes stop working (`/rotate` closes it without a new one).
 *
 * The gate binds because the bot is the one who acts: a client cannot make it act for someone it did not admit. It
 * does not bind on Telegram's side — anyone can still message the bot and be told they need a code.
 *
 * WebCrypto only (`crypto.subtle`): this runs on the box, and web or a phone never verifies a code.
 */

/** Why a code was not accepted — each has a line in the shared bundle (`circle.bot.admission_<reason>`). */
export const ADMISSION_REFUSALS = Object.freeze(['needs-code', 'invalid-code', 'code-used', 'cohort-expired', 'cohort-full', 'no-cohort']);

const SECRET_KEY = 'bot.admission.secret';
const STATE_ID = 'admission';
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(globalThis.crypto.getRandomValues(new Uint8Array(n)));

async function hmacHex(secret, msg) {
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
const sha256Hex = async (s) => hex(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(String(s))));

/** Constant-time for equal lengths (the signature is fixed-length). */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * @param {object} a
 * @param {{get:(k:string)=>Promise<any>, set:(k:string, v:any)=>Promise<void>}} a.secretVault  the bot's sealed vault
 * @param {{get:(id:string)=>Promise<object|null>, put:(row:object)=>Promise<object>}} a.store  sealed state rows
 * @param {() => number} [a.now]
 */
export function createBotAdmission({ secretVault, store, now = Date.now } = {}) {
  if (!secretVault || typeof secretVault.get !== 'function' || typeof secretVault.set !== 'function') throw new TypeError('createBotAdmission: a secret vault is required');
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') throw new TypeError('createBotAdmission: a state store is required');

  async function secret() {
    let s = await secretVault.get(SECRET_KEY);
    if (typeof s !== 'string' || s.length < 32) {
      s = randomHex(32);
      await secretVault.set(SECRET_KEY, s);
    }
    return s;
  }
  const load = async () => (await store.get(STATE_ID)) ?? { id: STATE_ID, cohort: null, spent: [] };
  // Every change of the state runs one at a time: the same message can arrive several times at once (the pair route and
  // the profile address, retried), and two redemptions that both read the state before either wrote it would both
  // pass — one code, or a one-person cohort, admitting several.
  let chain = Promise.resolve();
  const oneAtATime = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  const save = (state) => store.put({ ...state, id: STATE_ID });

  async function check(code, state) {
    const cohort = state.cohort;
    if (!cohort) return { ok: false, reason: 'no-cohort' };
    const [nonce, sig] = String(code ?? '').trim().split('-');
    if (!nonce || !sig) return { ok: false, reason: 'invalid-code' };
    const expect = (await hmacHex(await secret(), `${cohort.id}:${nonce}`)).slice(0, 12);
    if (!sameText(sig, expect)) return { ok: false, reason: 'invalid-code' };
    if (state.spent.includes(await sha256Hex(code))) return { ok: false, reason: 'code-used' };
    if (now() >= cohort.expiresAt) return { ok: false, reason: 'cohort-expired' };
    if (cohort.count >= cohort.ceiling) return { ok: false, reason: 'cohort-full' };
    return { ok: true };
  }

  return {
    /**
     * Open a cohort: up to `ceiling` people, until `days` from now. Replaces the one before — its codes stop working.
     * @param {{ceiling:number, days:number}} spec
     */
    openCohort({ ceiling, days } = {}) {
      const c = Math.floor(Number(ceiling));
      const d = Number(days);
      if (!Number.isFinite(c) || c < 1 || !Number.isFinite(d) || d <= 0) return Promise.reject(new TypeError('botAdmission: a cohort needs a ceiling ≥ 1 and a number of days > 0'));
      return oneAtATime(async () => {
        const cohort = { id: randomHex(8), ceiling: c, expiresAt: now() + d * 24 * 60 * 60 * 1000, count: 0 };
        await save({ cohort, spent: [] });
        return { ceiling: cohort.ceiling, expiresAt: cohort.expiresAt, count: 0 };
      });
    },
    /** A fresh single-use code for the open cohort, or null when none is open. */
    async code() {
      const { cohort } = await load();
      if (!cohort) return null;
      const nonce = randomHex(8);
      return `${nonce}-${(await hmacHex(await secret(), `${cohort.id}:${nonce}`)).slice(0, 12)}`;
    },
    /** @returns {Promise<{ok:true}|{ok:false, reason:string}>} */
    async validate(code) { return check(code, await load()); },
    /** Spend a code: admitted once. @returns {Promise<{ok:true}|{ok:false, reason:string}>} */
    redeem(code) {
      return oneAtATime(async () => {
        const state = await load();
        const v = await check(code, state);
        if (!v.ok) return v;
        await save({ cohort: { ...state.cohort, count: state.cohort.count + 1 }, spent: [...state.spent, await sha256Hex(code)] });
        return { ok: true };
      });
    },
    /** Close the open cohort: no code of it works any more. */
    rotate() { return oneAtATime(() => save({ cohort: null, spent: [] })); },
    /** The open cohort as the admin sees it (never a code), or null. */
    async status() {
      const { cohort } = await load();
      return cohort ? { ceiling: cohort.ceiling, expiresAt: cohort.expiresAt, count: cohort.count } : null;
    },
  };
}
