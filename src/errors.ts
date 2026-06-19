/**
 * Helpers for surfacing GitHub token permission problems with actionable guidance.
 *
 * The most common failure for the community/open-source setup: a pull request
 * opened from a fork. GitHub downgrades GITHUB_TOKEN to read-only for fork PRs
 * on the `pull_request` event, so Octopus cannot post its review. Instead of a
 * generic "it does not work" failure, we detect this case and tell the user
 * exactly how to fix it.
 */

import * as core from "@actions/core";

const DOCS_URL = "https://octopus-review.ai/docs/github-action#fork-pull-requests";

/**
 * True when an Octokit error indicates the token lacks write access — typically
 * a read-only GITHUB_TOKEN on a fork PR.
 */
export function isPermissionError(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null | undefined;
  if (!e) return false;
  const message = typeof e.message === "string" ? e.message : "";
  // Rate limiting and abuse detection also surface as 403, but switching to
  // pull_request_target would not help there — don't misclassify them.
  if (/rate limit|secondary rate|abuse detection/i.test(message)) return false;
  if (message.includes("Resource not accessible by integration")) return true;
  return e.status === 403;
}

let alreadyWarned = false;

/**
 * Test-only: reset the de-duplication flag so each test run starts clean.
 * The flag is module-level, which is correct for a single Action invocation
 * but would otherwise persist across tests that import this module once.
 */
export function resetWarningsForTests(): void {
  alreadyWarned = false;
}

/**
 * Emit a single, clear, actionable warning explaining why Octopus could not
 * post and how to enable it. De-duplicated so it shows once per run even if
 * both the summary comment and the inline review hit the same error.
 */
export function warnReadOnlyToken(eventName: string): void {
  if (alreadyWarned) return;
  alreadyWarned = true;

  core.warning(
    "Octopus could not post its review because the GITHUB_TOKEN is read-only. " +
      "GitHub restricts GITHUB_TOKEN to read-only on pull requests from forks when " +
      "using the `pull_request` event, so review comments cannot be created.\n\n" +
      "To enable reviews on fork pull requests, choose one of:\n" +
      "  1. Switch the workflow trigger to `pull_request_target`. The Octopus action " +
      "only reads the PR diff via the API; it never checks out or runs PR code, so " +
      "this is safe as long as your workflow does not check out and build the fork's head.\n" +
      "  2. Install the Octopus GitHub App, which posts reviews with its own " +
      "installation permissions and is unaffected by fork token restrictions.\n\n" +
      `See ${DOCS_URL} (current event: ${eventName}).`,
  );
}
