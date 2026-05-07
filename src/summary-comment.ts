/**
 * Find-or-update the single Octopus summary comment on a PR.
 *
 * Each PR should have at most one top-level Octopus comment that gets
 * rewritten as new commits trigger fresh reviews, instead of accumulating
 * a fresh comment per push. We tag the comment with a hidden HTML marker
 * so we can locate it reliably on later runs.
 */

import * as github from "@actions/github";
import * as core from "@actions/core";

export const SUMMARY_MARKER = "<!-- octopus-review-summary-comment -->";

type Octokit = ReturnType<typeof github.getOctokit>;

export async function postOrUpdateSummaryComment(params: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
}): Promise<{ action: "created" | "updated"; commentId: number }> {
  const { octokit, owner, repo, prNumber } = params;
  const taggedBody = `${SUMMARY_MARKER}\n${params.body}`;

  const existing = await findExistingSummaryComment(octokit, owner, repo, prNumber);

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: taggedBody,
    });
    core.info(`Updated existing Octopus summary comment (id=${existing.id}).`);
    return { action: "updated", commentId: existing.id };
  }

  const created = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: taggedBody,
  });
  core.info(`Created Octopus summary comment (id=${created.data.id}).`);
  return { action: "created", commentId: created.data.id };
}

async function findExistingSummaryComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<{ id: number } | null> {
  // Issue comments are paginated (default 30 per page). For most PRs the Octopus
  // comment will be among the recent ones; iterate just in case the PR has many.
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  let fallback: { id: number } | null = null;

  for await (const page of iterator) {
    for (const comment of page.data) {
      if (!comment.body) continue;
      if (comment.body.includes(SUMMARY_MARKER)) {
        return { id: comment.id };
      }
      // Backwards-compat: pre-marker comments authored by github-actions[bot]
      // that contain the Octopus footer. Match the most recent one so older
      // duplicates do not get reused.
      if (
        comment.user?.login === "github-actions[bot]" &&
        comment.body.includes("Reviewed by [Octopus]")
      ) {
        fallback = { id: comment.id };
      }
    }
  }

  return fallback;
}
