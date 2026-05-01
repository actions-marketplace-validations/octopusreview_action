/**
 * Maps Octopus findings to GitHub PR review comments and posts them.
 *
 * Comment format ported from octopus/apps/web/lib/reviewer.ts
 */

import * as github from "@actions/github";
import { Finding } from "./octopus-client";
import { parseDiffLines } from "./diff-parser";

interface ReviewComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

function formatCommentBody(f: Finding): string {
  let body = `**${f.severity} ${f.title}**\n\n${f.description}`;

  if (f.suggestion) {
    body += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  }

  // AI Fix Prompt — collapsible section
  const severityLabel =
    f.severity === "\u{1F534}"
      ? "Critical"
      : f.severity === "\u{1F7E0}"
        ? "High"
        : f.severity === "\u{1F7E1}"
          ? "Medium"
          : f.severity === "\u{1F535}"
            ? "Low"
            : "Nit";
  const categoryNote = f.category ? ` (${f.category})` : "";
  const lineRange =
    f.startLine === f.endLine
      ? `line ${f.startLine}`
      : `lines ${f.startLine}-${f.endLine}`;

  let aiPrompt = `Fix the following ${severityLabel}${categoryNote} issue in \`${f.filePath}\` at ${lineRange}:\n\n`;
  aiPrompt += `Problem: ${f.description}`;
  if (f.suggestion) {
    aiPrompt += `\n\nSuggested fix:\n${f.suggestion}`;
  }

  body += `\n\n<details><summary>AI Fix Prompt</summary>\n\n\`\`\`\n${aiPrompt}\n\`\`\`\n\n</details>`;

  return body;
}

function buildInlineComments(
  findings: Finding[],
  diffLines: Map<string, Set<number>>,
): ReviewComment[] {
  const comments: ReviewComment[] = [];

  for (const f of findings) {
    const validLines = diffLines.get(f.filePath);
    if (!validLines) continue;

    // Find a valid line to attach the comment to
    let targetLine = validLines.has(f.endLine) ? f.endLine : 0;
    if (!targetLine && validLines.has(f.startLine)) {
      targetLine = f.startLine;
    }
    if (!targetLine) {
      for (let l = f.endLine; l >= f.startLine; l--) {
        if (validLines.has(l)) {
          targetLine = l;
          break;
        }
      }
    }
    if (!targetLine) continue;

    comments.push({
      path: f.filePath,
      line: targetLine,
      side: "RIGHT",
      body: formatCommentBody(f),
    });
  }

  return comments;
}

export async function postReview(params: {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
  findings: Finding[];
  summary: string;
  diff: string;
  community: boolean;
  firstCommunityReview: boolean;
}): Promise<{ posted: number; skipped: number }> {
  const octokit = github.getOctokit(params.token);
  const diffLines = parseDiffLines(params.diff);
  const comments = buildInlineComments(params.findings, diffLines);

  // Build review body
  let reviewBody = params.summary;

  if (params.community && params.firstCommunityReview) {
    reviewBody +=
      "\n\n---\n*This review ran without an Octopus API key. " +
      "Add `octopus-api-key` to unlock your team's knowledge base, custom rules, and full review history. " +
      "[Learn more](https://octopus-review.ai/docs/github-action)*";
  }

  reviewBody += "\n\n---\n*Reviewed by [Octopus](https://octopus-review.ai)*";

  // Post the review — retry without offending comments on 422
  let commentsToPost = comments;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await octokit.rest.pulls.createReview({
        owner: params.owner,
        repo: params.repo,
        pull_number: params.prNumber,
        event: "COMMENT",
        body: reviewBody,
        comments: commentsToPost.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          body: c.body,
        })),
      });

      return {
        posted: commentsToPost.length,
        skipped: params.findings.length - commentsToPost.length,
      };
    } catch (err: unknown) {
      const ghError = err as { status?: number; message?: string };
      if (ghError.status === 422 && commentsToPost.length > 0) {
        // GitHub rejected a comment (likely invalid line). Try posting without inline comments.
        commentsToPost = [];
        continue;
      }
      throw err;
    }
  }

  return { posted: 0, skipped: params.findings.length };
}
