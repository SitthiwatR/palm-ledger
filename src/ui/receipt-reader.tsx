"use client";
import { useEffect, useRef, useState } from "react";
import { fullReceipt, type ReceiptSelection } from "../lib/receipt-selection";
import type { ReceiptDraft } from "../lib/receipt-parser";
import { selectReceiptImage } from "./receipt-image";
import { readReceipt } from "./receipt-ocr";

export function ReceiptReader({
  image,
  onApply,
  onReading,
}: {
  image: Blob;
  onApply: (draft: ReceiptDraft) => void;
  onReading: (reading: boolean) => void;
}) {
  const [selection, setSelection] = useState<ReceiptSelection>(fullReceipt);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [progress, setProgress] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<ReceiptDraft | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    let active = true;
    let url = "";
    setPreview("");
    selectReceiptImage(image, { ...fullReceipt, turns: selection.turns })
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
      })
      .catch(() => {
        if (active)
          setError("เตรียมรูปไม่สำเร็จ กรอกข้อมูลจากรูปต้นฉบับได้เลย");
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [image, selection.turns, open]);

  async function recognize() {
    if (controller.current) return;
    const aborter = new AbortController();
    controller.current = aborter;
    setReading(true);
    onReading(true);
    setError("");
    setCandidate(null);
    const timeout = window.setTimeout(() => aborter.abort(), 45000);
    try {
      setProgress("กำลังเตรียมช่วงรูปที่เลือก…");
      const selected = await selectReceiptImage(image, selection);
      aborter.signal.throwIfAborted();
      const result = await readReceipt(selected, aborter.signal, setProgress);
      aborter.signal.throwIfAborted();
      if (mounted.current) setCandidate(result);
    } catch {
      if (mounted.current)
        setError(
          aborter.signal.aborted
            ? "หยุดอ่านแล้ว ข้อมูลที่กรอกยังอยู่ อ่านใหม่หรือกรอกเองได้เลย"
            : "อ่านไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ ลองเลือกช่วงให้เห็นหัวข้อและตัวเลขครบ หรือกรอกเอง",
        );
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      if (mounted.current) {
        setReading(false);
        setProgress("");
        onReading(false);
      }
    }
  }
  function update(next: ReceiptSelection) {
    setSelection(next);
    setCandidate(null);
    setError("");
  }
  return (
    <details
      className="receipt-reader"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) controller.current?.abort();
      }}
    >
      <summary>ตัวช่วยอ่านบิล (OCR) · เลือกใช้ได้</summary>
      <p>
        ไม่จำเป็นต้องใช้ตัวช่วย กรอกเองได้เลย หากต้องการอ่าน
        ให้เลือกเฉพาะบิลและเหลือชื่อช่องกับตัวเลขครบ อ่านในเครื่องโดยไม่มีค่า
        OCR รูปต้นฉบับยังเก็บครบเหมือนเดิม
      </p>
      <fieldset disabled={reading} className="workflow-fields">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            update({ ...fullReceipt, turns: (selection.turns + 1) % 4 })
          }
        >
          หมุนขวา 90°
        </button>
        {preview && (
          <div className="receipt-selection">
            <img src={preview} alt="รูปสำหรับเลือกช่วงอ่านบิล" />
            <div
              aria-hidden="true"
              className="receipt-selection-box"
              style={{
                inset: `${selection.top}% ${selection.right}% ${selection.bottom}% ${selection.left}%`,
              }}
            />
          </div>
        )}
        <div className="receipt-crop-controls">
          {(
            [
              ["top", "ตัดด้านบน"],
              ["right", "ตัดด้านขวา"],
              ["bottom", "ตัดด้านล่าง"],
              ["left", "ตัดด้านซ้าย"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label} {selection[key]}%
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={selection[key]}
                aria-label={label}
                onChange={(event) =>
                  update({ ...selection, [key]: Number(event.target.value) })
                }
              />
            </label>
          ))}
        </div>
        <div className="receipt-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => update(fullReceipt)}
          >
            คืนค่ารูปเต็ม
          </button>
          <button
            type="button"
            className="secondary"
            disabled={!preview}
            onClick={() => void recognize()}
          >
            อ่านช่วงที่เลือก
          </button>
        </div>
      </fieldset>
      {reading && (
        <div role="status">
          <p>{progress}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => controller.current?.abort()}
          >
            หยุดอ่าน · เก็บข้อมูลเดิม
          </button>
        </div>
      )}
      {error && <p role="status">{error}</p>}
      {candidate && (
        <div className="receipt-candidate">
          <h4>ผลอ่านใหม่ · ยังไม่แทนข้อมูลที่คุณแก้</h4>
          <dl>
            {(
              [
                ["saleDate", "วันที่"],
                ["buyer", "ผู้รับซื้อ"],
                ["invoiceNumber", "เลขบิล"],
                ["weightKg", "น้ำหนักสุทธิ (กก.)"],
                ["priceBahtPerKg", "ราคา/กก."],
                ["printedNetBaht", "ยอดสุทธิตามบิล"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{candidate[key] || "อ่านไม่พบ"}</dd>
              </div>
            ))}
          </dl>
          <p>
            รายการหักที่อ่านได้ {candidate.deductions.length} รายการ ·
            ต้องตรวจเทียบรูปก่อนยืนยัน
          </p>
          <div className="receipt-actions">
            <button
              type="button"
              className="text-button"
              onClick={() => setCandidate(null)}
            >
              เก็บข้อมูลเดิม
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onApply(candidate);
                setCandidate(null);
              }}
            >
              ใช้ผลอ่านใหม่แทนข้อมูลบิล
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
