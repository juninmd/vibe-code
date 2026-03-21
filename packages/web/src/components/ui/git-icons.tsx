interface IconProps {
  className?: string;
  size?: number;
}

export function GitHubIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function GitLabIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} fill="currentColor">
      <path d="M8 14.5L10.89 5.09H5.11L8 14.5z" />
      <path d="M8 14.5L5.11 5.09H1.46L8 14.5z" opacity=".7" />
      <path d="M1.46 5.09L.59 7.77c-.08.24.01.5.21.64L8 14.5 1.46 5.09z" opacity=".5" />
      <path d="M1.46 5.09h3.65L3.49.72a.18.18 0 00-.35 0L1.46 5.09z" />
      <path d="M8 14.5l2.89-9.41h3.65L8 14.5z" opacity=".7" />
      <path d="M14.54 5.09l.87 2.68c.08.24-.01.5-.21.64L8 14.5l6.54-9.41z" opacity=".5" />
      <path d="M14.54 5.09h-3.65l1.62-4.37a.18.18 0 01.35 0l1.68 4.37z" />
    </svg>
  );
}

export function BitbucketIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} fill="currentColor">
      <path d="M.778 1.212a.768.768 0 00-.768.892l2.17 13.177a1.043 1.043 0 001.026.885h9.79a.768.768 0 00.763-.652L15.99 2.104a.768.768 0 00-.768-.892H.778zm8.663 9.481H6.56L5.83 6.229h4.488l-.877 4.464z" />
    </svg>
  );
}

export function GitGenericIcon({ className = "", size = 16 }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} className={className} fill="currentColor">
      <path d="M15.698 7.287L8.712.302a1.03 1.03 0 00-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 011.55 1.56l1.773 1.774a1.224 1.224 0 11-.733.684L8.535 5.91v4.246a1.226 1.226 0 11-1.008-.036V5.843a1.226 1.226 0 01-.665-1.607L5.05 2.425.302 7.173a1.03 1.03 0 000 1.457l6.986 6.986a1.03 1.03 0 001.457 0l6.953-6.953a1.031 1.031 0 000-1.376z" />
    </svg>
  );
}

export function getProviderFromUrl(url: string): { name: string; icon: typeof GitHubIcon; color: string } {
  if (url.includes("github.com") || url.includes("github")) {
    return { name: "GitHub", icon: GitHubIcon, color: "text-zinc-300" };
  }
  if (url.includes("gitlab.com") || url.includes("gitlab")) {
    return { name: "GitLab", icon: GitLabIcon, color: "text-orange-400" };
  }
  if (url.includes("bitbucket.org") || url.includes("bitbucket")) {
    return { name: "Bitbucket", icon: BitbucketIcon, color: "text-blue-400" };
  }
  return { name: "Git", icon: GitGenericIcon, color: "text-red-400" };
}
