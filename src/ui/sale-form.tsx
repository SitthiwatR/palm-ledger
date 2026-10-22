"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, message, RequestError } from "./api";
import {
  calculateLabor,
  calculateSale,
  type LaborInput,
} from "../lib/sale-math";
import type { ReceiptDraft } from "../lib/receipt-parser";
import { prepareReceiptImage, receiptMime } from "./receipt-ocr";
import { ReceiptReader } from "./receipt-reader";

type GardenChoice = { id: string; name: string; archived: boolean };
type Profile = { mode: "daily" | "weight"; payee: string; rateBaht: string };
type Prepared = {
  id: string;
  path: string;
  token: string;
  bucket: string;
  supabaseUrl: string;
  anonKey: string;
};
const money = (minor: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const today = () => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((p) => p.type === type)!.value)
    .join("-");
};

export function SaleForm({
  gardens,
  onSaved,
}: {
  gardens: GardenChoice[];
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState<"upload" | "review" | "labor">("upload");
  const [gardenId, setGardenId] = useState(
    gardens.find((g) => !g.archived)?.id ?? "",
  );
  const [saleDate, setSaleDate] = useState(today),
    [buyer, setBuyer] = useState(""),
    [invoiceNumber, setInvoiceNumber] = useState("");
  const [weightKg, setWeightKg] = useState(""),
    [price, setPrice] = useState("");
  const [deductions, setDeductions] = useState<
    { description: string; amountBaht: string }[]
  >([]);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [previewImage, setPreviewImage] = useState<Blob | null>(null),
    [retryReading, setRetryReading] = useState(false);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null),
    [ocrNote, setOcrNote] = useState("");
  const [progress, setProgress] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [receivedFull, setReceivedFull] = useState(false);
  const [mode, setMode] = useState<"none" | "daily" | "weight">("none");
  const [laborRows, setLaborRows] = useState<LaborInput[]>([]),
    [profiles, setProfiles] = useState<Profile[]>([]);
  const prepared = useRef<Prepared | null>(null),
    pendingId = useRef("");
  const lock = useRef(false),
    touched = useRef(false),
    uploadController = useRef<AbortController | null>(null);
  const saleKey = useRef({ key: "", body: "" }),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    api("sales/preferences")
      .then((data) => {
        if (!active) return;
        setProfiles(data.profiles);
        if (touched.current) return;
        if (gardens.some((g) => g.id === data.gardenId && !g.archived))
          setGardenId(data.gardenId);
        setBuyer(data.buyer ?? "");
        if (data.lastLabor.length) {
          setMode(data.lastLabor[0].mode);
          setLaborRows(data.lastLabor);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      uploadController.current?.abort();
    };
  }, [gardens]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (step !== "upload") heading.current?.focus();
  }, [step]);

  async function uploadOriginal(selected: File, signal: AbortSignal) {
    if (pendingId.current) return;
    const mimeType = receiptMime(selected);
    if (selected.size < 1 || selected.size > 10 * 1024 * 1024)
      throw new Error("รูปบิลต้องมีขนาดไม่เกิน 10 MB");
    if (!mimeType) throw new Error("รองรับรูป JPEG, PNG, WebP, HEIC และ HEIF");
    if (!prepared.current)
      prepared.current = await api(
        "receipts/upload-url",
        "POST",
        { mimeType, sizeBytes: selected.size },
        crypto.randomUUID(),
        signal,
      );
    const info = prepared.current!;
    const { createClient } = await import("@supabase/supabase-js");
    const storage = createClient(info.supabaseUrl, info.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal }) },
    });
    // Verify even after a transport error: the object may already have arrived.
    await storage.storage
      .from(info.bucket)
      .uploadToSignedUrl(info.path, info.token, selected, {
        contentType: mimeType,
        upsert: false,
      })
      .catch(() => {});
    const verified = await api(
      "receipts/verify",
      "POST",
      {
        pendingReceiptId: info.id,
      },
      undefined,
      signal,
    );
    pendingId.current = verified.id;
  }
  function applyDraft(result: ReceiptDraft) {
    setDraft(result);
    if (result.saleDate) setSaleDate(result.saleDate);
    if (result.buyer) setBuyer(result.buyer);
    setInvoiceNumber(result.invoiceNumber);
    setWeightKg(result.weightKg);
    setPrice(result.priceBahtPerKg);
    setDeductions(result.deductions);
    setOcrNote(
      result.uncertainFields.length
        ? "ตรวจช่องที่มีเครื่องหมาย และเทียบยอดกับรูปบิลก่อนยืนยัน"
        : "อ่านข้อมูลแล้ว ตรวจทานและแก้เฉพาะช่องที่ผิด",
    );
  }
  async function begin(selected: File, retry = false) {
    if (lock.current) return;
    touched.current = true;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    if (!retry) {
      prepared.current = null;
      pendingId.current = "";
      saleKey.current = { key: "", body: "" };
      setFile(selected);
      setDraft(null);
      setOcrNote("");
      setPreview("");
      setPreviewImage(null);
      setReceivedFull(false);
      setInvoiceNumber("");
      setWeightKg("");
      setPrice("");
      setDeductions([]);
      setSaleDate(today());
    }
    const uploader = new AbortController();
    uploadController.current = uploader;
    const uploadTimeout = window.setTimeout(() => uploader.abort(), 60000);
    try {
      if (!receiptMime(selected))
        throw new Error("รองรับรูป JPEG, PNG, WebP, HEIC และ HEIF");
      if (selected.size < 1 || selected.size > 10 * 1024 * 1024)
        throw new Error("รูปบิลต้องมีขนาดไม่เกิน 10 MB");
      setProgress(
        retry ? "กำลังอัปโหลดรูปอีกครั้ง…" : "กำลังอัปโหลดและเตรียมรูปบิล…",
      );
      const upload = uploadOriginal(selected, uploader.signal);
      const prepare = retry
        ? Promise.resolve()
        : (async () => {
            try {
              const image = await prepareReceiptImage(selected);
              setPreviewImage(image);
              setPreview(URL.createObjectURL(image));
            } catch {
              // The verified original remains usable even when a local preview fails.
            }
          })();
      const results = await Promise.allSettled([upload, prepare]);
      if (results[0].status === "rejected") throw results[0].reason;
      setOcrNote(
        "กรอกข้อมูลจากรูปบิล ระบบช่วยคำนวณยอดให้ ยังไม่ลงบัญชีจนกว่าจะยืนยัน",
      );
      setStep("review");
    } catch (problem) {
      setError(
        problem instanceof RequestError
          ? problem.message
          : problem instanceof Error &&
              !["AbortError", "TimeoutError", "TypeError"].includes(
                problem.name,
              )
            ? problem.message
            : message(problem),
      );
    } finally {
      clearTimeout(uploadTimeout);
      lock.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  function selectMode(next: "none" | "daily" | "weight") {
    setMode(next);
    if (next === "none") {
      setLaborRows([]);
      return;
    }
    if (laborRows.length && laborRows.every((row) => row.mode === next)) return;
    const last = profiles.find((p) => p.mode === next);
    setLaborRows([
      {
        mode: next,
        payee: last?.payee ?? "",
        rateBaht: last?.rateBaht ?? "",
        quantity: next === "daily" ? "1" : "",
      },
    ]);
  }
  const labor =
    mode === "none"
      ? []
      : laborRows.map((row) => ({
          ...row,
          quantity:
            row.mode === "weight" ? row.quantity || weightKg : row.quantity,
        }));
  let net: number | null = null,
    laborTotal: number | null = null;
  try {
    net = calculateSale(
      weightKg,
      price,
      deductions.map((d) => d.amountBaht),
    ).netMinor;
  } catch {}
  try {
    laborTotal = labor.reduce(
      (sum, row) => sum + calculateLabor(row).amountMinor,
      0,
    );
  } catch {}
  const needs = (field: string) =>
    draft?.uncertainFields.includes(field) ?? true;
  function fieldNote(field: string) {
    return needs(field) ? (
      <small className="review-caution">ตรวจจากรูปบิล</small>
    ) : null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "review") {
      setError("");
      setStep("labor");
      return;
    }
    if (lock.current || retryReading || !pendingId.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      for (const item of labor) calculateLabor(item);
      const payload = {
        gardenId,
        saleDate,
        buyer,
        invoiceNumber,
        weightKg,
        priceBahtPerKg: price,
        deductions,
        labor,
        pendingReceiptId: pendingId.current,
        receivedFull,
        confirmDuplicate: false,
      };
      const body = JSON.stringify(payload);
      if (!saleKey.current.key || saleKey.current.body !== body)
        saleKey.current = { key: crypto.randomUUID(), body };
      try {
        await api("sales", "POST", payload, saleKey.current.key);
      } catch (problem) {
        if (
          !(problem instanceof RequestError) ||
          problem.info.code !== "DUPLICATE_BILL"
        )
          throw problem;
        if (
          !window.confirm(
            "พบเลขบิลที่อาจซ้ำ กรุณาตรวจวันที่ ผู้รับซื้อ และยอด หากเป็นคนละบิลให้กดตกลง",
          )
        ) {
          setError("โปรดตรวจบิลที่อาจซ้ำก่อนบันทึก");
          return;
        }
        await api(
          "sales",
          "POST",
          { ...payload, confirmDuplicate: true },
          saleKey.current.key,
        );
      }
      setNotice("บันทึกบิลขายแล้ว");
      setStep("upload");
      setFile(null);
      setPreview("");
      setPreviewImage(null);
      setDraft(null);
      setInvoiceNumber("");
      setWeightKg("");
      setPrice("");
      setDeductions([]);
      setSaleDate(today());
      setReceivedFull(false);
      prepared.current = null;
      pendingId.current = "";
      saleKey.current = { key: "", body: "" };
      setProfiles((current) => [
        ...labor
          .filter((l) => l.rememberRate !== false)
          .map(({ mode, payee, rateBaht }) => ({
            mode,
            payee,
            rateBaht,
          })),
        ...current.filter(
          (p) =>
            !labor.some(
              (l) =>
                l.rememberRate !== false &&
                l.mode === p.mode &&
                l.payee === p.payee,
            ),
        ),
      ]);
      setLaborRows((rows) =>
        rows.map((row) => ({
          ...row,
          quantity: row.mode === "daily" ? "1" : "",
        })),
      );
      await onSaved();
    } catch (problem) {
      setError(
        problem instanceof RequestError
          ? problem.message
          : problem instanceof Error
            ? problem.message
            : message(problem),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="sale-card receipt-workflow">
      <div className="section-heading">
        <div>
          <span className="eyebrow">NEW SALE</span>
          <h2 ref={heading} tabIndex={-1}>
            บันทึกบิลขาย
          </h2>
          <p className="muted">เริ่มจากรูป ตรวจข้อมูล แล้วเลือกค่าแรง</p>
        </div>
      </div>
      <ol className="sale-steps" aria-label="ขั้นตอนบันทึกขาย">
        {[
          ["upload", "1", "รูปบิล"],
          ["review", "2", "ตรวจข้อมูล"],
          ["labor", "3", "ค่าแรงและยืนยัน"],
        ].map(([id, number, label]) => (
          <li key={id} aria-current={step === id ? "step" : undefined}>
            <span>{number}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === "upload" ? (
        <div className="receipt-start">
          <div className="receipt-start-icon" aria-hidden="true">
            ↥
          </div>
          <h3>ถ่ายหรือเลือกรูปบิล</h3>
          <p>แนบรูปไว้เป็นหลักฐาน แล้วกรอกข้อมูลจากบิล</p>
          <div className="receipt-actions">
            <label className={`primary file-action ${busy ? "disabled" : ""}`}>
              ถ่ายบิล
              <input
                className="sr-only"
                type="file"
                aria-label="ถ่ายบิล"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                disabled={busy}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = "";
                  if (selected) void begin(selected);
                }}
              />
            </label>
            <label
              className={`secondary file-action ${busy ? "disabled" : ""}`}
            >
              เลือกรูปบิล
              <input
                className="sr-only"
                type="file"
                aria-label="เลือกรูปบิล"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                disabled={busy}
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  e.target.value = "";
                  if (selected) void begin(selected);
                }}
              />
            </label>
          </div>
          <small className="muted">
            JPEG, PNG, WebP, HEIC/HEIF · ไม่เกิน 10 MB
          </small>
          {busy && (
            <div className="ocr-progress" role="status">
              <span className="loading-dot" />
              {progress}
              <small>เก็บรูปต้นฉบับไว้เป็นหลักฐาน</small>
            </div>
          )}
          {file && !busy && error && (
            <button
              className="secondary"
              onClick={() => void begin(file, true)}
            >
              ลองอัปโหลดอีกครั้ง
            </button>
          )}
        </div>
      ) : (
        <form
          className="sale-form"
          onSubmit={submit}
          aria-busy={busy || retryReading}
        >
          {step === "review" && previewImage && (
            <ReceiptReader
              image={previewImage}
              onApply={applyDraft}
              onReading={setRetryReading}
            />
          )}
          <fieldset disabled={busy || retryReading} className="workflow-fields">
            {step === "review" ? (
              <>
                <div className="review-intro">
                  <div>
                    <h3>กรอกและตรวจข้อมูลจากบิล</h3>
                    <p role="status">{ocrNote}</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setStep("upload");
                      setError("");
                    }}
                  >
                    เปลี่ยนรูป
                  </button>
                </div>
                {preview && (
                  <a
                    href={preview}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="receipt-preview"
                  >
                    <img src={preview} alt="รูปบิลที่กำลังตรวจ" />
                    <span>แตะเพื่อขยายรูปบิล</span>
                  </a>
                )}
                {!preview && (
                  <p className="muted">
                    เตรียมภาพตัวอย่างไม่สำเร็จ แต่ยังเก็บรูปต้นฉบับไว้แล้ว
                  </p>
                )}
                <div className="sale-field-grid">
                  <label>
                    สวน
                    <select
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
                    วันที่ขาย
                    <input
                      type="date"
                      required
                      value={saleDate}
                      onChange={(e) => setSaleDate(e.target.value)}
                    />
                    {fieldNote("saleDate")}
                  </label>
                  <label>
                    ผู้รับซื้อ
                    <input
                      required
                      maxLength={120}
                      value={buyer}
                      onChange={(e) => setBuyer(e.target.value)}
                    />
                    {fieldNote("buyer")}
                  </label>
                  <label>
                    เลขบิล
                    <input
                      required
                      maxLength={80}
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                    />
                    {fieldNote("invoiceNumber")}
                  </label>
                  <label>
                    น้ำหนักสุทธิ (กก.)
                    <input
                      required
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,3})?"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                    />
                    {fieldNote("weightKg")}
                  </label>
                  <label>
                    ราคาต่อกิโลกรัม (บาท)
                    <input
                      required
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,2})?"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    {fieldNote("priceBahtPerKg")}
                  </label>
                </div>
                <div className="deduction-fields">
                  <div className="section-heading">
                    <h3>รายการหักในบิล</h3>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        setDeductions((rows) => [
                          ...rows,
                          { description: "", amountBaht: "" },
                        ])
                      }
                    >
                      + เพิ่มรายการหัก
                    </button>
                  </div>
                  {!deductions.length && (
                    <p className="muted">
                      ไม่มีรายการหักที่อ่านได้ ตรวจจากรูปก่อนยืนยัน
                    </p>
                  )}
                  {deductions.map((row, index) => (
                    <div className="deduction-row" key={index}>
                      <label>
                        คำอธิบาย
                        <input
                          required
                          maxLength={120}
                          value={row.description}
                          onChange={(e) =>
                            setDeductions((rows) =>
                              rows.map((v, i) =>
                                i === index
                                  ? { ...v, description: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        ยอดหัก (บาท)
                        <input
                          required
                          inputMode="decimal"
                          pattern="[0-9]+(\.[0-9]{1,2})?"
                          value={row.amountBaht}
                          onChange={(e) =>
                            setDeductions((rows) =>
                              rows.map((v, i) =>
                                i === index
                                  ? { ...v, amountBaht: e.target.value }
                                  : v,
                              ),
                            )
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="text-button"
                        aria-label="ลบรายการหัก"
                        onClick={() =>
                          setDeductions((rows) =>
                            rows.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ลบ
                      </button>
                    </div>
                  ))}
                  {draft?.uncertainFields.includes("deductions") && (
                    <p className="review-caution">
                      ยอดหักอาจไม่ครบ กรุณาเทียบกับบิล
                    </p>
                  )}
                </div>
                <div className="sale-calculation">
                  <span>รายรับสุทธิตามข้อมูล</span>
                  <strong>{net === null ? "—" : money(net)} บาท</strong>
                  {draft?.printedNetBaht && (
                    <small>ยอดที่อ่านจากบิล {draft.printedNetBaht} บาท</small>
                  )}
                  {draft?.printedNetBaht &&
                    net !== null &&
                    Math.abs(
                      net - Math.round(Number(draft.printedNetBaht) * 100),
                    ) > 1 && (
                      <p className="review-caution">
                        ยอดคำนวณไม่ตรงกับยอดที่อ่านจากบิล กรุณาตรวจน้ำหนัก ราคา
                        และรายการหัก
                      </p>
                    )}
                </div>
                {draft?.text && (
                  <details className="ocr-text">
                    <summary>ดูข้อความที่อ่านได้</summary>
                    <pre>{draft.text}</pre>
                  </details>
                )}
                <button
                  className="primary"
                  disabled={!gardenId || net === null || net <= 0}
                >
                  ข้อมูลถูกต้อง · เลือกค่าแรง
                </button>
              </>
            ) : (
              <>
                <div className="review-intro">
                  <div>
                    <h3>เลือกวิธีคิดค่าแรง</h3>
                    <p>จำชื่อและอัตราไว้ให้ครั้งถัดไป</p>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setStep("review");
                      setError("");
                    }}
                  >
                    กลับไปแก้ข้อมูลบิล
                  </button>
                </div>
                <div
                  className="labor-options"
                  role="radiogroup"
                  aria-label="วิธีคิดค่าแรง"
                >
                  {(
                    [
                      ["none", "ไม่มีค่าแรง"],
                      ["daily", "รายวัน"],
                      ["weight", "รายน้ำหนัก"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={mode === value ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="labor-mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => selectMode(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                {mode !== "none" && (
                  <div className="labor-entries">
                    {laborRows.map((row, index) => (
                      <div className="labor-entry" key={index}>
                        <label>
                          {mode === "daily"
                            ? `ชื่อคนงาน ${index + 1}`
                            : "ชื่อทีม"}
                          <input
                            required
                            maxLength={120}
                            list={`labor-profiles-${index}`}
                            value={row.payee}
                            onChange={(e) => {
                              const name = e.target.value;
                              const match = profiles.find(
                                (p) => p.mode === mode && p.payee === name,
                              );
                              setLaborRows((rows) =>
                                rows.map((v, i) =>
                                  i === index
                                    ? {
                                        ...v,
                                        payee: name,
                                        rateBaht: match?.rateBaht ?? v.rateBaht,
                                      }
                                    : v,
                                ),
                              );
                            }}
                          />
                        </label>
                        <datalist id={`labor-profiles-${index}`}>
                          {profiles
                            .filter((p) => p.mode === mode)
                            .map((p, i) => (
                              <option value={p.payee} key={`${p.payee}-${i}`} />
                            ))}
                        </datalist>
                        <label>
                          {mode === "daily"
                            ? `จำนวนวัน ${index + 1}`
                            : "น้ำหนักคิดค่าแรง (กก.)"}
                          <input
                            required
                            inputMode="decimal"
                            type="number"
                            min={mode === "daily" ? "0.5" : "0.001"}
                            step={mode === "daily" ? "0.5" : "0.001"}
                            value={
                              mode === "weight"
                                ? row.quantity || weightKg
                                : row.quantity
                            }
                            onChange={(e) =>
                              setLaborRows((rows) =>
                                rows.map((v, i) =>
                                  i === index
                                    ? { ...v, quantity: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          {mode === "daily"
                            ? `บาทต่อวัน ${index + 1}`
                            : "บาทต่อตัน"}
                          <input
                            required
                            inputMode="decimal"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={row.rateBaht}
                            onChange={(e) =>
                              setLaborRows((rows) =>
                                rows.map((v, i) =>
                                  i === index
                                    ? { ...v, rateBaht: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <label className="expense-check">
                          <input
                            type="checkbox"
                            checked={row.rememberRate !== false}
                            onChange={(e) =>
                              setLaborRows((rows) =>
                                rows.map((v, i) =>
                                  i === index
                                    ? { ...v, rememberRate: e.target.checked }
                                    : v,
                                ),
                              )
                            }
                          />
                          จำอัตรานี้ไว้ใช้ครั้งถัดไป
                          (เอาออกเพื่อเปลี่ยนเฉพาะรายการ)
                        </label>
                        {laborRows.length > 1 && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setLaborRows((rows) =>
                                rows.filter((_, i) => i !== index),
                              )
                            }
                          >
                            ลบคนงาน {index + 1}
                          </button>
                        )}
                      </div>
                    ))}
                    {mode === "daily" && laborRows.length < 20 && (
                      <button
                        className="text-button"
                        type="button"
                        onClick={() =>
                          setLaborRows((rows) => [
                            ...rows,
                            {
                              mode: "daily",
                              payee: "",
                              rateBaht: "",
                              quantity: "1",
                            },
                          ])
                        }
                      >
                        + เพิ่มคนงาน
                      </button>
                    )}
                    <p className="muted">
                      {mode === "weight"
                        ? "ใช้น้ำหนักจากบิลให้แล้ว แก้ได้หากตกลงฐานน้ำหนักต่างกัน · "
                        : "รองรับครึ่งวัน · "}
                      ค่าแรงนี้บันทึกเป็นค้างจ่าย
                    </p>
                  </div>
                )}
                <div className="sale-final-summary">
                  <div>
                    <span>รายรับจากบิล {invoiceNumber}</span>
                    <strong>{net === null ? "—" : money(net)} บาท</strong>
                  </div>
                  <div>
                    <span>ค่าแรงค้างจ่าย</span>
                    <strong>
                      {laborTotal === null ? "—" : money(laborTotal)} บาท
                    </strong>
                  </div>
                  <div className="summary-net">
                    <span>สุทธิหลังค่าแรง</span>
                    <strong>
                      {net === null || laborTotal === null
                        ? "—"
                        : money(net - laborTotal)}{" "}
                      บาท
                    </strong>
                  </div>
                </div>
                <label className="received-check">
                  <input
                    type="checkbox"
                    required
                    checked={receivedFull}
                    onChange={(e) => setReceivedFull(e.target.checked)}
                  />
                  ตรวจข้อมูลแล้ว และได้รับเงินขายเต็มจำนวน
                </label>
                <button
                  className="primary"
                  disabled={busy || laborTotal === null || !gardenId}
                >
                  {busy ? "กำลังบันทึก…" : "ยืนยันและบันทึก"}
                </button>
              </>
            )}
          </fieldset>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="save-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
