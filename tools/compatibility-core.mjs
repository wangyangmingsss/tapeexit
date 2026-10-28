export function summarizeCompatibility(report) {
  const engines = ['chromium', 'firefox', 'webkit'];
  if (!report || report.errors?.length || report.stats?.unexpected !== 0 ||
      report.stats?.skipped !== 0 || report.stats?.flaky !== 0 ||
      !Array.isArray(report.config?.projects) ||
      report.config.projects.map(p => p.name).sort().join(',') !== engines.join(','))
    throw new Error('Complete, unskipped three-engine browser results required');
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) tests.push(...spec.tests);
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  const projects = engines.map(engine => {
    const cases = tests.filter(test => test.projectName === engine);
    if (cases.length < 46 || cases.some(test => test.expectedStatus !== 'passed' || test.status !== 'expected' ||
        test.results?.length !== 1 || test.results[0].status !== 'passed' || test.results[0].retry !== 0))
      throw new Error('Missing, retried or failed browser cases');
    const attachments = cases.flatMap(test => test.results[0].attachments ?? [])
      .filter(attachment => attachment.name === 'browser-capabilities');
    if (attachments.length !== 1 || attachments[0].contentType !== 'application/json' || !attachments[0].body)
      throw new Error('Missing actual browser capability observation');
    const observation = JSON.parse(Buffer.from(attachments[0].body, 'base64').toString('utf8'));
    if (observation.engine !== engine || typeof observation.version !== 'string' || !observation.version ||
        ['webLocks', 'serviceWorker', 'subtleCrypto', 'streams', 'bigint'].some(key => observation.capabilities?.[key] !== true))
      throw new Error('Browser lacks a required observed capability');
    return { engine, version: observation.version, passed: cases.length, capabilities: observation.capabilities };
  });
  if (new Set(projects.map(project => project.passed)).size !== 1 ||
      projects.reduce((sum, project) => sum + project.passed, 0) !== tests.length ||
      report.stats.expected !== tests.length)
    throw new Error('Unequal or incomplete browser matrix');
  return { projects, passed: tests.length, skipped: 0, flaky: 0,
    scope: 'Automated Playwright desktop engines on loopback, explicit provider/RPC/SW identity fixtures. ' +
      'Not branded Safari, mobile hardware, OKX extension, real TapeOut origin, public gateways or mainnet acceptance.' };
}
