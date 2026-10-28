import { ExitError } from './rpc';

export async function loadPlan() {
  try { return await import('./protocol'); }
  catch { throw new ExitError('CALCULATION', 'Calculation module unavailable; verify the release and reload before retrying'); }
}
