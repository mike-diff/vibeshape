import { execSync } from 'node:child_process';

const RUN_TIMEOUT_MS = 120_000;

function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Runs each test-type evidence entry through the repo's configured verify
 * command template ({path} and {name} placeholders, shell-quoted). Returns
 * { ok: true } only when every run exits zero. This is what makes `verified`
 * an executed fact rather than a claim: the cited test must pass right now.
 */
export function runTestEvidence(repoRoot, template, evidence) {
    const tests = evidence.filter((e) => e.type === 'test');
    if (tests.length === 0) return { ok: false, detail: 'no test evidence to execute' };
    for (const e of tests) {
        if (template.includes('{name}') && !e.name) {
            return { ok: false, detail: `test evidence ${e.path} has no #name and the verify command requires one` };
        }
        const command = template
            .replaceAll('{path}', shellQuote(e.path))
            .replaceAll('{name}', shellQuote(e.name ?? ''));
        try {
            // Scrub inherited test-harness context: when the CLI itself runs
            // under node --test, a child runner inheriting NODE_TEST_CONTEXT
            // reports into the parent harness instead of exiting on failure.
            const env = { ...process.env };
            delete env.NODE_TEST_CONTEXT;
            execSync(command, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: RUN_TIMEOUT_MS, env });
        }
        catch (error) {
            const tail = `${error.stdout ?? ''}${error.stderr ?? ''}`.toString().trim().slice(-400);
            return { ok: false, detail: `${command} failed${tail ? `:\n${tail}` : ''}` };
        }
    }
    return { ok: true };
}
