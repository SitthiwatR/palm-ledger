import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import type { Artifact, Offsite } from "../src/server/recovery/automatic";
// Real filesystem IO for the isolated offsite boundary; no GitHub credentials or
// production destinations enter these fault-injection integration tests.
export class TestOffsite implements Offsite {
  repository = "fixture/private-backups";
  objects: Artifact[] = [];
  directory = "";
  corruptDownload = false;
  failUpload = false;
  publicRepository = false;
  async init() {
    this.directory = await mkdtemp(join(tmpdir(), "palm-offsite-test-"));
    return this;
  }
  async assertPrivate() {
    if (this.publicRepository) throw new Error("public destination");
  }
  async list() {
    return [...this.objects];
  }
  async upload(name: string, path: string) {
    if (this.failUpload) throw new Error("offsite unavailable");
    if (this.objects.some((a) => a.name === name))
      throw new Error("immutable artifact already exists");
    const bytes = await readFile(path),
      id = String(this.objects.length + 1);
    await mkdir(join(this.directory, id));
    await writeFile(join(this.directory, id, basename(path)), bytes, {
      mode: 0o600,
    });
    this.objects.push({
      id,
      name,
      size: bytes.length,
      expired: false,
      runId: "9001",
    });
    return id;
  }
  async download(id: string, path: string) {
    const bytes = await readFile(join(this.directory, id, "backup.palmbackup"));
    if (this.corruptDownload) bytes[bytes.length - 1] ^= 1;
    await mkdir(path, { recursive: true });
    const result = join(path, "backup.palmbackup");
    await writeFile(result, bytes, { mode: 0o600 });
    return result;
  }
}
