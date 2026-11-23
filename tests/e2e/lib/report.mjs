import fs from 'node:fs';
import path from 'node:path';

export function buildReportSummary({ meta, results, sessionErrors }) {
  let passedChecks = 0;
  let failedChecks = 0;
  let totalIssues = 0;
  const issuesByCode = {};
  const issuesByViewport = {};
  const issuesByScenario = {};

  for (const r of results) {
    if (r.passed) passedChecks++;
    else failedChecks++;

    const count = r.issues.length;
    totalIssues += count;

    const vpName = r.viewport?.name || 'unknown';
    issuesByViewport[vpName] = (issuesByViewport[vpName] || 0) + count;
    issuesByScenario[r.scenario] = (issuesByScenario[r.scenario] || 0) + count;

    for (const iss of r.issues) {
      const key = `${iss.category || 'check'}:${iss.code || 'unknown'}`;
      issuesByCode[key] = (issuesByCode[key] || 0) + 1;
    }
  }

  const sessionErrorCount =
    (sessionErrors?.consoleErrors?.length || 0) +
    (sessionErrors?.pageErrors?.length || 0) +
    (sessionErrors?.requestFailed?.length || 0) +
    (sessionErrors?.httpErrors?.length || 0);

  return {
    meta,
    summary: {
      totalChecks: results.length,
      passedChecks,
      failedChecks,
      totalIssues,
      sessionErrorCount,
      overallPassed: failedChecks === 0 && sessionErrorCount === 0,
      issuesByCode,
      issuesByViewport,
      issuesByScenario,
    },
    sessionErrors,
    results,
  };
}

export function writeAuditReports(outDir, report) {
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, 'audit-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  const { meta, summary, sessionErrors, results } = report;
  const lines = [];
  lines.push(`# Cat Quest Proto — E2E Visual & DOM Audit Summary`);
  lines.push('');
  lines.push(`- **Generated**: ${meta.generatedAt}`);
  lines.push(`- **Mode**: \`${meta.mode}\` (${meta.gpu ? 'GPU' : 'SwiftShader'}, ${meta.serverMode})`);
  lines.push(`- **URL**: ${meta.url}`);
  lines.push(`- **Viewports**: ${meta.viewports.join(', ')}`);
  lines.push(`- **Scenarios**: ${meta.scenarios.join(', ')}`);
  lines.push(`- **Overall Result**: **${summary.overallPassed ? 'PASS' : 'FAIL'}**`);
  lines.push('');
  lines.push(`## Summary Counts`);
  lines.push(`- Total View/Viewport Checks: **${summary.totalChecks}**`);
  lines.push(`- Passed: **${summary.passedChecks}** | Failed: **${summary.failedChecks}**`);
  lines.push(`- Total Invariant Issues: **${summary.totalIssues}**`);
  lines.push(
    `- Cumulative Session Errors: console=${sessionErrors.consoleErrors.length}, pageerror=${sessionErrors.pageErrors.length}, requestfailed=${sessionErrors.requestFailed.length}, http>=400=${sessionErrors.httpErrors.length}, webglConsole=${sessionErrors.webglWarningsOrErrors.length}`,
  );
  lines.push('');

  if (Object.keys(summary.issuesByCode).length > 0) {
    lines.push(`## Issues by Code`);
    lines.push(`| Code | Count |`);
    lines.push(`|---|---:|`);
    for (const [code, count] of Object.entries(summary.issuesByCode).sort((a, b) => b[1] - a[1])) {
      lines.push(`| \`${code}\` | ${count} |`);
    }
    lines.push('');
  }

  lines.push(`## Issues by Viewport`);
  lines.push(`| Viewport | Issues |`);
  lines.push(`|---|---:|`);
  for (const [vp, count] of Object.entries(summary.issuesByViewport)) {
    lines.push(`| ${vp} | ${count} |`);
  }
  lines.push('');

  lines.push(`## Per-View / Viewport Breakdown`);
  lines.push(`| Scenario | View | Viewport | Status | Issues | Canvas | Screenshot |`);
  lines.push(`|---|---|---|---|---:|---|---|`);
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    const canvasInfo = r.webgl?.canvasAnalysis
      ? r.webgl.canvasAnalysis.ok
        ? `OK (stddev=${r.webgl.canvasAnalysis.rgbStddev})`
        : `FAIL (${r.webgl.canvasAnalysis.reason || 'blank'})`
      : 'n/a';
    const shot = r.screenshot ? `\`${r.screenshot}\`` : 'none';
    lines.push(
      `| ${r.scenario} | \`${r.view}\` | ${r.viewport?.name || ''} | **${status}** | ${r.issues.length} | ${canvasInfo} | ${shot} |`,
    );
  }
  lines.push('');

  const failedResults = results.filter((r) => !r.passed);
  if (failedResults.length > 0) {
    lines.push(`## Detailed Failures`);
    for (const r of failedResults) {
      lines.push(`### ${r.scenario} / \`${r.view}\` (${r.viewport?.name})`);
      if (r.screenshot) lines.push(`- Screenshot: \`${r.screenshot}\``);
      for (const iss of r.issues) {
        const { category, code, ...rest } = iss;
        lines.push(`- **[${category}:${code}]** \`${JSON.stringify(rest)}\``);
      }
      lines.push('');
    }
  }

  const mdPath = path.join(outDir, 'audit-summary.md');
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf8');

  return { jsonPath, mdPath };
}
