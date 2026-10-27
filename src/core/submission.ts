import { getAddress, keccak256, type Address, type Hex } from 'viem';
import { CHAIN_ID, MANAGER } from '../config';
import { parseTokenId, type Plan } from './protocol';
import { recheckHistory } from './history';
import { ExitError, type StrictRpc } from './rpc';
import { send, type Provider } from './wallet';
import { assertTransactionIdentity, minedTransaction, receiptEvidence } from './chain-evidence';

export const SUBMISSION_KEY = 'tapeexit:submission:v1';
const LOCK = 'tapeexit:submission:v1';
export interface Submission {
  schemaVersion: 1; id: string; chainId: number; account: Address; tokenId: string;
  inputHash: Hex; startedAt: string; hash?: Hex;
}
export type SubmissionState =
  | { state: 'empty' }
  | { state: 'blocked'; submission: Submission }
  | { state: 'unavailable' };
export function submissionState(): SubmissionState {
  try {
    const raw = localStorage.getItem(SUBMISSION_KEY);
    if (raw === null) return { state: 'empty' };
    if (raw.length > 2000) return { state: 'unavailable' };
    const value = JSON.parse(raw);
    const allowed = ['schemaVersion', 'id', 'chainId', 'account', 'tokenId', 'inputHash', 'startedAt', 'hash'];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !allowed.includes(key)) ||
        value.schemaVersion !== 1 || value.chainId !== CHAIN_ID ||
        typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) ||
        typeof value.tokenId !== 'string' || typeof value.account !== 'string' ||
        !/^0x[0-9a-f]{64}$/i.test(value.inputHash) ||
        typeof value.startedAt !== 'string' || value.startedAt.length > 40 ||
        !Number.isFinite(Date.parse(value.startedAt)) ||
        (value.hash !== undefined && !/^0x[0-9a-f]{64}$/i.test(value.hash))) return { state: 'unavailable' };
    parseTokenId(value.tokenId);
    return { state: 'blocked', submission: { ...value, account: getAddress(value.account) } };
  } catch { return { state: 'unavailable' }; }
}
function persist(value: Submission) {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(SUBMISSION_KEY, raw);
    if (localStorage.getItem(SUBMISSION_KEY) !== raw) throw new Error('Storage readback failed');
  } catch { throw new ExitError('SUBMISSION_STORAGE', 'Cannot preserve pending submission; sending stopped'); }
}
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new ExitError('SUBMISSION_LOCK', 'Browser cannot coordinate signing across tabs');
  return navigator.locks.request(LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
    if (!lock) throw new ExitError('SUBMISSION_LOCK', 'Another tab is handling a submission');
    return action();
  });
}
export async function sendGuarded(provider: Provider, plan: Plan, gas: bigint, beforeRequest?: () => void): Promise<Hex> {
  return exclusive(async () => {
    if (submissionState().state !== 'empty')
      throw new ExitError('SUBMISSION_BLOCKED', 'An unresolved submission exists; check it before sending again');
    if (plan.chainId !== CHAIN_ID || getAddress(plan.manager) !== MANAGER)
      throw new ExitError('SUBMISSION_BLOCKED', 'Submission deployment mismatch');
    const entry: Submission = { schemaVersion: 1, id: crypto.randomUUID(), chainId: CHAIN_ID,
      account: plan.account, tokenId: plan.tokenId.toString(), inputHash: keccak256(plan.data),
      startedAt: new Date().toISOString() };
    let preserved = false;
    try {
      const hash = await send(provider, plan, gas, () => { beforeRequest?.(); persist(entry); preserved = true; });
      // If this write fails, the pre-request unknown marker remains and still blocks a resend.
      try { persist({ ...entry, hash }); } catch { /* Hash is also returned to the active UI. */ }
      return hash;
    } catch (error) {
      if (preserved && (error as { code?: number })?.code === 4001) {
        // Only an explicit provider rejection proves that this wallet request was cancelled.
        try { localStorage.removeItem(SUBMISSION_KEY); } catch { /* Retain a conservative block. */ }
      }
      throw error;
    }
  });
}
export async function reconcileSubmission(rpc: StrictRpc, knownHash?: Hex) {
  return exclusive(async () => {
    const state = submissionState();
    if (state.state === 'empty') return { state: 'empty' as const };
    if (state.state !== 'blocked') throw new ExitError('SUBMISSION_STORAGE', 'Pending submission storage is unreadable');
    const entry = state.submission;
    const hash = entry.hash ?? knownHash;
    if (!hash || !/^0x[0-9a-f]{64}$/i.test(hash) ||
        (entry.hash && knownHash && entry.hash.toLowerCase() !== knownHash.toLowerCase()))
      throw new ExitError('SUBMISSION_UNKNOWN', 'No matching transaction hash; inspect wallet activity before recovery');
    await rpc.checkChain(entry.chainId);
    const tx = await rpc.request<{ from: Address; to: Address; input: Hex; value: Hex } | null>(
      'eth_getTransactionByHash', [hash], value => value ? {
        from: value.from, to: value.to, input: value.input, value: value.value,
      } : null);
    if (!tx) return { state: 'pending' as const };
    if (getAddress(tx.from) !== entry.account || getAddress(tx.to) !== MANAGER ||
        BigInt(tx.value) !== 0n || keccak256(tx.input) !== entry.inputHash)
      throw new ExitError('SUBMISSION_MISMATCH', 'Actual transaction does not match the pending intent');
    if (!entry.hash) persist({ ...entry, hash });
    const verification = await recheckHistory(rpc, {
      tokenId: entry.tokenId, hash, time: entry.startedAt, environment: 'mainnet', state: 'submitted',
    });
    if (verification.state === 'pending') return { state: 'pending' as const };
    // Keep the durable block through inclusion; a reorg must not enable a new send after reload.
    const finalized = await rpc.block('finalized');
    const receiptBlock = verification.state === 'checked' ? verification.result.blockNumber : verification.blockNumber;
    if (BigInt(finalized.number) < BigInt(receiptBlock)) return { state: 'confirming' as const };
    const rawReceipt = await rpc.request<unknown>('eth_getTransactionReceipt', [hash],
      value => value === null ? null : receiptEvidence(value));
    if (rawReceipt === null) throw new ExitError('REORG', 'Pending receipt disappeared during finalization check');
    const receipt = receiptEvidence(rawReceipt);
    if (BigInt(receipt.blockNumber) !== BigInt(receiptBlock))
      throw new ExitError('REORG', 'Pending receipt moved during finalization check');
    const canonical = await rpc.block(receipt.blockNumber);
    const verifiedHash = verification.state === 'checked' ? verification.result.blockHash : verification.blockHash;
    if (canonical.hash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
        canonical.hash.toLowerCase() !== verifiedHash.toLowerCase())
      throw new ExitError('REORG', 'Pending receipt block changed');
    if (receipt.transactionHash !== hash.toLowerCase() || receipt.from !== entry.account || receipt.to !== MANAGER ||
        receipt.status !== (verification.state === 'reverted' ? '0x0' : '0x1'))
      throw new ExitError('SUBMISSION_MISMATCH', 'Final receipt differs from the checked transaction');
    const finalTx = minedTransaction(await rpc.request<unknown>('eth_getTransactionByHash', [hash], minedTransaction));
    assertTransactionIdentity(finalTx, receipt);
    if (BigInt(finalTx.value) !== 0n || keccak256(finalTx.input) !== entry.inputHash)
      throw new ExitError('SUBMISSION_MISMATCH', 'Final transaction differs from the pending intent');
    await rpc.assertBlock(finalized);
    await rpc.assertBlock(canonical);
    const current = submissionState();
    if (current.state !== 'blocked' || current.submission.id !== entry.id)
      throw new ExitError('SUBMISSION_MISMATCH', 'Pending intent changed during recovery');
    try {
      localStorage.removeItem(SUBMISSION_KEY);
      if (localStorage.getItem(SUBMISSION_KEY) !== null) throw new Error('Storage removal failed');
    } catch { throw new ExitError('SUBMISSION_STORAGE', 'Cannot clear the finalized pending marker'); }
    return { state: 'resolved' as const, submission: { ...entry, hash }, verification };
  });
}
