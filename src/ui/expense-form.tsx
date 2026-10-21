"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, message } from "./api";
import {
  expenseKinds,
  calculateExpense,
  type ExpenseInput,
} from "../lib/expense-math";
import { receiptMime } from "./receipt-ocr";

type Garden = { id: string; name: string; archived: boolean };
type Profile = { mode: string; payee: string; rateBaht: string };
type Prepared = {
  id: string;
  path: string;
  token: string;
  bucket: string;
  supabaseUrl: string;
  anonKey: string;
};
export type Expense = {
  id: string;
  gardenName: string;
  expenseDate: string;
  kind: ExpenseInput["kind"];
  payee: string;
  note: string;
  unit: string;
  quantity: string;
  rateBaht: string;
  amountMinor: number;
  paidMinor: number;
  pendingMinor: number;
  receiptId: string | null;
  payments: {
    id: string;
    paymentDate: string;
    amountMinor: number;
    voidedAt: string | null;
    voidReason: string | null;
  }[];
};
const money = (minor: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function ExpenseForm({
  gardens,
  onSaved,
  onClose,
}: {
  gardens: Garden[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [gardenId, setGardenId] = useState(
    gardens.find((g) => !g.archived)?.id ?? "",
  );
  const [kind, setKind] = useState<ExpenseInput["kind"]>("other");
  const [date, setDate] = useState(today),
    [payee, setPayee] = useState(""),
    [note, setNote] = useState("");
  const [quantity, setQuantity] = useState("1"),
    [rate, setRate] = useState("");
  const [status, setStatus] = useState<ExpenseInput["paymentStatus"]>("unpaid"),
    [paid, setPaid] = useState(""),
    [paymentDate, setPaymentDate] = useState(today);
  const [remember, setRemember] = useState(true),
    [profiles, setProfiles] = useState<Profile[]>([]);
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    failure = useRef<HTMLParagraphElement>(null),
    lock = useRef(false);
  const rateEdited = useRef(false);
  const pending = useRef(""),
    prepared = useRef<Prepared | null>(null),
    uploadKey = useRef(""),
    saveKey = useRef({ body: "", key: "" });
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    api("sales/preferences")
      .then((data) => {
        if (active) setProfiles(data.profiles);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (error) failure.current?.focus();
  }, [error]);
  useEffect(() => {
    if (
      (kind !== "daily_labor" && kind !== "weight_labor") ||
      rateEdited.current
    )
      return;
    const profile = profiles.find(
      (p) =>
        p.mode === (kind === "weight_labor" ? "weight" : "daily") &&
        p.payee === payee,
    );
    if (profile) setRate(profile.rateBaht);
  }, [kind, payee, profiles]);
  const unit =
    kind === "daily_labor"
      ? "day"
      : kind === "weight_labor"
        ? "kg"
        : kind === "fertilizer"
          ? "sack"
          : "item";
  const input: ExpenseInput = {
    gardenId,
    expenseDate: date,
    kind,
    payee,
    note,
    unit,
    quantity,
    rateBaht: rate,
    paymentStatus: status,
    paidBaht: status === "partial" ? paid : "0",
    ...(status !== "unpaid" ? { paymentDate } : {}),
    rememberRate: remember,
  };
  let preview: ReturnType<typeof calculateExpense> | null = null;
  try {
    preview = calculateExpense(input);
  } catch {}
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      calculateExpense(input);
      if (file && !pending.current) {
        const mimeType = receiptMime(file);
        if (!mimeType || file.size < 1 || file.size > 10 * 1024 * 1024)
          throw new Error(
            "รองรับ JPEG, PNG, WebP, HEIC/HEIF ขนาดไม่เกิน 10 MB",
          );
        if (!uploadKey.current) uploadKey.current = crypto.randomUUID();
        if (!prepared.current)
          prepared.current = await api(
            "receipts/upload-url",
            "POST",
            { mimeType, sizeBytes: file.size },
            uploadKey.current,
          );
        const info = prepared.current!;
        const { createClient } = await import("@supabase/supabase-js");
        const client = createClient(info.supabaseUrl, info.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        await client.storage
          .from(info.bucket)
          .uploadToSignedUrl(info.path, info.token, file, {
            contentType: mimeType,
            upsert: false,
          });
        const verified = await api("receipts/verify", "POST", {
          pendingReceiptId: info.id,
        });
        pending.current = verified.id;
      }
      const payload = {
        ...input,
        ...(pending.current ? { pendingReceiptId: pending.current } : {}),
      };
      const body = JSON.stringify(payload);
      if (saveKey.current.body !== body)
        saveKey.current = { body, key: crypto.randomUUID() };
      await api("expenses", "POST", payload, saveKey.current.key);
      await onSaved();
      onClose();
    } catch (problem) {
      setError(
        problem instanceof Error && !("info" in problem)
          ? problem.message
          : message(problem),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="expense-dialog"
      aria-labelledby="expense-heading"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="expense-heading">บันทึกรายจ่าย</h2>
        <p>ค่าแรงที่ผูกบิลขายอยู่แล้ว ไม่ต้องลงซ้ำที่นี่</p>
        <fieldset disabled={busy} className="expense-fields">
          <div className="sale-field-grid">
            <label>
              สวนที่มีรายจ่าย
              <select
                autoFocus
                required
                value={gardenId}
                onChange={(e) => setGardenId(e.target.value)}
              >
                {gardens
                  .filter((g) => !g.archived)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              วันที่เกิดรายจ่าย
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              ชนิดรายจ่าย
              <select
                value={kind}
                onChange={(e) => {
                  rateEdited.current = false;
                  setKind(e.target.value as ExpenseInput["kind"]);
                  setQuantity("1");
                }}
              >
                {Object.entries(expenseKinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              ผู้รับเงิน
              <input
                required
                maxLength={120}
                list="expense-workers"
                value={payee}
                onChange={(e) => {
                  rateEdited.current = false;
                  setPayee(e.target.value);
                }}
              />
            </label>
            <datalist id="expense-workers">
              {profiles
                .filter(
                  (p) =>
                    p.mode === (kind === "weight_labor" ? "weight" : "daily"),
                )
                .map((p) => (
                  <option key={p.payee} value={p.payee} />
                ))}
            </datalist>
            <label>
              {kind === "daily_labor"
                ? "จำนวนวันทำงาน"
                : kind === "weight_labor"
                  ? "น้ำหนักคิดค่าแรง (กก.)"
                  : kind === "fertilizer"
                    ? "กระสอบที่ใช้จริง"
                    : "จำนวนรายการ"}
              <input
                required
                type="number"
                min={kind === "daily_labor" ? "0.5" : "0.001"}
                step={kind === "daily_labor" ? "0.5" : "0.001"}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label>
              {kind === "daily_labor"
                ? "ค่าแรงต่อวัน (บาท)"
                : kind === "weight_labor"
                  ? "บาทต่อตัน"
                  : kind === "fertilizer"
                    ? "ราคาต่อกระสอบ (บาท)"
                    : "ราคาต่อรายการ (บาท)"}
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={rate}
                onChange={(e) => {
                  rateEdited.current = true;
                  setRate(e.target.value);
                }}
              />
            </label>
          </div>
          {(kind === "daily_labor" || kind === "weight_labor") && (
            <label className="expense-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              จำอัตรานี้ไว้ใช้ครั้งถัดไป (เอาออกเพื่อเปลี่ยนเฉพาะรายการ)
            </label>
          )}
          {kind === "fertilizer" && (
            <p className="section-note">
              ลงเฉพาะปุ๋ยที่ใช้ในสวนแล้ว ไม่รวมที่ซื้อเก็บไว้และยังไม่ใช้
            </p>
          )}
          <label>
            หมายเหตุ
            <textarea
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label>
            รูปหลักฐานรายจ่าย (ไม่บังคับ)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                pending.current = "";
                prepared.current = null;
                uploadKey.current = "";
              }}
            />
          </label>
          <div className="sale-field-grid">
            <label>
              การจ่ายครั้งแรก
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as ExpenseInput["paymentStatus"])
                }
              >
                <option value="unpaid">ยังไม่จ่าย</option>
                <option value="partial">จ่ายบางส่วน</option>
                <option value="full">จ่ายครบ</option>
              </select>
            </label>
            {status === "partial" && (
              <label>
                ยอดจ่ายครั้งแรก (บาท)
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paid}
                  onChange={(e) => setPaid(e.target.value)}
                />
              </label>
            )}
            {status !== "unpaid" && (
              <label>
                วันที่จ่ายครั้งแรก
                <input
                  required
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="sale-calculation" aria-live="polite">
            {preview ? (
              <>
                <strong>รายจ่าย {money(preview.amountMinor)} บาท</strong>
                <span>
                  จ่ายแล้ว {money(preview.paidMinor)} · ค้างจ่าย{" "}
                  {money(preview.amountMinor - preview.paidMinor)} บาท
                </span>
              </>
            ) : (
              <span>กรอกจำนวน อัตรา และการจ่ายเพื่อตรวจยอด</span>
            )}
          </div>
        </fieldset>
        {error && (
          <p role="alert" tabIndex={-1} ref={failure} className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" disabled={busy || !gardenId}>
            {busy ? "กำลังบันทึก…" : "ยืนยันรายจ่าย"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            ยกเลิก
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function ExpenseList({
  expenses,
  onError,
}: {
  expenses: Expense[];
  onError: (error: string) => void;
}) {
  return (
    <section className="sale-list" aria-label="รายการรายจ่าย">
      {expenses.length === 0 ? (
        <p className="empty">ยังไม่มีรายจ่ายที่ลงแยกจากบิลขาย</p>
      ) : (
        expenses.map((e) => (
          <article className="sale-row expense-row" key={e.id}>
            <div>
              <strong>
                {expenseKinds[e.kind]} · {e.payee}
              </strong>
              <span>
                {e.gardenName} ·{" "}
                {new Date(e.expenseDate + "T00:00:00").toLocaleDateString(
                  "th-TH",
                )}
              </span>
              <small>
                {e.quantity}{" "}
                {e.unit === "day"
                  ? "วัน"
                  : e.unit === "kg"
                    ? "กก."
                    : e.unit === "sack"
                      ? "กระสอบ"
                      : "รายการ"}{" "}
                × {e.rateBaht} บาท/
                {e.unit === "kg"
                  ? "ตัน"
                  : e.unit === "day"
                    ? "วัน"
                    : e.unit === "sack"
                      ? "กระสอบ"
                      : "รายการ"}
              </small>
              {e.note && <small>{e.note}</small>}
              <small>
                จ่ายแล้ว {money(e.paidMinor)} บาท · ค้างจ่าย{" "}
                {money(e.pendingMinor)} บาท
              </small>
              {e.payments.map((p) => (
                <small key={p.id}>
                  จ่ายวันที่{" "}
                  {new Date(p.paymentDate + "T00:00:00").toLocaleDateString(
                    "th-TH",
                  )}{" "}
                  · {money(p.amountMinor)} บาท{" "}
                  {p.voidedAt ? `· ยกเลิกแล้ว: ${p.voidReason}` : ""}
                </small>
              ))}
            </div>
            <b>
              {money(e.amountMinor)}
              <small>บาท</small>
            </b>
            {e.receiptId && (
              <button
                className="secondary receipt-open"
                onClick={async () => {
                  const popup = window.open("about:blank", "_blank");
                  if (popup) popup.opener = null;
                  try {
                    const signed = await api("receipts/" + e.receiptId);
                    if (popup) popup.location.href = signed.url;
                    else onError("กรุณาอนุญาตป๊อปอัปเพื่อเปิดรูป");
                  } catch (problem) {
                    popup?.close();
                    onError(message(problem));
                  }
                }}
              >
                เปิดรูปหลักฐาน
              </button>
            )}
          </article>
        ))
      )}
    </section>
  );
}
