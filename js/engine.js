// The election, simulated end to end in one page: back office, voters' phones,
// ballot box, five keyholders and an independent verifier. All cryptography is real.
import * as C from './crypto.js';

export const N = 5, T = 3, BUDGET = 1;
export const OPTIONS = [
  { key: 'for', label: 'For' },
  { key: 'against', label: 'Against' },
  { key: 'abstain', label: 'Abstain' },
  { key: 'chair', label: 'Leave to the chair', hint: 'The chair decides after the count' },
];
export const KEYHOLDERS = [
  { id: 1, name: 'MIXX', role: 'Platform operator', color: '#0071e3' },
  { id: 2, name: 'Shutter', role: 'Cryptography partner', color: '#6e4fd8' },
  { id: 3, name: 'Notary', role: 'Independent notary', color: '#1a8f48' },
  { id: 4, name: 'Auditor', role: 'Statutory auditor', color: '#b25a00' },
  { id: 5, name: 'Members', role: 'Shareholder panel', color: '#d1468e' },
];
// The worked example from MIXX's calculation guide (attendees A to F).
const PEOPLE = [
  ['A', 'Anna Peeters', 100, true, null, '#0071e3'],
  ['B', 'Bram Janssens', 50, true, null, '#6e4fd8'],
  ['C', 'Chloé Dubois', 30, true, null, '#1a8f48'],
  ['D', 'Dirk Maes', 20, true, null, '#b25a00'],
  ['E', 'Els Wouters', 40, false, 'chair', '#d1468e'],
  ['F', 'Frank Claes', 60, false, null, '#5e5ce6'],
];
export const EXAMPLE = [['A', 'for'], ['B', 'against'], ['C', 'abstain'], ['E', 'chair']];
export const SEAL_STEPS = [
  ['credential', 'Getting a voting credential'],
  ['encrypt', 'Encrypting your choice'],
  ['prove', 'Proving it is a valid vote'],
  ['sign', 'Signing the ballot'],
  ['send', 'Sending to the ballot box'],
];
export const BASES = [
  ['cast', 'Votes cast'],
  ['castWo', 'Excl. abstentions'],
  ['present', 'Present'],
  ['all', 'All votes'],
];

// ---------------------------------------------------------------- store
let state;
const listeners = new Set();
export const S = () => state;
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function emit() { for (const l of listeners) l(); }
// Short pauses pace the animations. Browsers throttle timers in hidden tabs to once a
// second or even once a minute, so a hidden tab skips the pause and keeps working.
const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => { ch.port1.close(); r(); }; ch.port2.postMessage(0); });
export const tick = (ms = 0) => {
  if (typeof document === 'undefined' || typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, ms));
  if (document.hidden) return yieldNow();
  return new Promise((r) => {
    const done = () => { clearTimeout(id); document.removeEventListener('visibilitychange', done); r(); };
    const id = setTimeout(done, ms);
    document.addEventListener('visibilitychange', done);
  });
};
// A failed step never leaves a spinner behind: it is reset so it can be run again, and
// the error is passed on so the page can show it.
async function guarded(run, undo) {
  try { return await run(); } catch (err) { undo(); emit(); throw err; }
}
export const now = () => performance.now();

function fresh() {
  const eid = C.keccak(C.concat(C.utf8('Example NV / General assembly 2026 / item 1 / '), C.randomBytes(16)));
  return {
    meeting: { company: 'Example NV', title: 'General assembly 2026', item: 'Approval of the 2025 annual accounts', no: 1 },
    attendees: PEOPLE.map(([id, name, shares, present, proxy, color]) => ({ id, name, shares, present, proxy, color })),
    rules: { base: 'cast', nonVoterAbstain: false, ignoreWeight: false, capMode: 'off', capPct: 25 },
    eid,
    issuer: C.keygen(), // MIXX eligibility service
    pseudoKey: C.randomBytes(32),
    status: 'setup', // setup | open | closed | counted
    dkg: null,
    keyholders: KEYHOLDERS.map((k) => ({ ...k, online: k.id !== 5, secret: null })),
    ballots: [],
    nonces: {},
    phone: { who: 'A', pick: {}, phase: 'pick', steps: {}, code: null },
    lastCast: null,
    locked: null,
    tally: null,
    verify: null,
    attacks: {},
    autoRunning: false,
  };
}
export function reset() { state = fresh(); emit(); }
state = fresh();

