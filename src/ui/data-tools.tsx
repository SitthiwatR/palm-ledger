"use client";
import Link from "next/link";
import { AutomaticBackupStatus } from "./automatic-backup-status";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@supabase/supabase-js";
import { api, message, RequestError } from "./api";
type Row = Record<string, any>;
const money = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
function Summary({ value }: { value: Row }) {
  return (
    <div className="transfer-summary">
      <p>
        สวน {value.gardens} · รายการ {value.records} · ประวัติจ่าย{" "}
        {value.payments} · รูป {value.photos}
      </p>
      <p>
        สุทธิ {money(value.netMinor)} บาท · ค้างปัจจุบัน{" "}
        {money(value.pendingMinor)} บาท
      </p>
      {value.gardenTotals?.map((g: Row) => (
        <p key={g.id}>
          {g.name}: สุทธิ {money(g.netMinor)} บาท
        </p>
      ))}
    </div>
  );
}
export function DataTools() {
  const [jobs, setJobs] = useState<Row[]>([]),
    [password, setPassword] = useState(""),
    [repeat, setRepeat] = useState(""),
    [backup, setBackup] = useState<Row | null>(null),
    [file, setFile] = useState<File | null>(null),
    [kind, setKind] = useState("prototype"),
    [restorePassword, setRestorePassword] = useState(""),
    [preview, setPreview] = useState<Row | null>(null),
    [confirmed, setConfirmed] = useState<Row | null>(null),
    [ack, setAck] = useState(false),
    [demoAck, setDemoAck] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const lock = useRef(false),
    failure = useRef<HTMLParagraphElement>(null),
    backupKey = useRef<{ body: string; key: string } | null>(null),
    upload = useRef<{
      file: File;
      kind: string;
      key: string;
      id?: string;
    } | null>(null),
    confirmKey = useRef<{ body: string; key: string } | null>(null);
  async function refresh() {
    const r = await api("backups");
    setJobs(r.jobs);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    if (error && !busy) failure.current?.focus();
  }, [error, busy]);
  async function createBackup(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    if (password !== repeat) {
      setError("รหัสชุดสำรองทั้งสองช่องไม่ตรงกัน");
      return;
    }
    lock.current = true;
    setBusy("backup");
    setError("");
    setStatus("กำลังอ่าน snapshot และตรวจรูปทุกไฟล์…");
    try {
      const body = { passphrase: password },
        serialized = JSON.stringify(body);
      if (backupKey.current?.body !== serialized)
        backupKey.current = { body: serialized, key: crypto.randomUUID() };
      let result = await api("backups", "POST", body, backupKey.current.key);
      for (let i = 0; result.status === "processing" && i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        result = await api("backups/" + result.id);
        if (result.status === "failed")
          throw new RequestError(
            {
              code: "BACKUP_FAILED",
              message: "สร้างชุดสำรองไม่สำเร็จ กรุณาลองอีกครั้ง",
            },
            503,
          );
      }
      if (result.status !== "ready")
        throw new RequestError(
          {
            code: "BACKUP_PENDING",
            message:
              "ชุดสำรองยังทำงานอยู่ ตรวจสถานะอีกครั้งหรือกดลองใหม่ด้วยรหัสเดิม",
          },
          503,
        );
      setBackup(result);
      setPassword("");
      setRepeat("");
      backupKey.current = null;
      setStatus(
        "สำรองและตรวจ checksum ครบแล้ว กรุณาดาวน์โหลดไฟล์ไปเก็บแยกจากระบบ",
      );
      await refresh();
    } catch (e) {
      setError(message(e));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function download(id: string) {
    try {
      setError("");
      const r = await api("backups/" + id);
      if (!r.url) throw new Error("Not ready");
      const a = document.createElement("a");
      a.href = r.url;
      a.rel = "noopener noreferrer";
      a.download = "palm-ledger.palmbackup";
      a.click();
    } catch (e) {
      setError(message(e));
    }
  }
  function choose(f: File | null, nextKind = kind) {
    setFile(f);
    setPreview(null);
    setConfirmed(null);
    setAck(false);
    setDemoAck(false);
    setError("");
    upload.current = f
      ? { file: f, kind: nextKind, key: crypto.randomUUID() }
      : null;
    confirmKey.current = null;
  }
  async function inspect(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !file) return;
    lock.current = true;
    setBusy("preview");
    setError("");
    setStatus("กำลังอัปโหลดและตรวจข้อมูล/รูปก่อนแสดงตัวอย่าง…");
    try {
      if (
        !upload.current ||
        upload.current.file !== file ||
        upload.current.kind !== kind
      )
        upload.current = { file, kind, key: crypto.randomUUID() };
      const task = upload.current;
      {
        const prepared = await api(
          "recoveries/upload-url",
          "POST",
          { kind, sizeBytes: file.size },
          task.key,
        );
        task.id = prepared.id;
        if (prepared.path) {
          const storage = createClient(prepared.supabaseUrl, prepared.anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          await storage.storage
            .from(prepared.bucket)
            .uploadToSignedUrl(prepared.path, prepared.token, file, {
              contentType:
                kind === "prototype"
                  ? "application/json"
                  : "application/octet-stream",
            });
        }
      }
      const result = await api(
        `recoveries/${task.id}/preview`,
        "POST",
        kind === "restore" ? { passphrase: restorePassword } : {},
      );
      setPreview(result);
      setConfirmed(null);
      setAck(false);
      setDemoAck(false);
      setStatus("ตรวจตัวอย่างครบแล้ว ยังไม่เปลี่ยนข้อมูลที่ใช้งาน");
    } catch (e) {
      setPreview(null);
      setError(message(e));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !preview) return;
    lock.current = true;
    setBusy("confirm");
    setError("");
    setStatus(
      kind === "prototype"
        ? "กำลังนำเข้าใน transaction และตรวจยอดหลังบันทึก…"
        : "กำลังยืนยันชุดสำหรับกู้คืนในระบบใหม่…",
    );
    try {
      const body = {
          previewHash: preview.previewHash,
          acknowledge: true,
          allowDemo: demoAck,
          ...(kind === "restore" ? { passphrase: restorePassword } : {}),
        },
        serialized = JSON.stringify(body);
      if (confirmKey.current?.body !== serialized)
        confirmKey.current = { body: serialized, key: crypto.randomUUID() };
      const r = await api(
        `recoveries/${preview.id}/confirm`,
        "POST",
        body,
        confirmKey.current.key,
      );
      setConfirmed(r);
      setRestorePassword("");
      setStatus(
        kind === "prototype"
          ? "นำเข้าแล้ว ยอดและรูปตรงตัวอย่าง เก็บประวัติข้อมูลเดิมไว้ครบ"
          : "ยืนยันชุดสำหรับกู้คืนแล้ว พร้อมให้ผู้ดูแลกู้ในระบบใหม่และตรวจบัญชีก่อนสลับเว็บ ข้อมูลปัจจุบันยังอยู่",
      );
      await refresh();
    } catch (e) {
      setError(message(e));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy("");
    }
  }
  return (
    <main className="shell app-main data-tools">
      <header className="page-top">
        <Link className="secondary" href="/gardens">
          กลับหน้าสวน
        </Link>
        <h1>สำรอง กู้คืน และย้ายข้อมูล</h1>
      </header>
      {error && (
        <p className="error" role="alert" tabIndex={-1} ref={failure}>
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <AutomaticBackupStatus />
      <section>
        <h2>สำรองข้อมูลพร้อมรูป</h2>
        <p>
          รวมสวน รายการ ประวัติการจ่าย audit รูปต้นฉบับ
          และบัญชีสำหรับกู้คืนเป็นไฟล์เข้ารหัส ไม่รวม credentials ของระบบ
          เก็บรหัสชุดสำรองแยกจากไฟล์ หากลืมรหัสจะเปิดไฟล์ไม่ได้
        </p>
        <form className="stack" onSubmit={createBackup}>
          <fieldset disabled={!!busy} className="stack debt-fields">
            <label>
              รหัสชุดสำรอง
              <input
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                required
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              ยืนยันรหัสชุดสำรอง
              <input
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={repeat}
                required
                onChange={(e) => setRepeat(e.target.value)}
              />
            </label>
            <button className="primary">
              {busy === "backup"
                ? "กำลังสร้างชุดสำรอง…"
                : "สร้างชุดสำรองรวมรูป"}
            </button>
          </fieldset>
        </form>
        {backup && (
          <>
            <Summary value={backup.summary} />
            <button
              className="secondary"
              onClick={() => void download(backup.id)}
            >
              ดาวน์โหลดชุดสำรองที่ตรวจแล้ว
            </button>
          </>
        )}
        <p>
          ดาวน์โหลดชุดสำรองได้ภายใน 7 วัน กรุณาดาวน์โหลดเก็บนอกระบบหลัก
          ขนาดชุดสูงสุด 40 MiB/1,000 รูป ตรวจสถานะสำรองอัตโนมัติแยกด้านบน
        </p>
      </section>
      <section>
        <h2>ตรวจชุดกู้คืน / ย้าย JSON ต้นแบบ</h2>
        <p>
          กู้คืนเต็มชุดไปยังระบบใหม่ที่ว่างก่อนตรวจยอด รูป และการเข้าสู่บัญชี
          แล้วผู้ดูแลจึงสลับใช้งาน ส่วน JSON
          ต้นแบบจะเพิ่มข้อมูลหลังยืนยันโดยเก็บข้อมูลที่มีอยู่
          ไม่แทนที่ข้อมูลปัจจุบัน
        </p>
        <form className="stack" onSubmit={inspect}>
          <fieldset disabled={!!busy} className="stack debt-fields">
            <label>
              ชนิดไฟล์
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  choose(null, e.target.value);
                  setRestorePassword("");
                }}
              >
                <option value="prototype">JSON ต้นแบบ version 1</option>
                <option value="restore">ชุดสำรองเข้ารหัส .palmbackup</option>
              </select>
            </label>
            <label>
              เลือกไฟล์
              <input
                key={kind}
                type="file"
                accept={
                  kind === "prototype"
                    ? ".json,application/json"
                    : ".palmbackup,application/octet-stream"
                }
                required
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
              />
            </label>
            {kind === "restore" && (
              <label>
                รหัสเปิดชุดสำรอง
                <input
                  type="password"
                  minLength={12}
                  maxLength={256}
                  autoComplete="off"
                  required
                  value={restorePassword}
                  onChange={(e) => {
                    setRestorePassword(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
            )}
            <button className="primary">
              {busy === "preview"
                ? "กำลังตรวจข้อมูล…"
                : "ตรวจตัวอย่างก่อนยืนยัน"}
            </button>
          </fieldset>
        </form>
        {preview && !confirmed && (
          <form className="stack transfer-preview" onSubmit={confirm}>
            <h3>ตัวอย่างที่ตรวจแล้ว</h3>
            <Summary value={preview.summary} />
            {preview.summary.demo !== undefined && (
              <strong>
                {preview.summary.demo
                  ? "ต้นแบบระบุ: ข้อมูลตัวอย่าง"
                  : "ต้นแบบระบุ: ข้อมูลจริง"}
              </strong>
            )}
            {preview.summary.gardenNames?.length > 0 && (
              <p>สวนที่จะเพิ่ม: {preview.summary.gardenNames.join(" / ")}</p>
            )}
            {preview.summary.before && (
              <>
                <p>
                  ก่อนนำเข้า: สุทธิ {money(preview.summary.before.netMinor)} ·
                  ค้าง {money(preview.summary.before.pendingMinor)} บาท
                </p>
                <p>
                  หลังนำเข้า: สุทธิ {money(preview.summary.after.netMinor)} ·
                  ค้าง {money(preview.summary.after.pendingMinor)} บาท
                </p>
              </>
            )}
            {preview.summary.warnings?.length > 0 && (
              <details>
                <summary>
                  ข้อควรตรวจ ({preview.summary.warnings.length})
                </summary>
                {preview.summary.warnings.map((w: string, i: number) => (
                  <p key={i}>{w}</p>
                ))}
              </details>
            )}
            <fieldset className="stack debt-fields" disabled={!!busy}>
              <label className="check">
                <input
                  type="checkbox"
                  required
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />
                {kind === "prototype"
                  ? "ตรวจสวน ยอดก่อน/หลัง และรูปแล้ว ยืนยันเพิ่มข้อมูลชุดนี้"
                  : "ตรวจยอดและรูปแล้ว ยืนยันเตรียมชุดนี้สำหรับกู้คืนในระบบใหม่"}
              </label>
              {preview.summary.demo && (
                <label className="check">
                  <input
                    type="checkbox"
                    required
                    checked={demoAck}
                    onChange={(e) => setDemoAck(e.target.checked)}
                  />
                  ทราบว่าเป็นข้อมูลตัวอย่างและตั้งใจนำเข้าชุดตัวอย่างนี้
                </label>
              )}
              <button className="primary">
                {busy === "confirm"
                  ? "กำลังตรวจและบันทึก…"
                  : kind === "prototype"
                    ? "ยืนยันนำเข้า JSON"
                    : "ยืนยันชุดสำหรับกู้คืน"}
              </button>
            </fieldset>
          </form>
        )}
        {confirmed && (
          <div className="transfer-summary">
            <p>
              {confirmed.status === "imported"
                ? "นำเข้าเสร็จแล้ว"
                : "ชุดสำรองตรวจครบและพร้อมกู้ในระบบใหม่ ยังไม่สลับข้อมูลปัจจุบัน"}
            </p>
            {confirmed.status !== "imported" && (
              <button
                className="secondary"
                onClick={() => void download(confirmed.id)}
              >
                ดาวน์โหลดชุดสำหรับกู้ในระบบใหม่
              </button>
            )}
            <Link href="/records">เปิดตรวจรายการ</Link>
          </div>
        )}
      </section>
      <section>
        <h2>ชุดข้อมูลล่าสุด</h2>
        {jobs.length ? (
          jobs.map((j) => (
            <article className="debt-row" key={j.id}>
              <p>
                {j.kind === "backup"
                  ? "สำรอง"
                  : j.kind === "prototype"
                    ? "ต้นแบบ"
                    : "กู้คืน"}{" "}
                · {new Date(j.created_at).toLocaleString("th-TH")} ·{" "}
                {
                  (
                    {
                      ready: "พร้อม",
                      confirmed: "ยืนยันแล้ว",
                      failed: "ไม่สำเร็จ",
                      processing: "กำลังทำงาน",
                      pending: "รออัปโหลด",
                    } as Record<string, string>
                  )[j.status]
                }
              </p>
              {["ready", "confirmed"].includes(j.status) && (
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void download(j.id)}
                >
                  ดาวน์โหลดชุด {new Date(j.created_at).toLocaleString("th-TH")}
                </button>
              )}
            </article>
          ))
        ) : (
          <p>ยังไม่มีชุดสำรองหรือชุดนำเข้า</p>
        )}
      </section>
    </main>
  );
}
