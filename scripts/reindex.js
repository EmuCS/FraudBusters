// Rebuild the local index purely from Solana: the registry is the chain, the index is a cache.
// Reads every memo written by the service + treasury wallets and re-creates photos, claims and rules.
// Claim records v2 carry no insurer, amount or description (only a seal of them): those come back
// from the insurer's own records where present.
import { connection, loadKeypair, MEMO_PROGRAM_ID } from '../src/solana.js';
import { MEMO_PHOTO, MEMO_CLAIM, MEMO_CLAIM_V1, MEMO_POLICY } from '../src/config.js';
import { photos, claims, policies } from '../src/store.js';

async function memosFor(address) {
  const out = [];
  let before;
  for (;;) {
    const sigs = await connection.getSignaturesForAddress(address, { before, limit: 1000 });
    if (!sigs.length) break;
    for (const s of sigs) {
      if (s.err) continue;
      const tx = await connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
      for (const ix of tx?.transaction.message.instructions || []) {
        if (ix.programId.equals(MEMO_PROGRAM_ID) && typeof ix.parsed === 'string') {
          out.push({ memo: ix.parsed, tx: s.signature, at: new Date((s.blockTime || 0) * 1000).toISOString() });
        }
      }
    }
    before = sigs.at(-1).signature;
  }
  return out;
}

const local = new Map(photos.all().map((p) => [p.tx, p]));
const localClaims = new Map(claims.all().map((c) => [c.id, c]));
const all = [...(await memosFor(loadKeypair('service').publicKey)), ...(await memosFor(loadKeypair('treasury').publicKey))];

const rebuiltPhotos = [];
const rebuiltClaims = new Map(); // claim id → latest state (creation memo, then decisions)
const rebuiltPolicies = [];
for (const { memo, tx, at } of all.sort((a, b) => a.at.localeCompare(b.at))) {
  const parts = memo.split('|');
  if (parts[0] === MEMO_PHOTO) {
    const [, dhash, sha512, pubkey, signature] = parts;
    const prev = local.get(tx);
    rebuiltPhotos.push({ id: prev?.id || tx.slice(0, 12), dhash, sha512, pubkey, signature, tx, createdAt: prev?.createdAt || at });
  } else if (parts[0] === MEMO_CLAIM || parts[0] === MEMO_CLAIM_V1) {
    const v1 = parts[0] === MEMO_CLAIM_V1;
    const [dhash, id, status, photoId, claimant, seal] = v1
      ? [parts[1], parts[3], parts[4], parts[5], parts[7], null]
      : parts.slice(1, 7);
    const prev = rebuiltClaims.get(id) || localClaims.get(id) || {};
    const first = !rebuiltClaims.has(id);
    rebuiltClaims.set(id, {
      ...prev,
      id,
      insurer: prev.insurer || (v1 ? parts[2] : 'unknown'),
      amount: prev.amount ?? (v1 ? Number(parts[6]) || 0 : 0),
      dhash,
      status: status === 'offer-declined' ? prev.statusBeforeOffer || 'review' : status,
      photoId: photoId === '-' ? null : photoId,
      claimant: claimant || prev.claimant || '',
      ...(seal && seal !== '-' ? { seal } : {}),
      ...(first ? { tx, createdAt: prev.createdAt || at } : { decisionTx: tx }),
    });
  } else if (parts[0] === MEMO_POLICY) {
    const [, insurer, rule, adj, adjsig] = parts;
    rebuiltPolicies.push({
      id: tx.slice(0, 12),
      insurer,
      fastTrackLimit: Number(rule.split(':')[1]) || 0,
      setBy: { wallet: adj?.replace(/^adj:/, '') || null, walletName: 'Wallet' },
      signature: adjsig?.replace(/^adjsig:/, '') || null,
      tx,
      at,
    });
  }
}

photos.replaceAll(rebuiltPhotos);
claims.replaceAll([...rebuiltClaims.values()]);
policies.replaceAll(rebuiltPolicies);
console.log(`Rebuilt from chain: ${rebuiltPhotos.length} photos, ${rebuiltClaims.size} claims, ${rebuiltPolicies.length} fast-track rules`);