// ---------------------------------------------------------------- helpers
export const person = (id) => state.attendees.find((a) => a.id === id);
export function isPresent(a) {
  if (a.present || a.proxy === 'chair') return true;
  if (a.proxy) return !!person(a.proxy)?.present;
  return false;
}
export function pseudonym(id) { return C.keccak(C.concat(state.pseudoKey, state.eid, C.utf8(id))); }
export const trackingCode = (h) => C.toHex(h.slice(0, 4)).toUpperCase().replace(/(.{4})/, '$1-');
export function sums(ignoreWeight = (state.locked || state.rules).ignoreWeight) {
  let all = 0, present = 0;
  for (const a of state.attendees) {
    const w = ignoreWeight ? 1 : a.shares;
    all += w;
    if (isPresent(a)) present += w;
  }
  return { all, present };
}
export function capValue(r = state.locked || state.rules) {
  if (r.ignoreWeight || r.capMode === 'off') return null;
  const s = sums(false);
  return Math.round((r.capMode === 'all' ? s.all : s.present) * r.capPct / 100);
}
export function effWeight(w, r = state.locked || state.rules) {
  if (r.ignoreWeight) return 1n;
  const cap = r.capValue !== undefined ? r.capValue : capValue(r);
  return cap != null && w > BigInt(cap) ? BigInt(cap) : w;
}
export const activeBallots = () => state.ballots.filter((b) => !b.replaced);
export function turnout() {
  const s = sums();
  let cast = 0;
  for (const b of activeBallots()) cast += Number(effWeight(b.weight));
  return { cast, present: s.present, all: s.all, ballots: activeBallots().length };
}

// ---------------------------------------------------------------- key ceremony (Feldman DKG)
export async function runKeyCeremony() {
  if (state.dkg?.status === 'running') return;
  return guarded(keyCeremony, () => { state.dkg = null; });
}
async function keyCeremony() {
  const t0 = now();
  const dkg = state.dkg = { status: 'running', phase: 'deal', members: KEYHOLDERS.map((k) => ({ id: k.id, state: 'wait', verified: 0 })), messages: 0, edges: [] };
  emit();
  const deals = [];
  for (const m of dkg.members) {
    m.state = 'dealing'; emit(); await tick(140);
    const d = C.dkgDeal(N, T);
    deals.push(d);
    m.commitments = d.commitments;
    m.state = 'dealt'; emit();
  }
  dkg.phase = 'exchange';
  for (const m of dkg.members) {
    m.state = 'verifying'; emit();
    for (let j = 0; j < N; j++) {
      if (!C.dkgVerifyShare(deals[j].commitments, m.id, deals[j].shares[m.id])) throw new Error('share check failed');
      m.verified++; dkg.messages++;
      dkg.edges = [[deals.indexOf(deals[j]) + 1, m.id]];
      emit(); await tick(45);
    }
    state.keyholders[m.id - 1].secret = deals.reduce((s, d) => C.mod(s + d.shares[m.id]), 0n);
    m.state = 'ready'; emit();
  }
  dkg.edges = [];
  dkg.phase = 'combine'; emit(); await tick(60);
  const all = deals.map((d) => d.commitments);
  for (const d of deals) { d.coeffs.fill(0n); d.shares = null; } // dealing data is discarded
  dkg.commitments = all;
  dkg.mpk = C.dkgJointKey(all);
  dkg.pks = KEYHOLDERS.map((k) => C.dkgPublicShare(k.id, all));
  C.fixedBase(dkg.mpk);
  dkg.ms = now() - t0;
  dkg.status = 'done'; dkg.phase = 'done';
  emit();
}

export function openVoting() {
  if (state.dkg?.status !== 'done') return;
  state.status = 'open';
  state.openedAt = Date.now();
  emit();
}

