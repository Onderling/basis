def sub(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert s.count(a) == 1, (p, a[:80], s.count(a))
        s = s.replace(a, b)
    open(p, 'w').write(s)

sub('basis/src/v2/enrollOffer.js', [
    ("export async function consumeCircleEntry({ agent, callSkill, sendPeerMessage, registerCirclePresence = null, contentPulls = null } = {}, c, { claimPrimary = false } = {}) {",
     "export async function consumeCircleEntry({ agent, callSkill, sendPeerMessage, registerCirclePresence = null, contentPulls = null, markPolicyPending = null } = {}, c, { claimPrimary = false } = {}) {"),
    ("  if (!c || typeof c.id !== 'string' || !c.id || typeof c.address !== 'string' || !c.address) return { ...row, ok: false, error: 'malformed-entry' };\n",
     "  if (!c || typeof c.id !== 'string' || !c.id || typeof c.address !== 'string' || !c.address) return { ...row, ok: false, error: 'malformed-entry' };\n"
     "  // The circle arrives WITHOUT its policy (an own device's carry, an enrolment, a restore): its posture is not known until\n"
     "  // the policy arrives, so it is marked pending FIRST, as a join's post-step does (writes in it are refused until then)\n"
     "  if (typeof markPolicyPending === 'function') { try { await markPolicyPending(c.id); } catch { /* the store says a failed mark itself */ } }\n"),
])
# the phone: the bundle exposes its marker; ChatScreen hands it to the consume
sub('basis-mobile/src/core/agentBundle.js', [
    ("    sendPeerRedeem,\n", "    sendPeerRedeem,\n    // a circle that arrives without its policy is marked pending (App.js hands the policy store's mark)\n    markPolicyPending: typeof opts.markPolicyPending === 'function' ? opts.markPolicyPending : null,\n"),
])
sub('basis-mobile/src/screens/ChatScreen.js', [
    ("      const enrolDeps = {\n", "      const enrolDeps = {\n        // a circle that arrives without its policy: its posture not known until the policy lands (web parity)\n        markPolicyPending: bundle.markPolicyPending ?? null,\n"),
])
sub('basis/web/v2/circleApp.js', [
    ("        const enrolDeps = {\n", "        const enrolDeps = {\n          // a circle that arrives without its policy: its posture not known until the policy lands\n          markPolicyPending: (cid) => policyStore.markPending(cid),\n"),
])
print('ok')
