"use client";
import { useEffect, useState } from "react";
import { api, message } from "./api";
type Status = {
  state: "not-configured" | "failed" | "stale" | "healthy";
  lastSuccess: null | {
    snapshot_at: string;
    completed_at: string;
    destination_repository: string;
  };
  latest: null | { status: string; started_at: string };
};
const time = (value: string) =>
  new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
export function AutomaticBackupStatus() {
  const [data, setData] = useState<Status | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      setData(await api("backups/automatic-status"));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section
      className="automatic-backup"
      aria-labelledby="automatic-backup-title"
    >
      <h2 id="automatic-backup-title">สำรองอัตโนมัติรายวัน</h2>
      {error && (
        <p className="error" role="alert">
          ตรวจสถานะไม่สำเร็จ: {error}
        </p>
      )}
      {data && (
        <>
          <p>
            {data.state === "not-configured"
              ? "ยังไม่ได้เชื่อมตัวรันสำรองส่วนตัว"
              : data.state === "failed"
                ? "งานสำรองล่าสุดไม่สำเร็จ กรุณาให้ผู้ดูแลตรวจ"
                : data.state === "stale"
                  ? "ยังไม่มีจุดสำรองอัตโนมัติภายใน 24 ชั่วโมง"
                  : "มีจุดสำรองอัตโนมัติที่ยืนยันแล้วภายใน 24 ชั่วโมง"}
          </p>
          {data.lastSuccess ? (
            <>
              <p>จุดข้อมูลล่าสุด: {time(data.lastSuccess.snapshot_at)}</p>
              <p>ตรวจสำเร็จ: {time(data.lastSuccess.completed_at)}</p>
            </>
          ) : (
            <p>ยังไม่มีการสำรองอัตโนมัติที่ยืนยันสำเร็จ</p>
          )}
          {data.latest?.status === "running" && (
            <p>เริ่มงานล่าสุด: {time(data.latest.started_at)}</p>
          )}
        </>
      )}
      {!data && !error && <p>กำลังตรวจสถานะสำรอง…</p>}
      <p>
        สำรองรวมฐาน บัญชี และรูปต้นฉบับแบบเข้ารหัส เก็บนอก Supabase
        ในพื้นที่ส่วนตัว 7 วัน การกดสำรองเองไม่นับเป็นงานอัตโนมัติ
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void refresh()}
      >
        ตรวจสถานะอีกครั้ง
      </button>
    </section>
  );
}
