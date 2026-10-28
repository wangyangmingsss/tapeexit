import { readFile, realpath, mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const stages = ['INTERVIEWED', 'AGREED', 'COMPLETED', 'PAID'];
const evidenceKinds = ['interview', 'agreement', 'outcome', 'payment'];
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const hash = (value, length) => typeof value === 'string' &&
  new RegExp(`^[a-f0-9]{${length}}$`).test(value) && !/^0+$/.test(value);
export function summarizePilots(input, now = Date.now()) {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('Expected at most 1000 private pilot records');
  const seen = new Set(), groups = new Map();
  for (const record of input) {
    if (!record || Object.keys(record).some(key => !['pilotId', 'organizationId', 'consentToRecord',
      'observedAt', 'sourceCommit', 'manifestSha256', 'environment', 'stage', 'evidence',
      'receivedUsdCents'].includes(key)) ||
        !id(record.pilotId) || seen.has(record.pilotId) || !id(record.organizationId) ||
        record.consentToRecord !== true || !hash(record.sourceCommit, 40) || !hash(record.manifestSha256, 64) ||
        !['isolation-demo', 'local-fork', 'mainnet'].includes(record.environment) ||
        !stages.includes(record.stage) || typeof record.observedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.observedAt)) || Date.parse(record.observedAt) > now ||
        !record.evidence || typeof record.evidence !== 'object' || Array.isArray(record.evidence))
      throw new Error('Invalid, duplicate, future or unconsented pilot record');
    const required = evidenceKinds.slice(0, stages.indexOf(record.stage) + 1);
    if (Object.keys(record.evidence).length !== required.length ||
        required.some(kind => {
          const ref = record.evidence[kind];
          return !ref || Object.keys(ref).sort().join(',') !== 'path,sha256' ||
            typeof ref.path !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(ref.path) ||
            ref.path.startsWith('/') || ref.path.split('/').some(part => !part || part === '.' || part === '..') ||
            !hash(ref.sha256, 64);
        })) throw new Error('Each declared stage requires its own digest-bound evidence');
    if (record.stage === 'PAID' ?
      !Number.isSafeInteger(record.receivedUsdCents) || record.receivedUsdCents <= 0 :
      record.receivedUsdCents !== null)
      throw new Error('Only a paid record may declare an explicit positive USD-cent receipt');
    seen.add(record.pilotId);
    const key = [record.sourceCommit, record.manifestSha256, record.environment].join(':');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return { schemaVersion: 1, status: input.length ? 'RECORDED_CLAIMS_REQUIRE_HUMAN_VERIFICATION' : 'NO_PILOT_EVIDENCE',
    pilotCount: input.length, organizationCount: new Set(input.map(r => r.organizationId)).size,
    groups: [...groups.values()].map(records => ({
      sourceCommit: records[0].sourceCommit, manifestSha256: records[0].manifestSha256,
      environment: records[0].environment, pilots: records.length,
      organizations: new Set(records.map(r => r.organizationId)).size,
      stages: Object.fromEntries(stages.map(stage => [stage, records.filter(r => r.stage === stage).length])),
      declaredReceivedUsdCents: records.reduce((total, r) => total + BigInt(r.receivedUsdCents ?? 0), 0n).toString(),
    })),
    limitations: ['Record and file hashes do not authenticate consent, signatories, protocol endorsement, task success or payment',
      'Stages count the latest declared state per pilot, not independent customers or a conversion funnel',
      'Versions and environments are separated; simulated and fork pilots are not mainnet acceptance',
      'Declared receipts are not profit or recurring revenue; costs, refunds, tax and FX need separate evidence',
      'No private identifiers, contact details, document contents or quotations are included in this summary'] };
}

export async function verifyPilotFiles(records, rootPath) {
  const root = await realpath(rootPath);
  for (const record of records) for (const ref of Object.values(record.evidence)) {
    const file = await realpath(resolve(root, ref.path));
    if (!file.startsWith(root + sep)) throw new Error('Pilot evidence escapes the private record directory');
    const bytes = await readFile(file);
    if (bytes.length > 2_000_000 || createHash('sha256').update(bytes).digest('hex') !== ref.sha256)
      throw new Error('Pilot evidence is oversized or has changed');
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = 'release-artifacts/pilot-validation.json';
  await mkdir('release-artifacts', { recursive: true }); await rm(output, { force: true });
  if (process.argv.length > 3) throw new Error('Usage: npm run report:pilots -- [private-records.json]');
  const bytes = process.argv[2] ? await readFile(process.argv[2]) : Buffer.from('[]');
  if (bytes.length > 2_000_000) throw new Error('Pilot records exceed size limit');
  const records = JSON.parse(bytes.toString('utf8'));
  const report = summarizePilots(records);
  if (process.argv[2]) await verifyPilotFiles(records, resolve(process.argv[2], '..'));
  await writeFile(output, JSON.stringify({ ...report, evidenceFiles: 'DIGEST_CHECKED_NOT_AUTHENTICATED' }, null, 2) + '\n');
  console.log(`${report.status}; ${report.pilotCount} pilots. No outreach or payment performed.`);
}
