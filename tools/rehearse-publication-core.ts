import { decodeFunctionData, getAddress, type Hex } from 'viem';
import { parsePublishProfile } from './operations-core';
import { REGISTRY, publishAbi, type PublishTransaction } from './publish-core';

type Request = (method: string, params?: unknown[]) => Promise<unknown>;
const quantity = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value))
    throw new Error('Malformed local EVM quantity');
  return BigInt(value);
};
const hex = (value: bigint) => `0x${value.toString(16)}`;

// Internal runner. The CLI supplies only startLocalEvm's private IPC transport.
export async function rehearseOperations(request: Request, input: unknown, operations: PublishTransaction[]) {
  const profile = parsePublishProfile(input);
  if (!operations.length || operations.length > 100_000) throw new Error('No bounded remaining publication operations');
  for (const op of operations) {
    if (op.to !== REGISTRY || op.value !== '0') throw new Error('Unexpected publication target or value');
    const decoded = decodeFunctionData({ abi: publishAbi, data: op.data });
    if (getAddress(decoded.args[0]) !== profile.container) throw new Error('Wrong publication container');
  }
  if (await request('eth_chainId') !== '0xc4') throw new Error('Wrong local chain');
  const price = quantity(await request('eth_gasPrice'));
  if (price > BigInt(profile.maxFeePerGasWei)) throw new Error('Fork gas price exceeds budget');
  const ceiling = BigInt(profile.maxGasPerTransaction);
  if (ceiling * BigInt(profile.maxFeePerGasWei) * BigInt(operations.length) > BigInt(profile.maxUploadCostWei))
    throw new Error('Upload gas ceilings exceed total budget');
  // Funding and impersonation exist only inside the disposable EVM.
  await request('anvil_setBalance', [profile.publisher, hex(BigInt(profile.maxUploadCostWei))]);
  await request('anvil_impersonateAccount', [profile.publisher]);
  const receipts = [];
  let totalGas = 0n, totalCost = 0n;
  for (const [index, op] of operations.entries()) {
    const tx = { from: profile.publisher, to: REGISTRY, data: op.data, value: '0x0', gasPrice: hex(price) };
    await request('eth_call', [tx, 'latest']);
    const estimated = quantity(await request('eth_estimateGas', [tx]));
    const gas = (estimated * 120n + 99n) / 100n;
    if (!estimated || gas > ceiling) throw new Error(`Operation ${index} exceeds gas ceiling`);
    const hash = await request('eth_sendTransaction', [{ ...tx, gas: hex(gas) }]);
    if (typeof hash !== 'string' || !/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid local transaction hash');
    // Poll only the receipt. Never retry a send, including when its response is lost.
    let receipt: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      receipt = await request('eth_getTransactionReceipt', [hash]) as Record<string, unknown> | null;
      if (receipt) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!receipt || receipt.status !== '0x1' || receipt.transactionHash !== hash)
      throw new Error(`Operation ${index} reverted or has no checked receipt`);
    const gasUsed = quantity(receipt.gasUsed), effectivePrice = quantity(receipt.effectiveGasPrice);
    if (!gasUsed || gasUsed > gas || effectivePrice !== price) throw new Error('Receipt gas or price mismatch');
    const actual = await request('eth_getTransactionByHash', [hash]) as Record<string, unknown> | null;
    const block = await request('eth_getBlockByNumber', [receipt.blockNumber, false]) as Record<string, unknown> | null;
    if (!actual || !block || typeof receipt.blockHash !== 'string' ||
        block.hash !== receipt.blockHash || actual.blockHash !== receipt.blockHash ||
        actual.blockNumber !== receipt.blockNumber || actual.hash !== hash ||
        typeof actual.from !== 'string' || getAddress(actual.from) !== profile.publisher ||
        typeof actual.to !== 'string' || getAddress(actual.to) !== REGISTRY ||
        actual.input !== op.data || quantity(actual.value) !== 0n ||
        quantity(actual.gas) !== gas || quantity(actual.gasPrice) !== price)
      throw new Error('Local mined transaction or canonical block mismatch');
    totalGas += gasUsed; totalCost += gasUsed * effectivePrice;
    if (totalCost > BigInt(profile.maxUploadCostWei)) throw new Error('Actual rehearsal cost exceeds budget');
    receipts.push({ index, file: op.file, chunk: op.chunk, hash: hash as Hex,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      estimatedGas: estimated.toString(), gasLimit: gas.toString(), gasUsed: gasUsed.toString(),
      effectiveGasPriceWei: effectivePrice.toString(), simulatedCostWei: (gasUsed * effectivePrice).toString() });
  }
  return { status: 'ISOLATED_EVM_OPERATIONS_PASSED', receipts,
    totalGas: totalGas.toString(), simulatedUploadCostWei: totalCost.toString() };
}