// ---------------------------------------------------------------- casting a vote (voter's phone)
export async function castVote(id, choice, opts = {}) {
  const a = person(id);
  if (state.status !== 'open' || !isPresent(a)) return;
  return guarded(() => seal(a, id, choice, opts), () => { state.phone.phase = 'pick'; state.phone.steps = {}; });
}
async function seal(a, id, choice, { fast = false } = {}) {
  const ph = state.phone;
  ph.who = id; ph.phase = 'sealing'; ph.steps = {}; ph.code = null; ph.cts = null;
  emit();
  const min = fast ? 90 : 340;
  const stepRun = async (k) => { ph.steps[k] = 'run'; emit(); await tick(fast ? 30 : 120); };
  const stepDone = async (k, t0) => { const left = min - (now() - t0); if (left > 0) await tick(left); ph.steps[k] = 'done'; emit(); };
  const vote = OPTIONS.map((o) => (o.key === choice ? 1 : 0));

  // 1. One-time voting key on the device; MIXX's eligibility service signs a credential for it.
  let t = now(); await stepRun('credential');
  const voter = C.keygen();
  const pseud = pseudonym(id);
  const nonce = BigInt((state.nonces[id] || 0) + 1);
  state.nonces[id] = Number(nonce);
  const weight = BigInt(a.shares);
  const att = { electionId: state.eid, pseudonym: pseud, vk: C.pb(voter.vk), weight, nonce };
  att.signature = C.signAttestation(state.issuer, state.eid, pseud, att.vk, weight, nonce);
  await stepDone('credential', t);

  // 2-4. Encrypt, prove, sign.
  let built;
  const marks = {};
  t = now(); await stepRun('encrypt');
  built = await C.buildBallot({
    mpk: state.dkg.mpk, eid: state.eid, pseudonym: pseud, sk: voter.sk, vk: voter.vk, attestation: att, votes: vote,
    onStep: async (name, data) => {
      if (name === 'range') { ph.cts = data.map((c) => C.ph(c.c2)); await stepDone('encrypt', t); t = now(); await stepRun('prove'); }
      if (name === 'sign') { await stepDone('prove', t); t = now(); await stepRun('sign'); }
      await tick();
      marks[name] = now();
    },
  });
  await stepDone('sign', t);

  // 5. Ballot box: posts it publicly and runs a quick admission check.
  t = now(); await stepRun('send');
  const hash = C.keccak(C.concat(built.detail.preimage, built.envelope.voterSignature));
  const ballot = { seq: state.ballots.length, attendeeId: id, envelope: built.envelope, hash, code: trackingCode(hash), at: Date.now(), weight, nonce, check: 'checking', replaced: false };
  for (const b of state.ballots) if (b.attendeeId === id) b.replaced = true;
  state.ballots.push(ballot);
  await stepDone('send', t);
  ph.phase = 'done'; ph.code = ballot.code;
  state.lastCast = { id, choice, vote, built, att, ballot };
  emit();
  await tick(20);
  const r = C.verifyBallot(ballot.envelope, state.dkg.mpk, OPTIONS.length, BUDGET);
  ballot.check = r.ok ? 'ok' : r.reason;
  emit();
  return ballot;
}

export async function castExample() {
  if (state.autoRunning || state.status !== 'open') return;
  state.autoRunning = true; emit();
  try {
    for (const [id, choice] of EXAMPLE) {
      state.phone.who = id; state.phone.pick[id] = choice; state.phone.phase = 'pick'; emit();
      await tick(380);
      await castVote(id, choice, { fast: true });
      await tick(520);
    }
  } finally { state.autoRunning = false; emit(); }
}

// ---------------------------------------------------------------- closing
export function closeVoting() {
  if (state.status !== 'open') return;
  const r = state.rules;
  state.locked = { ignoreWeight: r.ignoreWeight, capMode: r.capMode, capPct: r.capPct, capValue: capValue(r) };
  state.status = 'closed';
  state.closedAt = Date.now();
  state.tally = { phase: 'ready', rows: [], participants: state.keyholders.filter((k) => k.online).map((k) => k.id), shares: {}, chairChoice: 'for' };
  emit();
}

// ---------------------------------------------------------------- counting
export function toggleParticipant(id) {
  const t = state.tally;
  if (!t || (t.phase !== 'ready' && t.phase !== 'aggregate-done')) return;
  t.participants = t.participants.includes(id) ? t.participants.filter((x) => x !== id) : [...t.participants, id].sort();
  emit();
}

