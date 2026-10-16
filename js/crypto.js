// Shutter voting protocol v1, running in the browser.
// A JavaScript port of the crypto suite of Shutter's reference implementation (geg):
// exponential ElGamal on BLS12-381 G2, Schnorr signatures on G1, Fiat-Shamir proofs over
// a keccak256 Merlin-style transcript, Feldman DKG, threshold decryption with DLEQ proofs.
// Byte formats follow the reference implementation's conformance vectors (tests/vectors.test.mjs).
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const Fr = bls12_381.fields.Fr;
export const Q = G1.Fn.ORDER;
export const P1 = G1.BASE, P2 = G2.BASE, Z1 = G1.ZERO, Z2 = G2.ZERO;

// ---------------------------------------------------------------- bytes
const te = new TextEncoder();
export const utf8 = (s) => te.encode(s);
export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export function fromHex(h) {
  h = h.startsWith('0x') ? h.slice(2) : h;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
export function be(n, len) {
  let x = BigInt(n);
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  if (x !== 0n) throw new Error(`integer does not fit in ${len} bytes`);
  return out;
}
export const u16 = (n) => be(n, 2);
export const u32 = (n) => be(n, 4);
export function big(b) {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}
export const mod = (a) => { const r = BigInt(a) % Q; return r < 0n ? r + Q : r; };
export const sc = (s) => be(mod(s), 32);
export function scFrom(b, field = 'scalar') {
  if (b.length !== 32) throw new Error(`${field}: expected 32 bytes`);
  const v = big(b);
  if (v >= Q) throw new Error(`${field}: non-canonical scalar`);
  return v;
}
export const keccak = (b) => keccak_256(b);
export function randomScalar() {
  const b = crypto.getRandomValues(new Uint8Array(64));
  return (big(b) % (Q - 1n)) + 1n;
}
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---------------------------------------------------------------- points
// Compressed (zcash) encodings are cached per point object: transcripts append the same
// points many times, and compression includes a subgroup check.
const enc = new WeakMap();
export function pb(P) {
  let b = enc.get(P);
  if (!b) { b = P.toBytes(true); enc.set(P, b); }
  return b;
}
export const ph = (P) => toHex(pb(P));
function decode(Cls, len, b) {
  if (b.length !== len) throw new Error(`expected ${len}-byte point`);
  const P = Cls.fromBytes(b);
  enc.set(P, Uint8Array.from(b));
  return P;
}
export const g1 = (b) => decode(G1, 48, typeof b === 'string' ? fromHex(b) : b);
export const g2 = (b) => decode(G2, 96, typeof b === 'string' ? fromHex(b) : b);
// Secret-dependent multiplication (constant time) and public multiplication (fast).
export const mul = (P, k) => { k = mod(k); return k === 0n ? P.multiplyUnsafe(0n) : P.multiply(k); };
export const vmul = (P, k) => P.multiplyUnsafe(mod(k));
export const fixedBase = (P) => { try { P.precompute(8, false); } catch (_) { /* optional */ } return P; };

// ---------------------------------------------------------------- transcript
const DST_FS = utf8('SHUTTER-VOTE-FS-v1');
const DST_SCHNORR = utf8('SHUTTER-VOTE-SCHNORR-v1');
function wide(pre) {
  const h1 = keccak(concat(Uint8Array.of(0), pre));
  const h2 = keccak(concat(Uint8Array.of(1), pre));
  return big(concat(h1, h2)) % Q;
}
export const hashToScalar = (dst, ...parts) => wide(concat(dst, ...parts));

export class Transcript {
  constructor(label) { this.parts = [utf8(label)]; }
  append(tag, v) {
    const tb = utf8(tag);
    v = v instanceof Uint8Array ? v : Uint8Array.from(v);
    this.parts.push(u32(tb.length), tb, u32(v.length), v);
    return this;
  }
  point(tag, P) { return this.append(tag, pb(P)); }
  scalar(tag, s) { return this.append(tag, sc(s)); }
  challenge(tag) {
    const tb = utf8(tag);
    const e = wide(concat(DST_FS, u32(tb.length), tb, ...this.parts));
    this.scalar(tag + ':chal', e);
    return e;
  }
  preimage() { return concat(...this.parts); }
}

// ---------------------------------------------------------------- ElGamal
export function encrypt(mpk, m, r = randomScalar()) {
  return { c1: mul(P2, r), c2: mul(mpk, r).add(vmul(P2, m)), r };
}
export const ctAdd = (a, b) => ({ c1: a.c1.add(b.c1), c2: a.c2.add(b.c2) });
export const ctMul = (k, a) => ({ c1: vmul(a.c1, k), c2: vmul(a.c2, k) });

// ---------------------------------------------------------------- DLEQ (Chaum-Pedersen)
function bindDleq(t, b1, p1, b2, p2) {
  t.point('dleq:base1', b1).point('dleq:base2', b2).point('dleq:point1', p1).point('dleq:point2', p2);
}
export function proveDleq(b1, p1, b2, p2, x, t, w = randomScalar()) {
  const a1 = mul(b1, w), a2 = mul(b2, w);
  bindDleq(t, b1, p1, b2, p2);
  t.point('dleq:a1', a1).point('dleq:a2', a2);
  const e = t.challenge('dleq:e');
  return { e, z: mod(w + mod(x) * e), a1, a2 };
}
export function verifyDleq(b1, p1, b2, p2, e, z, t) {
  const a1 = vmul(b1, z).add(vmul(p1, -e));
  const a2 = vmul(b2, z).add(vmul(p2, -e));
  bindDleq(t, b1, p1, b2, p2);
  t.point('dleq:a1', a1).point('dleq:a2', a2);
  return e === t.challenge('dleq:e');
}
export const encodeDleq = (e, z) => concat(sc(e), sc(z));
export function decodeDleq(b) {
  if (b.length !== 64) throw new Error('expected 64-byte DLEQ');
  return { e: scFrom(b.slice(0, 32)), z: scFrom(b.slice(32)) };
}

// Decryption shares: sigma = msk_k * C1, with a DLEQ against the keyper's public share.
export function decryptTranscript(electionId, candidate) {
  return new Transcript('SHUTTER-VOTE-DECRYPT-v1').append('electionId', electionId).append('candidate', u16(candidate));
}
function bindShare(t, C1, C2, pk, k) {
  t.point('dec:C1', C1).point('dec:C2', C2).point('dec:mpk_k', pk).append('dec:keyperIndex', u16(k));
}
export function proveShare(t, C1, C2, pk, sigma, msk, k) {
  bindShare(t, C1, C2, pk, k);
  return proveDleq(P2, pk, C1, sigma, msk, t);
}
export function verifyShare(t, C1, C2, pk, sigma, e, z, k) {
  bindShare(t, C1, C2, pk, k);
  return verifyDleq(P2, pk, C1, sigma, e, z, t);
}

// ---------------------------------------------------------------- OR proof (range proofs)
function bindOr(t, c1, c2, mpk, cands) {
  t.point('or:P2', P2).point('or:mpk', mpk).point('or:C1', c1).point('or:C2', c2);
  t.append('or:|M|', u32(cands.length));
  cands.forEach((m, i) => t.scalar(`or:m[${i}]`, m));
}
export function proveOr(c1, c2, mpk, cands, r, trueIdx, t, opt = {}) {
  const n = cands.length;
  const w = opt.w ?? randomScalar();
  const br = [];
  for (let i = 0; i < n; i++) {
    if (i === trueIdx) { br.push({ a1: mul(P2, w), a2: mul(mpk, w), e: 0n, z: 0n }); continue; }
    const sim = opt.sims?.[i];
    const e = mod(sim ? sim[0] : randomScalar()), z = mod(sim ? sim[1] : randomScalar());
    const D = c2.add(vmul(P2, -BigInt(cands[i])));
    br.push({ a1: mul(P2, z).add(vmul(c1, -e)), a2: mul(mpk, z).add(vmul(D, -e)), e, z });
  }
  bindOr(t, c1, c2, mpk, cands);
  br.forEach((b, i) => t.point(`or:a1[${i}]`, b.a1).point(`or:a2[${i}]`, b.a2));
  const eTot = t.challenge('or:e');
  let sim = 0n;
  br.forEach((b, i) => { if (i !== trueIdx) sim += b.e; });
  br[trueIdx].e = mod(eTot - sim);
  br[trueIdx].z = mod(w + mod(r) * br[trueIdx].e);
  return br;
}
export function verifyOr(c1, c2, mpk, cands, br, t) {
  if (br.length !== cands.length) return false;
  for (let i = 0; i < br.length; i++) {
    const b = br[i];
    if (!vmul(P2, b.z).equals(b.a1.add(vmul(c1, b.e)))) return false;
    const D = c2.add(vmul(P2, -BigInt(cands[i])));
    if (!vmul(mpk, b.z).equals(b.a2.add(vmul(D, b.e)))) return false;
  }
  bindOr(t, c1, c2, mpk, cands);
  br.forEach((b, i) => t.point(`or:a1[${i}]`, b.a1).point(`or:a2[${i}]`, b.a2));
  return mod(br.reduce((s, b) => s + b.e, 0n)) === t.challenge('or:e');
}
export function decodeOr(b) {
  const n = (b[0] << 8) | b[1];
  const br = [];
  let o = 2;
  for (let i = 0; i < n; i++) {
    br.push({ a1: g2(b.slice(o, o + 96)), a2: g2(b.slice(o + 96, o + 192)), e: big(b.slice(o + 192, o + 224)), z: big(b.slice(o + 224, o + 256)) });
    o += 256;
  }
  return br;
}

// ---------------------------------------------------------------- budget proofs
function bindBudget(t, B, mode) {
  t.append('budget:mode', Uint8Array.of(mode === 'exact' ? 0 : 1)).scalar('budget:B', B);
}
export function proveBudgetExact(c1s, c2s, mpk, B, rSum, t, w) {
  bindBudget(t, B, 'exact');
  return proveDleq(P2, c1s, mpk, c2s.add(vmul(P2, -BigInt(B))), rSum, t, w);
}
export function verifyBudgetExact(c1s, c2s, mpk, B, e, z, t) {
  bindBudget(t, B, 'exact');
  return verifyDleq(P2, c1s, mpk, c2s.add(vmul(P2, -BigInt(B))), e, z, t);
}
export function verifyBudgetAtMost(c1s, c2s, mpk, B, br, t) {
  bindBudget(t, B, 'atMost');
  return verifyOr(c1s, c2s, mpk, [...Array(B + 1).keys()], br, t);
}

// ---------------------------------------------------------------- Schnorr on G1
const schnorrChallenge = (R, vk, msg) => hashToScalar(DST_SCHNORR, pb(R), pb(vk), msg);
export function keygen(sk = randomScalar()) { sk = mod(sk); return { sk, vk: mul(P1, sk) }; }
export function schnorrSign(sk, vk, msg, k = randomScalar()) {
  const R = mul(P1, k);
  const e = schnorrChallenge(R, vk, msg);
  return { R, s: mod(mod(k) + e * mod(sk)) };
}
export function schnorrVerify(vk, msg, R, s) {
  if (vk.equals(Z1)) return false;
  return vmul(P1, s).equals(R.add(vmul(vk, schnorrChallenge(R, vk, msg))));
}
export const encodeSig = ({ R, s }) => concat(pb(R), sc(s));
export function decodeSig(b) {
  if (b.length !== 80) throw new Error('expected 80-byte Schnorr signature');
  return { R: g1(b.slice(0, 48)), s: scFrom(b.slice(48), 'schnorr s') };
}

// ---------------------------------------------------------------- ATTESTATION_V1 (eligibility credential)
export function attestationMessage(eid, pseudonym, vkBytes, weight, nonce) {
  const t = new Transcript('SHUTTER-VOTE-ATTEST-v1')
    .append('attest:electionId', eid).append('attest:pseudonym', pseudonym).append('attest:vk', vkBytes)
    .scalar('attest:weight', weight).scalar('attest:nonce', nonce);
  return keccak(t.preimage());
}
export function signAttestation(issuer, eid, pseudonym, vkBytes, weight, nonce) {
  return encodeSig(schnorrSign(issuer.sk, issuer.vk, attestationMessage(eid, pseudonym, vkBytes, weight, nonce)));
}
export function verifyAttestation(issuerVkBytes, att, eid) {
  try {
    if (toHex(att.electionId) !== toHex(eid)) return false;
    if (att.pseudonym.length !== 32 || att.vk.length !== 48) return false;
    if (BigInt(att.weight) < 1n || BigInt(att.nonce) < 1n) return false;
    const { R, s } = decodeSig(att.signature);
    return schnorrVerify(g1(issuerVkBytes), attestationMessage(eid, att.pseudonym, att.vk, att.weight, att.nonce), R, s);
  } catch (_) { return false; }
}

// ---------------------------------------------------------------- ballots (variant A, exact budget)
export function encodeBallotProof(rangeProofs, eB, zB) {
  const parts = [Uint8Array.of(0x01, 0x41), u16(rangeProofs.length)];
  for (const p of rangeProofs) parts.push(u16(p.length));
  for (const p of rangeProofs) for (const b of p) parts.push(pb(b.a1), pb(b.a2), sc(b.e), sc(b.z));
  parts.push(Uint8Array.of(0x00), sc(eB), sc(zB));
  return concat(...parts);
}
export function decodeBallotProof(buf, nc, B) {
  if (buf[0] !== 0x01 || buf[1] !== 0x41) throw new Error('unsupported proof version/variant');
  let o = 2;
  const n = (buf[o] << 8) | buf[o + 1]; o += 2;
  if (n !== nc) throw new Error('candidate count mismatch');
  for (let i = 0; i < n; i++) { if (((buf[o] << 8) | buf[o + 1]) !== B + 1) throw new Error('branch count mismatch'); o += 2; }
  const rangeProofs = [];
  for (let i = 0; i < n; i++) {
    const br = [];
    for (let j = 0; j <= B; j++) {
      br.push({ a1: g2(buf.slice(o, o + 96)), a2: g2(buf.slice(o + 96, o + 192)), e: scFrom(buf.slice(o + 192, o + 224)), z: scFrom(buf.slice(o + 224, o + 256)) });
      o += 256;
    }
    rangeProofs.push(br);
  }
  if (buf[o] !== 0x00) throw new Error('only exact budget supported');
  o += 1;
  const eB = scFrom(buf.slice(o, o + 32)), zB = scFrom(buf.slice(o + 32, o + 64));
  if (o + 64 !== buf.length) throw new Error('trailing bytes');
  return { rangeProofs, eB, zB };
}
export function canonicalBallotMessage(eid, pseudonym, ctBytes, zk, att) {
  const parts = [utf8('SHUTTER-VOTE-BALLOT-v2'), eid, pseudonym, u16(ctBytes.length)];
  for (const [c1, c2] of ctBytes) parts.push(c1, c2);
  parts.push(u32(zk.length), zk, att.pseudonym, att.vk, be(att.weight, 32), be(att.nonce, 32), u16(att.signature.length), att.signature);
  return concat(...parts);
}
function seedBallotTranscript(eid, mpk, vk, cts, nc, B) {
  const t = new Transcript('SHUTTER-VOTE-BALLOT-PROOF-v1')
    .append('electionId', eid).point('mpk', mpk).append('vk', pb(vk))
    .append('variant', Uint8Array.of(0x41)).append('mode', Uint8Array.of(0))
    .append('numCandidates', u16(nc)).append('budget', u16(B)).append('|cts|', u16(cts.length));
  cts.forEach((c, i) => t.point(`ct.c1[${i}]`, c.c1).point(`ct.c2[${i}]`, c.c2));
  return t;
}

// Build a ballot. `onStep` lets the UI follow along; `pin` reproduces fixtures.
export async function buildBallot({ mpk, eid, pseudonym, sk, vk, attestation, votes, budget = 1, onStep, pin = {} }) {
  const nc = votes.length;
  if (votes.reduce((a, b) => a + b, 0) !== budget) throw new Error('exact mode: votes must sum to budget');
  const step = async (name, data) => { if (onStep) await onStep(name, data); };
  const t0 = performance.now();
  await step('encrypt');
  const cts = votes.map((v, j) => encrypt(mpk, v, pin.rs ? BigInt(pin.rs[j]) : randomScalar()));
  const tEnc = performance.now();
  const t = seedBallotTranscript(eid, mpk, vk, cts, nc, budget);
  const cands = [...Array(budget + 1).keys()];
  await step('range', cts);
  const rangeProofs = [];
  for (let j = 0; j < nc; j++) {
    t.append('ballot:range', u16(j));
    rangeProofs.push(proveOr(cts[j].c1, cts[j].c2, mpk, cands, cts[j].r, votes[j], t,
      { w: pin.rangeW ? BigInt(pin.rangeW[j]) : undefined, sims: pin.rangeSims?.[j] }));
    if (onStep) await onStep('range-' + j);
  }
  const tRange = performance.now();
  await step('budget');
  let c1s = Z2, c2s = Z2, rSum = 0n;
  for (const c of cts) { c1s = c1s.add(c.c1); c2s = c2s.add(c.c2); rSum += c.r; }
  t.append('ballot:budget', Uint8Array.of(0));
  const bp = proveBudgetExact(c1s, c2s, mpk, budget, mod(rSum), t, pin.budgetW ? BigInt(pin.budgetW) : undefined);
  const tBudget = performance.now();
  await step('sign');
  const zk = encodeBallotProof(rangeProofs, bp.e, bp.z);
  const ctBytes = cts.map((c) => [pb(c.c1), pb(c.c2)]);
  const preimage = canonicalBallotMessage(eid, pseudonym, ctBytes, zk, attestation);
  const sig = encodeSig(schnorrSign(sk, vk, keccak(preimage), pin.k ? BigInt(pin.k) : undefined));
  const tEnd = performance.now();
  return {
    envelope: { electionId: eid, pseudonym, vk: pb(vk), ciphertexts: ctBytes, zkProof: zk, voterSignature: sig, attestation },
    detail: { cts, rangeProofs, budgetProof: bp, sum: { c1: c1s, c2: c2s }, preimage },
    timing: { encrypt: tEnc - t0, range: tRange - tEnc, budget: tBudget - tRange, sign: tEnd - tBudget, total: tEnd - t0 },
  };
}

// Verify a ballot's proofs and voter signature from its wire bytes.
export function verifyBallot(env, mpk, nc, B = 1) {
  try {
    if (env.electionId.length !== 32 || env.pseudonym.length !== 32) return { ok: false, reason: 'MALFORMED' };
    const vk = g1(env.vk);
    if (vk.equals(Z1) || env.ciphertexts.length !== nc) return { ok: false, reason: 'MALFORMED' };
    const cts = env.ciphertexts.map(([a, b]) => ({ c1: g2(a), c2: g2(b) }));
    const { rangeProofs, eB, zB } = decodeBallotProof(env.zkProof, nc, B);
    const t = seedBallotTranscript(env.electionId, mpk, vk, cts, nc, B);
    const cands = [...Array(B + 1).keys()];
    for (let j = 0; j < nc; j++) {
      t.append('ballot:range', u16(j));
      if (!verifyOr(cts[j].c1, cts[j].c2, mpk, cands, rangeProofs[j], t)) return { ok: false, reason: 'INVALID_PROOF', detail: `range proof ${j}` };
    }
    let c1s = Z2, c2s = Z2;
    for (const c of cts) { c1s = c1s.add(c.c1); c2s = c2s.add(c.c2); }
    t.append('ballot:budget', Uint8Array.of(0));
    if (!verifyBudgetExact(c1s, c2s, mpk, B, eB, zB, t)) return { ok: false, reason: 'INVALID_PROOF', detail: 'sum proof' };
    const { R, s } = decodeSig(env.voterSignature);
    const pre = canonicalBallotMessage(env.electionId, env.pseudonym, env.ciphertexts, env.zkProof, env.attestation);
    if (!schnorrVerify(vk, keccak(pre), R, s)) return { ok: false, reason: 'INVALID_SIGNATURE' };
    return { ok: true, cts };
  } catch (err) {
    return { ok: false, reason: 'MALFORMED', detail: String(err.message || err) };
  }
}

// ---------------------------------------------------------------- Feldman DKG over G2
export function dkgDeal(n, quorum) {
  const coeffs = Array.from({ length: quorum }, () => randomScalar());
  const commitments = coeffs.map((c) => mul(P2, c));
  const shares = {};
  for (let i = 1; i <= n; i++) {
    let v = 0n, x = 1n;
    for (const c of coeffs) { v = mod(v + c * x); x = mod(x * BigInt(i)); }
    shares[i] = v;
  }
  return { coeffs, commitments, shares };
}
export function dkgVerifyShare(commitments, i, share) {
  let exp = Z2, x = 1n;
  for (const c of commitments) { exp = exp.add(vmul(c, x)); x = mod(x * BigInt(i)); }
  return exp.equals(mul(P2, share));
}
export const dkgJointKey = (all) => all.reduce((acc, comms) => acc.add(comms[0]), Z2);
export function dkgPublicShare(target, all) {
  let pk = Z2;
  for (const comms of all) {
    let x = 1n;
    for (const c of comms) { pk = pk.add(vmul(c, x)); x = mod(x * BigInt(target)); }
  }
  return pk;
}

// ---------------------------------------------------------------- threshold combination + recovery
export function lagrange(j, ids) {
  let num = 1n, den = 1n;
  for (const k of ids) {
    if (k === j) continue;
    num = mod(num * mod(-BigInt(k)));
    den = mod(den * mod(BigInt(j) - BigInt(k)));
  }
  return mod(num * Fr.inv(den));
}
export function combineShares(pairs) {
  const ids = pairs.map(([id]) => id);
  return pairs.reduce((acc, [id, sigma]) => acc.add(vmul(sigma, lagrange(id, ids))), Z2);
}
// Baby-step giant-step for m in [0, max] with m*P2 == target. Keys use the affine
// x-coordinate, which is cheaper than full compression and unique up to sign.
function key(P) {
  if (P.equals(Z2)) return 'O';
  const a = P.toAffine();
  return a.x.c0.toString(36) + ':' + a.x.c1.toString(36) + ':' + (a.y.c0 & 1n);
}
export function bsgsTable(max) {
  const n = max > 0 ? Number(sqrtBig(BigInt(max))) + 2 : 1;
  const table = new Map();
  let p = Z2;
  for (let j = 0; j < n; j++) { const k = key(p); if (!table.has(k)) table.set(k, j); p = p.add(P2); }
  return { max: BigInt(max), n, step: vmul(P2, BigInt(n)).negate(), table };
}
export function bsgs(target, tbl) {
  if (target.equals(Z2)) return 0n;
  let g = target;
  for (let i = 0; i <= tbl.n; i++) {
    const j = tbl.table.get(key(g));
    if (j !== undefined) {
      const m = BigInt(i) * BigInt(tbl.n) + BigInt(j);
      if (m <= tbl.max && vmul(P2, m).equals(target)) return m;
    }
    g = g.add(tbl.step);
  }
  return null;
}
function sqrtBig(v) {
  if (v < 2n) return v;
  let x = BigInt(Math.floor(Math.sqrt(Number(v))));
  while (x * x > v) x--;
  while ((x + 1n) * (x + 1n) <= v) x++;
  return x;
}

// Cheap result check: T * P2 must equal tau = C2 - sigma.
export const checkTotal = (tau, total) => vmul(P2, BigInt(total)).equals(tau);

export const short = (b, n = 8) => { const h = typeof b === 'string' ? b : toHex(b); return h.length <= 2 * n ? h : h.slice(0, n) + '…' + h.slice(-4); };
