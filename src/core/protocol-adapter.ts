import type { Block } from './rpc';

export type ProtocolCategory = 'liquidity' | 'staking' | 'vault' | 'lending';
export type ProtocolAction = 'withdraw' | 'claim' | 'request-withdrawal' | 'claim-withdrawal';

export interface ProtocolDescriptor {
  readonly id: string;
  readonly name: string;
  readonly chainId: number;
  readonly category: ProtocolCategory;
  // Describes implemented operations, not asset or release approval.
  readonly actions: readonly ProtocolAction[];
}

/**
 * Shared read and simulation boundary. Position identities and transaction
 * models stay protocol-specific; the adapter never signs or broadcasts.
 */
export interface ProtocolAdapter<
  PositionId,
  PositionSnapshot extends { block: Block },
  ExitPlan,
  ExitPreview,
> {
  readonly protocol: ProtocolDescriptor;
  snapshot(positionId: PositionId): Promise<PositionSnapshot>;
  snapshotAt(positionId: PositionId, block: Block): Promise<PositionSnapshot>;
  simulate(plan: ExitPlan, block?: Block): Promise<ExitPreview>;
}