export async function runCount() {
  const t = state.tally;
  if (!t || t.phase !== 'ready') return;
  return guarded(() => count(t), () => { t.phase = 'ready'; t.rows = []; });
}
async function count(t) {
  const mpk = state.dkg.mpk;
  // 1. Admission: every ballot is checked independently, then the latest per voter wins.
  t.phase = 'admission';
  t.rows = state.ballots.map((b) => ({ seq: b.seq, code: b.code, pseud: C.toHex(b.envelope.pseudonym), weight: b.weight, nonce: b.nonce, status: 'wait' }));
  emit();
  const valid = [];
  for (const [i, b] of state.ballots.entries()) {
    const row = t.rows[i];
    row.status = 'run'; emit(); await tick(40);
    const att = C.verifyAttestation(C.pb(state.issuer.vk), b.envelope.attestation, state.eid);
    const r = att ? C.verifyBallot(b.envelope, mpk, OPTIONS.length, BUDGET) : { ok: false, reason: 'INVALID_ATTESTATION' };
    row.status = r.ok ? 'ok' : 'bad';
    row.reason = r.reason;
    if (r.ok) valid.push({ b, cts: r.cts });
    emit(); await tick(60);
  }
  const best = new Map();
  for (const v of valid) {
    const k = C.toHex(v.b.envelope.pseudonym);
    const cur = best.get(k);
    if (!cur || v.b.nonce > cur.b.nonce || (v.b.nonce === cur.b.nonce && v.b.seq > cur.b.seq)) best.set(k, v);
  }
  t.admitted = valid.filter((v) => best.get(C.toHex(v.b.envelope.pseudonym)) === v);
  for (const v of valid) if (!t.admitted.includes(v)) { const row = t.rows[v.b.seq]; row.status = 'replaced'; }
  t.castWeight = t.admitted.reduce((s, v) => s + effWeight(v.b.weight), 0n);
  t.bound = BigInt(BUDGET) * t.castWeight;
  t.phase = 'aggregate'; emit(); await tick(350);

  // 2. Weighted homomorphic sum per option.
  t.agg = OPTIONS.map((_, j) => t.admitted.reduce((acc, v) => C.ctAdd(acc, C.ctMul(effWeight(v.b.weight), v.cts[j])), { c1: C.Z2, c2: C.Z2 }));
  t.aggHex = t.agg.map((c) => ({ c1: C.ph(c.c1), c2: C.ph(c.c2) }));
  t.phase = 'aggregate-done'; emit();
}

export async function runDecrypt() {
  const t = state.tally;
  if (!t || t.phase !== 'aggregate-done' || t.participants.length < T) return;
  return guarded(() => decrypt(t), () => { t.phase = 'aggregate-done'; t.shares = {}; });
}
async function decrypt(t) {
  t.phase = 'decrypt'; t.shares = {}; emit();
  for (const id of t.participants) {
    const kh = state.keyholders[id - 1];
    const pk = state.dkg.pks[id - 1];
    t.shares[id] = [];
    for (let j = 0; j < OPTIONS.length; j++) {
      const { c1, c2 } = t.agg[j];
      const sigma = C.mul(c1, kh.secret);
      const pr = C.proveShare(C.decryptTranscript(state.eid, j), c1, c2, pk, sigma, kh.secret, id);
      t.shares[id].push({ sigma, e: pr.e, z: pr.z, ok: null });
      emit(); await tick(30);
    }
    // The counter checks every share before it is used.
    for (let j = 0; j < OPTIONS.length; j++) {
      const sh = t.shares[id][j];
      sh.ok = C.verifyShare(C.decryptTranscript(state.eid, j), t.agg[j].c1, t.agg[j].c2, pk, sh.sigma, sh.e, sh.z, id);
    }
    emit(); await tick(120);
  }
  // 3. Combine any T verified shares (Lagrange at zero) and search for the totals.
  t.phase = 'recover'; emit(); await tick(300);
  const t0 = now();
  const tbl = C.bsgsTable(t.bound);
  t.used = t.participants.filter((id) => t.shares[id].every((s) => s.ok)).slice(0, T);
  if (t.used.length < T) throw new Error(`only ${t.used.length} keyholders gave valid shares, ${T} are needed`);
  t.lambdas = t.used.map((id) => C.lagrange(id, t.used));
  t.taus = t.agg.map((c, j) => c.c2.subtract(C.combineShares(t.used.map((id) => [id, t.shares[id][j].sigma]))));
  t.totals = t.taus.map((tau) => C.bsgs(tau, tbl));
  if (t.totals.some((x) => x === null)) throw new Error('a total was not found in the search range');
  t.recoverMs = now() - t0;
  t.sumOk = t.totals.reduce((s, x) => s + x, 0n) === t.bound;
  t.phase = 'done';
  state.status = 'counted';
  emit();
}

