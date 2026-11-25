import '../server/env.ts';
import { runGeminiDiagnostics } from '../server/ai-diagnostics.ts';

/**
 * Usage: npm run diagnose:gemini
 * Checks the Gemini key/model separately from the chat route. Never prints the API key.
 */
const report = await runGeminiDiagnostics({ includeFingerprint: true });

console.log('\nBuddy Elder AI - Gemini diagnostic (API key is never printed)\n');
console.log(`Primary model:  ${report.model}`);
console.log(`Fallback model: ${report.fallbackModel ?? 'disabled'}`);
console.log(`SDK version:    ${report.sdkVersion ?? 'unknown'}`);
console.log(`Env files:      ${report.env.filesRead.join(', ') || '(none found)'}${report.env.directory ? `  in ${report.env.directory}` : ''}`);
console.log(
  `Key source:     ${report.key.source}   length: ${report.key.length}   fingerprint: ${report.key.fingerprint ?? 'n/a'}` +
    `   standard format: ${report.key.looksLikeStandardKey ? 'yes' : 'no/unknown'}`
);
if (report.availableModels.length > 0) {
  console.log(`Accessible:     ${report.availableModels.slice(0, 10).join(', ')}${report.availableModels.length > 10 ? ' ...' : ''}`);
}
if (report.env.overridden.length) {
  console.log(`NOTE: ${report.env.overridden.join(', ')} from a .env file replaced a different value from your shell/OS.`);
}
if (report.env.conflicts.length) {
  console.log(`NOTE: ${report.env.conflicts.join(', ')} from the host environment differs from your .env file (host wins).`);
}
console.log('');
for (const s of report.steps) {
  const icon = s.category === 'skipped' ? '-' : s.ok ? 'PASS' : 'FAIL';
  const extra = [s.httpStatus ? `HTTP ${s.httpStatus}` : '', s.reason ?? ''].filter(Boolean).join(' ');
  console.log(`[${icon}] ${s.label}${s.category !== 'ok' && s.category !== 'skipped' ? ` <${s.category}>` : ''}${extra ? ` (${extra})` : ''}`);
  console.log(`       ${s.message}`);
}
if (report.fallbackModel && report.fallbackCategory) {
  const icon = report.fallbackOk ? 'PASS' : 'FAIL';
  console.log(`[${icon}] Fallback model (${report.fallbackModel})${report.fallbackOk ? '' : ` <${report.fallbackCategory}>`}`);
  console.log(`       ${report.fallbackMessage ?? ''}`);
}
console.log(`\nResult: ${report.ok ? 'ALL CHECKS PASSED' : 'PROBLEM FOUND'}\n${report.verdict}\n`);
process.exit(report.ok ? 0 : 1);
