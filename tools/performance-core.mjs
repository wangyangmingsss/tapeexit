export function analyzePerformance(chunks) {
  if (!Array.isArray(chunks) || !chunks.length) throw new Error('Missing production chunks');
  const graph = new Map();
  for (const chunk of chunks) {
    if (!chunk || !/^assets\/[a-zA-Z0-9_-]+\.js$/.test(chunk.path) || graph.has(chunk.path) ||
        !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 ||
        !Number.isSafeInteger(chunk.gzipBytes) || chunk.gzipBytes < 1 ||
        typeof chunk.entry !== 'boolean' || !Array.isArray(chunk.imports) ||
        !Array.isArray(chunk.dynamicImports) || !Array.isArray(chunk.modules) ||
        chunk.modules.some(id => typeof id !== 'string'))
      throw new Error('Invalid chunk graph');
    graph.set(chunk.path, chunk);
  }
  const roots = chunks.filter(chunk => chunk.entry);
  if (roots.length !== 1) throw new Error('Expected one application entry');
  for (const chunk of chunks) for (const path of [...chunk.imports, ...chunk.dynamicImports])
    if (!graph.has(path)) throw new Error('Missing or external executable dependency');
  const initial = new Set();
  function visit(path) {
    if (initial.has(path)) return;
    initial.add(path);
    graph.get(path).imports.forEach(visit);
  }
  visit(roots[0].path);
  const first = chunks.filter(chunk => initial.has(chunk.path));
  if (first.some(chunk => chunk.modules.some(id => /\/node_modules\/@uniswap\//.test(id))))
    throw new Error('Official SDK must remain outside the initial static graph');
  const totals = list => ({
    bytes: list.reduce((sum, chunk) => sum + chunk.bytes, 0),
    gzipBytes: list.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    paths: list.map(chunk => chunk.path).sort(),
  });
  const result = { initial: totals(first), deferred: totals(chunks.filter(c => !initial.has(c.path))),
    total: totals(chunks), officialSdkDeferred: chunks.some(c =>
      !initial.has(c.path) && c.modules.some(id => /\/node_modules\/@uniswap\/v3-sdk\//.test(id))) };
  if (!result.officialSdkDeferred || result.initial.bytes > 400000 ||
      result.initial.gzipBytes > 130000 || result.total.bytes > 600000)
    throw new Error('Production JavaScript exceeds the reviewed budget or lacks the official SDK');
  return result;
}
