import { DefaultArtifactClient } from "@actions/artifact";
import { dirname, join } from "node:path";
import type { Artifact, Offsite } from "../src/server/recovery/automatic";
import { RETENTION_DAYS } from "../src/server/recovery/automatic";

export class GithubBackupStore implements Offsite {
  private client = new DefaultArtifactClient();
  private digests = new Map<string, string>();
  constructor(
    public repository: string,
    private token: string,
  ) {
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !token ||
      process.env.GITHUB_REPOSITORY !== repository
    )
      throw new Error("Run only inside the selected private backup repository");
  }
  private async request(path: string) {
    const response = await fetch(
      `https://api.github.com/repos/${this.repository}${path}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok) throw new Error("GitHub backup access failed");
    return response.json();
  }
  async assertPrivate() {
    const repo = await this.request("");
    if (
      repo.private !== true ||
      repo.full_name?.toLowerCase() !== this.repository.toLowerCase()
    )
      throw new Error("Backup repository must be private");
  }
  async list(): Promise<Artifact[]> {
    const result: Artifact[] = [];
    for (let page = 1; page <= 50; page++) {
      const data = await this.request(
        `/actions/artifacts?per_page=100&page=${page}`,
      );
      if (!Array.isArray(data.artifacts))
        throw new Error("Invalid artifact inventory");
      for (const a of data.artifacts) {
        if (!Number.isSafeInteger(a.size_in_bytes) || a.size_in_bytes < 0)
          throw new Error("Invalid artifact size");
        result.push({
          id: String(a.id),
          name: a.name,
          size: a.size_in_bytes,
          expired: a.expired === true,
          runId: String(a.workflow_run?.id ?? ""),
        });
      }
      if (data.artifacts.length < 100) return result;
    }
    throw new Error("Artifact inventory too large for the free storage budget");
  }
  async upload(name: string, path: string) {
    const result = await this.client.uploadArtifact(
      name,
      [path],
      dirname(path),
      { retentionDays: RETENTION_DAYS, compressionLevel: 0 },
    );
    if (!result.id || !Number.isSafeInteger(result.id))
      throw new Error("Artifact upload was not confirmed");
    const id = String(result.id);
    if (result.digest) this.digests.set(id, result.digest);
    const metadata = await this.request(`/actions/artifacts/${id}`);
    if (
      metadata.expired ||
      Date.parse(metadata.expires_at) - Date.parse(metadata.created_at) <
        (RETENTION_DAYS * 24 - 1) * 3600000
    )
      throw new Error("Repository retention is shorter than seven days");
    return id;
  }
  async download(id: string, path: string) {
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new Error("Invalid artifact ID");
    const result = await this.client.downloadArtifact(Number(id), {
      path,
      expectedHash: this.digests.get(id),
    });
    if (result.digestMismatch || !result.downloadPath)
      throw new Error("Artifact download failed integrity verification");
    return join(result.downloadPath, "backup.palmbackup");
  }
}
