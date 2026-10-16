// Runs the reference implementation's conformance vectors against js/crypto.js.
// Usage: npm install && node tests/vectors.test.mjs <path to geg>/tests/vectors
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../js/crypto.js';

const V = process.argv[2];
if (!V) { console.error('Usage: node tests/vectors.test.mjs <path to geg>/tests/vectors'); process.exit(2); }
const load = (cat) => fs.readdirSync(path.join(V, cat)).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(V, cat, f), 'utf8'))]);
const hx = (h) => C.fromHex(h);
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) pass++; else { fail++; console.log('FAIL', name); } };
const truthy = (v) => v === true || v === 'True' || v === 'true';

for (const [f, v] of load('encrypt')) {
  const i = v.inputs;
  const ct = C.encrypt(C.g2(i.mpk), BigInt(i.m), BigInt(i.r));
  check(f, C.ph(ct.c1) === v.expected.c1 && C.ph(ct.c2) === v.expected.c2);
}
for (const [f, v] of load('dleq')) {
  const i = v.inputs; const { e, z } = C.decodeDleq(hx(i.proof));
  check(f, C.verifyDleq(C.g2(i.base1), C.g2(i.point1), C.g2(i.base2), C.g2(i.point2), e, z, new C.Transcript(i.transcript_label)) === truthy(v.expected.verify));
}
for (const [f, v] of load('or')) {
  const i = v.inputs;
  check(f, C.verifyOr(C.g2(i.ct.c1), C.g2(i.ct.c2), C.g2(i.mpk), i.candidates.map(Number), C.decodeOr(hx(i.or_proof_encoded)), new C.Transcript(i.transcript_label)) === truthy(v.expected.verify));
}
for (const [f, v] of load('budget')) {
  const i = v.inputs; const t = new C.Transcript(i.transcript_label);
  const c1 = C.g2(i.ct_sum.c1), c2 = C.g2(i.ct_sum.c2), mpk = C.g2(i.mpk), B = Number(i.budget);
  let ok;
  if (i.mode === 'exact') { const { e, z } = C.decodeDleq(hx(i.proof_encoded)); ok = C.verifyBudgetExact(c1, c2, mpk, B, e, z, t); }
  else ok = C.verifyBudgetAtMost(c1, c2, mpk, B, C.decodeOr(hx(i.proof_encoded)), t);
  check(f, ok === truthy(v.expected.verify));
}
for (const [f, v] of load('schnorr')) {
  const i = v.inputs;
  if (i.sig) { const { R, s } = C.decodeSig(hx(i.sig)); check(f, C.schnorrVerify(C.g1(i.vk), hx(i.message), R, s) === truthy(v.expected.verify)); }
  else {
    const { sk, vk } = C.keygen(BigInt(i.sk));
    const sig = C.encodeSig(C.schnorrSign(sk, vk, hx(i.message), BigInt(i.k)));
    check(f + ' (byte parity)', C.ph(vk) === i.vk && C.toHex(sig) === i.sig_encoded);
  }
}
for (const [f, v] of load('decrypt-share')) {
  const i = v.inputs; const sh = i.share; const { e, z } = C.decodeDleq(hx(sh.dleq_proof));
  check(f, C.verifyShare(new C.Transcript(i.transcript_label), C.g2(i.ct_sum.c1), C.g2(i.ct_sum.c2), C.g2(i.committee_pk), C.g2(sh.sigma), e, z, Number(i.keyper_index)) === truthy(v.expected.verify));
}
const att = (a) => ({ electionId: hx(a.electionId), pseudonym: hx(a.pseudonym), vk: hx(a.vk), weight: BigInt(a.weight), nonce: BigInt(a.nonce ?? 1), signature: hx(a.signature) });
for (const [f, v] of load('attestation')) {
  const i = v.inputs;
  check(f, C.verifyAttestation(hx(i.eligibilityKey), att(i), hx(i.electionId)) === truthy(v.expected.verify));
}
for (const [f, v] of load('ballot')) {
  const i = v.inputs;
  if (i.zkProof) {
    const env = { electionId: hx(i.election_id), pseudonym: hx(i.pseudonym), vk: hx(i.vk), ciphertexts: i.ciphertexts.map((c) => [hx(c.c1), hx(c.c2)]), zkProof: hx(i.zkProof), voterSignature: hx(i.signature), attestation: att(i.attestation) };
    const r = C.verifyBallot(env, C.g2(i.mpk), Number(i.params.numCandidates), Number(i.params.budget));
    check(f, r.ok === truthy(v.expected.verify));
  } else {
    // Build-style fixture: rebuild with pinned randomness and compare bytes.
    const p = i.params; const { sk, vk } = C.keygen(BigInt(i.sk));
    const sims = i.range_proof_sims.map((row) => row.map((x) => (x === null ? null : [BigInt(x.e), BigInt(x.z)])));
    const built = await C.buildBallot({
      mpk: C.g2(i.mpk), eid: hx(i.electionId), pseudonym: hx(i.pseudonym), sk, vk, attestation: att(i.attestation),
      votes: i.votes.map(Number), budget: Number(p.budget),
      pin: { rs: i.randomness, rangeW: i.range_proof_w, rangeSims: sims, budgetW: i.budget_proof_w, k: i.k },
    });
    const o = v.outputs;
    check(f + ' ciphertexts', built.envelope.ciphertexts.every(([a, b], j) => C.toHex(a) === o.ciphertexts[j][0] && C.toHex(b) === o.ciphertexts[j][1]));
    check(f + ' zkProof', C.toHex(built.envelope.zkProof) === o.zkProof);
    check(f + ' preimage', C.toHex(built.detail.preimage) === o.canonical_preimage);
    check(f + ' signature', C.toHex(built.envelope.voterSignature) === o.voterSignature);
    check(f + ' verifies', C.verifyBallot(built.envelope, C.g2(i.mpk), Number(p.numCandidates), Number(p.budget)).ok);
  }
}
for (const [f, v] of load('tally')) {
  const i = v.inputs;
  const pairs = i.shares.map((sh, k) => [Number(i.alphas[k]), C.g2(sh.sigma)]);
  const tau = C.g2(i.ct_sum.c2).subtract(C.combineShares(pairs));
  check(f, C.bsgs(tau, C.bsgsTable(BigInt(i.upper_bound))) === BigInt(v.expected.V));
}

