"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AllocationForm } from "./allocation-form";
import { api, message } from "./api";

export type Payable = {
  id: string;
  source: "expenses" | "sale-labor" | "opening-debts";
  gardenId: string | null;
  gardenName: string;
  businessDate: string;
  kind: string;
  payee: string;
  note: string;
  invoiceNumber: string | null;
  amountMinor: number;
  paidMinor: number;
  pendingMinor: number;
  allocationVersion: number;
  allocations: {
    gardenId: string;
    gardenName: string;
    amountMinor: number;
    paidMinor: number;
    pendingMinor: number;
  }[];
  payments: Payment[];
};
type Payment = {
  legacyDateUnknown?: boolean;
  id: string;
  paymentDate: string;
  amountMinor: number;
  voidedAt: string | null;
  voidReason: string | null;
};
type Garden = { id: string; name: string; archived: boolean };
type Action =
  | { kind: "opening" }
  | { kind: "pay"; entry: Payable }
  | { kind: "void"; entry: Payable; payment: Payment };
const money = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
const dateText = (v: string) =>
  new Date(v + "T00:00:00").toLocaleDateString("th-TH");
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const category = (e: Payable) =>
  e.source === "opening-debts"
    ? "หนี้ก่อนเริ่มระบบ"
    : e.source === "sale-labor"
      ? `ค่าแรงผูกบิล ${e.invoiceNumber}`
      : e.kind === "weight_labor"
        ? "ค่าแรงทีมแยกบิล"
        : "รายจ่าย";

