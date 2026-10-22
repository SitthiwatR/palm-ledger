"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { api, message, RequestError } from "./api";
import { calculateExpense } from "../lib/expense-math";
import { calculateLabor, calculateSale } from "../lib/sale-math";
import { expenseKinds } from "../lib/expense-math";

type Garden = {
  id: string;
  name: string;
  archived: boolean;
  openingMinor: number;
};
type Row = Record<string, any>;
const names: Record<string, string> = {
  sales: "ขายผลผลิต",
  expenses: "รายจ่าย",
  "sale-labor": "ค่าแรงผูกบิล",
  "opening-debts": "หนี้ก่อนเริ่มระบบ",
};
const money = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n / 100);
const baht = (n: unknown) => (Number(n) / 100).toFixed(2);
const kinds: Record<string, string> = {
  sale: "ขายผลผลิต",
  daily: "ค่าแรงรายวันผูกบิล",
  weight: "ค่าแรงทีมผูกบิล",
  ...expenseKinds,
  opening_debt: "หนี้ก่อนเริ่มระบบ",
};
function editValues(d: Row) {
  const r = d.record;
  return {
    gardenId: r.garden_id ?? "",
    date: r.date,
    payee: r.buyer ?? r.payee,
    note: r.note ?? "",
    invoiceNumber: r.invoice_number ?? "",
    weightKg: String(Number(r.net_weight_grams) / 1000),
    priceBahtPerKg: baht(r.price_minor_per_kg),
    deductions: d.deductions.map((a: Row) => ({
      description: a.description,
      amountBaht: baht(a.amount_minor),
    })),
    kind: r.kind ?? "other",
    unit: r.unit ?? "item",
    quantity: String(
      Number(r.quantity_milli ?? r.basis_units) /
        (r.quantity_milli !== undefined ? 1000 : r.mode === "daily" ? 2 : 1000),
    ),
    rateBaht: baht(r.rate_minor),
    mode: r.mode ?? "daily",
    amountBaht: baht(r.amount_minor),
    allocations: d.allocations.map((a: Row) => ({
      gardenId: a.garden_id,
      amountBaht: baht(a.amount_minor),
    })),
  };
}
function auditChanges(before: Row, after: Row, gardens: Garden[]) {
  const gardenName = (id: string | null) =>
    gardens.find((g) => g.id === id)?.name ?? "ส่วนกลาง";
  const date = (value: unknown) => String(value ?? "").split("T")[0];
  const parts = (items: Row[] | undefined) =>
    (items ?? [])
      .map(
        (a) =>
          `${gardenName(a.gardenId ?? a.garden_id)} ${money(a.amountBaht !== undefined ? Math.round(Number(a.amountBaht) * 100) : Number(a.amount_minor))} บาท`,
      )
      .sort()
      .join(" / ") || "ไม่แบ่ง";
  const deductions = (items: Row[] | undefined) =>
    (items ?? [])
      .map(
        (a) =>
          `${a.description} ${money(a.amountBaht !== undefined ? Math.round(Number(a.amountBaht) * 100) : Number(a.amount_minor))} บาท`,
      )
      .sort()
      .join(" / ") || "ไม่มีรายการหัก";
  const fields: [string, (r: Row) => string][] = [
    ["สวน", (r) => gardenName(r.garden_id)],
    [
      "วันที่",
      (r) => date(r.sale_date ?? r.expense_date ?? r.labor_date ?? r.debt_date),
    ],
    ["ผู้ซื้อ/ผู้รับเงิน", (r) => r.buyer ?? r.payee ?? ""],
    ["เลขบิล", (r) => r.invoice_number ?? ""],
    ["หมายเหตุ", (r) => r.note || "ไม่มี"],
    ["ชนิด", (r) => kinds[r.kind ?? r.mode] ?? "ขายผลผลิต"],
    [
      "น้ำหนักขาย",
      (r) =>
        r.net_weight_grams === undefined
          ? ""
          : `${Number(r.net_weight_grams) / 1000} กก.`,
    ],
    [
      "ราคาขาย",
      (r) =>
        r.price_minor_per_kg === undefined
          ? ""
          : `${money(Number(r.price_minor_per_kg))} บาท/กก.`,
    ],
    [
      "จำนวนคิดต้นทุน",
      (r) =>
        r.quantity_milli !== undefined
          ? String(Number(r.quantity_milli) / 1000)
          : r.basis_units !== undefined
            ? String(Number(r.basis_units) / (r.mode === "daily" ? 2 : 1000))
            : "",
    ],
    [
      "อัตรา",
      (r) =>
        r.rate_minor === undefined ? "" : `${money(Number(r.rate_minor))} บาท`,
    ],
    ["ชุดแบ่ง", (r) => parts(r.allocations)],
    ["รายการหัก", (r) => deductions(r.deductions)],
  ];
  return fields.flatMap(([label, value]) =>
    value(before) !== value(after)
      ? [`${label}: ${value(before)} → ${value(after)}`]
      : [],
  );
}
function EntryDialog({
  source,
  id,
  gardens,
  onClose,
  onSaved,
  onRelated,
}: {
  source: string;
  id: string;
  gardens: Garden[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onRelated: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    failure = useRef<HTMLParagraphElement>(null),
    lock = useRef(false),
    retry = useRef<{
      body: unknown;
      key: string;
      path: string;
      method: string;
    } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState(false),
    [duplicateAck, setDuplicateAck] = useState(false);
  const [data, setData] = useState<Row | null>(null),
    [form, setForm] = useState<Row>({}),
    [mode, setMode] = useState<"view" | "edit" | "void">("view"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false),
    [reason, setReason] = useState(""),
    [laborAck, setLaborAck] = useState(false),
    [paymentAck, setPaymentAck] = useState(false),
    [clearAck, setClearAck] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const d = await api(`entries/${source}/${id}`);
      setData(d);
      setForm(editValues(d));
      setStale(false);
      setReason("");
      setLaborAck(false);
      setPaymentAck(false);
      setClearAck(false);
      setDuplicateWarning(false);
      setDuplicateAck(false);
      retry.current = null;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [source, id]);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    void load();
  }, [load]);
  useEffect(() => {
    if (mode !== "view")
      dialog.current
        ?.querySelector<HTMLInputElement>("input,select,textarea")
        ?.focus();
  }, [mode]);
  useEffect(() => {
    if (error && !busy) failure.current?.focus();
  }, [error, busy]);
  function field(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === "invoiceNumber" || key === "gardenId") setDuplicateAck(false);
    retry.current = null;
  }
  let preview: number | null = null;
  if (data)
    try {
      preview =
        source === "sales"
          ? calculateSale(
              form.weightKg,
              form.priceBahtPerKg,
              form.deductions.map((a: Row) => a.amountBaht),
            ).netMinor
          : source === "opening-debts"
            ? Number(form.amountBaht) * 100
            : source === "sale-labor"
              ? calculateLabor({
                  mode: form.mode,
                  payee: form.payee,
                  quantity: form.quantity,
                  rateBaht: form.rateBaht,
                }).amountMinor
              : calculateExpense({
                  gardenId: form.gardenId || null,
                  expenseDate: form.date,
                  kind: form.kind,
                  unit:
                    form.kind === "daily_labor"
                      ? "day"
                      : form.kind === "weight_labor"
                        ? "kg"
                        : form.kind === "fertilizer"
                          ? "sack"
                          : "item",
                  payee: form.payee,
                  note: form.note,
                  quantity: form.quantity,
                  rateBaht: form.rateBaht,
                  paymentStatus: "unpaid",
                  paidBaht: "0",
                  rememberRate: false,
                }).amountMinor;
      if (preview === null || !Number.isSafeInteger(preview) || preview <= 0)
        preview = null;
    } catch {
      preview = null;
    }
  const r = data?.record,
    active = data?.payments.filter((p: Row) => !p.voided_at) ?? [];
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let payload: Row = {
        expectedVersion: r.version,
        reason,
        acknowledgeLabor: laborAck,
        laborVersions: data.labor.map((l: Row) => ({
          id: l.id,
          version: l.version,
        })),
      };
      if (mode === "void")
        payload = {
          ...payload,
          acknowledgePayments: paymentAck,
          activePaymentIds: active.map((p: Row) => p.id),
        };
      else {
        const common = {
          gardenId: form.gardenId || null,
          date: form.date,
          payee: form.payee,
          note: form.note,
        };
        if (source === "sales")
          payload = {
            ...payload,
            ...common,
            invoiceNumber: form.invoiceNumber,
            weightKg: form.weightKg,
            priceBahtPerKg: form.priceBahtPerKg,
            deductions: form.deductions,
            receivedFull: true,
            confirmDuplicate: duplicateAck,
          };
        else {
          payload = { expectedVersion: r.version, reason, ...common };
          if (source === "expenses") {
            if (form.gardenId && data.allocations.length && !clearAck)
              throw new RequestError(
                {
                  code: "ALLOCATION_REVIEW",
                  message: "กรุณายืนยันยกเลิกชุดแบ่งก่อนย้ายเข้าสวนโดยตรง",
                },
                422,
              );
            payload = {
              ...payload,
              kind: form.kind,
              unit:
                form.kind === "daily_labor"
                  ? "day"
                  : form.kind === "weight_labor"
                    ? "kg"
                    : form.kind === "fertilizer"
                      ? "sack"
                      : "item",
              quantity: form.quantity,
              rateBaht: form.rateBaht,
              allocations: form.gardenId ? [] : form.allocations,
            };
          } else if (source === "sale-labor")
            payload = {
              ...payload,
              mode: form.mode,
              quantity: form.quantity,
              rateBaht: form.rateBaht,
            };
          else payload = { ...payload, amountBaht: form.amountBaht };
        }
      }
      const path = `entries/${source}/${id}${mode === "void" ? "/void" : ""}`,
        method = mode === "void" ? "POST" : "PATCH";
      const fingerprint = JSON.stringify(payload);
      if (
        !retry.current ||
        JSON.stringify(retry.current.body) !== fingerprint ||
        retry.current.path !== path
      )
        retry.current = {
          body: payload,
          key: crypto.randomUUID(),
          path,
          method,
        };
      await api(path, method, retry.current.body, retry.current.key);
      await onSaved();
      onClose();
    } catch (e) {
      setError(message(e));
      if (e instanceof RequestError && e.info.code === "DUPLICATE_BILL")
        setDuplicateWarning(true);
      if (
        e instanceof RequestError &&
        [
          "STALE_VERSION",
          "LABOR_REVIEW_REQUIRED",
          "PAYMENT_REVIEW_REQUIRED",
        ].includes(e.info.code)
      )
        setStale(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function photo(id: string) {
    try {
      const p = await api(`receipts/${id}`);
      window.open(p.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setError(message(e));
    }
  }
  const text = (key: string, label: string, type = "text", required = true) => (
    <label key={key}>
      {label}
      <input
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => field(key, e.target.value)}
        required={required}
        maxLength={type === "text" ? 2000 : undefined}
        step={type === "number" ? "any" : undefined}
      />
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="garden-dialog debt-dialog entry-dialog"
      aria-labelledby="entry-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form className="stack" onSubmit={submit}>
        <div className="dialog-heading">
          <h2 id="entry-title">
            {mode === "edit"
              ? "แก้ไข"
              : mode === "void"
                ? "ยกเลิก"
                : "รายละเอียด"}
            {names[source]}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label="ปิดรายละเอียด"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {error && (
          <p ref={failure} tabIndex={-1} role="alert" className="error">
            {error}
          </p>
        )}
        {stale && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void load()}
          >
            โหลดข้อมูลล่าสุด (แทนค่าที่กำลังแก้)
          </button>
        )}
        {!data ? (
          <p role="status">{busy ? "กำลังโหลด…" : "โหลดข้อมูลไม่สำเร็จ"}</p>
        ) : (
          <>
            <p>
              {r.date} · {names[source]} · เวอร์ชัน {r.version}
              {r.voided_at ? " · ยกเลิกแล้ว" : ""}
            </p>
            <p>
              ยอดเต็ม {money(Number(r.net_minor ?? r.amount_minor))} บาท ·
              จ่ายแล้ว {money(data.paidMinor)} · ค้างปัจจุบัน{" "}
              {money(data.pendingMinor)}
            </p>
            {r.voided_at && <p>เหตุผลยกเลิก: {r.void_reason}</p>}
            <fieldset disabled={busy} className="stack debt-fields">
              {mode === "edit" ? (
                <>
                  <label>
                    สวน
                    <select
                      value={form.gardenId}
                      onChange={(e) => field("gardenId", e.target.value)}
                    >
                      {source === "expenses" && (
                        <option value="">ส่วนกลาง</option>
                      )}
                      {gardens
                        .filter(
                          (g) =>
                            !g.archived ||
                            g.id === r.garden_id ||
                            data.allocations.some(
                              (a: Row) => a.garden_id === g.id,
                            ),
                        )
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                            {g.archived ? " (ประวัติ)" : ""}
                          </option>
                        ))}
                    </select>
                  </label>
                  {text("date", "วันที่รายการ", "date")}
                  {text("payee", source === "sales" ? "ผู้ซื้อ" : "ผู้รับเงิน")}
                  <label>
                    หมายเหตุ
                    <textarea
                      value={form.note}
                      maxLength={2000}
                      onChange={(e) => field("note", e.target.value)}
                    />
                  </label>
                  {source === "sales" ? (
                    <>
                      {text("invoiceNumber", "เลขบิล")}
                      {duplicateWarning && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={duplicateAck}
                            onChange={(e) => setDuplicateAck(e.target.checked)}
                          />
                          ตรวจแล้วและยืนยันใช้เลขบิลซ้ำในสวนนี้
                        </label>
                      )}
                      {text("weightKg", "น้ำหนักขาย (กก.)", "number")}
                      {text("priceBahtPerKg", "ราคาขาย (บาท/กก.)", "number")}
                      <h3>รายการหักจากบิล</h3>
                      {form.deductions.map((a: Row, i: number) => (
                        <div className="entry-part" key={i}>
                          <label>
                            รายละเอียดหัก {i + 1}
                            <input
                              value={a.description}
                              required
                              maxLength={120}
                              onChange={(e) =>
                                field(
                                  "deductions",
                                  form.deductions.map((d: Row, j: number) =>
                                    j === i
                                      ? { ...d, description: e.target.value }
                                      : d,
                                  ),
                                )
                              }
                            />
                          </label>
                          <label>
                            ยอดหัก {i + 1} (บาท)
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={a.amountBaht}
                              required
                              onChange={(e) =>
                                field(
                                  "deductions",
                                  form.deductions.map((d: Row, j: number) =>
                                    j === i
                                      ? { ...d, amountBaht: e.target.value }
                                      : d,
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            className="secondary"
                            type="button"
                            onClick={() =>
                              field(
                                "deductions",
                                form.deductions.filter(
                                  (_: unknown, j: number) => j !== i,
                                ),
                              )
                            }
                          >
                            ลบรายการหัก {i + 1}
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="secondary"
                        disabled={form.deductions.length >= 40}
                        onClick={() =>
                          field("deductions", [
                            ...form.deductions,
                            { description: "", amountBaht: "" },
                          ])
                        }
                      >
                        เพิ่มรายการหัก
                      </button>
                      <p>
                        ยอดขายยังถือว่าได้รับเต็มตามบิล
                        การแก้ครั้งนี้ไม่เปลี่ยนรูปต้นฉบับ
                      </p>
                    </>
                  ) : source === "opening-debts" ? (
                    text("amountBaht", "ยอดหนี้เดิม (บาท)", "number")
                  ) : (
                    <>
                      {source === "expenses" ? (
                        <label>
                          ชนิดรายจ่าย
                          <select
                            value={form.kind}
                            onChange={(e) => field("kind", e.target.value)}
                          >
                            {Object.entries(expenseKinds).map(([v, n]) => (
                              <option key={v} value={v}>
                                {n}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <label>
                          วิธีคิดค่าแรง
                          <select
                            value={form.mode}
                            onChange={(e) => field("mode", e.target.value)}
                          >
                            <option value="daily">รายวัน</option>
                            <option value="weight">ตามผลผลิต</option>
                          </select>
                        </label>
                      )}
                      {text(
                        "quantity",
                        source === "sale-labor"
                          ? form.mode === "daily"
                            ? "จำนวนวัน"
                            : "น้ำหนักคิดค่าแรง (กก.)"
                          : form.kind === "daily_labor"
                            ? "จำนวนวัน"
                            : form.kind === "weight_labor"
                              ? "น้ำหนักคิดค่าแรง (กก.)"
                              : form.kind === "fertilizer"
                                ? "จำนวนกระสอบ"
                                : "จำนวน",
                        "number",
                      )}
                      {text(
                        "rateBaht",
                        source === "sale-labor"
                          ? form.mode === "weight"
                            ? "อัตรา (บาท/ตัน)"
                            : "อัตรา (บาท/วัน)"
                          : form.kind === "weight_labor"
                            ? "อัตรา (บาท/ตัน)"
                            : form.kind === "daily_labor"
                              ? "อัตรา (บาท/วัน)"
                              : form.kind === "fertilizer"
                                ? "อัตรา (บาท/กระสอบ)"
                                : "อัตราต่อหน่วย (บาท)",
                        "number",
                      )}
                      <p>
                        คำนวณยอดใหม่จากจำนวนและอัตรา ไม่เปลี่ยนอัตราที่จำไว้
                        ยอดใหม่ต้องไม่น้อยกว่ายอดจ่ายที่มีผล
                      </p>
                    </>
                  )}
                  {source === "expenses" && (
                    <>
                      <h3>ชุดแบ่งต้นทุน</h3>
                      {form.gardenId ? (
                        <>
                          {data.allocations.length > 0 && (
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={clearAck}
                                onChange={(e) => setClearAck(e.target.checked)}
                                required
                              />
                              ยกเลิกชุดแบ่งเดิมและนับต้นทุนเต็มเข้าสวนที่เลือก
                            </label>
                          )}
                        </>
                      ) : (
                        <>
                          <p>
                            แบ่งให้ครบยอดใหม่
                            หรือเอาทุกรายการออกเพื่อคงเป็นส่วนกลาง
                          </p>
                          {form.allocations.map((a: Row, i: number) => (
                            <div className="entry-part" key={i}>
                              <label>
                                สวนที่แบ่ง {i + 1}
                                <select
                                  value={a.gardenId}
                                  onChange={(e) =>
                                    field(
                                      "allocations",
                                      form.allocations.map(
                                        (a: Row, j: number) =>
                                          j === i
                                            ? { ...a, gardenId: e.target.value }
                                            : a,
                                      ),
                                    )
                                  }
                                >
                                  {gardens
                                    .filter(
                                      (g) =>
                                        !g.archived ||
                                        data.allocations.some(
                                          (a: Row) => a.garden_id === g.id,
                                        ),
                                    )
                                    .map((g) => (
                                      <option key={g.id} value={g.id}>
                                        {g.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                              <label>
                                ยอดแบ่ง {i + 1} (บาท)
                                <input
                                  type="number"
                                  min="0.01"
                                  step="0.01"
                                  value={a.amountBaht}
                                  required
                                  onChange={(e) =>
                                    field(
                                      "allocations",
                                      form.allocations.map(
                                        (a: Row, j: number) =>
                                          j === i
                                            ? {
                                                ...a,
                                                amountBaht: e.target.value,
                                              }
                                            : a,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  field(
                                    "allocations",
                                    form.allocations.filter(
                                      (_: unknown, j: number) => j !== i,
                                    ),
                                  )
                                }
                              >
                                เอาส่วนแบ่ง {i + 1} ออก
                              </button>
                            </div>
                          ))}
                          <button
                            className="secondary"
                            type="button"
                            disabled={
                              !gardens.some((g) => !g.archived) ||
                              form.allocations.length >= 200
                            }
                            onClick={() =>
                              field("allocations", [
                                ...form.allocations,
                                {
                                  gardenId: gardens.find((g) => !g.archived)
                                    ?.id,
                                  amountBaht: "",
                                },
                              ])
                            }
                          >
                            เพิ่มสวนในชุดแบ่ง
                          </button>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <p>
                    สวน:{" "}
                    {gardens.find((g) => g.id === r.garden_id)?.name ??
                      "ส่วนกลาง"}
                  </p>
                  <p>
                    {r.buyer ?? r.payee}
                    {r.invoice_number ? ` · บิล ${r.invoice_number}` : ""}
                  </p>
                  {r.note && <p>{r.note}</p>}
                  {(source === "expenses" || source === "sale-labor") && (
                    <p>
                      {source === "sale-labor"
                        ? Number(r.basis_units) /
                          (r.mode === "daily" ? 2 : 1000)
                        : Number(r.quantity_milli) / 1000}{" "}
                      {source === "sale-labor"
                        ? r.mode === "daily"
                          ? "วัน"
                          : "กก."
                        : (
                            {
                              day: "วัน",
                              kg: "กก.",
                              sack: "กระสอบ",
                              item: "รายการ",
                            } as Record<string, string>
                          )[r.unit]}{" "}
                      · อัตรา {baht(r.rate_minor)}{" "}
                      {source === "sale-labor"
                        ? r.mode === "daily"
                          ? "บาท/วัน"
                          : "บาท/ตัน"
                        : r.kind === "weight_labor"
                          ? "บาท/ตัน"
                          : r.kind === "daily_labor"
                            ? "บาท/วัน"
                            : r.kind === "fertilizer"
                              ? "บาท/กระสอบ"
                              : "บาท/รายการ"}
                    </p>
                  )}
                  {source === "sales" && (
                    <p>
                      น้ำหนัก {Number(r.net_weight_grams) / 1000} กก. ×{" "}
                      {baht(r.price_minor_per_kg)} บาท/กก.
                      {data.deductions
                        .map(
                          (d: Row) =>
                            ` · หัก ${d.description} ${baht(d.amount_minor)} บาท`,
                        )
                        .join("")}
                    </p>
                  )}
                  {data.allocations.map((a: Row) => (
                    <p key={a.garden_id}>
                      {a.garden_name}: {money(Number(a.amount_minor))} บาท
                    </p>
                  ))}
                </>
              )}
              {data.labor.length > 0 && (
                <section
                  className="entry-impact"
                  aria-label="ค่าแรงที่เกี่ยวข้อง"
                >
                  <h3>ค่าแรงที่เกี่ยวข้อง — ตรวจแยกจากบิล</h3>
                  <p>
                    การแก้หรือยกเลิกบิลเปลี่ยนเฉพาะรายได้ ค่าแรง สวน วันที่
                    และประวัติจ่ายด้านล่างคงเดิม
                    เปิดแต่ละรายการเพื่อแก้หรือยกเลิกแยกได้
                  </p>
                  {data.labor.map((l: Row) => (
                    <div key={l.id}>
                      <p>
                        {l.payee} · {l.garden_name} · {l.date} ·{" "}
                        {money(Number(l.amount_minor))} บาท · จ่าย{" "}
                        {money(Number(l.paid_minor))}
                        {l.voided_at ? " · ยกเลิกแล้ว" : ""}
                      </p>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => onRelated(l.id)}
                      >
                        เปิดค่าแรง {l.payee}
                      </button>
                    </div>
                  ))}
                  {mode !== "view" && (
                    <label className="check">
                      <input
                        type="checkbox"
                        required
                        checked={laborAck}
                        onChange={(e) => setLaborAck(e.target.checked)}
                      />
                      ตรวจค่าแรงทั้งหมดแล้ว เข้าใจว่าค่าแรงไม่เปลี่ยนตามบิล
                    </label>
                  )}
                </section>
              )}
              {data.payments.length > 0 && (
                <section aria-label="ประวัติการจ่าย">
                  <h3>ประวัติการจ่าย</h3>
                  {data.payments.map((p: Row) => (
                    <p key={p.id}>
                      {p.payment_date} · {money(Number(p.amount_minor))} บาท ·{" "}
                      {p.voided_at ? `ยกเลิก: ${p.void_reason}` : "มีผล"}
                    </p>
                  ))}
                </section>
              )}
              {mode === "void" && (
                <section className="entry-impact">
                  <h3>ผลของการยกเลิก</h3>
                  <p>
                    {source === "sales"
                      ? `รายได้สุทธิลด ${money(Number(r.net_minor))} บาท ค่าแรงที่เกี่ยวข้องไม่เปลี่ยน`
                      : source === "opening-debts"
                        ? "ยอดสุทธิไม่เปลี่ยน หนี้รายการนี้ออกจากยอดค้าง"
                        : `ยกเลิกต้นทุน ${money(Number(r.amount_minor))} บาท ยอดสุทธิเพิ่ม ${money(Number(r.amount_minor))} บาท ชุดแบ่งเดิมอยู่เป็นประวัติและไม่นับยอด`}
                  </p>
                  <p>
                    รายการและรูปยังเปิดดูเป็นประวัติได้ ไม่ลบข้อมูล
                    ไม่จำลองการคืนหรือโอนเงินจริง
                  </p>
                  {data.payments.length > 0 && (
                    <>
                      <p>
                        การจ่ายที่ยังมีผล {active.length} ครั้ง รวม{" "}
                        {money(data.paidMinor)}{" "}
                        บาทจะถูกยกเลิกในประวัติพร้อมรายการต้นทาง
                        ค้างรายการนี้เป็น 0
                      </p>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={paymentAck}
                          onChange={(e) => setPaymentAck(e.target.checked)}
                          required
                        />
                        ตรวจประวัติและยืนยันยกเลิกการจ่ายที่มีผลพร้อมต้นทาง
                      </label>
                    </>
                  )}
                </section>
              )}
              {mode === "edit" && preview !== null && (
                <section className="entry-impact" aria-label="ผลกระทบการแก้ไข">
                  <p>
                    ยอดใหม่โดยประมาณ {money(preview)} บาท · ผลต่อสุทธิ{" "}
                    {money(
                      source === "opening-debts"
                        ? 0
                        : source === "sales"
                          ? preview - Number(r.net_minor)
                          : Number(r.amount_minor) - preview,
                    )}{" "}
                    บาท · ค้างใหม่{" "}
                    {money(
                      source === "sales"
                        ? 0
                        : Math.max(0, preview - data.paidMinor),
                    )}{" "}
                    บาท
                  </p>
                  <p>ระบบตรวจจำนวนและยอดจ่ายปัจจุบันอีกครั้งเมื่อบันทึก</p>
                </section>
              )}
              {mode !== "view" && (
                <>
                  <label>
                    เหตุผลที่{mode === "void" ? "ยกเลิก" : "แก้ไข"}
                    <textarea
                      required
                      maxLength={2000}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    className={mode === "void" ? "danger" : "primary"}
                    disabled={busy || stale}
                  >
                    {busy
                      ? "กำลังบันทึก…"
                      : mode === "void"
                        ? "ยืนยันยกเลิกรายการ"
                        : "บันทึกการแก้ไข"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setMode("view");
                      setError("");
                    }}
                  >
                    กลับรายละเอียด
                  </button>
                </>
              )}
              {mode === "view" && !r.voided_at && (
                <div className="actions">
                  <button
                    className="primary"
                    type="button"
                    onClick={() => setMode("edit")}
                  >
                    แก้ไขรายการ
                  </button>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => setMode("void")}
                  >
                    ยกเลิกรายการ
                  </button>
                </div>
              )}
              {mode === "view" &&
                data.receipts.map((p: Row) => (
                  <button
                    type="button"
                    className="secondary"
                    key={p.id}
                    onClick={() => void photo(p.id)}
                  >
                    เปิดรูปต้นฉบับ
                  </button>
                ))}
            </fieldset>
            <details>
              <summary>ประวัติการเปลี่ยนแปลง ({data.audit.length})</summary>
              {data.audit.map((a: Row, i: number) => (
                <div className="payment-history" key={i}>
                  <p>
                    {new Date(a.created_at).toLocaleString("th-TH")} ·{" "}
                    {(
                      {
                        "entry.edited": "แก้ไขรายการ",
                        "entry.voided": "ยกเลิกรายการ",
                        "payment.created": "บันทึกการจ่าย",
                        "payment.voided": "ยกเลิกการจ่าย",
                      } as Record<string, string>
                    )[a.action] ?? "บันทึกข้อมูล"}
                  </p>
                  {(a.after_data?.reason ?? a.after_data?.void_reason) && (
                    <p>
                      เหตุผล: {a.after_data.reason ?? a.after_data.void_reason}
                    </p>
                  )}
                  {a.action.startsWith("entry.") &&
                    auditChanges(a.before_data, a.after_data, gardens).map(
                      (change: string, j: number) => <p key={j}>{change}</p>,
                    )}
                  {a.action.startsWith("entry.") && (
                    <p>
                      ยอดก่อน{" "}
                      {money(
                        Number(
                          a.before_data.net_minor ?? a.before_data.amount_minor,
                        ),
                      )}{" "}
                      → ยอดหลัง{" "}
                      {money(
                        Number(
                          a.after_data.net_minor ?? a.after_data.amount_minor,
                        ),
                      )}{" "}
                      บาท
                    </p>
                  )}
                </div>
              ))}
            </details>
          </>
        )}
      </form>
    </dialog>
  );
}
export function Entries({
  gardens,
  onChanged,
}: {
  gardens: Garden[];
  onChanged: () => Promise<void>;
}) {
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<Row>({
      gardenId: "",
      from: "",
      to: "",
      source: "",
      kind: "",
      q: "",
      paymentStatus: "",
      status: "active",
    }),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<{ source: string; id: string } | null>(
      null,
    ),
    [revision, setRevision] = useState(0);
  const requestId = useRef(0),
    trigger = useRef<HTMLButtonElement | null>(null);
  const load = useCallback(async () => {
    const n = ++requestId.current;
    setBusy(true);
    setError("");
    try {
      const r = await api(`entries?${query}&page=${page}`);
      if (n === requestId.current) setData(r);
    } catch (e) {
      if (n === requestId.current) setError(message(e));
    } finally {
      if (n === requestId.current) setBusy(false);
    }
  }, [query, page]);
  useEffect(() => {
    void load();
    return () => {
      requestId.current++;
    };
  }, [load, revision]);
  function apply(e: FormEvent) {
    e.preventDefault();
    setPage(1);
    setQuery(
      new URLSearchParams(
        Object.entries(draft).filter(([, v]) => v),
      ).toString(),
    );
    setRevision((r) => r + 1);
  }
  async function download() {
    setError("");
    try {
      const res = await fetch(`/api/v1/entries/export?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) window.location.replace("/login");
        const result = await res.json();
        throw new RequestError(result.error, res.status);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "palm-ledger.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(message(e));
    }
  }
  const f = (key: string, value: string) =>
      setDraft((d) => ({ ...d, [key]: value })),
    report = data?.report;
  return (
    <section className="entries" aria-label="ค้นหารายการและรายงาน">
      <h2 ref={heading} tabIndex={-1}>
        ค้นหา แก้ไข และรายงาน
      </h2>
      {notice && <p role="status">{notice}</p>}
      <form className="entry-filters" onSubmit={apply}>
        <label>
          ค้นหาผู้ซื้อ ผู้รับเงิน เลขบิล หรือหมายเหตุ
          <input
            value={draft.q}
            maxLength={120}
            onChange={(e) => f("q", e.target.value)}
          />
        </label>
        <label>
          สวนที่รับต้นทุน
          <select
            value={draft.gardenId}
            onChange={(e) => f("gardenId", e.target.value)}
          >
            <option value="">ทุกสวนและส่วนกลาง</option>
            <option value="shared">ส่วนกลางที่ยังไม่แบ่ง</option>
            {gardens.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.archived ? " (ประวัติ)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          ตั้งแต่วันที่
          <input
            type="date"
            value={draft.from}
            onChange={(e) => f("from", e.target.value)}
          />
        </label>
        <label>
          ถึงวันที่
          <input
            type="date"
            value={draft.to}
            onChange={(e) => f("to", e.target.value)}
          />
        </label>
        <label>
          ประเภทรายการ
          <select
            value={draft.source}
            onChange={(e) => f("source", e.target.value)}
          >
            <option value="">ทุกประเภท</option>
            {Object.entries(names).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          ชนิดรายการ
          <select
            value={draft.kind}
            onChange={(e) => f("kind", e.target.value)}
          >
            <option value="">ทุกชนิด</option>
            {Object.entries(kinds).map(([v, n]) => (
              <option key={v} value={v}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          สถานะค้างจ่าย
          <select
            value={draft.paymentStatus}
            onChange={(e) => f("paymentStatus", e.target.value)}
          >
            <option value="">ทั้งหมด</option>
            <option value="pending">ยังค้างจ่ายปัจจุบัน</option>
            <option value="settled">จ่ายครบปัจจุบัน</option>
          </select>
        </label>
        <label>
          สถานะรายการ
          <select
            value={draft.status}
            onChange={(e) => f("status", e.target.value)}
          >
            <option value="active">ใช้งาน</option>
            <option value="all">รวมประวัติยกเลิก</option>
            <option value="voided">ยกเลิกแล้ว</option>
          </select>
        </label>
        <button className="primary" disabled={busy}>
          ใช้ตัวกรอง
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
          <button className="secondary" onClick={() => void load()}>
            ลองโหลดอีกครั้ง
          </button>
        </p>
      )}
      {busy && <p role="status">กำลังโหลดรายการและรายงาน…</p>}
      {!busy && data && !error && (
        <>
          <section className="entry-report" aria-label="รายงานตามตัวกรอง">
            <h3>รายงานตามตัวกรองที่ใช้ · {data.total} รายการ</h3>
            <p>
              รายได้ {money(report.incomeMinor)} − ต้นทุน{" "}
              {money(report.expenseMinor)} = ความเคลื่อนไหว{" "}
              {money(report.movementMinor)} บาท
            </p>
            <p>
              ยอดยกมาแยก {money(report.openingMinor)} บาท ·{" "}
              {report.includesOpening
                ? `สุทธิรวมยอดยกมา ${money(report.netMinor)} บาท`
                : "ตัวกรองนี้แสดงความเคลื่อนไหว ไม่บวกยอดยกมา"}
            </p>
            <p>
              ค้างปัจจุบันของรายการที่ตรงตัวกรอง {money(report.pendingMinor)}{" "}
              บาท (รวมการจ่ายภายหลัง ไม่ใช่ยอดค้าง ณ วันสิ้นช่วง)
              หนี้ก่อนเริ่มระบบไม่หักสุทธิซ้ำ
            </p>
            <p>
              รายได้และต้นทุนไม่นับรายการยกเลิก CSV
              ส่งออกรายการทุกหน้าที่ตรงตัวกรองที่ใช้
            </p>
            {report.gardens.map((g: Row) => (
              <p key={g.garden_id ?? "shared"}>
                {g.garden_name}: รายได้ {money(g.income_minor)} − ต้นทุน{" "}
                {money(g.expense_minor)} = {money(g.movement_minor)} บาท
                {report.includesOpening
                  ? ` · ยกมา ${money(g.opening_minor)} · สุทธิ ${money(g.net_minor)}`
                  : ""}{" "}
                · ค้างปัจจุบัน {money(g.pending_minor)}
              </p>
            ))}
            <button className="secondary" onClick={() => void download()}>
              ส่งออก CSV ตามตัวกรอง
            </button>
          </section>
          <div className="entry-list">
            {data.entries.map((r: Row) => (
              <article className="entry-row" key={r.source + r.id}>
                <div>
                  <strong>{r.payee}</strong>
                  <p>
                    {r.date} · {names[r.source]} · {kinds[r.kind]} · สวนต้นทาง{" "}
                    {r.garden_name}
                    {r.voided_at ? " · ยกเลิกแล้ว" : ""}
                  </p>
                  {r.invoice_number && <p>บิล {r.invoice_number}</p>}
                  <p>
                    ยอดตามตัวกรอง {money(Number(r.selected_amount_minor))} บาท
                    {Number(r.selected_amount_minor) !== Number(r.amount_minor)
                      ? ` (ยอดเต็มต้นทาง ${money(Number(r.amount_minor))})`
                      : ""}{" "}
                    · ค้างปัจจุบัน {money(Number(r.selected_pending_minor))}
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={(e) => {
                    trigger.current = e.currentTarget;
                    setSelected({ source: r.source, id: r.id });
                  }}
                >
                  รายละเอียด {r.payee}
                </button>
              </article>
            ))}
          </div>
          {!data.total && <p className="empty">ไม่พบรายการที่ตรงตัวกรอง</p>}
          <nav aria-label="หน้ารายการ" className="actions">
            <button
              className="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              หน้าก่อน
            </button>
            <span>
              หน้า {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
            </span>
            <button
              className="secondary"
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              หน้าถัดไป
            </button>
          </nav>
        </>
      )}
      {selected && (
        <EntryDialog
          key={selected.source + selected.id}
          {...selected}
          gardens={gardens}
          onClose={() => {
            setSelected(null);
            requestAnimationFrame(() =>
              (trigger.current?.isConnected
                ? trigger.current
                : heading.current
              )?.focus(),
            );
          }}
          onSaved={async () => {
            await onChanged();
            setNotice("บันทึกการเปลี่ยนแปลงแล้ว เก็บประวัติเดิมครบ");
            setRevision((r) => r + 1);
          }}
          onRelated={(id) => setSelected({ source: "sale-labor", id })}
        />
      )}
    </section>
  );
}
