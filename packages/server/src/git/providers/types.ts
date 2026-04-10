import type { GitProvider, RemoteRepo } from "@vibe-code/shared";

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
}
