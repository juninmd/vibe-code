import type { GitProvider, RemoteRepo, RepositoryIssue } from "@vibe-code/shared";

export interface CreatePRParams {
  repoUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface CreateRepoParams {
  name: string;
  description: string;
  isPrivate: boolean;
}

export interface ListIssuesOptions {
  state?: "open" | "closed" | "all";
  labels?: string[];
  limit?: number;
  /** Most recently updated first (default is provider order). */
  recentlyUpdated?: boolean;
}

export interface LabelSpec {
  name: string;
  color: string;
  description?: string;
}

export interface GitProviderAdapter {
  readonly name: GitProvider;

  /** Get authenticated user info */
  getUser(token: string): Promise<{ username: string; displayName?: string }>;

  /** List repositories accessible to the authenticated user */
  listRepos(token: string, limit?: number): Promise<RemoteRepo[]>;

  /** Search repositories by query (server-side) */
  searchRepos(token: string, query: string, limit?: number): Promise<RemoteRepo[]>;

  /** Create a new remote repository */
  createRepo(token: string, params: CreateRepoParams): Promise<RemoteRepo>;

  /** Create a pull/merge request */
  createPR(token: string, params: CreatePRParams): Promise<string>;

  /** Check if a PR/MR identified by its URL has been merged */
  isPrMerged(token: string, prUrl: string): Promise<boolean>;

  /** List issues for a repository */
  listIssues(
    token: string,
    repoUrl: string,
    options?: ListIssuesOptions
  ): Promise<RepositoryIssue[]>;

  /** Add and remove labels on one issue; removing a label it does not have is not an error. */
  updateIssueLabels(
    token: string,
    repoUrl: string,
    issueNumber: number,
    change: { add: string[]; remove: string[] }
  ): Promise<void>;

  /** Create labels that do not exist yet (colour is a hex string without "#"). */
  ensureLabels(token: string, repoUrl: string, labels: LabelSpec[]): Promise<void>;

  /** List branches for a repository */
  listBranches(token: string, repoUrl: string): Promise<string[]>;
}
