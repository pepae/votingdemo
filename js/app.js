import { html, render, useState, useEffect, useRef, useMemo } from 'htm/preact/standalone';
import * as E from './engine.js';
import * as C from './crypto.js';

const { OPTIONS, KEYHOLDERS, T, N } = E;

// ---------------------------------------------------------------- small pieces
const ICONS = {
  lock: ['M5 11h14v10H5z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  key: ['M11 12.5l8.5-8.5', 'M16.5 7l3 3', 'M14 9.5l2 2', 'M7.5 20.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'],
  users: ['M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20', 'M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.4', 'M15.5 4.2a3.5 3.5 0 0 1 0 6.6'],
  eyeoff: ['M3 3l18 18', 'M10.6 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7a12.5 12.5 0 0 1-2.9 4.1', 'M6.6 6.6C4.2 8 2.6 10.2 2 12c1 2.5 5 7 10 7a9.8 9.8 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  chev: ['M9.5 6l6 6-6 6'],
  down: ['M6 9.5l6 6 6-6'],
  reset: ['M4 12a8 8 0 1 0 2.4-5.7', 'M4 4v4.5h4.5'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  box: ['M4 10h16v10H4z', 'M9 10V4h6v6', 'M8 14.5h8'],
  sigma: ['M17 5H7l6 7-6 7h10'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.6v.1'],
  chip: ['M7 7h10v10H7z', 'M10 3v4', 'M14 3v4', 'M10 17v4', 'M14 17v4', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'],
  bolt: ['M13 2L4.5 14H11l-1 8 8.5-12H12z'],
  scale: ['M12 4v16', 'M7 20h10', 'M5 7h14', 'M5 7l-3 6.5a3 3 0 0 0 6 0z', 'M19 7l-3 6.5a3 3 0 0 0 6 0z'],
  eye: ['M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
};
const Icon = ({ n, s = 18, w = 1.8 }) => html`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n].map((d) => html`<path d=${d} />`)}</svg>`;
const Check = ({ st = 'ok', s = 22 }) => html`<span class=${'check ' + st} style=${{ width: s + 'px', height: s + 'px' }}>${st === 'ok' ? html`<${Icon} n="check" s=${s - 8} w="2.6" />` : st === 'bad' ? html`<${Icon} n="x" s=${s - 8} w="2.6" />` : null}</span>`;
const Chip = ({ c = '', children }) => html`<span class=${'chip ' + c}>${children}</span>`;
const Av = ({ a, s = 30 }) => html`<span class="av" style=${{ background: a.color, width: s + 'px', height: s + 'px' }}>${a.id}</span>`;
const fmt = (n) => Number(n).toLocaleString('en-US');
const ms = (x) => (x < 1000 ? `${Math.max(1, Math.round(x))} ms` : `${(x / 1000).toFixed(1)} s`);

function Hex({ v, n = 10, light }) {
  const [open, setOpen] = useState(false);
  const s = typeof v === 'string' ? v : C.toHex(v);
  const shown = open || s.length <= n * 2 + 8 ? s : `${s.slice(0, n * 2)}…${s.slice(-8)}`;
  return html`<button class=${'hex' + (light ? ' light' : '')} title=${open ? 'Click to collapse' : `${s.length / 2} bytes, click to expand`} onClick=${() => setOpen(!open)}>${shown}</button>`;
}
function Scramble({ text, cls = 'mono' }) {
  const [shown, setShown] = useState(text);
  const prev = useRef(text);
  useEffect(() => {
    if (prev.current === text) return undefined;
    prev.current = text;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(text); return undefined; }
    let i = 0;
    const id = setInterval(() => {
      i++;
      if (i >= 12) { clearInterval(id); setShown(text); return; }
      setShown(text.split('').map((ch, k) => (k < (i / 12) * text.length ? ch : '0123456789abcdef'[(Math.random() * 16) | 0])).join(''));
    }, 45);
    return () => clearInterval(id);
  }, [text]);
  return html`<span class=${cls}>${shown}</span>`;
}
function Hood({ title = 'Under the hood', sub, children, open: initial = false }) {
  const [open, setOpen] = useState(initial);
  return html`<div class="toggle-hood">
    <button class="link small" onClick=${() => setOpen(!open)}><${Icon} n="chip" s=${15} /> ${open ? 'Hide' : 'Show'} ${title.toLowerCase()} <${Icon} n=${open ? 'down' : 'chev'} s=${14} /></button>
    ${open && html`<div class="hood mt12"><div class="hood-t"><${Icon} n="chip" s=${15} /> ${title} ${sub && html`<span class="faint">${sub}</span>`}</div>${children}</div>`}
  </div>`;
}
function Seg({ value, options, onChange, disabled }) {
  return html`<div class="seg" role="radiogroup">${options.map(([k, label]) => html`<button role="radio" aria-checked=${value === k} class=${value === k ? 'on' : ''} disabled=${disabled} onClick=${() => onChange(k)}>${label}</button>`)}</div>`;
}
const Switch = ({ on, onChange, disabled, label }) => html`<button class=${'switch' + (on ? ' on' : '')} role="switch" aria-checked=${on} aria-label=${label} disabled=${disabled} onClick=${() => onChange(!on)}></button>`;
function Ring({ value, label, sub, size = 168, stroke = 12 }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return html`<div class="ring" style=${{ width: size + 'px', height: size + 'px' }}>
    <svg width=${size} height=${size}><circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--track)" stroke-width=${stroke} />
      <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--bar)" stroke-width=${stroke} stroke-linecap="round" stroke-dasharray=${c} stroke-dashoffset=${c * (1 - Math.max(0, Math.min(1, value)))} style="transition: stroke-dashoffset .9s var(--ease)" /></svg>
    <div class="ring-c"><div><b>${label}</b><span>${sub}</span></div></div></div>`;
}
const Empty = ({ icon, title, text, cta, go }) => html`<div class="card empty"><div class="ic"><${Icon} n=${icon} s=${26} /></div><h3>${title}</h3><p>${text}</p>${cta && html`<button class="btn" onClick=${() => go(cta[0])}>${cta[1]}</button>`}</div>`;
const Head = ({ eyebrow, title, lede }) => html`<header class="head"><div class="eyebrow">${eyebrow}</div><h1 class="h1">${title}</h1>${lede && html`<p class="lede">${lede}</p>`}</header>`;
const KV = ({ rows }) => html`<dl class="kv">${rows.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;
// The weight cap in force: fixed at close, otherwise the current setting.
const capNow = () => { const s = E.S(); return s.locked ? s.locked.capValue : E.capValue(); };
const Wt = ({ w }) => { const cap = capNow(); return cap != null && Number(w) > cap ? html`<span class="wt-cap" title=${`${fmt(w)} shares, capped at ${fmt(cap)}`}><s>${fmt(w)}</s> ${fmt(cap)}</span>` : fmt(w); };

function useStore() {
  const [, force] = useState(0);
  useEffect(() => E.subscribe(() => force((x) => x + 1)), []);
  return E.S();
}

// ---------------------------------------------------------------- nav
const ROUTES = [['overview', 'Overview'], ['setup', 'Set up'], ['vote', 'Vote'], ['live', 'Live'], ['count', 'Count'], ['results', 'Results'], ['verify', 'Verify']];
function stepDone(s, k) {
  return { setup: s.status !== 'setup', vote: s.status !== 'setup' && s.ballots.length > 0 && s.status !== 'open', live: s.status === 'closed' || s.status === 'counted', count: s.status === 'counted', results: s.status === 'counted', verify: !!s.verify?.ok }[k];
}
function Nav({ route, go }) {
  const s = E.S();
  const [ask, setAsk] = useState(false);
  return html`<nav class="nav"><div class="nav-in">
    <button class="brand" onClick=${() => go('overview')} aria-label="Overview"><span class="brand-mark"><${Icon} n="lock" s=${15} w="2.2" /></span><span class="bt">Shutter Governance</span><small>Concept demo for MIXX</small></button>
    <div class="steps">${ROUTES.map(([k, label], i) => html`<button class=${'step-btn' + (route === k ? ' on' : '') + (stepDone(s, k) ? ' done' : '')} onClick=${() => go(k)} aria-current=${route === k ? 'page' : null}>${i > 0 && html`<span class="n">${stepDone(s, k) && route !== k ? html`<${Icon} n="check" s=${11} w="3" />` : i}</span>`}${label}</button>`)}</div>
    <button class="icon-btn" title="Start over" aria-label="Start over" onClick=${() => setAsk(true)}><${Icon} n="reset" s=${17} /></button>
  </div>
  ${ask && html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && setAsk(false)}><div class="modal" role="dialog" aria-modal="true"><h3>Start over?</h3><p>This clears the key, all ballots and the count, and starts a fresh election with a new key.</p><div class="row mt24" style="justify-content:flex-end"><button class="btn ghost" onClick=${() => setAsk(false)}>Cancel</button><button class="btn" onClick=${() => { E.reset(); setAsk(false); go('setup'); }}>Start over</button></div></div></div>`}
  </nav>`;
}

// ---------------------------------------------------------------- phone
const StatusBar = () => html`<div class="sbar"><span>9:41</span><span class="sbar-icons"><svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor"/><rect x="4.5" y="5" width="3" height="6" rx="1" fill="currentColor"/><rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="currentColor"/><rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor"/></svg><svg width="25" height="12" viewBox="0 0 25 12"><rect x=".5" y=".5" width="21" height="11" rx="3.5" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor"/><rect x="22.5" y="4" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".5"/></svg></span></div>`;
function PhoneFrame({ children }) {
  return html`<div class="phone"><div class="island"></div><div class="screen"><${StatusBar} /><div class="app">${children}</div></div></div>`;
}
function AppHead({ a }) {
  const s = E.S();
  return html`<div class="app-h"><div><small>${s.meeting.company}</small><b>${s.meeting.title}</b></div><${Av} a=${a} s=${34} /></div>`;
}
function BallotScreen({ a, pick, onPick, onSeal, disabled, voted, demo }) {
  const s = E.S();
  return html`<${AppHead} a=${a} />
    <div><span class="chip green" style="background:#e3f6e9;color:#1a7f3c"><span class="dot pulse"></span> Item ${s.meeting.no} · voting open</span></div>
    <div class="ios-t mt8">${s.meeting.item}</div>
    <div class="ios-s">You vote with ${fmt(a.shares)} shares${capNow() != null && a.shares > capNow() ? `, counted as ${fmt(capNow())} under the cap` : ''}${a.proxy === 'chair' ? ' · your proxy is the chair' : ''}</div>
    <div class="group">${OPTIONS.map((o) => html`<button class=${'opt' + (pick === o.key ? ' on' : '')} onClick=${() => onPick && onPick(o.key)} disabled=${disabled}>
      <span class="radio">${pick === o.key && html`<${Icon} n="check" s=${13} w="3" />`}</span><span><b>${o.label}</b>${o.hint && html`<small>${o.hint}</small>`}</span></button>`)}</div>
    ${voted && html`<div class="ios-note" style="margin-top:12px">You already voted. Sending again replaces it.</div>`}
    <button class="ios-btn" disabled=${!demo && (!pick || disabled)} tabindex=${demo ? -1 : 0} onClick=${onSeal} style=${demo ? 'margin-top:auto;pointer-events:none' : 'margin-top:auto'}>Seal and send vote</button>
    <div class="ios-note"><${Icon} n="lock" s=${12} w="2.2" /> Encrypted on this phone. Not even MIXX can see it.</div>`;
}
function SealingScreen({ a }) {
  const s = E.S();
  const ph = s.phone;
  const encDone = ph.steps.encrypt === 'done' && ph.cts;
  const pick = ph.pick[a.id];
  return html`<${AppHead} a=${a} />
    <div class="ios-t">Sealing your vote</div>
    <div class="cipher-rows">${OPTIONS.map((o) => html`<div class="cipher-row"><span>${o.label}</span>${encDone ? html`<${Scramble} text=${ph.cts[OPTIONS.indexOf(o)].slice(0, 12)} cls="mono" />` : html`<b class="mono" style="color:#1d1d1f">${pick === o.key ? 1 : 0}</b>`}</div>`)}</div>
    <div class="seal-steps">${E.SEAL_STEPS.map(([k, label]) => { const st = ph.steps[k]; return html`<div class=${'seal-step' + (st ? ' ' + (st === 'run' ? 'on' : 'done') : '')}>${st === 'done' ? html`<${Check} s=${20} />` : st === 'run' ? html`<span class="check run" style="width:20px;height:20px"></span>` : html`<span class="check wait" style="width:20px;height:20px"></span>`}<span>${label}</span></div>`; })}</div>`;
}
function DoneScreen({ a, onAgain }) {
  const s = E.S();
  return html`<${AppHead} a=${a} />
    <div class="done-mark"><${Icon} n="check" s=${38} w="2.6" /></div>
    <div class="ios-t" style="text-align:center">Vote sealed</div>
    <div class="ios-s" style="text-align:center">Your ballot is in the ballot box. Keep the tracking code to find it later.</div>
    <div class="code-pill">${s.phone.code}</div>
    <div class="ios-note">You can change your vote until voting closes.</div>
    <button class="ios-btn sec" style="margin-top:auto" onClick=${onAgain}>Change vote</button>`;
}
const PhoneMsg = ({ a, icon, title, text, children }) => html`<${AppHead} a=${a} /><div class="phone-msg"><div class="ic"><${Icon} n=${icon} s=${26} /></div><div class="ios-t" style="font-size:20px">${title}</div><div class="ios-s">${text}</div>${children}</div>`;

function Phone({ who }) {
  const s = E.S();
  const a = E.person(who);
  const ph = s.phone;
  const voted = s.ballots.some((b) => b.attendeeId === who);
  let body;
  if (s.status === 'setup') body = html`<${PhoneMsg} a=${a} icon="lock" title="Voting has not opened" text="The key ceremony and the opening happen in Set up." />`;
  else if (!E.isPresent(a)) body = html`<${PhoneMsg} a=${a} icon="users" title="Not checked in" text=${`${a.name.split(' ')[0]} is not present and has no proxy, so cannot vote on this item.`}><button class="ios-btn sec" style="margin-top:14px" onClick=${() => { a.present = true; E.emit(); }} disabled=${s.status !== 'open'}>Check in</button><//>`;
  else if (ph.who === who && ph.phase === 'sealing') body = html`<${SealingScreen} a=${a} />`;
  else if (ph.who === who && ph.phase === 'done' && s.status === 'open') body = html`<${DoneScreen} a=${a} onAgain=${() => { ph.phase = 'pick'; E.emit(); }} />`;
  else if (s.status !== 'open') body = html`<${PhoneMsg} a=${a} icon="lock" title="Voting closed" text=${voted ? 'Your sealed vote is in the count.' : 'No vote was cast from this phone.'} />`;
  else body = html`<${BallotScreen} a=${a} pick=${ph.pick[who]} voted=${voted} disabled=${s.autoRunning || (ph.phase === 'sealing')} onPick=${(k) => { ph.pick[who] = k; E.emit(); }} onSeal=${() => E.castVote(who, ph.pick[who])} />`;
  return html`<${PhoneFrame}>${body}<//>`;
}

// ---------------------------------------------------------------- overview
function Overview({ go }) {
  const demoA = { id: 'A', name: 'Anna Peeters', shares: 100, color: '#0071e3' };
  const flows = [
    ['lock', 'Seal', 'The phone encrypts the choice and proves it is a valid vote, without revealing it.'],
    ['box', 'Post', 'The ballot box publishes every sealed ballot, so anyone can see it arrived unchanged.'],
    ['sigma', 'Add up', 'Sealed ballots are weighted by shares and added up while still sealed.'],
    ['key', 'Open', `Any ${T} of ${N} independent keyholders open the totals together. Never a single ballot.`],
    ['shield', 'Check', 'Anyone can recheck every proof and the final count, in their own browser.'],
  ];
  const gains = [
    ['#0071e3', 'eyeoff', 'Secret, even from MIXX', 'No one sees an individual vote: not the platform, not the chair, not the server.'],
    ['#6e4fd8', 'key', 'No master key', `The decryption key is split across ${N} organisations. Any ${T} together open the totals. Single ballots stay secret unless ${T} of them collude.`],
    ['#1a8f48', 'shield', 'Proof instead of trust', 'Each ballot carries zero-knowledge proofs that it is one valid vote with the right weight.'],
    ['#b25a00', 'search', 'Checkable by anyone', 'Shareholders, auditors or a notary can recheck the whole count from the public record.'],
    ['#d1468e', 'bolt', 'Tamper evident', 'A changed weight, a swapped ballot, a cheating keyholder or a wrong total is caught.'],
    ['#5e5ce6', 'scale', 'Your numbers, unchanged', 'The worked example from your calculation guide comes out exactly the same: 300, 240, 220, 30.'],
  ];
  const P = { pilot: ['blue', 'Pilot'], int: ['violet', 'Full integration'], later: ['orange', 'Later phase'], no: ['', 'Not covered'] };
  const reqs = [
    ['Voting weight (shares)', 'Weight sits in each signed credential and is public. The sealed vote is multiplied by it.', true, 'pilot'],
    ['Ignore voting weight', 'Every credential counts as 1. Set before voting closes.', true, 'pilot'],
    ['Abstain', 'A sealed option like any other.', true, 'pilot'],
    ['Majority base: cast, without abstentions, present, all', 'Computed from the decrypted totals. Switch freely after the count.', true, 'pilot'],
    ['Non-voters count as abstention', 'Computed from the decrypted totals and the attendance list.', true, 'pilot'],
    ['Change vote until voting closes', 'The latest ballot per voter counts, enforced by a signed counter.', true, 'pilot'],
    ['Categories, allowed to vote', 'Only eligible attendees receive a voting credential.', false, 'pilot'],
    ['Live voting screen', 'Turnout is live and public. Results stay sealed until voting closes.', true, 'pilot'],
    ['Close voting from the chair’s screen', 'A signed close instead of a fixed end time.', true, 'int'],
    ['Weight cap', 'Applied to the weights when sealed votes are added up. Fixed at close.', true, 'int'],
    ['Discretionary vote (leave to the chair)', 'A sealed option. The chair assigns its total publicly after the count.', true, 'int'],
    ['Proxies', 'The proxy holder votes with the principal’s credential; the principal’s own vote takes precedence.', false, 'int'],
    ['Multiple choice with min and max', 'Needs an additional proof type for “between min and max options”.', false, 'later'],
    ['Confirming advance votes', 'Needs a confirmation record per ballot.', false, 'later'],
    ['Wireless keypads', 'Keypads cannot encrypt, so they stay outside the sealed flow.', false, 'no'],
  ];
  return html`<div class="page">
    <section class="hero">
      <${Chip} c="blue">Concept demo · prepared for MIXX<//>
      <h1 class="mt16">Secret ballots.<br /><span class="grad">Provable results.</span></h1>
      <p class="lede">Your general assemblies keep their rules: share weights, proxies, chair votes and majority bases. Every ballot is sealed on the voter's phone, counted while still sealed, and only the totals are opened, by independent keyholders. Anyone can check the result.</p>
      <div class="hero-cta"><button class="btn lg" onClick=${() => go('setup')}>Start the demo</button><button class="btn lg ghost" onClick=${() => document.getElementById('rules').scrollIntoView({ behavior: 'smooth' })}>Your rules, mapped</button></div>
      <div class="showcase">
        <div class="float" style="left:10px;top:50px"><b>Sealed on the phone</b><span class="muted">Encrypted before it leaves the device.</span><div class="mono mt8">C₁ = r·G   C₂ = r·PK + m·G</div></div>
        <div class="float" style="left:-10px;top:330px"><b>Proven valid</b><span class="muted">Each option is 0 or 1, exactly one is chosen. Which one stays secret.</span></div>
        <div class="float" style="right:-10px;top:90px"><b>Counted while sealed</b><span class="muted">Encrypted ballots add up to an encrypted total.</span><div class="mono mt8">Σ wᵢ·Enc(vᵢ) = Enc(Σ wᵢvᵢ)</div></div>
        <div class="float" style="right:10px;top:380px"><b>Opened by ${T} of ${N}</b><span class="muted">MIXX, Shutter, a notary, the auditor and the members each hold a key share.</span></div>
        <div style="pointer-events:none"><${PhoneFrame}><${BallotScreen} a=${demoA} pick="for" disabled=${true} demo=${true} /><//></div>
      </div>
    </section>

    <section class="sec-h"><div class="eyebrow">How it works</div><h2>Five steps. Each one public, each one checkable.</h2></section>
    <div class="flow">${flows.map(([ic, t, d], i) => html`<div class="flow-s"><span class="k">${i + 1}</span><div class="ic"><${Icon} n=${ic} s=${20} /></div><b>${t}</b><span>${d}</span></div>`)}</div>

    <section class="band">
      <h2>Not a mock-up underneath.<br />Real cryptography, in this page.</h2>
      <p>Every vote you cast in this demo is encrypted, proven, counted and decrypted with the Shutter voting protocol. The ballots use the same constructions and byte formats as the reference implementation and pass its conformance test vectors.</p>
      <div class="specs">
        <div class="spec"><b>BLS12-381</b><span>Pairing-friendly curve, about 128-bit security</span></div>
        <div class="spec"><b>ElGamal</b><span>Additively homomorphic, so totals are computed sealed</span></div>
        <div class="spec"><b>Zero knowledge</b><span>Range, sum and decryption proofs, all Fiat-Shamir</span></div>
        <div class="spec"><b>${T} of ${N}</b><span>Threshold key from a distributed key ceremony</span></div>
      </div>
    </section>

    <section class="sec-h" id="rules"><div class="eyebrow">Your rules, our guarantees</div><h2>Everything your calculation guide describes, plus what encryption adds.</h2></section>
    <div class="grid g-3">${gains.map(([col, ic, t, d]) => html`<div class="card gain"><div class="ic" style=${{ background: col }}><${Icon} n=${ic} s=${18} /></div><b>${t}</b><p>${d}</p></div>`)}</div>
    <div class="card mt24">
      <div class="card-h"><div><div class="card-t">How each MIXX setting works with sealed votes</div><div class="card-s">What this demo shows, and when each part would arrive in your app.</div></div></div>
      <div class="req"><div class="req-h"><span>Setting</span><span>In demo</span><span>With sealed voting</span><span>Phase</span></div>
      ${reqs.map(([k, how, demo, ph]) => html`<div class="req-r"><b>${k}</b><span class="req-demo">${demo ? html`<${Check} s=${20} />` : html`<span class="faint">-</span>`}</span><span class="req-how">${how}</span><span class="req-ph"><${Chip} c=${P[ph][0]}>${P[ph][1]}<//></span></div>`)}</div>
    </div>
    <div class="next"><button class="btn lg" onClick=${() => go('setup')}>Start the demo <${Icon} n="chev" s=${16} /></button></div>
    <footer class="footer"><span>Concept demo by Shutter Governance (brainbot gmbh, Mainz). Fictional company and attendees; numbers follow the worked example in MIXX's calculation guide.</span><span>Runs entirely in your browser. Nothing is sent anywhere.</span></footer>
  </div>`;
}

// ---------------------------------------------------------------- set up
function KeyGraph({ dkg }) {
  const W = 320, H = 300, cx = 160, cy = 152, R = 100;
  const pos = KEYHOLDERS.map((_, i) => { const t = ((-90 + i * 72) * Math.PI) / 180; return [cx + R * Math.cos(t), cy + R * Math.sin(t)]; });
  const st = (id) => dkg?.members?.[id - 1]?.state || 'wait';
  const fill = { wait: 'var(--sunk)', dealing: 'var(--accent-tint)', dealt: 'var(--accent-tint)', verifying: 'var(--accent)', ready: 'var(--green)' };
  const ink = (id) => (['verifying', 'ready'].includes(st(id)) ? '#fff' : 'var(--text-2)');
  const done = dkg?.status === 'done';
  const initials = ['MX', 'SH', 'NO', 'AU', 'ME'];
  const pairs = [];
  if (dkg?.phase === 'exchange') for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pairs.push([i, j]);
  return html`<svg class="graph" viewBox=${`0 0 ${W} ${H}`} width="100%" style="max-width:340px;display:block;margin:0 auto" role="img" aria-label="Key ceremony between five keyholders">
    ${pairs.map(([i, j]) => html`<line class="edge" x1=${pos[i][0]} y1=${pos[i][1]} x2=${pos[j][0]} y2=${pos[j][1]} />`)}
    ${done && pos.map(([x, y]) => html`<line x1=${x} y1=${y} x2=${cx} y2=${cy} stroke="var(--green)" stroke-width="1.5" opacity=".45" />`)}
    ${done && html`<g><circle cx=${cx} cy=${cy} r="30" fill="var(--text)" /><g transform=${`translate(${cx - 11},${cy - 11})`} style="color:var(--surface)"><${Icon} n="key" s=${22} w="2" /></g><text x=${cx} y=${cy + 50} text-anchor="middle" class="halo">Election key</text></g>`}
    ${!done && html`<text x=${cx} y=${cy + 4} text-anchor="middle" style="fill:var(--text-3);font-weight:500">${dkg ? (dkg.phase === 'deal' ? 'Dealing shares' : dkg.phase === 'exchange' ? 'Checking shares' : 'Combining') : `${T} of ${N}`}</text>`}
    ${KEYHOLDERS.map((k, i) => { const [x, y] = pos[i]; const below = y > cy - 10; return html`<g><circle class="node" cx=${x} cy=${y} r="25" fill=${fill[st(k.id)]} stroke=${st(k.id) === 'wait' ? 'var(--line-2)' : 'none'} />
      <text x=${x} y=${y + 4} text-anchor="middle" style=${{ fill: ink(k.id) }}>${st(k.id) === 'ready' ? '✓' : initials[i]}</text>
      <text x=${x} y=${below ? y + 42 : y - 33} text-anchor="middle" style="fill:var(--text);font-weight:500">${k.name}</text></g>`; })}
  </svg>`;
}

// Weight per attendee against the cap line. Anything above the cap is hatched and does not count.
function WeightBars() {
  const s = E.S();
  const r = s.locked || s.rules;
  if (r.ignoreWeight) return html`<div class="wb"><p class="small muted">Voting weight is ignored, so every attendee counts as 1 and there is nothing to cap.</p></div>`;
  const cap = capNow();
  const sm = E.sums(false);
  const onPresent = r.capMode === 'present';
  const base = onPresent ? sm.present : sm.all;
  const baseLabel = onPresent ? 'present votes' : 'all votes';
  const max = Math.max(...s.attendees.map((a) => a.shares), cap || 0);
  const pc = (x) => `${Math.round((x / base) * 100)} %`;
  const x = (v) => (v / max) * 100 + '%';
  const top = s.attendees.reduce((m, a) => (a.shares > m.shares ? a : m));
  const over = cap != null ? s.attendees.filter((a) => a.shares > cap) : [];
  const first = (a) => a.name.split(' ')[0];
  return html`<div class="wb">
    <div class="wb-h"><span>Weight per attendee</span><span>${cap != null ? 'counts as' : 'shares'} · % of ${baseLabel}</span></div>
    ${s.attendees.map((a, i) => {
      const capped = cap != null && a.shares > cap;
      const eff = capped ? cap : a.shares;
      const here = E.isPresent(a);
      return html`<div class=${'wb-r' + (here ? '' : ' away')} title=${`${a.name}: ${fmt(a.shares)} shares${capped ? `, counts as ${fmt(cap)}` : ''}${here ? '' : ', absent'}`}>
        <span class="wb-n"><${Av} a=${a} s=${22} /><span>${first(a)}</span></span>
        <div class="wb-t"><div class="wb-f" style=${{ width: x(eff), borderRadius: capped ? '0' : '' }}></div>${capped && html`<div class="wb-x" style=${{ left: x(cap), width: x(a.shares - cap) }}></div>`}${cap != null && html`<div class="wb-cap" style=${{ left: x(cap) }}>${i === 0 && html`<span>cap ${fmt(cap)}</span>`}</div>`}</div>
        <span class="wb-v">${capped ? html`<s>${fmt(a.shares)}</s> <b>${fmt(cap)}</b>` : html`<b>${fmt(a.shares)}</b>`}<small>${here || !onPresent ? pc(eff) : 'absent'}</small></span>
      </div>`;
    })}
    <div class="wb-foot">${cap == null
      ? html`<span>${first(top)} alone holds ${pc(top.shares)} of all votes. A cap limits what any one shareholder counts for.</span>${!s.locked && html`<button class="btn ghost sm" onClick=${() => { s.rules.capMode = 'all'; s.rules.capPct = 25; E.emit(); }}>Try the cap from your guide: 25 % of all votes</button>`}`
      : over.length
        ? html`<span><b>${over.map(first).join(', ')}</b> ${over.length === 1 ? 'counts' : 'count'} for ${fmt(cap)} instead of ${over.map((a) => fmt(a.shares)).join(', ')}. The cap is ${r.capPct} % of ${baseLabel} (${fmt(base)}), and the hatched part does not count.</span>`
        : html`<span>Nobody is above the cap of ${fmt(cap)} (${r.capPct} % of ${baseLabel}).</span>`}</div>
  </div>`;
}

function Setup({ go }) {
  const s = useStore();
  const r = s.rules;
  const sm = E.sums(r.ignoreWeight);
  const locked = !!s.locked;
  const editable = s.status === 'setup';
  const dkg = s.dkg;
  const cap = E.capValue(r);
  const set = (k, v) => { r[k] = v; E.emit(); };
  const badge = (fixed) => (fixed ? html`<${Chip} c="orange"><${Icon} n="lock" s=${11} w="2.4" /> Fixed at close<//>` : html`<${Chip} c="green">Adjustable after the count<//>`);
  return html`<div class="page">
    <${Head} eyebrow="Step 1 · Back office" title="Prepare the meeting" lede="Attendees, counting rules and the election key. Everything except the key ceremony mirrors what the MIXX back office does today." />
    <div class="grid g-setup">
      <div class="stack">
        <div class="card">
          <div class="card-h"><div><div class="card-t">${s.meeting.company} · ${s.meeting.title}</div><div class="card-s">Agenda item ${s.meeting.no}: ${s.meeting.item}</div></div><${Chip} c=${s.status === 'setup' ? '' : s.status === 'open' ? 'green' : 'blue'}>${{ setup: 'Draft', open: 'Voting open', closed: 'Voting closed', counted: 'Counted' }[s.status]}<//></div>
          <div class="row wrap">${OPTIONS.map((o) => html`<${Chip}>${o.label}<//>`)}<span class="faint small">Single choice · abstain and discretionary vote allowed</span></div>
        </div>
        <div class="card">
          <div class="card-h"><div><div class="card-t">Attendees</div><div class="card-s">From the worked example in MIXX's calculation guide. Weights are bound into each voting credential.</div></div></div>
          <div class="scroll-x"><table class="tbl"><thead><tr><th>Attendee</th><th class="r">Shares</th><th>Present</th><th class="hide-sm">Proxy</th><th class="hide-sm">Counts as</th></tr></thead><tbody>
          ${s.attendees.map((a) => html`<tr><td><div class="who"><${Av} a=${a} /><span><b>${a.name}</b><span class="show-sm tiny faint">${E.isPresent(a) ? (a.present ? 'Present' : 'Present via the chair') : 'Absent'}</span></span></div></td>
            <td class="r"><input class="input num" type="number" min="1" max="1000000" value=${a.shares} disabled=${!editable} aria-label=${'Shares for ' + a.name} onChange=${(e) => { a.shares = Math.max(1, Math.min(1000000, Math.round(+e.target.value || 1))); E.emit(); }} /></td>
            <td><${Switch} on=${a.present} label=${'Present: ' + a.name} disabled=${s.status === 'closed' || s.status === 'counted'} onChange=${(v) => { a.present = v; E.emit(); }} /></td>
            <td class="hide-sm"><select class="input" value=${a.proxy || ''} disabled=${!editable} onChange=${(e) => { a.proxy = e.target.value || null; E.emit(); }} aria-label=${'Proxy for ' + a.name}><option value="">None</option><option value="chair">The chair</option></select></td>
            <td class="hide-sm">${E.isPresent(a) ? (a.present ? html`<${Chip} c="green">Present<//>` : html`<${Chip} c="blue">Present via proxy<//>`) : html`<${Chip}>Absent<//>`}</td></tr>`)}
          </tbody><tfoot><tr><td>Totals</td><td class="r num">${fmt(sm.all)}</td><td colspan="3" class="muted hide-sm" style="font-weight:400">All votes ${fmt(sm.all)} · present ${fmt(sm.present)}${r.ignoreWeight ? ' (one per attendee)' : ' shares'}</td></tr></tfoot></table></div>
        </div>
        <div class="card">
          <div class="card-h"><div><div class="card-t">Counting rules</div><div class="card-s">The same settings as a MIXX meeting item.</div></div></div>
          <div class="set"><div class="set-l"><div class="set-t">Majority base</div><div class="set-d">What the votes for each option are divided by.</div><div class="mt8">${badge(false)}</div></div><div class="set-r"><${Seg} value=${r.base} options=${E.BASES} onChange=${(v) => set('base', v)} /></div></div>
          <div class="set"><div class="set-l"><div class="set-t">Non-voters count as abstention</div><div class="set-d">Present attendees who did not vote are added to abstentions.</div><div class="mt8">${badge(false)}</div></div><div class="set-r"><${Switch} on=${r.nonVoterAbstain} label="Non-voters count as abstention" onChange=${(v) => set('nonVoterAbstain', v)} /></div></div>
          <div class="set"><div class="set-l"><div class="set-t">Ignore voting weight</div><div class="set-d">One person, one vote, regardless of shares.</div><div class="mt8">${badge(true)}</div></div><div class="set-r"><${Switch} on=${r.ignoreWeight} label="Ignore voting weight" disabled=${locked} onChange=${(v) => set('ignoreWeight', v)} /></div></div>
          <div class="set"><div class="set-l"><div class="set-t">Weight cap</div><div class="set-d">${cap != null ? `Nobody counts for more than ${fmt(cap)} shares.` : 'Limits how much any one shareholder counts for.'}</div><div class="mt8">${badge(true)}</div></div><div class="set-r"><${Seg} value=${r.capMode} disabled=${locked || r.ignoreWeight} options=${[['off', 'Off'], ['all', '% of all'], ['present', '% of present']]} onChange=${(v) => set('capMode', v)} />${r.capMode !== 'off' && html`<input class="input num" style="width:70px" type="number" min="1" max="100" value=${r.capPct} disabled=${locked || r.ignoreWeight} onChange=${(e) => set('capPct', Math.max(1, Math.min(100, +e.target.value || 25)))} aria-label="Cap percentage" /><span class="small muted">%</span>`}</div></div>
          <${WeightBars} />
          <div class="callout warn mt16"><span class="ic"><${Icon} n="lock" s=${18} /></span><span><b>Why some settings lock.</b> Weighting and the cap change what is added up inside the encryption. Opening a second total with different weights would let anyone compare the two and work out individual votes, so these are fixed when voting closes. Everything else is arithmetic on the opened totals.</span></div>
        </div>
      </div>
      <div class="stack">
        <div class="card">
          <div class="card-h"><div><div class="card-t">Keyholders</div><div class="card-s">${N} organisations create the election key together. Any ${T} can open the totals; nobody ever holds the whole key.</div></div></div>
          <${KeyGraph} dkg=${dkg} />
          <div class="mt16">${KEYHOLDERS.map((k) => { const m = dkg?.members?.[k.id - 1]; const label = !m ? 'Waiting' : { wait: 'Waiting', dealing: 'Dealing', dealt: 'Shares sent', verifying: `Checking ${m.verified}/${N}`, ready: 'Key share ready' }[m.state]; return html`<div class="row spread" style="padding:7px 0;border-top:1px solid var(--line)"><span class="row"><span class="dot" style=${{ color: k.color }}></span><b style="font-weight:500">${k.name}</b><span class="faint small">${k.role}</span></span><span class="small ${m?.state === 'ready' ? '' : 'muted'}">${m?.state === 'ready' ? html`<span class="row" style="gap:6px;color:var(--green)"><${Icon} n="check" s=${14} w="2.6" />${label}</span>` : label}</span></div>`; })}</div>
          <div class="mt16">${!dkg ? html`<button class="btn block" onClick=${() => E.runKeyCeremony()}><${Icon} n="key" s=${17} /> Run key ceremony</button>` : dkg.status === 'running' ? html`<button class="btn block" disabled><span class="spinner"></span> Generating the election key…</button>` : html`<div class="callout"><span class="ic"><${Icon} n="key" s=${18} /></span><span><b>Election key ready</b> in ${ms(dkg.ms)}. ${N * N} shares were exchanged and checked, keyholder to keyholder. The dealing data has been destroyed.</span></div>`}</div>
          ${dkg?.status === 'done' && html`<${Hood} title="Key ceremony" sub="Feldman VSS on BLS12-381 G2">
            <p class="muted small" style="color:var(--code-dim)">Each keyholder picks a random polynomial of degree ${T - 1}, publishes commitments γ = c·G and sends every other keyholder a share. Each share is checked against the commitments: s·G = Σ iʲ·γⱼ.</p><hr />
            ${KEYHOLDERS.map((k, i) => html`<div class="sec">${k.name} commitments</div><${KV} rows=${dkg.commitments[i].map((c, j) => [`γ${'₀₁₂₃'[j]}`, html`<${Hex} v=${C.ph(c)} />`])} />`)}
            <hr /><${KV} rows=${[['Election key PK', html`<${Hex} v=${C.ph(dkg.mpk)} />`], ['PK =', html`<span class="formula" style="font-size:14px">Σ γ₀ over all keyholders</span>`], ...KEYHOLDERS.map((k) => [`${k.name} PKₖ`, html`<${Hex} v=${C.ph(dkg.pks[k.id - 1])} />`])]} />
          <//>`}
        </div>
        <div class="card">
          <div class="card-h"><div><div class="card-t">Voting credentials</div><div class="card-s">MIXX's eligibility service signs a credential when an attendee opens the ballot: pseudonym, one-time voting key, weight and a vote counter.</div></div></div>
          <${KV} rows=${[['Eligibility key', html`<${Hex} v=${C.ph(s.issuer.vk)} light />`], ['Election ID', html`<${Hex} v=${C.toHex(s.eid)} light />`]]} />
        </div>
        <button class="btn lg block" disabled=${dkg?.status !== 'done' || s.status !== 'setup'} onClick=${() => { E.openVoting(); go('vote'); }}>${s.status === 'setup' ? 'Open voting' : 'Voting is open'} <${Icon} n="chev" s=${16} /></button>
        ${s.status === 'setup' && dkg?.status !== 'done' && html`<p class="small faint" style="text-align:center;margin-top:-8px">Run the key ceremony first.</p>`}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- vote
function Inspector() {
  const s = E.S();
  const lc = s.lastCast;
  if (!lc) return html`<div class="card"><div class="card-t">What the phone does</div><p class="muted mt8">Cast a vote to see it here, byte by byte: the credential, the encrypted choice, the zero-knowledge proofs and the signature. The plain choice never leaves the phone.</p>
    <div class="timeline mt24">${[['Credential', 'MIXX signs: this pseudonym may vote with this weight.'], ['Encrypt', 'Each option becomes a pair of curve points.'], ['Prove', 'Proofs that each value is 0 or 1 and exactly one is chosen.'], ['Sign and send', 'A one-time key signs the ballot for the ballot box.']].map(([t, d], i) => html`<div class="tl"><span class="tl-n">${i + 1}</span><div><div class="tl-t">${t}</div><div class="tl-d">${d}</div></div></div>`)}</div></div>`;
  const a = E.person(lc.id);
  const b = lc.built;
  const att = lc.att;
  const bytes = 32 + 32 + 48 + 192 * OPTIONS.length + b.envelope.zkProof.length + 80 + (32 + 48 + 32 + 32 + att.signature.length);
  return html`<div class="card inspector">
    <div class="card-h"><div><div class="card-t">What ${a.name.split(' ')[0]}'s phone just did</div><div class="card-s">Ballot ${lc.ballot.code} · ${(bytes / 1000).toFixed(1)} kB · built in ${ms(b.timing.total)}</div></div><${Chip} c=${lc.ballot.check === 'ok' ? 'green' : lc.ballot.check === 'checking' ? 'blue' : 'red'}>${lc.ballot.check === 'ok' ? 'Accepted by the ballot box' : lc.ballot.check === 'checking' ? 'Ballot box checking…' : 'Rejected'}<//></div>
    <div class="callout"><span class="ic"><${Icon} n="eyeoff" s=${18} /></span><span><b>Stayed on the phone:</b> the choice <span class="vec">${lc.vote.map((v) => html`<span class=${v ? 'one' : ''}>${v}</span>`)}</span> (${OPTIONS.find((o) => o.key === lc.choice).label}) and the encryption randomness. Everything below is public.</span></div>
    <div class="timeline mt24">
      <div class="tl"><span class="tl-n">1</span><div class="grow"><div class="tl-t">Credential from MIXX</div><div class="tl-d">${a.name} may vote with ${fmt(att.weight)} shares. The ballot box only sees a pseudonym.</div>
        <div class="hood mt12"><${KV} rows=${[['Pseudonym', html`<${Hex} v=${att.pseudonym} />`], ['Weight', html`<span>${fmt(att.weight)}${capNow() != null && att.weight > BigInt(capNow()) ? ` (counted as ${fmt(capNow())} under the cap)` : ''}</span>`], ['Vote counter', html`<span>${String(att.nonce)}${att.nonce > 1n ? ' (replaces earlier vote)' : ''}</span>`], ['One-time key', html`<${Hex} v=${att.vk} />`], ['MIXX signature', html`<${Hex} v=${att.signature} />`]]} /></div></div></div>
      <div class="tl"><span class="tl-n">2</span><div class="grow"><div class="tl-t">Encrypted ${OPTIONS.length} numbers <${Chip}>${ms(b.timing.encrypt)}<//></div><div class="tl-d">Exponential ElGamal under the election key: C₁ = r·G, C₂ = r·PK + m·G. A 1 and a 0 look equally random.</div>
        <div class="hood mt12">${b.detail.cts.map((c, j) => html`<div class="sec">${OPTIONS[j].label}</div><${KV} rows=${[['C₁', html`<${Hex} v=${C.ph(c.c1)} />`], ['C₂', html`<${Hex} v=${C.ph(c.c2)} />`]]} />`)}</div></div></div>
      <div class="tl"><span class="tl-n">3</span><div class="grow"><div class="tl-t">Proved it is one valid vote <${Chip}>${ms(b.timing.range + b.timing.budget)}<//></div><div class="tl-d">${OPTIONS.length} range proofs (each value is 0 or 1) and 1 sum proof (the values add up to exactly 1). In every range proof one branch is real and one is simulated; nobody can tell which.</div>
        <div class="hood mt12">${b.detail.rangeProofs.map((br, j) => html`<div class="sec">Range proof · ${OPTIONS[j].label}</div><div class="pg"><span></span><span class="pg-h">challenge e</span><span class="pg-h">response z</span>${br.map((x, m) => html`<span class="pg-l">m = ${m}</span><${Hex} v=${C.toHex(C.sc(x.e))} n=${5} /><${Hex} v=${C.toHex(C.sc(x.z))} n=${5} />`)}</div>`)}
          <p class="tiny mt8" style="color:var(--code-dim)">In each range proof e₀ + e₁ must equal the hash of everything above, so only one branch can be faked.</p>
          <div class="sec">Sum proof (Chaum-Pedersen)</div><${KV} rows=${[['statement', html`<span class="formula" style="font-size:14px">ΣC₂ − 1·G = (Σr)·PK, ΣC₁ = (Σr)·G</span>`], ['e', html`<${Hex} v=${C.toHex(C.sc(b.detail.budgetProof.e))} />`], ['z', html`<${Hex} v=${C.toHex(C.sc(b.detail.budgetProof.z))} />`]]} /></div></div></div>
      <div class="tl"><span class="tl-n">4</span><div class="grow"><div class="tl-t">Signed and sent <${Chip}>${ms(b.timing.sign)}<//></div><div class="tl-d">Schnorr signature with the one-time key over the whole ballot, credential included. Nothing can be changed or swapped in transit.</div>
        <div class="hood mt12"><${KV} rows=${[['Signature', html`<${Hex} v=${b.envelope.voterSignature} />`], ['Proof bytes', html`<span>${fmt(b.envelope.zkProof.length)}</span>`], ['Tracking code', html`<span>${lc.ballot.code}</span>`]]} /></div></div></div>
    </div>
  </div>`;
}

function Vote({ go }) {
  const s = useStore();
  if (s.status === 'setup') return html`<div class="page"><${Head} eyebrow="Step 2 · Attendees" title="Vote as any attendee" /><${Empty} icon="lock" title="Voting has not opened yet" text="Run the key ceremony and open voting first. Ballots are encrypted under the election key, so it has to exist before anyone votes." cta=${['setup', 'Go to set up']} go=${go} /></div>`;
  const who = s.phone.who;
  return html`<div class="page">
    <${Head} eyebrow="Step 2 · Attendees" title="Vote as any attendee" lede="Pick an attendee and vote on their phone. The choice is encrypted and proven on the device; only sealed data goes to the ballot box." />
    <div class="grid g-vote">
      <div class="stack people-col">
        <div class="people">${s.attendees.map((a) => { const voted = s.ballots.some((b) => b.attendeeId === a.id); return html`<button class=${'person' + (who === a.id ? ' on' : '')} onClick=${() => { if (s.phone.phase !== 'sealing') { s.phone.who = a.id; if (s.phone.phase === 'done') s.phone.phase = 'pick'; E.emit(); } }}>
          <${Av} a=${a} /><span class="grow"><b>${a.name}</b><span>${fmt(a.shares)} shares${a.proxy === 'chair' ? ' · proxy to chair' : ''}</span></span>
          ${voted ? html`<${Check} s=${20} />` : !E.isPresent(a) ? html`<${Chip}>Absent<//>` : null}</button>`; })}</div>
        ${s.status === 'open' && html`<div class="card" style="padding:18px"><b style="font-weight:600">In a hurry?</b><p class="small muted mt8">Cast the votes from the worked example: A for, B against, C abstains, E leaves it to the chair. D does not vote, F is absent.</p><button class="btn ghost block mt12" disabled=${s.autoRunning || s.phone.phase === 'sealing'} onClick=${() => E.castExample()}>${s.autoRunning ? html`<span class="spinner dark"></span> Casting…` : 'Cast example votes'}</button></div>`}
        ${s.status === 'open' && s.ballots.length > 0 && html`<button class="btn block" onClick=${() => go('live')}>Watch the live screen <${Icon} n="chev" s=${16} /></button>`}
      </div>
      <div class="phone-col"><${Phone} who=${who} /></div>
      <${Inspector} />
    </div>
  </div>`;
}

// ---------------------------------------------------------------- live
function useNow(on) {
  const [, f] = useState(0);
  useEffect(() => { if (!on) return undefined; const id = setInterval(() => f((x) => x + 1), 1000); return () => clearInterval(id); }, [on]);
  return Date.now();
}
const clock = (msx) => { const sec = Math.max(0, Math.floor(msx / 1000)); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };

function runningTotals(s) {
  const act = E.activeBallots();
  return OPTIONS.map((_, j) => act.reduce((acc, b) => { const c = b.cts || (b.cts = b.envelope.ciphertexts.map(([x, y]) => ({ c1: C.g2(x), c2: C.g2(y) }))); return C.ctAdd(acc, C.ctMul(E.effWeight(b.weight), c[j])); }, { c1: C.Z2, c2: C.Z2 }));
}

function Live({ go }) {
  const s = useStore();
  const t = useNow(s.status === 'open');
  const [ask, setAsk] = useState(false);
  const key = s.ballots.map((b) => b.seq + (b.replaced ? 'r' : '')).join(',') + JSON.stringify(s.locked || s.rules);
  const sums = useMemo(() => (s.dkg ? runningTotals(s).map((c) => C.ph(c.c2)) : []), [key]);
  if (s.status === 'setup') return html`<div class="page"><${Head} eyebrow="Step 3 · The room" title="Live in the room" /><${Empty} icon="box" title="Nothing to show yet" text="The live screen starts when voting opens." cta=${['setup', 'Go to set up']} go=${go} /></div>`;
  const to = E.turnout();
  const share = to.present ? to.cast / to.present : 0;
  const unit = (s.locked || s.rules).ignoreWeight ? 'attendees' : 'shares';
  return html`<div class="page">
    <${Head} eyebrow="Step 3 · The room" title="Live in the room" lede="What the chair's screen shows while voting is open. Turnout is public because every ballot carries its weight. How anyone voted is not." />
    <div class="card row spread wrap" style="gap:16px">
      <div class="row wrap"><span class="chip ${s.status === 'open' ? 'red' : ''}">${s.status === 'open' ? html`<span class="dot pulse"></span> Voting open · ${clock(t - s.openedAt)}` : 'Voting closed'}</span><b style="font-size:17px;font-weight:600">Item ${s.meeting.no} · ${s.meeting.item}</b></div>
      ${s.status === 'open' ? html`<button class="btn dark" disabled=${s.ballots.length === 0} onClick=${() => setAsk(true)}><${Icon} n="lock" s=${16} /> Close voting</button>` : html`<button class="btn" onClick=${() => go('count')}>Go to the count <${Icon} n="chev" s=${16} /></button>`}
    </div>
    <div class="grid g-live mt24">
      <div class="card">
        <div class="card-t">Turnout</div><div class="card-s">Weight of ballots received, out of the present ${unit}.</div>
        <div class="ring-wrap mt24"><${Ring} value=${share} label=${`${Math.round(share * 100)} %`} sub="of present weight" />
          <div><div class="hero-num num">${fmt(to.cast)}</div><div class="muted mt8">of ${fmt(to.present)} present ${unit}</div><div class="muted">${to.ballots} ballot${to.ballots === 1 ? '' : 's'} · ${s.attendees.filter(E.isPresent).length} present</div></div></div>
        <div class="callout mt24"><span class="ic"><${Icon} n="eye" s=${18} /></span><span>No running result. Interim results would leak how the room is voting, so they stay sealed until voting closes.</span></div>
      </div>
      <div class="card">
        <div class="card-h"><div><div class="card-t">Sealed running total</div><div class="card-s">The real encrypted sum for each option, updated with every ballot. Nobody can read it until ${T} keyholders open it.</div></div><${Icon} n="lock" s=${20} /></div>
        <div class="enc-rows">${OPTIONS.map((o, j) => html`<div class="enc-row"><b style="font-weight:500">${o.label}</b><${Scramble} text=${sums[j] ? sums[j].slice(0, 56) : ''} /><span class="faint"><${Icon} n="lock" s=${15} /></span></div>`)}</div>
        <p class="small faint mt12">Showing C₂ of Σ wᵢ·Enc(vᵢ) per option, ${(s.locked || s.rules).ignoreWeight ? 'one vote per attendee' : 'weighted by shares'}${E.capValue() != null ? `, capped at ${fmt(E.capValue())}` : ''}.</p>
      </div>
    </div>
    <div class="card mt24">
      <div class="card-h"><div><div class="card-t">Ballot box</div><div class="card-s">Public. Every sealed ballot as it arrives, checked on entry. Voters find theirs with the tracking code.</div></div><${Chip} c="blue">${s.ballots.length} received<//></div>
      ${s.ballots.length === 0 ? html`<p class="muted">No ballots yet. <button class="link" onClick=${() => go('vote')}>Cast a vote</button></p>` : html`<div class="scroll-x"><table class="tbl"><thead><tr><th>Time</th><th>Tracking code</th><th>Voter (pseudonym)</th><th class="r">Weight</th><th>Ballot</th><th>Check on entry</th><th>Status</th></tr></thead><tbody>
        ${[...s.ballots].reverse().map((b) => html`<tr key=${b.seq} class="new"><td class="num muted">${new Date(b.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td class="mono" style="font-size:13px">${b.code}</td><td><${Hex} v=${C.toHex(b.envelope.pseudonym)} n=${5} light /></td><td class="r num"><${Wt} w=${b.weight} /></td><td class="muted small">${OPTIONS.length} ciphertexts + proofs</td>
          <td>${b.check === 'ok' ? html`<span class="row" style="gap:6px"><${Check} s=${18} /><span class="small">Proofs valid</span></span>` : b.check === 'checking' ? html`<span class="row" style="gap:6px"><span class="spinner dark"></span><span class="small muted">Checking</span></span>` : html`<span class="row" style="gap:6px"><${Check} st="bad" s=${18} /><span class="small">${b.check}</span></span>`}</td>
          <td>${b.replaced ? html`<${Chip} c="orange">Replaced by newer vote<//>` : html`<${Chip} c="green">Counts<//>`}</td></tr>`)}</tbody></table></div>`}
    </div>
    ${ask && html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && setAsk(false)}><div class="modal" role="dialog" aria-modal="true"><h3>Close voting on item ${s.meeting.no}?</h3><p>No more ballots will be accepted. Weighting${E.capValue() != null ? ' and the weight cap lock' : ' locks'} now: ${s.rules.ignoreWeight ? 'one vote per attendee' : 'weighted by shares'}${E.capValue() != null ? `, capped at ${fmt(E.capValue())}` : ', no cap'}.</p><div class="row mt24" style="justify-content:flex-end"><button class="btn ghost" onClick=${() => setAsk(false)}>Keep open</button><button class="btn dark" onClick=${() => { E.closeVoting(); setAsk(false); go('count'); }}>Close voting</button></div></div></div>`}
  </div>`;
}

// ---------------------------------------------------------------- count
function PipeStep({ n, state, title, sub, children }) {
  return html`<div class=${'pipe-s ' + state}><div class="pipe-n">${state === 'done' ? html`<${Icon} n="check" s=${20} w="2.6" />` : n}</div><div class="card"><div class="eyebrow pipe-k">Step ${n}${state === 'done' ? ' · done' : ''}</div><div class="card-t">${title}</div>${sub && html`<div class="card-s">${sub}</div>`}<div class="mt16">${children}</div></div></div>`;
}
function Count({ go }) {
  const s = useStore();
  const t = s.tally;
  if (s.status === 'setup' || s.status === 'open') return html`<div class="page"><${Head} eyebrow="Step 4 · The count" title="Count without opening a ballot" /><${Empty} icon="sigma" title="Voting is still open" text="The count starts after the chair closes voting on the live screen." cta=${s.status === 'open' ? ['live', 'Go to the live screen'] : ['setup', 'Go to set up']} go=${go} /></div>`;
  const ph = t.phase;
  const order = ['ready', 'admission', 'aggregate', 'aggregate-done', 'decrypt', 'recover', 'done'];
  const at = order.indexOf(ph);
  const stState = (from, to) => (at >= to ? 'done' : at >= from ? 'active' : 'idle');
  const L = s.locked;
  const counted = (t.admitted || []).length;
  const weightLabel = L.ignoreWeight ? 'one vote per attendee' : L.capValue != null ? `shares, capped at ${fmt(L.capValue)}` : 'shares';
  const adm = t.admitted || [];
  return html`<div class="page">
    <${Head} eyebrow="Step 4 · The count" title="Count without opening a ballot" lede="Every step works on sealed data and leaves public evidence behind. The only thing ever decrypted is the total per option." />
    <div class="pipe">
      <${PipeStep} n="1" state=${stState(1, 2)} title="Check every ballot" sub="Credential signed by MIXX, valid zero-knowledge proofs, intact voter signature. Then the latest vote per voter wins.">
        ${ph === 'ready' ? html`<button class="btn" onClick=${() => E.runCount()}><${Icon} n="sigma" s=${17} /> Start counting</button>` : html`<div class="scroll-x"><table class="tbl"><thead><tr><th>Ballot</th><th class="hide-sm">Voter</th><th class="r">Weight</th><th class="r hide-sm">Counter</th><th>Result</th></tr></thead><tbody>${t.rows.map((r) => html`<tr><td class="mono" style="font-size:13px">${r.code}</td><td class="hide-sm"><${Hex} v=${r.pseud} n=${5} light /></td><td class="r num"><${Wt} w=${r.weight} /></td><td class="r num hide-sm">${String(r.nonce)}</td><td>${r.status === 'ok' ? html`<span class="row" style="gap:6px"><${Check} s=${18} /> Counted</span>` : r.status === 'replaced' ? html`<${Chip} c="orange">Valid, replaced by a newer vote<//>` : r.status === 'run' ? html`<span class="row" style="gap:6px"><span class="spinner dark"></span> Checking proofs</span>` : r.status === 'bad' ? html`<span class="row" style="gap:6px"><${Check} st="bad" s=${18} /> ${r.reason}</span>` : html`<span class="faint">Waiting</span>`}</td></tr>`)}</tbody></table></div>
          ${at >= 2 && html`<p class="small muted mt12">${counted} ballot${counted === 1 ? '' : 's'} counted, carrying ${fmt(t.castWeight)} ${L.ignoreWeight ? 'votes' : 'shares'}.</p>`}`}
      <//>
      <${PipeStep} n="2" state=${stState(2, 3)} title="Add up, still sealed" sub=${`Each sealed ballot is multiplied by its weight (${weightLabel}) and added up. Anyone can redo this from the ballot box.`}>
        ${at < 2 ? html`<p class="faint">Waits for step 1.</p>` : html`
          <div class="formula" style="font-size:19px;margin-bottom:14px">Σ <i>w</i>ᵢ · Enc(<i>v</i>ᵢ) = Enc(Σ <i>w</i>ᵢ<i>v</i>ᵢ)</div>
          <div class="scroll-x"><div class="mat" style=${{ gridTemplateColumns: `120px repeat(${adm.length}, minmax(70px, 1fr)) 24px minmax(110px, 1.4fr)` }}>
            <span></span>${adm.map((v) => { const e = E.effWeight(v.b.weight); return html`<span class="hd">× ${fmt(e)}${e < v.b.weight && !L.ignoreWeight ? html`<span class="capnote">capped from ${fmt(v.b.weight)}</span>` : ''}</span>`; })}<span></span><span class="hd">Sealed total</span>
            ${OPTIONS.map((o, j) => html`<b style="font-weight:500">${o.label}</b>${adm.map((v) => html`<span class=${'cell' + (at >= 3 ? ' fold' : '')}>${C.ph(v.cts[j].c2).slice(0, 10)}</span>`)}<span class="faint" style="text-align:center">=</span><span class="cell sum">${t.aggHex ? html`<${Scramble} text=${t.aggHex[j].c2.slice(0, 18)} cls="" />` : '…'}</span>`)}
          </div></div>
          ${t.aggHex && html`<${Hood} title="Sealed totals" sub="per option, compressed G2 points">${OPTIONS.map((o, j) => html`<div class="sec">${o.label}</div><${KV} rows=${[['C₁', html`<${Hex} v=${t.aggHex[j].c1} />`], ['C₂', html`<${Hex} v=${t.aggHex[j].c2} />`]]} />`)}<//>`}`}
      <//>
      <${PipeStep} n="3" state=${stState(3, 5)} title="Open the totals together" sub=${`Pick which keyholders take part. Any ${T} of ${N} are enough. Each one decrypts only the ${OPTIONS.length} totals and proves it did so honestly.`}>
        ${at < 3 ? html`<p class="faint">Waits for step 2.</p>` : html`
          <div class="kh-pick">${KEYHOLDERS.map((k) => { const on = t.participants.includes(k.id); const sh = t.shares[k.id]; const okN = sh ? sh.filter((x) => x.ok).length : 0; return html`<button class=${'kh' + (on ? ' on' : ' off')} disabled=${at >= 4} onClick=${() => E.toggleParticipant(k.id)} aria-pressed=${on}>
            <span class="dot" style=${{ color: k.color, width: '10px', height: '10px' }}></span><span class="st">${sh ? (okN === OPTIONS.length ? html`<${Check} s=${18} />` : html`<span class="spinner dark"></span>`) : null}</span>
            <b>${k.name}</b><span>${sh ? `${okN} of ${OPTIONS.length} shares proven` : on ? 'Taking part' : E.S().keyholders[k.id - 1].online ? 'Not taking part' : 'Offline · click to add'}</span></button>`; })}</div>
          ${at === 3 && html`<div class="row mt16 wrap"><button class="btn" disabled=${t.participants.length < T} onClick=${() => E.runDecrypt()}><${Icon} n="key" s=${17} /> Decrypt with ${t.participants.length} keyholder${t.participants.length === 1 ? '' : 's'}</button><span class="small ${t.participants.length < T ? '' : 'muted'}" style=${t.participants.length < T ? 'color:var(--red)' : ''}>${t.participants.length < T ? `Needs at least ${T}. With fewer, the totals cannot be opened at all.` : `${t.participants.length} of ${N} selected. Click a keyholder to change.`}</span></div>`}
          ${Object.keys(t.shares).length > 0 && html`<${Hood} title="Decryption shares" sub="σₖ = skₖ·C₁ with a DLEQ proof against PKₖ">${Object.entries(t.shares).map(([id, arr]) => html`<div class="sec">${KEYHOLDERS[id - 1].name}</div><${KV} rows=${arr.map((x, j) => [OPTIONS[j].label, html`<span><${Hex} v=${C.ph(x.sigma)} n=${8} /> ${x.ok === null ? '' : x.ok ? html`<span class="ok">✓ proof valid</span>` : html`<span class="bad">✗ proof invalid</span>`}</span>`])} />`)}<//>`}`}
      <//>
      <${PipeStep} n="4" state=${stState(5, 6)} title="Read the totals" sub="The shares are combined, the sealed part is removed, and a short search finds each number. A wrong number cannot pass the check.">
        ${at < 5 ? html`<p class="faint">Waits for step 3.</p>` : ph === 'recover' ? html`<span class="row"><span class="spinner dark"></span> Combining shares and searching…</span>` : html`
          <div class="totals">${OPTIONS.map((o, j) => html`<div class="total reveal" style=${{ animationDelay: j * 120 + 'ms' }}><span>${o.label}</span><b class="num">${fmt(t.totals[j])}</b><span class="row" style="gap:5px;color:var(--green)"><${Icon} n="check" s=${13} w="2.6" /> matches sealed total</span></div>`)}</div>
          <p class="small muted mt12">Opened with ${t.used.map((id) => KEYHOLDERS[id - 1].name).join(', ')}${t.participants.length > T ? ` (${t.participants.filter((id) => !t.used.includes(id)).map((id) => KEYHOLDERS[id - 1].name).join(', ')} also proved its shares, but ${T} are enough)` : ''}. Totals add up to ${fmt(t.bound)}, the weight that voted${t.sumOk ? ', as they must' : ''}. Search and checks took ${ms(t.recoverMs)}.</p>
          <${Hood} title="Combination" sub="Lagrange interpolation at zero, then baby-step giant-step"><${KV} rows=${[...t.used.map((id, i) => [`λ for ${KEYHOLDERS[id - 1].name}`, html`<${Hex} v=${C.toHex(C.sc(t.lambdas[i]))} n=${8} />`]), ['σ =', html`<span class="formula" style="font-size:14px">Σ λₖ·σₖ = sk·C₁</span>`], ['τ = C₂ − σ', html`<span class="formula" style="font-size:14px">= M·G, solve for M in 0 … ${t.bound}</span>`], ...OPTIONS.map((o, j) => [`τ ${o.label}`, html`<${Hex} v=${C.ph(t.taus[j])} n=${8} />`])]} /><//>`}
      <//>
      <${PipeStep} n="5" state=${at >= 6 ? 'done' : 'idle'} title="The chair's discretionary votes" sub="Votes left to the chair are opened as a total, like any other option. The chair then decides publicly where they go.">
        ${at < 6 ? html`<p class="faint">Waits for step 4.</p>` : html`<div class="row wrap"><span><b>${fmt(t.totals[3])}</b> ${L.ignoreWeight ? 'votes' : 'shares'} left to the chair. The chair votes:</span><${Seg} value=${t.chairChoice} options=${[['for', 'For'], ['against', 'Against'], ['abstain', 'Abstain']]} onChange=${(v) => E.setChair(v)} /></div>
          <div class="next" style="justify-content:flex-start"><button class="btn lg" onClick=${() => go('results')}>See the results <${Icon} n="chev" s=${16} /></button></div>`}
      <//>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- results
function Results({ go }) {
  const s = useStore();
  if (s.status !== 'counted') return html`<div class="page"><${Head} eyebrow="Step 5 · Results" title="The result" /><${Empty} icon="scale" title="Not counted yet" text="Results appear once the keyholders have opened the totals." cta=${['count', 'Go to the count']} go=${go} /></div>`;
  const r = s.rules;
  const res = E.result();
  const L = s.locked;
  const unit = L.ignoreWeight ? 'votes' : 'shares';
  const baseLabel = E.BASES.find((b) => b[0] === r.base)[1];
  const rows = [['For', res.votesFor, res.pFor], ['Against', res.votesAgainst, res.pAgainst]];
  const raw = E.result('cast', false);
  const capped = L.capValue != null ? (s.tally.admitted || []).filter((v) => v.b.weight > BigInt(L.capValue)) : [];
  return html`<div class="page">
    <${Head} eyebrow="Step 5 · Results" title="The result" lede="MIXX's result page, computed from the opened totals and the public attendance list with the same rules as today." />
    <div class="grid g-2">
      <div class="card">
        <div class="row spread"><${Chip} c=${res.adopted ? 'green' : 'red'}>${res.adopted ? 'Adopted' : 'Not adopted'}<//><button class="chip" style="border:0;cursor:pointer" onClick=${() => go('verify')}><${Icon} n="shield" s=${12} w="2.2" /> Verifiable</button></div>
        <div class="outcome mt16"><div class="hero-num num">${E.pct(res.pFor)}</div><div class="muted" style="padding-bottom:6px">for · ${fmt(res.votesFor)} of ${fmt(res.denom)} ${unit}<br />${baseLabel.toLowerCase()}</div></div>
        <div class="bars mt32">${rows.map(([label, v, p], i) => html`<div class="bar-row"><div class="bar-l"><b>${label}</b></div><div class="bar-track"><div class="bar-base"></div><div class="bar-fill" style=${{ width: Math.min(100, p * 100) + '%' }}></div><div class="majority" style="left:50%">${i === 0 && html`<span>50 %</span>`}</div></div><div class="bar-v"><b>${E.pct(p)}</b><span>${fmt(v)}</span></div></div>`)}</div>
        <hr class="sep" />
        <div><div class="set-t">Majority base</div><div class="set-d">Recalculated from the opened totals. No new decryption needed.</div><div class="mt12"><${Seg} value=${r.base} options=${E.BASES} onChange=${(v) => { r.base = v; E.emit(); }} /></div></div>
        <div style="height:14px"></div>
        <div class="set"><div class="set-l"><div class="set-t">Non-voters count as abstention</div><div class="set-d">Present but did not vote: ${fmt(res.nonVoters)} ${unit}${r.nonVoterAbstain ? ', counted as abstentions' : ', not counted'}.</div></div><div class="set-r"><${Switch} on=${r.nonVoterAbstain} label="Non-voters count as abstention" onChange=${(v) => { r.nonVoterAbstain = v; E.emit(); }} /></div></div>
      </div>
      <div class="stack">
        <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[['All votes', res.all, 'allowed to vote'], ['Present', res.present, 'in the room or by proxy'], ['Votes cast', res.cast, r.nonVoterAbstain ? 'incl. non-voters' : 'incl. abstentions and chair'], ['Abstentions', res.abstain, r.nonVoterAbstain ? 'incl. non-voters' : 'chose to abstain']].map(([l, v, d]) => html`<div class="tile"><span>${l}</span><b class="num">${fmt(v)}</b><small>${d}</small></div>`)}</div>
        <div class="card"><div class="lockbox"><span class="ic"><${Icon} n="lock" s=${18} /></span><div><b>Fixed at close</b><p class="small muted mt8">${L.ignoreWeight ? 'One vote per attendee' : 'Weighted by shares'}${L.capValue != null ? `, capped at ${fmt(L.capValue)} (${L.capPct} % of ${L.capMode === 'all' ? 'all' : 'present'} votes)` : ', no cap'}. These shaped the sealed sums, so they cannot change now: a second opening with other weights would reveal individual votes.</p>${capped.length > 0 && html`<p class="small mt8">${capped.map((v, i) => html`${i ? ', ' : ''}<b>${E.person(v.b.attendeeId).name}</b> counted <span class="wt-cap"><s>${fmt(v.b.weight)}</s> ${fmt(L.capValue)}</span>`)} because of the cap.</p>`}</div></div></div>
      </div>
    </div>
    <div class="card mt24">
      <div class="card-h"><div><div class="card-t">${res.all === 300 && res.present === 240 && raw.votesAgainst === 50 && ((raw.cast === 220 && raw.votesFor === 140) || (L.capValue === 75 && raw.cast === 195 && raw.votesFor === 115)) ? (L.capValue === 75 ? 'Same numbers as the cap example in your guide' : 'Same numbers as your worked example') : 'All four majority bases'}</div><div class="card-s">All four majority bases at once, computed from the opened totals${r.nonVoterAbstain ? ' with non-voters counted as abstention' : ''}. Click a row to use it.</div></div></div>
      <div class="scroll-x"><table class="tbl cmp"><thead><tr><th>Majority base</th><th class="r">Divides by</th><th class="r">For</th><th class="r">Against</th><th>Outcome</th></tr></thead><tbody>${E.BASES.map(([k, label]) => { const x = E.result(k); return html`<tr class=${r.base === k ? 'on' : ''} style="cursor:pointer" onClick=${() => { r.base = k; E.emit(); }}><td>${label}</td><td class="r num">${fmt(x.denom)}</td><td class="r num">${E.pct(x.pFor)}</td><td class="r num">${E.pct(x.pAgainst)}</td><td>${x.adopted ? html`<${Chip} c="green">Adopted<//>` : html`<${Chip} c="red">Not adopted<//>`}</td></tr>`; })}</tbody></table></div>
    </div>
    <div class="next"><button class="btn lg" onClick=${() => go('verify')}>Verify this result <${Icon} n="chev" s=${16} /></button></div>
  </div>`;
}

// ---------------------------------------------------------------- verify
function Verify({ go }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  if (s.status !== 'counted') return html`<div class="page"><${Head} eyebrow="Step 6 · Anyone" title="Check it yourself" /><${Empty} icon="shield" title="Nothing to verify yet" text="Verification checks a finished count. Run the count first." cta=${['count', 'Go to the count']} go=${go} /></div>`;
  const v = s.verify;
  const download = () => {
    const blob = new Blob([JSON.stringify(E.publicRecord(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'election-public-record.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  return html`<div class="page">
    <${Head} eyebrow="Step 6 · Anyone" title="Check it yourself" lede="Everything needed to recheck the result is public: the key ceremony, the ballot box, the sealed totals, the decryption proofs. This runs the whole check in your browser, independently of the count." />
    <div class="card">
      <div class="card-h"><div><div class="card-t">Verify the election</div><div class="card-s">Recomputes every step from the public record and compares it with what was published.</div></div>
        <button class="btn" disabled=${v?.running} onClick=${() => E.runVerify()}>${v?.running ? html`<span class="spinner"></span> Verifying…` : v ? 'Run again' : html`<${Icon} n="shield" s=${17} /> Verify everything`}</button></div>
      ${v && html`<div class="checks">${v.checks.map((c) => html`<div class="ck"><${Check} st=${c.status === 'run' ? 'run' : c.status} /><div><b>${c.title}</b><div class="d">${c.detail}</div></div><span class="t">${c.status === 'run' ? '' : ms(c.ms)}</span></div>`)}</div>
        ${!v.running && html`<div class=${'callout mt16' + (v.ok ? '' : ' warn')}><span class="ic"><${Icon} n=${v.ok ? 'shield' : 'info'} s=${18} /></span><span><b>${v.ok ? 'Election verified.' : 'Verification failed.'}</b> ${v.checks.length} checks, ${v.proofs} zero-knowledge proofs and signatures, ${ms(v.ms)}.</span></div>`}`}
      ${!v && html`<p class="muted">Eight checks: the key, the credentials, every ballot's proofs, the vote counters, the sealed sums, the keyholders' decryption proofs, the totals and the counting rules.</p>`}
    </div>
    <div class="grid g-2 mt24">
      <div class="card">
        <div class="card-t">Find my ballot</div><div class="card-s">Each voter gets a tracking code on their phone. A ballot missing from the box would be noticed.</div>
        <div class="search mt16"><input class="input" placeholder="Tracking code, e.g. ${s.ballots[0]?.code || '7F3A-91C2'}" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && setFound(E.findBallot(q))} aria-label="Tracking code" /><button class="btn" onClick=${() => setFound(E.findBallot(q))}><${Icon} n="search" s=${16} /></button></div>
        <div class="row wrap mt8">${s.ballots.slice(0, 6).map((b) => html`<button class="chip" style="border:0;cursor:pointer" onClick=${() => { setQ(b.code); setFound(E.findBallot(b.code)); }}>${b.code}</button>`)}</div>
        ${found && html`<div class=${'callout mt16' + (found.found ? '' : ' warn')}><span class="ic"><${Icon} n=${found.found ? 'check' : 'info'} s=${18} /></span><span>${found.found ? html`<b>Found: ballot #${found.b.seq + 1}</b>, weight ${fmt(found.b.weight)}, ${found.counted ? 'included in the count.' : 'replaced by a newer vote from the same voter.'}` : 'No ballot with this code in the box. The voter’s phone still holds the signed ballot, so a dropped vote can be raised and resubmitted.'}</span></div>`}
      </div>
      <div class="card">
        <div class="card-t">The public record</div><div class="card-s">Key ceremony commitments, all ballots, the sealed totals, decryption shares with proofs, and the result. Enough for anyone to redo the count with independent software.</div>
        <button class="btn ghost mt16" onClick=${download}><${Icon} n="download" s=${17} /> Download JSON</button>
      </div>
    </div>
    <section class="sec-h" style="margin-top:56px;margin-bottom:20px"><div class="eyebrow">Tamper lab</div><h2 style="font-size:32px">Try to break it.</h2><p class="lede" style="font-size:17px">Each attack is run against the real data of this election and checked with the same code as above.</p></section>
    <div class="grid g-3">${E.ATTACKS.map((a) => { const st = s.attacks[a.key]; return html`<div class="card attack"><${Chip} c="red"><${Icon} n="bolt" s=${11} w="2.4" /> ${a.who}<//><div class="card-t" style="font-size:17px">${a.title}</div><p class="small muted">${E.attackText(a.key)}</p>
      ${st?.running ? html`<span class="row small"><span class="spinner dark"></span> Trying…</span>` : st?.error ? html`<p class="small" style="color:var(--orange)">${st.error}</p>` : st ? html`<div class=${'res ' + (st.caught ? 'bad' : '')}><b>${st.caught ? '✓ Caught.' : 'Not caught!'}</b> ${st.reason}<span class="mono">${st.tech}</span></div>` : null}
      <button class="btn ghost sm" style="align-self:flex-start;margin-top:auto" disabled=${st?.running} onClick=${() => E.runAttack(a.key)}>${st && !st.running ? 'Try again' : 'Try it'}</button></div>`; })}</div>
  </div>`;
}

// ---------------------------------------------------------------- app
function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || 'overview');
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1) || 'overview');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  useStore();
  useEffect(() => { const el = document.querySelector('.step-btn.on'); if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [route]);
  const go = (r) => { if (location.hash.slice(1) !== r) location.hash = r; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const Page = { overview: Overview, setup: Setup, vote: Vote, live: Live, count: Count, results: Results, verify: Verify }[route] || Overview;
  return html`<${Nav} route=${route} go=${go} /><main key=${route}><${Page} go=${go} /></main>`;
}

const root = document.getElementById('app');
root.replaceChildren();
render(html`<${App} />`, root);
window.__demoReady = true;