export function setChair(choice) { if (state.tally) { state.tally.chairChoice = choice; emit(); } }

// ---------------------------------------------------------------- MIXX result calculation
// A port of CalculateVotesPlan::calculateTotals, fed with decrypted totals instead of plaintext votes.
export function result(base = state.rules.base, nonVoter = state.rules.nonVoterAbstain) {
  const t = state.tally;
  if (!t?.totals) return null;
  const s = sums();
  const [f, a, ab, ch] = t.totals.map(Number);
  const chair = t.chairChoice;
  const votesFor = f + (chair === 'for' ? ch : 0);
  const votesAgainst = a + (chair === 'against' ? ch : 0);
  let abstain = ab + (chair === 'abstain' ? ch : 0);
  let cast = Number(t.castWeight);
  const castWo = cast - abstain;
  if (nonVoter) { abstain = s.present - cast + abstain; cast = s.present; }
  const denom = { cast, castWo, present: s.present, all: s.all }[base];
  const p = (v) => (denom > 0 ? v / denom : 0);
  return { all: s.all, present: s.present, cast, castWo, abstain, votesFor, votesAgainst, chairVotes: ch, denom, pFor: p(votesFor), pAgainst: p(votesAgainst), adopted: p(votesFor) > 0.5 };
}
export const pct = (x) => `${Math.round(x * 100)} %`;

