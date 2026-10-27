import { describe, expect, it } from 'vitest';
// @ts-expect-error Dependency-free evidence summarizer is JavaScript.
import { summarizeSessions } from '../tools/user-validation.mjs';
const session = { consentToParticipate: true, quoteConsent: false, sessionId: 'S001', participantId: 'P001',
  observedAt: '2026-10-27T10:00:00Z',
  scenarioId: 'outage-v1', sourceCommit: 'a'.repeat(40), manifestSha256: 'b'.repeat(64),
  environment: 'isolation-demo', method: 'tapeexit', durationSeconds: 40,
  assistanceCount: 0, errors: 0, taskCompleted: true, recognizedEnvironment: true };
describe('consented user evidence summaries', () => {
  it('never creates user evidence from an empty template', () => {
    expect(summarizeSessions([])).toMatchObject({ status: 'NO_USER_EVIDENCE', sessionCount: 0, participantCount: 0 });
  });
  it('counts repeat sessions once per participant and excludes unconsented quotations', () => {
    const report = summarizeSessions([{ ...session, quote: 'private' },
      { ...session, sessionId: 'S002', assistanceCount: 1, durationSeconds: 60 }]);
    expect(report).toMatchObject({ sessionCount: 2, participantCount: 1, approvedQuotes: [] });
    expect(report.groups[0]).toMatchObject({ completed: 2, unassistedCompleted: 1, medianCompletedSeconds: 50 });
    expect(JSON.stringify(report)).not.toContain('private');
  });
  it('matches comparisons only within one participant, version, manifest, environment and scenario', () => {
    const explorer = { ...session, sessionId: 'S002', method: 'explorer' };
    expect(summarizeSessions([session, explorer]).matchedComparisonCount).toBe(1);
    for (const patch of [{ participantId: 'P002' }, { sourceCommit: 'c'.repeat(40) },
      { manifestSha256: 'd'.repeat(64) }, { environment: 'local-fork' }, { scenarioId: 'different' }])
      expect(summarizeSessions([session, { ...explorer, ...patch }]).matchedComparisonCount).toBe(0);
  });
  it('rejects invalid consent, duplicate sessions and fabricated numeric measurements', () => {
    for (const patch of [{ consentToParticipate: false }, { assistanceCount: -1 }, { durationSeconds: null },
      { durationSeconds: Infinity }, { errors: 0.5 }, { sourceCommit: 'unknown' }, { observedAt: 'unknown' }])
      expect(() => summarizeSessions([{ ...session, ...patch }])).toThrow();
    expect(() => summarizeSessions([session, session])).toThrow();
    expect(() => summarizeSessions([{ ...session, environment: 'mainnet' }])).toThrow('transaction hash');
  });
});
