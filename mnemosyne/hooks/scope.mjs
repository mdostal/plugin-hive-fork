export function resolveRepoScope(repoScope = null) {
  const raw =
    repoScope ??
    process.env.HIVE_MEMORY_SCOPE ??
    process.env.SWARM_MEMORY_SCOPE ??
    process.env.GITHUB_REPOSITORY ??
    '';
  return String(raw).trim();
}
