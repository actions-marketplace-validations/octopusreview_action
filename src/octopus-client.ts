/**
 * Octopus API client for the GitHub Action.
 */

export interface Finding {
  severity: string;
  title: string;
  filePath: string;
  startLine: number;
  endLine: number;
  category: string;
  description: string;
  suggestion: string;
  confidence: string;
}

export interface ReviewResponse {
  findings: Finding[];
  summary: string;
  model: string;
  indexed: boolean;
  community: boolean;
  firstCommunityReview: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ReviewRequest {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  headSha: string;
  baseBranch: string;
  diff: string;
  githubToken: string;
  forceReindex?: boolean;
  reindexThresholdHours?: number;
}

export async function requestReview(
  apiUrl: string,
  apiKey: string | undefined,
  params: ReviewRequest,
): Promise<ReviewResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${apiUrl}/api/github-action/review`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    const message = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new OctopusApiError(message, res.status);
  }

  return res.json() as Promise<ReviewResponse>;
}

export class OctopusApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OctopusApiError";
  }
}
