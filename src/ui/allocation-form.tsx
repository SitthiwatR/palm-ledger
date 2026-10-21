"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, message, RequestError } from "./api";
import type { Payable } from "./payables";

type Garden = { id: string; name: string; archived: boolean };
const money = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
export function AllocationForm({
  entry,
  gardens,
  onClose,
  onSaved,
  onRefresh,
}: {
  entry: Payable;
  gardens: Garden[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entry.allocations.map((a) => [
        a.gardenId,
        (a.amountMinor / 100).toFixed(2),
      ]),
    ),
  );
  const [version, setVersion] = useState(entry.allocationVersion);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null),
    failure = useRef<HTMLParagraphElement>(null),
    lock = useRef(false),
    request = useRef({ body: "", key: "" });
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  useEffect(() => {
    if (error && !busy) failure.current?.focus();
  }, [error, busy]);
  const available = gardens.filter(
    (g) => !g.archived || entry.allocations.some((a) => a.gardenId === g.id),
  );
  let total = 0n,
    valid = true;
  for (const value of Object.values(amounts)) {
    if (!value) continue;
    if (!/^\d{1,11}(?:\.\d{1,2})?$/.test(value)) {
      valid = false;
      continue;
    }
    const [whole, fraction = ""] = value.split(".");
    total += BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const allocations = available
      .filter((g) => amounts[g.id] && Number(amounts[g.id]) > 0)
      .map((g) => ({ gardenId: g.id, amountBaht: amounts[g.id] }));
    if (
      !valid ||
      (allocations.length > 0 && total !== BigInt(entry.amountMinor))
    ) {
      setError(
        "ยอดแบ่งต้องเท่ากับยอดเต็ม หรือเว้นว่างทั้งหมดเพื่อเก็บเป็นส่วนกลาง",
      );
      return;
    }
    const payload = { expectedVersion: version, allocations };
    const body = JSON.stringify(payload);
    if (body !== request.current.body)
      request.current = { body, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        `expenses/${entry.id}/allocations`,
        "PUT",
        payload,
        request.current.key,
      );
      onClose();
      await onSaved();
    } catch (e) {
      setError(message(e));
      setStale(e instanceof RequestError && e.info.code === "STALE_VERSION");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="garden-dialog debt-dialog"
      aria-labelledby="allocation-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="allocation-title">แบ่งรายจ่ายส่วนกลางเข้าสวน</h2>
        <button
          className="icon-button"
          aria-label="ปิดฟอร์ม"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p>
        {entry.payee} · ยอดเต็ม {money(entry.amountMinor)} บาท · จ่ายแล้ว{" "}
        {money(entry.paidMinor)} บาท
      </p>
      <p className="section-note">
        แบ่งยอดต้นทุนเต็มให้ครบ ประวัติการจ่ายและรูปยังอยู่ที่รายการเดิม
        ยอดจ่ายของแต่ละสวนคำนวณตามสัดส่วนโดยรักษาเศษสตางค์ให้รวมตรง
      </p>
      <form className="stack" onSubmit={save} aria-busy={busy}>
        <fieldset className="stack debt-fields" disabled={busy || stale}>
          {available.map((g) => (
            <label key={g.id}>
              แบ่งให้ {g.name}
              {g.archived ? " (เก็บเป็นประวัติ)" : ""} (บาท)
              <input
                inputMode="decimal"
                pattern="[0-9]{1,11}(\.[0-9]{1,2})?"
                value={amounts[g.id] ?? ""}
                onChange={(e) =>
                  setAmounts({ ...amounts, [g.id]: e.target.value })
                }
              />
            </label>
          ))}
          <p role="status">
            ยอดแบ่ง {valid ? money(Number(total)) : "—"} /{" "}
            {money(entry.amountMinor)} บาท
          </p>
          <p className="section-note">
            สวนที่ไม่แบ่งให้เว้นว่างหรือใส่ 0
            เว้นว่างทั้งหมดเพื่อเก็บยอดเต็มไว้ที่ส่วนกลาง
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setAmounts({})}
          >
            เก็บทั้งหมดเป็นส่วนกลาง
          </button>
        </fieldset>
        {error && (
          <p ref={failure} role="alert" tabIndex={-1} className="error">
            {error}
          </p>
        )}
        {stale && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onRefresh();
                const data = await api("payables");
                const latest: Payable | undefined = data.payables.find(
                  (e: Payable) => e.id === entry.id,
                );
                if (latest) {
                  setAmounts(
                    Object.fromEntries(
                      latest.allocations.map((a) => [
                        a.gardenId,
                        (a.amountMinor / 100).toFixed(2),
                      ]),
                    ),
                  );
                  setVersion(latest.allocationVersion);
                  setStale(false);
                  setError("");
                }
              } catch (problem) {
                setError(message(problem));
              } finally {
                setBusy(false);
              }
            }}
          >
            โหลดชุดแบ่งล่าสุด
          </button>
        )}
        <button className="primary" disabled={busy || stale}>
          {busy ? "กำลังบันทึก…" : "ยืนยันชุดแบ่ง"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onClose}
        >
          ยกเลิก
        </button>
      </form>
    </dialog>
  );
}
