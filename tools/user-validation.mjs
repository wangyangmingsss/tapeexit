import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeSessions(input) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Expected at most 1000 consented sessions');
  const seen = new Set(), sessions = [];
  for (const record of input) {
    if (!record || record.consentToParticipate !== true ||
        typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt)) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(record.sessionId || '') || seen.has(record.sessionId) ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(record.participantId || '') ||
        !/^[A-Za-z0-9_-]{1,64}$/.test(record.scenarioId || '') ||
        !/^[a-f0-9]{40}$/.test(record.sourceCommit || '') ||
        !/^[a-f0-9]{64}$/.test(record.manifestSha256 || '') ||
        !['isolation-demo', 'local-fork', 'mainnet'].includes(record.environment) ||
        !['tapeexit', 'explorer', 'official-local'].includes(record.method) ||
        !Number.isFinite(record.durationSeconds) || record.durationSeconds < 0 ||
        !Number.isInteger(record.assistanceCount) || record.assistanceCount < 0 ||
        !Number.isInteger(record.errors) || record.errors < 0 ||
        typeof record.taskCompleted !== 'boolean' || typeof record.recognizedEnvironment !== 'boolean' ||
        typeof record.quoteConsent !== 'boolean' ||
        (record.quote != null && (typeof record.quote !== 'string' || record.quote.length > 2000)))
      throw new Error('Invalid, duplicate or unconsented validation session');
    if (record.environment === 'mainnet' && !/^0x[a-f0-9]{64}$/i.test(record.transactionHash || ''))
      throw new Error('Mainnet task claims require an explicit transaction hash; independent verification remains required');
    seen.add(record.sessionId);
    sessions.push(record);
  }
  const groups = new Map();
  for (const record of sessions) {
    const key = [record.sourceCommit, record.manifestSha256, record.environment, record.scenarioId, record.method].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const comparisons = new Map();
  for (const record of sessions) {
    const key = [record.participantId, record.sourceCommit, record.manifestSha256, record.environment, record.scenarioId].join(':');
    if (!comparisons.has(key)) comparisons.set(key, new Set());
    comparisons.get(key).add(record.method);
  }
  return { schemaVersion: 1, status: sessions.length ? 'CONSENTED_OBSERVATIONS' : 'NO_USER_EVIDENCE',
    sessionCount: sessions.length, participantCount: new Set(sessions.map(s => s.participantId)).size,
    matchedComparisonCount: [...comparisons.values()].filter(methods => methods.has('tapeexit') && methods.size > 1).length,
    groups: [...groups.values()].map(records => {
      const r = records[0], completed = records.filter(s => s.taskCompleted);
      return { sourceCommit: r.sourceCommit, manifestSha256: r.manifestSha256, environment: r.environment,
        scenarioId: r.scenarioId, method: r.method, sessions: records.length, completed: completed.length,
        unassistedCompleted: completed.filter(s => s.assistanceCount === 0).length,
        medianCompletedSeconds: completed.length ? median(completed.map(s => s.durationSeconds)) : null,
        errors: records.reduce((sum, s) => sum + s.errors, 0),
        recognizedEnvironment: records.filter(s => s.recognizedEnvironment).length };
    }),
    approvedQuotes: sessions.filter(s => s.quoteConsent && s.quote).map(s => ({
      sessionId: s.sessionId, participantId: s.participantId, quote: s.quote,
    })),
    limitations: ['Self-reported session records; consent and observation authenticity need human verification',
      'Repeated sessions are not independent participants; groups are split by source, manifest, scenario and environment',
      'Matched records alone do not establish randomization, comparable outages or a causal benefit',
      'Transaction hashes are recorded, not independently verified by this tool'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = 'release-artifacts/user-validation-summary.json';
  await mkdir('release-artifacts', { recursive: true });
  await rm(output, { force: true });
  const input = process.argv[2] ? JSON.parse(await readFile(process.argv[2], 'utf8')) : [];
  const report = summarizeSessions(input);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${report.sessionCount} sessions, ${report.participantCount} participants.`);
}
