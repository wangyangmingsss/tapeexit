import { ExitError } from './rpc';

export function parseTokenId(input: string): bigint {
  if (!/^(0|[1-9]\d{0,77})$/.test(input)) throw new ExitError('INPUT', 'Invalid token ID');
  const id = BigInt(input);
  if (id >= 2n ** 256n) throw new ExitError('INPUT', 'Token ID exceeds uint256');
  return id;
}