// Full election replay: admission, weighted aggregate, share checks, recovery.
{
  const fx = JSON.parse(fs.readFileSync(path.join(V, 'flow', 'full_election_level1.json'), 'utf8'));
  const cfg = fx.config; const nc = cfg.numCandidates, B = cfg.budget;
  const mpk = C.g2(fx.finalizedKey.pkElection); const eid = hx(cfg.electionId);
  const valid = [];
  fx.ballots.forEach((b, seq) => {
    const env = { electionId: hx(b.electionId), pseudonym: hx(b.pseudonym), vk: hx(b.vk), ciphertexts: b.ciphertexts.map((c) => [hx(c.c1), hx(c.c2)]), zkProof: hx(b.zkProof), voterSignature: hx(b.voterSignature), attestation: att(b.attestation) };
    const r = C.verifyBallot(env, mpk, nc, B);
    const a = C.verifyAttestation(hx(cfg.eligibilityKey), env.attestation, eid);
    if (r.ok && a) valid.push({ seq, env, cts: r.cts, w: env.attestation.weight, nonce: env.attestation.nonce });
  });
  const win = new Map();
  for (const b of valid) { const k = C.toHex(b.env.pseudonym); const cur = win.get(k); if (!cur || b.nonce > cur.nonce || (b.nonce === cur.nonce && b.seq > cur.seq)) win.set(k, b); }
  const admitted = valid.filter((b) => win.get(C.toHex(b.env.pseudonym)) === b);
  check('flow admitted set', JSON.stringify(admitted.map((b) => b.seq)) === JSON.stringify(fx.aggregate.admitted));
  const agg = [...Array(nc)].map((_, j) => admitted.reduce((acc, b) => C.ctAdd(acc, C.ctMul(b.w, b.cts[j])), { c1: C.Z2, c2: C.Z2 }));
  check('flow aggregate bytes', agg.every((c, j) => '0x' + C.ph(c.c1) === fx.aggregate.aggregates[j].c1 && '0x' + C.ph(c.c2) === fx.aggregate.aggregates[j].c2));
  const committee = fx.finalizedKey.committeePKs.map((h) => C.g2(h));
  const totalW = admitted.reduce((s, b) => s + b.w, 0n);
  const tbl = C.bsgsTable(BigInt(B) * totalW);
  const totals = agg.map((c, j) => {
    const good = [];
    for (const s of fx.shares) {
      const en = s.entries[j]; const { e, z } = C.decodeDleq(hx(en.proof)); const sigma = C.g2(en.sigma);
      if (C.verifyShare(C.decryptTranscript(eid, j), c.c1, c.c2, committee[s.keyperIndex - 1], sigma, e, z, s.keyperIndex)) good.push([s.keyperIndex, sigma]);
    }
    const tau = c.c2.subtract(C.combineShares(good.slice(0, cfg.threshold.t)));
    return C.bsgs(tau, tbl);
  });
  check('flow totals', JSON.stringify(totals.map(String)) === JSON.stringify(fx.result.totals.map(String)));
}

