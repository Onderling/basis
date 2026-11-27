# Keys, devices and recovery

The person's own key: where it is kept on each device, what guards it, and the ways back when a device or a code is
lost. Started 2026-11-26 with the browser lock only. Not written here yet, and belonging here: the recovery phrase
(showing it, restoring from it), start over, the recovery file, and enrolling, replacing and retiring a device.

## What a person can do

- Lock their own Basis in the browser (optional): in Instellingen → Herstel, a switch asks a code or a passphrase
  twice, with a plain line that a short code stops someone at the computer and not someone who copies the browser's
  files. From then on every open, a reload included, shows the lock screen before anything starts.
- Open it with the code. A wrong code says so and asks again; the right one opens the same person.
- Lock it now (while the lock is on): the tab forgets the key and reloads onto the lock screen.
- Switch the lock off: the code is asked once. To change the code: switch it off and on again.
- Forget the code: "forgot" on the lock screen opens the start-over page; the recovery phrase brings back the same
  person on a cleared browser. The code itself cannot be recovered from the device.
- On the phone: a line in the same section says the key is guarded by the phone's own screen lock. The box shows nothing
  (it starts unattended).

## Where it lives

- **The door**: `packages/vault/src/RootKeyStoreWebCrypto.js`, the browser's root-key door. The lock is a slot of the
  passphrase kind that wraps the door's key (Argon2id, parameters stored in the slot): `status`, `unlock`, `lock`,
  `setLock`, `clearLock`. While locked, no key in the browser is usable.
- **The boot step**: `openKeyDoorAtBoot` in `apps/basis/src/core/agent/ownerRootCustody.js` (a shell seam, web only):
  it asks until the door opens. `pickRootKeyStore` there builds the door with the passphrase derivation.
- **The web shell**: `apps/basis/web/v2/circleApp.js` builds the door once at the start, right after the start-over
  check, paints the lock screen while it is locked, and hands the same open door to the agent. The settings acts
  (`appLock`: set, clear, lock now) are host acts onto that door, not ops: the code never passes the waist. The section
  `app-lock` is in the recovery group of the basis manifest; painted by `apps/basis/web/v2/circleMyData.js`, and on the
  phone by `apps/basis-mobile/src/screens/v2/CircleMyDataScreen.js` (the fact line).
- **Words**: `circle.lock.*` in the shared locale (`apps/basis/src/locales/`).

The lock has no op, so this page names none yet: the ops of the recovery phrase and the devices stay where they are
until the rest of this page is written.

## Proof

- `apps/basis/test/keyDoorLock.test.js`: while locked, the stored data holds no usable key; a wrong secret does not
  unlock; the right one opens the same seed; a failure while switching the lock on still leaves a door that gives the
  seed; switching it off leaves the seed unchanged; start over still deletes the database with the door open.
- `apps/basis/test/keyDoorBoot.test.js`: the boot step asks until the door opens; a door built by `pickRootKeyStore`
  can be locked.
- `apps/basis/test-browser/app-lock.spec.js`: on a real browser, the switch on, the lock screen at a reload with nobody
  behind it, a wrong code, the right code (the same person), a wrong code to switch off, lock now, and "forgot" through
  the start-over page back to the same person.

## Decided not to build (yet)

- A passkey to open the lock, an idle lock (after a time without use), changing the code in place: later; the slot
  format leaves room for them.
- A second person on the same browser: not in this lock.
- A lock on the phone or the box: the phone's key is behind the phone's own screen lock; the box has no person to ask.
  Both doors answer `unlocked`.

## Open rows

- The rest of this page: the recovery phrase, start over, the recovery file, enrolling a device.

## Decisions that bind this area

- `docs/decisions.md` 2026-11-26: a person can lock their own Basis in the browser: optional, a short code allowed, no
  lock on the phone or the box.
