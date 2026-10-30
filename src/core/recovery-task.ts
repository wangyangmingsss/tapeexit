import { getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { CHAIN_ID, MANAGER } from '../config';
import { parseTokenId } from './token-id';

export const RECOVERY_TASK_KEY = 'tapeexit:recovery-task:v1';
export interface RecoveryTask {
  schemaVersion: 1; chainId: number; manager: Address;
  tokenId: string; account: Address; hash: Hex;
}
export function recoveryTask(tokenId: string, account: string, hash: string): RecoveryTask {
  const owner = getAddress(account);
  if (owner === zeroAddress || !/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid recovery task');
  return { schemaVersion: 1, chainId: CHAIN_ID, manager: MANAGER,
    tokenId: parseTokenId(tokenId).toString(), account: owner, hash: hash.toLowerCase() as Hex };
}
function parseTask(value: unknown): RecoveryTask {
  const keys = ['schemaVersion', 'chainId', 'manager', 'tokenId', 'account', 'hash'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid recovery task');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(key => !Object.hasOwn(v, key)) ||
      v.schemaVersion !== 1 || v.chainId !== CHAIN_ID ||
      typeof v.manager !== 'string' || getAddress(v.manager) !== MANAGER ||
      typeof v.tokenId !== 'string' || typeof v.account !== 'string' || typeof v.hash !== 'string')
    throw new Error('Invalid recovery task');
  return recoveryTask(v.tokenId, v.account, v.hash);
}
export function importRecoveryTask(text: string): RecoveryTask {
  if (text.length > 65536) throw new Error('Recovery record too large');
  const value = JSON.parse(text);
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'task')) {
    const keys = ['schemaVersion', 'environment', 'signingApproved', 'task', 'outcome', 'observedAt'];
    if (Object.keys(value).some(key => !keys.includes(key)) || value.schemaVersion !== 1 ||
        value.environment !== 'MAINNET_READ_ONLY' || value.signingApproved !== false ||
        typeof value.observedAt !== 'string' || value.observedAt.length > 40 ||
        !Number.isFinite(Date.parse(value.observedAt))) throw new Error('Invalid recovery report');
    // The saved outcome is untrusted; importing restores only public transaction identity.
    return parseTask(value.task);
  }
  return parseTask(value);
}
export function loadRecoveryTask(): RecoveryTask | undefined {
  try {
    const raw = localStorage.getItem(RECOVERY_TASK_KEY);
    if (!raw || raw.length > 1024) return;
    return parseTask(JSON.parse(raw));
  } catch { return; }
}
export function saveRecoveryTask(task: RecoveryTask): boolean {
  try {
    const raw = JSON.stringify(recoveryTask(task.tokenId, task.account, task.hash));
    localStorage.setItem(RECOVERY_TASK_KEY, raw);
    return localStorage.getItem(RECOVERY_TASK_KEY) === raw;
  } catch { return false; }
}
export function clearRecoveryTask(): boolean {
  try {
    localStorage.removeItem(RECOVERY_TASK_KEY);
    return localStorage.getItem(RECOVERY_TASK_KEY) === null;
  } catch { return false; }
}