// ---------------------------------------------------------------- independent verification
export async function runVerify() {
  if (state.status !== 'counted' || state.verify?.running) return;
  const v = state.verify = { running: true, checks: [], started: now() };
  return guarded(() => verify(v), () => { state.verify = null; });
}
async function verify(v) {
  const t = state.tally, dkg = state.dkg;
  const add = (key, title) => { const c = { key, title, status: 'run', detail: '', ms: 0 }; v.checks.push(c); emit(); return c; };
  const done = (c, ok, detail, t0) => { c.status = ok ? 'ok' : 'bad'; c.detail = detail; c.ms = now() - t0; emit(); };
  let proofs = 0;

  let c = add('key', 'The election key came from all five keyholders');
  let t0 = now(); await tick(200);
  const mpk = C.dkgJointKey(dkg.commitments);
  const pksOk = KEYHOLDERS.every((k) => C.dkgPublicShare(k.id, dkg.commitments).equals(dkg.pks[k.id - 1]));
  done(c, mpk.equals(dkg.mpk) && pksOk && dkg.commitments.every((cm) => cm.length === T), `${N * T} commitments, joint key and ${N} keyholder keys rederived`, t0);

  c = add('creds', 'Every voting credential was signed by MIXX');
  t0 = now(); await tick(120);
  const credOk = state.ballots.map((b) => C.verifyAttestation(C.pb(state.issuer.vk), b.envelope.attestation, state.eid));
  done(c, credOk.every(Boolean), `${credOk.filter(Boolean).length} of ${credOk.length} credentials valid, weights as signed`, t0);

  c = add('ballots', 'Every ballot proves it is a valid vote');
  t0 = now();
  const parsed = [];
  for (const b of state.ballots) { await tick(); const r = C.verifyBallot(b.envelope, dkg.mpk, OPTIONS.length, BUDGET); parsed.push(r); proofs += OPTIONS.length + 2; c.detail = `${parsed.length} of ${state.ballots.length} checked`; emit(); }
  done(c, parsed.every((r) => r.ok), `${parsed.filter((r) => r.ok).length} of ${parsed.length} ballots: ${OPTIONS.length} range proofs, 1 sum proof and 1 signature each`, t0);

  c = add('dedupe', 'Only the latest vote per voter counts');
  t0 = now(); await tick(150);
  const best = new Map();
  state.ballots.forEach((b, i) => { if (!parsed[i].ok) return; const k = C.toHex(b.envelope.pseudonym); const cur = best.get(k); if (!cur || b.nonce > cur.nonce) best.set(k, b); });
  const admittedSeq = [...best.values()].map((b) => b.seq).sort((x, y) => x - y);
  const pubSeq = t.admitted.map((x) => x.b.seq).sort((x, y) => x - y);
  done(c, JSON.stringify(admittedSeq) === JSON.stringify(pubSeq), `${admittedSeq.length} ballots counted, ${state.ballots.length - admittedSeq.length} replaced by a newer vote`, t0);

  c = add('agg', 'The encrypted totals add up');
  t0 = now(); await tick(100);
  const agg = OPTIONS.map((_, j) => admittedSeq.reduce((acc, seq) => C.ctAdd(acc, C.ctMul(effWeight(state.ballots[seq].weight), parsed[seq].cts[j])), { c1: C.Z2, c2: C.Z2 }));
  const aggOk = agg.every((x, j) => C.ph(x.c1) === t.aggHex[j].c1 && C.ph(x.c2) === t.aggHex[j].c2);
  done(c, aggOk, `${OPTIONS.length} weighted sums recomputed byte for byte`, t0);

  c = add('shares', 'The keyholders decrypted honestly');
  t0 = now();
  let nShares = 0, okShares = 0;
  for (const id of Object.keys(t.shares).map(Number)) {
    for (let j = 0; j < OPTIONS.length; j++) {
      await tick();
      const sh = t.shares[id][j];
      nShares++;
      if (C.verifyShare(C.decryptTranscript(state.eid, j), agg[j].c1, agg[j].c2, dkg.pks[id - 1], sh.sigma, sh.e, sh.z, id)) okShares++;
    }
  }
  proofs += nShares;
  done(c, okShares >= T * OPTIONS.length && okShares === nShares, `${okShares} of ${nShares} decryption proofs valid`, t0);

  c = add('totals', 'The published totals are correct');
  t0 = now(); await tick(100);
  const used = t.used;
  const taus = agg.map((x, j) => x.c2.subtract(C.combineShares(used.map((id) => [id, t.shares[id][j].sigma]))));
  const totOk = taus.every((tau, j) => t.totals[j] <= t.bound && C.checkTotal(tau, t.totals[j]));
  const sumOk = t.totals.reduce((s, x) => s + x, 0n) === t.bound;
  done(c, totOk && sumOk, `${t.totals.join(' + ')} = ${t.bound}, each checked with one multiplication`, t0);

  c = add('rules', 'The result follows the counting rules');
  t0 = now(); await tick(120);
  const r = result();
  done(c, !!r, `${pct(r.pFor)} for, ${pct(r.pAgainst)} against on ${BASES.find((b) => b[0] === state.rules.base)[1].toLowerCase()} (${r.denom})`, t0);

  v.running = false;
  v.ms = now() - v.started;
  v.proofs = proofs;
  v.ok = v.checks.every((x) => x.status === 'ok');
  emit();
}