// Round trip: DKG, ballots, aggregate, threshold decryption, all with fresh randomness.
{
  const n = 5, t = 3;
  const deals = [...Array(n)].map(() => C.dkgDeal(n, t));
  let okShares = true;
  for (let i = 1; i <= n; i++) for (const d of deals) okShares &&= C.dkgVerifyShare(d.commitments, i, d.shares[i]);
  check('dkg share checks', okShares);
  const all = deals.map((d) => d.commitments);
  const mpk = C.dkgJointKey(all);
  const msk = (i) => deals.reduce((s, d) => C.mod(s + d.shares[i]), 0n);
  check('dkg public shares', [1, 2, 3, 4, 5].every((i) => C.dkgPublicShare(i, all).equals(C.mul(C.P2, msk(i)))));
  const eid = C.randomBytes(32), issuer = C.keygen();
  const votes = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], weights = [100n, 50n, 30n, 40n];
  const envs = [];
  for (let k = 0; k < votes.length; k++) {
    const voter = C.keygen(); const pseud = C.randomBytes(32);
    const a = { electionId: eid, pseudonym: pseud, vk: C.pb(voter.vk), weight: weights[k], nonce: 1n };
    a.signature = C.signAttestation(issuer, eid, pseud, a.vk, a.weight, a.nonce);
    const b = await C.buildBallot({ mpk, eid, pseudonym: pseud, sk: voter.sk, vk: voter.vk, attestation: a, votes: votes[k] });
    const r = C.verifyBallot(b.envelope, mpk, 4, 1);
    check('roundtrip ballot ' + k, r.ok && C.verifyAttestation(C.pb(issuer.vk), a, eid));
    envs.push({ cts: r.cts, w: weights[k] });
    if (k === 0) console.log('ballot timing ms', Object.fromEntries(Object.entries(b.timing).map(([x, y]) => [x, Math.round(y)])));
  }
  const tv0 = performance.now(); C.verifyBallot((await C.buildBallot({ mpk, eid, pseudonym: C.randomBytes(32), sk: 5n, vk: C.mul(C.P1, 5n), attestation: { electionId: eid, pseudonym: C.randomBytes(32), vk: C.pb(C.mul(C.P1, 5n)), weight: 1n, nonce: 1n, signature: new Uint8Array(80) }, votes: [1, 0, 0, 0] })).envelope, mpk, 4, 1); console.log('build+verify ms', Math.round(performance.now() - tv0));
  const agg = [0, 1, 2, 3].map((j) => envs.reduce((acc, b) => C.ctAdd(acc, C.ctMul(b.w, b.cts[j])), { c1: C.Z2, c2: C.Z2 }));
  const ids = [1, 3, 5];
  const tbl = C.bsgsTable(220n);
  const totals = agg.map((c, j) => {
    const pairs = ids.map((i) => {
      const sigma = C.mul(c.c1, msk(i)); const pk = C.dkgPublicShare(i, all);
      const pr = C.proveShare(C.decryptTranscript(eid, j), c.c1, c.c2, pk, sigma, msk(i), i);
      check(`share ${i}/${j}`, C.verifyShare(C.decryptTranscript(eid, j), c.c1, c.c2, pk, sigma, pr.e, pr.z, i));
      return [i, sigma];
    });
    const tau = c.c2.subtract(C.combineShares(pairs));
    return C.bsgs(tau, tbl);
  });
  check('roundtrip totals', JSON.stringify(totals.map(String)) === JSON.stringify(['100', '50', '30', '40']));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
