import * as core from "@actions/core";
import * as github from "@actions/github";
import { requestReview, OctopusApiError } from "./octopus-client";
import { postReview } from "./post-review";

const MAX_DIFF_SIZE = 500_000; // 500KB

async function run(): Promise<void> {
  try {
    // ── Validate event ────────────────────────────────────────────────────

    const eventName = github.context.eventName;
    if (eventName !== "pull_request" && eventName !== "pull_request_target") {
      core.info(
        `Octopus Review only runs on pull_request events. Current event: ${eventName}. Skipping.`,
      );
      return;
    }

    const pr = github.context.payload.pull_request;
    if (!pr) {
      core.warning("No pull_request payload found. Skipping.");
      return;
    }

    // ── Read inputs ───────────────────────────────────────────────────────

    const apiKey = core.getInput("octopus-api-key") || undefined;
    const githubToken = core.getInput("github-token", { required: true });
    const apiUrl = core.getInput("api-url") || "https://octopus-review.ai";
    const forceReindex = core.getInput("force-reindex") === "true";
    const reindexThresholdHours = parseInt(
      core.getInput("reindex-threshold-hours") || "24",
      10,
    );

    const { owner, repo } = github.context.repo;
    const prNumber = pr.number as number;
    const prTitle = (pr.title as string) || "";
    const prAuthor = (pr.user?.login as string) || "";
    const headSha = (pr.head?.sha as string) || "";
    const baseBranch = (pr.base?.ref as string) || "main";

    core.info(`Reviewing PR #${prNumber}: ${prTitle}`);
    if (!apiKey) {
      core.info("No octopus-api-key provided. Running in community mode (public repos only).");
    }

    // ── Fetch PR diff ─────────────────────────────────────────────────────

    const octokit = github.getOctokit(githubToken);

    core.info("Fetching PR diff...");
    const diffResponse = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: "diff" },
    });

    let diff = diffResponse.data as unknown as string;
    if (diff.length > MAX_DIFF_SIZE) {
      core.warning(
        `Diff is ${(diff.length / 1024).toFixed(0)}KB, truncating to ${MAX_DIFF_SIZE / 1024}KB.`,
      );
      diff = diff.slice(0, MAX_DIFF_SIZE);
    }

    if (!diff || diff.trim().length === 0) {
      core.info("Empty diff. Nothing to review.");
      core.setOutput("findings-count", "0");
      core.setOutput("summary", "No changes to review.");
      return;
    }

    // ── Call Octopus API ──────────────────────────────────────────────────

    core.info("Sending to Octopus for review...");
    const result = await requestReview(apiUrl, apiKey, {
      owner,
      repo,
      prNumber,
      prTitle,
      prAuthor,
      headSha,
      baseBranch,
      diff,
      githubToken,
      forceReindex,
      reindexThresholdHours,
    });

    core.info(
      `Review complete: ${result.findings.length} findings (model: ${result.model}, indexed: ${result.indexed})`,
    );

    if (result.community) {
      core.info(
        "Running in community mode. Add octopus-api-key to unlock full features: knowledge base, custom rules, and review history.",
      );
    }

    // ── Post review ───────────────────────────────────────────────────────

    if (result.findings.length === 0) {
      // Post a short positive comment
      const octokit = github.getOctokit(githubToken);
      let body = result.summary || "No issues found. Looking good!";
      body += "\n\n---\n*Reviewed by [Octopus](https://octopus-review.ai)*";

      if (result.community && result.firstCommunityReview) {
        body +=
          "\n\n---\n*This review ran without an Octopus API key. " +
          "Add `octopus-api-key` to unlock your team's knowledge base, custom rules, and full review history. " +
          "[Learn more](https://octopus-review.ai/docs/github-action)*";
      }

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });

      core.info("Posted summary comment (no findings).");
    } else {
      const { posted, skipped } = await postReview({
        token: githubToken,
        owner,
        repo,
        prNumber,
        findings: result.findings,
        summary: result.summary,
        diff,
        community: result.community,
        firstCommunityReview: result.firstCommunityReview,
      });

      core.info(
        `Posted review: ${posted} inline comments, ${skipped} could not be mapped to diff lines.`,
      );
    }

    // ── Set outputs ───────────────────────────────────────────────────────

    core.setOutput("findings-count", String(result.findings.length));
    core.setOutput("summary", result.summary);
  } catch (error) {
    if (error instanceof OctopusApiError) {
      switch (error.status) {
        case 401:
          core.setFailed(
            `Authentication failed: ${error.message}. Check your octopus-api-key secret.`,
          );
          break;
        case 402:
          core.warning(`Octopus: ${error.message}`);
          break;
        case 413:
          core.warning(`Octopus: ${error.message}`);
          break;
        case 429:
          core.warning(`Octopus: ${error.message}`);
          break;
        default:
          core.setFailed(`Octopus API error (${error.status}): ${error.message}`);
      }
    } else {
      core.setFailed(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

run();
