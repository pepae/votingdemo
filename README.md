# Verifiable voting demo

Concept demo for MIXX: encrypted, verifiable voting for general assemblies, built on Shutter's threshold-encryption voting protocol.

**Live:** https://pepae.github.io/votingdemo/

The walkthrough follows a meeting from the back office to the result: set up attendees and counting rules, run the key ceremony, vote on an attendee's phone, watch the live screen, count, read the result and verify everything. The scenario is the worked example from MIXX's calculation guide (attendees A to F: 300 / 240 / 220 / 30, 64 % for on votes cast).

## Real cryptography, in the browser

- Exponential ElGamal on BLS12-381 (G2), Schnorr signatures on G1
- Feldman DKG between five keyholders, any three can decrypt
- Per-ballot zero-knowledge proofs: OR range proofs per option and an exact-sum proof (Fiat-Shamir over keccak256)
- Eligibility credentials binding pseudonym, one-time key, weight and a re-vote counter
- Weighted homomorphic tally, threshold decryption with DLEQ proofs, baby-step giant-step recovery
- A verifier that rechecks the whole election from the public record, and a tamper lab

`js/crypto.js` ports the crypto suite of Shutter's reference implementation (geg). It passes geg's conformance vectors, including byte-for-byte reproduction of a pinned ballot:

```sh
npm install
node tests/vectors.test.mjs <path to geg>/tests/vectors
```

## Running

No build step. Serve the folder with any static web server. Libraries load from jsDelivr: `htm/preact`, `@noble/curves`, `@noble/hashes`.

## Limits

This is a demo, not a product. All five keyholders run inside one page so you can watch them; in a deployment each runs on separate infrastructure operated by a different organisation. The company and attendees are fictional.