export function Payables({
  entries,
  gardens,
  onSaved,
  onRefresh,
}: {
  onRefresh: () => Promise<void>;
  entries: Payable[];
  gardens: Garden[];
  onSaved: () => Promise<void>;
}) {
  const [payee, setPayee] = useState("");
  const [gardenId, setGardenId] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [allocation, setAllocation] = useState<Payable | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);
  const creditors = [...new Set(entries.map((e) => e.payee))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );
  const filtered = entries.filter(
    (e) =>
      (!payee || e.payee === payee) &&
      matchesGarden(e) &&
      (!pendingOnly || selectedPending(e) > 0),
  );
  function selectedPending(e: Payable) {
    return !gardenId
      ? e.pendingMinor
      : gardenId === "shared"
        ? e.gardenId === null && !e.allocations.length
          ? e.pendingMinor
          : 0
        : e.gardenId === gardenId
          ? e.pendingMinor
          : (e.allocations.find((a) => a.gardenId === gardenId)?.pendingMinor ??
            0);
  }
  function matchesGarden(e: Payable) {
    return (
      !gardenId ||
      (gardenId === "shared"
        ? e.gardenId === null && !e.allocations.length
        : e.gardenId === gardenId ||
          e.allocations.some((a) => a.gardenId === gardenId))
    );
  }
  function open(value: Action) {
    trigger.current = document.activeElement as HTMLElement;
    setAction(value);
  }
  function close() {
    setAction(null);
    setTimeout(
      () =>
        (trigger.current?.isConnected
          ? trigger.current
          : panel.current
        )?.focus(),
      0,
    );
  }
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="payables"
      aria-label="หนี้และประวัติการจ่าย"
    >
      <div className="section-heading records-heading">
        <h2>หนี้และการจ่าย</h2>
        <button
          className="secondary"
          disabled={!gardens.some((g) => !g.archived)}
          onClick={() => open({ kind: "opening" })}
        >
          เพิ่มหนี้ก่อนเริ่มระบบ
        </button>
      </div>
      <p className="section-note">
        บันทึกการจ่ายเมื่อสะดวก ยอดสุทธิรับรู้ต้นทุนไปแล้ว
        การจ่ายเปลี่ยนเฉพาะยอดค้าง
      </p>
      <div className="debt-filters">
        <label>
          คน / ทีม / ร้าน
          <select value={payee} onChange={(e) => setPayee(e.target.value)}>
            <option value="">ทั้งหมด</option>
            {creditors.map((c) => (
              <option key={c} value={c}>
                {c} · ค้าง{" "}
                {money(
                  entries
                    .filter((e) => e.payee === c && matchesGarden(e))
                    .reduce((sum, e) => sum + selectedPending(e), 0),
                )}{" "}
                บาท
              </option>
            ))}
          </select>
        </label>
        <label>
          สวนของหนี้
          <select
            value={gardenId}
            onChange={(e) => setGardenId(e.target.value)}
          >
            <option value="">ทุกสวนและส่วนกลาง</option>
            <option value="shared">ส่วนกลางที่ยังไม่แบ่ง</option>
            {gardens.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
          />
          เฉพาะที่ยังค้าง
        </label>
      </div>
      <p role="status">
        ค้างปัจจุบันตามที่เลือก{" "}
        {money(filtered.reduce((sum, e) => sum + selectedPending(e), 0))} บาท
      </p>
      <div className="sale-list">
        {!filtered.length && <p className="empty">ไม่มีหนี้ตามที่เลือก</p>}
        {filtered.map((e) => (
          <article className="debt-row" key={e.source + e.id}>
            <strong>
              {e.payee} · {category(e)}
            </strong>
            <p>
              {e.gardenName} · {dateText(e.businessDate)}
              {e.note && ` · ${e.note}`}
            </p>
            <p>
              ยอดเต็ม {money(e.amountMinor)} · จ่ายแล้ว {money(e.paidMinor)} ·
              ค้าง {money(e.pendingMinor)} บาท
            </p>
            {e.pendingMinor > 0 && (
              <button
                className="secondary"
                onClick={() => open({ kind: "pay", entry: e })}
              >
                บันทึกจ่ายให้ {e.payee}
              </button>
            )}
            {e.source === "expenses" && e.gardenId === null && (
              <>
                <button
                  className="secondary"
                  onClick={() => {
                    trigger.current = document.activeElement as HTMLElement;
                    setAllocation(e);
                  }}
                >
                  แบ่งเข้าสวน / แก้ชุดแบ่ง
                </button>
                {e.allocations.length > 0 ? (
                  <div className="allocation-history">
                    <p>
                      แบ่งต้นทุนจากรายการนี้ · ยอดจ่ายด้านล่างคำนวณตามสัดส่วน
                    </p>
                    {e.allocations.map((a) => (
                      <p key={a.gardenId}>
                        {a.gardenName} · ต้นทุน {money(a.amountMinor)} ·
                        จ่ายตามสัดส่วน {money(a.paidMinor)} · ค้าง{" "}
                        {money(a.pendingMinor)} บาท
                      </p>
                    ))}
                  </div>
                ) : (
                  <p>ส่วนกลางที่ยังไม่แบ่งเข้าสวน</p>
                )}
              </>
            )}
            <details>
              <summary>ประวัติการจ่าย ({e.payments.length})</summary>
              {!e.payments.length && <p>ยังไม่มีการจ่าย</p>}
              {e.payments.map((p) => (
                <div className="payment-history" key={p.id}>
                  <p>
                    {p.legacyDateUnknown
                      ? "ยอดจ่ายสะสมเดิม (ไม่ทราบวันจ่าย)"
                      : dateText(p.paymentDate)}{" "}
                    · {money(p.amountMinor)} บาท ·{" "}
                    {p.voidedAt ? "ยกเลิกแล้ว" : "มีผล"}
                  </p>
                  {p.voidedAt ? (
                    <p>
                      เหตุผล: {p.voidReason} · ยกเลิกเมื่อ{" "}
                      {new Date(p.voidedAt).toLocaleString("th-TH")}
                    </p>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() =>
                        open({ kind: "void", entry: e, payment: p })
                      }
                    >
                      ยกเลิกการจ่าย {money(p.amountMinor)} บาท
                    </button>
                  )}
                </div>
              ))}
            </details>
          </article>
        ))}
      </div>
      {allocation && (
        <AllocationForm
          entry={allocation}
          gardens={gardens}
          onRefresh={onRefresh}
          onSaved={onSaved}
          onClose={() => {
            setAllocation(null);
            setTimeout(() => trigger.current?.focus(), 0);
          }}
        />
      )}
      {action && (
        <DebtDialog
          action={action}
          gardens={gardens}
          onClose={close}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
function DebtDialog({
  action,
  gardens,
  onClose,
  onSaved,
}: {
  action: Action;
  gardens: Garden[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    failure = useRef<HTMLParagraphElement>(null),
    lock = useRef(false),
    request = useRef({ body: "", key: "" });
  const [gardenId, setGardenId] = useState(
    gardens.find((g) => !g.archived)?.id ?? "",
  );
  const [date, setDate] = useState(today),
    [payee, setPayee] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
  }, []);
  useEffect(() => {
    if (error && !busy) failure.current?.focus();
  }, [error, busy]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const payload =
      action.kind === "opening"
        ? { gardenId, debtDate: date, payee, amountBaht: amount, note }
        : action.kind === "pay"
          ? { paymentDate: date, amountBaht: amount }
          : { reason: note };
    const path =
      action.kind === "opening"
        ? "opening-debts"
        : action.kind === "pay"
          ? `${action.entry.source}/${action.entry.id}/payments`
          : `payments/${action.payment.id}/void`;
    const serialized = JSON.stringify(payload);
    if (request.current.body !== serialized)
      request.current = { body: serialized, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api(path, "POST", payload, request.current.key);
      onClose();
      await onSaved();
    } catch (problem) {
      setError(message(problem));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const title =
    action.kind === "opening"
      ? "เพิ่มหนี้ก่อนเริ่มระบบ"
      : action.kind === "pay"
        ? "บันทึกการจ่าย"
        : "ยกเลิกการจ่ายผิด";
  return (
    <dialog
      ref={dialog}
      className="garden-dialog debt-dialog"
      aria-labelledby="debt-dialog-title"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="debt-dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="ปิดฟอร์ม"
          disabled={busy}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <form className="stack" onSubmit={submit} aria-busy={busy}>
        <fieldset className="stack debt-fields" disabled={busy}>
          {action.kind === "opening" ? (
            <>
              <p>
                หนี้นี้เกิดก่อนยอดสุทธิยกมา
                จึงติดตามเฉพาะค้างและไม่หักสุทธิอีกครั้ง
              </p>
              <label>
                สวน
                <select
                  data-initial-focus
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
                เจ้าหนี้ / คน / ทีม / ร้าน
                <input
                  required
                  maxLength={120}
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                />
              </label>
            </>
          ) : (
            <p>
              {action.entry.payee} · {action.entry.gardenName} ·{" "}
              {category(action.entry)}
              <br />
              ค้างปัจจุบัน {money(action.entry.pendingMinor)} บาท
            </p>
          )}
          {action.kind !== "void" ? (
            <>
              <label>
                {action.kind === "opening"
                  ? "วันที่ตั้งหนี้เดิม"
                  : "วันที่จ่าย"}
                <input
                  data-initial-focus={action.kind === "pay" ? "" : undefined}
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                {action.kind === "opening"
                  ? "หนี้ค้างเดิม (บาท)"
                  : "ยอดจ่าย (บาท)"}
                <input
                  inputMode="decimal"
                  required
                  pattern="[0-9]{1,11}(\.[0-9]{1,2})?"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </>
          ) : (
            <p>
              ยกเลิกยอด {money(action.payment.amountMinor)} บาท วันที่{" "}
              {action.payment.legacyDateUnknown
                ? "ยอดจ่ายสะสมเดิม (ไม่ทราบวันที่จ่าย)"
                : dateText(action.payment.paymentDate)}{" "}
              จะคืนยอดค้างเป็น{" "}
              {money(action.entry.pendingMinor + action.payment.amountMinor)}{" "}
              บาท และเก็บประวัติเดิมไว้ นี่เป็นการแก้บันทึก
              ไม่ได้โอนหรือคืนเงินจริง
            </p>
          )}
          {action.kind !== "pay" && (
            <label>
              {action.kind === "void" ? "เหตุผลที่ยกเลิก" : "หมายเหตุ"}
              <textarea
                data-initial-focus={action.kind === "void" ? "" : undefined}
                required={action.kind === "void"}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p className="error" role="alert" ref={failure} tabIndex={-1}>
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "กำลังบันทึก…"
              : action.kind === "void"
                ? "ยืนยันยกเลิกการจ่าย"
                : action.kind === "opening"
                  ? "บันทึกหนี้เดิม"
                  : "บันทึกการจ่าย"}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            ปิด
          </button>
        </fieldset>
      </form>
    </dialog>
  );
}