// ---------------------------------------------------------------- tamper lab
const fmtN = (n) => Number(n).toLocaleString('en-US');
const firstName = (b) => (b ? person(b.attendeeId).name.split(' ')[0] : 'a voter');
function targets() {
  const act = activeBallots();
  const b = act.find((x) => x.attendeeId === 'B') || act[act.length - 1];
  const a = act.find((x) => x.attendeeId === 'A' && x !== b) || act.find((x) => x !== b);
  return { a, b };
}
export const ATTACKS = [
  { key: 'double', title: 'Vote twice in one ballot', who: 'A voter' },
  { key: 'weight', title: 'Inflate a weight', who: 'An insider' },
  { key: 'swap', title: 'Swap a ballot', who: 'The server' },
  { key: 'hide', title: 'Hide a ballot', who: 'The server' },
  { key: 'share', title: 'Cheat while decrypting', who: 'A keyholder' },
  { key: 'result', title: 'Announce a different result', who: 'The organiser' },
];
export function attackText(key) {
  const { a, b } = targets();
  const t = state.tally;
  return {
    double: 'Edits the voting app to put 2 votes on For, then signs the ballot with their own key.',
    weight: b ? `Changes ${firstName(b)}’s credential from ${fmtN(b.weight)} to ${fmtN(b.weight * 10n)} shares before the count.` : 'Changes a credential’s weight before the count.',
    swap: a && b ? `Replaces ${firstName(a)}’s encrypted vote with a copy of ${firstName(b)}’s.` : 'Replaces one encrypted vote with a copy of another.',
    hide: b ? `Quietly leaves ${firstName(b)}’s ballot out of the public ballot box.` : 'Quietly leaves a ballot out of the public ballot box.',
    share: 'Publishes a decryption share that would add 10 votes to For.',
    result: t?.totals ? `Publishes For = ${fmtN(t.totals[0] + 10n)} instead of the real ${fmtN(t.totals[0])}.` : 'Publishes a higher total for For.',
  }[key];
}
export async function runAttack(key) {
  const st = state.attacks[key] = { running: true };
  emit(); await tick(60);
  const mpk = state.dkg.mpk;
  const t = state.tally;
  const { a, b } = targets();
  let caught = false, reason = '', tech = '';
  try {
    if (key === 'double') {
      const voter = C.keygen(); const pseud = C.randomBytes(32);
      const att = { electionId: state.eid, pseudonym: pseud, vk: C.pb(voter.vk), weight: 10n, nonce: 1n };
      att.signature = C.signAttestation(state.issuer, state.eid, pseud, att.vk, att.weight, att.nonce);
      const built = await C.buildBallot({ mpk, eid: state.eid, pseudonym: pseud, sk: voter.sk, vk: voter.vk, attestation: att, votes: [1, 0, 0, 0] });
      const ct0 = built.detail.cts[0];
      const env = { ...built.envelope, ciphertexts: built.envelope.ciphertexts.slice() };
      env.ciphertexts[0] = [C.pb(ct0.c1), C.pb(ct0.c2.add(C.P2))]; // now encrypts 2
      const pre = C.canonicalBallotMessage(env.electionId, env.pseudonym, env.ciphertexts, env.zkProof, att);
      env.voterSignature = C.encodeSig(C.schnorrSign(voter.sk, voter.vk, C.keccak(pre)));
      const r = C.verifyBallot(env, mpk, OPTIONS.length, BUDGET);
      caught = !r.ok; reason = 'The range proof for For no longer holds: the value is not 0 or 1. The signature is valid, the proof is not.'; tech = `${r.reason}: ${r.detail || ''}`;
    } else if (key === 'weight') {
      if (!b) throw new Error('needs-ballots');
      const att = { ...b.envelope.attestation, weight: b.envelope.attestation.weight * 10n };
      const ok = C.verifyAttestation(C.pb(state.issuer.vk), att, state.eid);
      const r = C.verifyBallot({ ...b.envelope, attestation: att }, mpk, OPTIONS.length, BUDGET);
      caught = !ok && !r.ok; reason = 'MIXX’s signature on the credential no longer matches, and the voter’s own signature covers the credential too.'; tech = `INVALID_ATTESTATION, ${r.reason}`;
    } else if (key === 'swap') {
      if (!a || !b) throw new Error('needs-two');
      const env = { ...a.envelope, ciphertexts: b.envelope.ciphertexts, zkProof: b.envelope.zkProof };
      const r = C.verifyBallot(env, mpk, OPTIONS.length, BUDGET);
      caught = !r.ok; reason = 'The proofs and the voter’s signature are bound to the original ballot, and the server cannot re-sign it.'; tech = `${r.reason}${r.detail ? ': ' + r.detail : ''}`;
    } else if (key === 'hide') {
      if (!b) throw new Error('needs-ballots');
      const box = state.ballots.filter((x) => x !== b);
      caught = !box.some((x) => x.code === b.code);
      reason = `${firstName(b)} looks up tracking code ${b.code} and it is missing. The phone still holds the complete signed ballot, so the dropped vote can be raised and resubmitted.`;
      tech = `lookup ${b.code}: not in the public box (${box.length} of ${state.ballots.length} ballots shown)`;
    } else if (key === 'share') {
      if (!t?.totals) throw new Error('needs-count');
      const id = t.used[0], j = 0, sh = t.shares[id][j];
      const fake = sh.sigma.subtract(C.vmul(C.P2, 10n)); // tau = C2 - sigma would grow by 10
      const ok = C.verifyShare(C.decryptTranscript(state.eid, j), t.agg[j].c1, t.agg[j].c2, state.dkg.pks[id - 1], fake, sh.e, sh.z, id);
      caught = !ok; reason = `The decryption proof from ${KEYHOLDERS[id - 1].name} fails, so the share is rejected. Any ${T} honest keyholders still open the total.`; tech = 'DLEQ check failed: log_G(PK_k) ≠ log_C1(σ_k)';
    } else if (key === 'result') {
      if (!t?.totals) throw new Error('needs-count');
      const fake = t.totals[0] + 10n;
      const ok = C.checkTotal(t.taus[0], fake);
      const real = C.checkTotal(t.taus[0], t.totals[0]);
      caught = !ok && real; reason = `${fmtN(fake)} does not decrypt the sealed total for For. Only the true number passes.`; tech = `${fake}·G ≠ C2 − σ, while ${t.totals[0]}·G = C2 − σ`;
    }
    Object.assign(st, { running: false, caught, reason, tech });
  } catch (err) {
    const m = { 'needs-count': 'Run the count first.', 'needs-ballots': 'Cast a vote first.', 'needs-two': 'Needs at least two ballots.' }[err.message];
    Object.assign(st, { running: false, error: m || String(err.message || err) });
  }
  emit();
}

// ---------------------------------------------------------------- receipts and the public record
export function findBallot(code) {
  const q = code.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (q.length < 4) return null;
  const b = state.ballots.find((x) => x.code.replace('-', '').startsWith(q));
  if (!b) return { found: false };
  const counted = state.tally?.admitted ? state.tally.admitted.some((v) => v.b === b) : null;
  return { found: true, b, counted };
}

export function publicRecord() {
  const h = (b) => C.toHex(b);
  const t = state.tally, dkg = state.dkg;
  return {
    protocol: 'SHUTTER-VOTE-v1 (variant A, exact budget 1)',
    election: { id: h(state.eid), company: state.meeting.company, item: state.meeting.item, options: OPTIONS.map((o) => o.label), threshold: { t: T, n: N }, eligibilityKey: C.ph(state.issuer.vk), weighting: state.locked },
    keyCeremony: dkg && { commitments: dkg.commitments.map((cm, i) => ({ keyholder: KEYHOLDERS[i].name, commitments: cm.map(C.ph) })), electionKey: C.ph(dkg.mpk), keyholderKeys: dkg.pks.map(C.ph) },
    ballots: state.ballots.map((b) => ({ seq: b.seq, trackingCode: b.code, electionId: h(b.envelope.electionId), pseudonym: h(b.envelope.pseudonym), vk: h(b.envelope.vk), ciphertexts: b.envelope.ciphertexts.map(([x, y]) => ({ c1: h(x), c2: h(y) })), zkProof: h(b.envelope.zkProof), voterSignature: h(b.envelope.voterSignature), attestation: { pseudonym: h(b.envelope.attestation.pseudonym), vk: h(b.envelope.attestation.vk), weight: String(b.envelope.attestation.weight), nonce: String(b.envelope.attestation.nonce), signature: h(b.envelope.attestation.signature) } })),
    aggregate: t?.aggHex && { admitted: t.admitted.map((v) => v.b.seq), totalWeight: String(t.castWeight), ciphertexts: t.aggHex },
    decryptionShares: t?.totals && Object.entries(t.shares).map(([id, arr]) => ({ keyholder: Number(id), entries: arr.map((s) => ({ sigma: C.ph(s.sigma), proof: h(C.encodeDleq(s.e, s.z)) })) })),
    result: t?.totals && { totals: Object.fromEntries(OPTIONS.map((o, j) => [o.label, String(t.totals[j])])), chairDecision: t.chairChoice, keyholdersUsed: t.used },
  };
}
