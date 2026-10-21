"use client";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import icons from "../../assets/icons.json";
import { PalmLandscape } from "./palm-landscape";
import { ExpenseForm, ExpenseList, type Expense } from "./expense-form";
import { Payables, type Payable } from "./payables";
import { SaleForm } from "./sale-form";
import { api, message, RequestError } from "./api";

type Garden = {
  id: string;
  name: string;
  openingMinor: number;
  netMinor: number;
  laborPendingMinor: number;
  expensePendingMinor: number;
  openingDebtPendingMinor: number;
  archived: boolean;
  version: number;
};
type Sale = {
  id: string;
  gardenId: string;
  gardenName: string;
  saleDate: string;
  buyer: string;
  invoiceNumber: string;
  weightKg: string;
  priceBahtPerKg: string;
  netMinor: number;
  deductions: { description: string; amountMinor: number }[];
  labor: {
    id: string;
    mode: "daily" | "weight";
    payee: string;
    quantity: string;
    rateBaht: string;
    amountMinor: number;
    pendingMinor: number;
  }[];
  receipt: {
    id: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  } | null;
};
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <span
      className="icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
function SunMark() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path
        d="M20 3v10m0 14v10M3 20h10m14 0h10M8 8l7 7m10 10 7 7M8 32l7-7m10-10 7-7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
function Brand() {
  return (
    <header className="brand">
      <span className="brand-symbol">
        <Icon name="tree-palm" />
      </span>
      <div>
        <h1>
          สวนปาล์ม<span className="brand-dot">.</span>
        </h1>
        <p>PALM LEDGER</p>
      </div>
    </header>
  );
}
const baht = (minor: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

export function Login({ support }: { support: string }) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const lock = useRef(false),
    failure = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    api("session")
      .then(() => window.location.replace("/"))
      .catch(() => {});
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await api("session", "POST", { username, password });
      window.location.replace("/");
    } catch (error) {
      setError(message(error));
      setBusy(false);
      lock.current = false;
      setTimeout(() => failure.current?.focus(), 0);
    }
  }
  return (
    <main className="login-layout">
      <section
        className="login-story"
        aria-label="สวนปาล์ม ดูแลทุกสวน เห็นทุกยอด"
      >
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">พื้นที่เล็ก ๆ สำหรับทุกการเติบโต</span>
          <h2>
            ดูแลทุกสวน
            <br />
            <span>เห็นทุกยอด</span>
          </h2>
          <p>
            ให้เรื่องตัวเลขเป็นเรื่องง่าย
            <br />
            มีเวลาให้สวน และสิ่งที่คุณรักมากขึ้น
          </p>
        </div>
        <PalmLandscape className="login-landscape" />
        <div className="story-footer">
          <span className="small-sun" aria-hidden="true">
            <SunMark />
          </span>
          <span>ค่อย ๆ เติบโตไปด้วยกัน ในทุกวัน</span>
          <span className="story-edition">PALM / 01</span>
        </div>
      </section>
      <div className="login-panel">
        <div className="login-panel-inner">
          <div className="login-welcome">
            <span className="welcome-icon">
              <Icon name="plant" />
            </span>
            <span className="eyebrow">ยินดีต้อนรับกลับบ้านสวน</span>
          </div>
          <section className="login-card" aria-labelledby="login-title">
            <h2 id="login-title">เข้าสู่ระบบ</h2>
            <p className="section-note">ทุกสวนของคุณ อยู่พร้อมกันที่นี่</p>
            <form onSubmit={submit} className="stack" aria-busy={busy}>
              <label>
                ชื่อผู้ใช้
                <input
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="ชื่อผู้ใช้ของคุณ"
                  required
                  maxLength={80}
                />
              </label>
              <div className="form-field">
                <label htmlFor="login-password">รหัสผ่าน</label>
                <span className="password-field">
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    placeholder="กรอกรหัสผ่าน"
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "ซ่อน" : "แสดง"}
                  </button>
                </span>
              </div>
              {error && (
                <p className="error" role="alert" tabIndex={-1} ref={failure}>
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
                <span className="button-arrow" aria-hidden="true">
                  <Icon name="arrow-left" />
                </span>
              </button>
              <p className="muted hint">
                จำการเข้าสู่ระบบ 30 วันบนเครื่องส่วนตัว
                <br />
                หากใช้เครื่องร่วมกับคนอื่น ให้ออกจากระบบเมื่อใช้เสร็จ
              </p>
            </form>
            <details className="help">
              <summary>ลืมรหัสผ่าน?</summary>
              <p>{support}</p>
            </details>
          </section>
          <p className="login-footnote">
            <Icon name="tree-palm" />
            สวนปาล์ม · พื้นที่ส่วนตัวของเจ้าของสวน
          </p>
        </div>
      </div>
    </main>
  );
}

function GardenForm({
  garden,
  onSaved,
  onClose,
  onConflict,
}: {
  garden?: Garden;
  onSaved: () => Promise<void>;
  onClose: () => void;
  onConflict: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    firstInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(garden?.name ?? ""),
    [opening, setOpening] = useState(
      garden ? (garden.openingMinor / 100).toFixed(2) : "0",
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [stale, setStale] = useState(false);
  const lock = useRef(false),
    request = useRef({ body: "", key: "" });
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    firstInput.current?.focus();
    return () => current?.close();
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(opening)) {
      setFields({ openingMinor: "กรอกจำนวนเงินไม่เกิน 2 ตำแหน่งทศนิยม" });
      return;
    }
    const negative = opening.startsWith("-"),
      [whole, decimal = ""] = opening.replace("-", "").split(".");
    const minor =
      (BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"))) *
      (negative ? -1n : 1n);
    if (minor > 99999999999n || minor < -99999999999n) {
      setFields({ openingMinor: "จำนวนเงินเกินขอบเขตที่รองรับ" });
      return;
    }
    const payload = {
      name,
      openingMinor: Number(minor),
      ...(garden ? { expectedVersion: garden.version } : {}),
    };
    const serialized = JSON.stringify(payload);
    if (request.current.body !== serialized)
      request.current = { body: serialized, key: crypto.randomUUID() };
    lock.current = true;
    setBusy(true);
    setError("");
    setFields({});
    try {
      await api(
        garden ? "gardens/" + garden.id : "gardens",
        garden ? "PATCH" : "POST",
        payload,
        request.current.key,
      );
      // A successful write stays successful even if refreshing the list later fails.
      await onSaved();
      onClose();
    } catch (error) {
      setError(message(error));
      if (error instanceof RequestError) {
        setFields(error.info.fields ?? {});
        setStale(error.info.code === "STALE_VERSION");
      }
      setTimeout(() => errorRef.current?.focus(), 0);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="garden-form-title"
      className="garden-dialog"
    >
      <div className="dialog-heading">
        <h2 id="garden-form-title">{garden ? "แก้ไขสวน" : "เพิ่มสวน"}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="ปิดฟอร์ม"
          disabled={busy}
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      <form onSubmit={save} className="stack" aria-busy={busy}>
        <label>
          ชื่อสวน
          <input
            ref={firstInput}
            name="gardenName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            aria-invalid={!!fields.name}
            aria-describedby={fields.name ? "name-error" : undefined}
          />
        </label>
        {fields.name && (
          <p id="name-error" className="error">
            {fields.name}
          </p>
        )}
        <label>
          ยอดสุทธิยกมา (บาท)
          <input
            name="opening"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            inputMode="decimal"
            required
            aria-invalid={!!fields.openingMinor}
            aria-describedby="opening-hint"
          />
        </label>
        <button
          type="button"
          className="text-button sign-toggle"
          onClick={() =>
            setOpening((value) =>
              value.startsWith("-") ? value.slice(1) : "-" + value,
            )
          }
        >
          {opening.startsWith("-")
            ? "เปลี่ยนเป็นยอดบวก"
            : "เปลี่ยนเป็นยอดติดลบ"}
        </button>
        <p id="opening-hint" className="muted hint">
          ยอดสุทธิของสวนก่อนเริ่มบันทึก ใส่ 0 ได้ หรือใส่เครื่องหมาย − หากติดลบ
        </p>
        {fields.openingMinor && <p className="error">{fields.openingMinor}</p>}
        {error && (
          <p className="error" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </p>
        )}
        {stale && (
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await onConflict();
              onClose();
            }}
          >
            โหลดข้อมูลล่าสุด
          </button>
        )}
        <button className="primary" disabled={busy || stale}>
          {busy ? "กำลังบันทึก…" : "บันทึกสวน"}
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

export function Ledger({
  view,
  gardenId,
}: {
  view: "home" | "gardens" | "garden" | "records";
  gardenId?: string;
}) {
  const [summary, setSummary] = useState({
    netMinor: 0,
    laborPendingMinor: 0,
    expensePendingMinor: 0,
    openingDebtPendingMinor: 0,
    sharedUnallocatedMinor: 0,
    sharedUnallocatedPendingMinor: 0,
  });
  const [payables, setPayables] = useState<Payable[]>([]);
  const [expenseModal, setExpenseModal] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const expenseTrigger = useRef<HTMLButtonElement>(null);
  const [gardens, setGardens] = useState<Garden[]>([]),
    [sales, setSales] = useState<Sale[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [modal, setModal] = useState<{ garden?: Garden } | null>(null),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const actionLock = useRef(false),
    trigger = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    try {
      await api("session");
      const result = await api("gardens");
      setGardens(result.gardens);
      setSummary(result.summary);
      if (view === "records") {
        const [ledger, costs, debts] = await Promise.all([
          api("sales"),
          api("expenses"),
          api("payables"),
        ]);
        setSales(ledger.sales);
        setExpenses(costs.expenses);
        setPayables(debts.payables);
      }
      setError("");
      setReady(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  function open(garden?: Garden) {
    trigger.current = document.activeElement as HTMLElement;
    setModal({ garden });
  }
  function close() {
    setModal(null);
    setTimeout(() => trigger.current?.focus(), 0);
  }
  async function saved() {
    await load();
    setNotice("บันทึกสวนแล้ว");
  }
  async function logout() {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await api("session", "DELETE");
      window.location.replace("/login");
    } catch (error) {
      setError(message(error));
      setBusy(false);
      actionLock.current = false;
    }
  }
  const selected = gardens.find((g) => g.id === gardenId),
    total = summary.netMinor;
  async function archive() {
    if (!selected || actionLock.current) return;
    if (
      !window.confirm(
        selected.archived
          ? "นำสวนนี้กลับมาใช้งาน?"
          : "เก็บสวนนี้เป็นประวัติ? ข้อมูลและยอดเดิมจะยังอยู่",
      )
    )
      return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await api(
        "gardens/" + selected.id,
        "PATCH",
        { archived: !selected.archived, expectedVersion: selected.version },
        crypto.randomUUID(),
      );
      await saved();
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
      actionLock.current = false;
    }
  }
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <Brand />
        <p className="sidebar-caption">ดูแลทุกสวน เห็นทุกยอด</p>
        <div className="sidebar-bottom">
          <span className="sidebar-sprout">
            <Icon name="plant" />
          </span>
          <p>
            เริ่มต้นจากสวน
            <br />
            <strong>เติบโตไปด้วยกัน</strong>
          </p>
          <span>PALM LEDGER · สำหรับสวนของคุณ</span>
        </div>
      </aside>
      <main className="shell app-main">
        <div className="account">
          <span className="account-label">
            <span className="account-avatar">
              <Icon name="tree-palm" />
            </span>
            <span>
              พื้นที่ส่วนตัว
              <span className="account-owner">บัญชีเจ้าของสวน</span>
            </span>
          </span>
          <button className="text-button" onClick={logout} disabled={busy}>
            ออกจากระบบ
          </button>
        </div>
        {view === "home" ? (
          <header className="dashboard-heading">
            <div>
              <span className="eyebrow">GROW A LITTLE, EVERY DAY</span>
              <h1>
                ภาพรวมสวนของคุณ<span className="heading-dot">.</span>
              </h1>
              <p>ดูแลสวนให้เติบโต เริ่มจากเห็นยอดที่ชัดเจน</p>
            </div>
            <span className="heading-mark" aria-hidden="true">
              <SunMark />
            </span>
          </header>
        ) : (
          <header className="page-top">
            <Link
              className="icon-button"
              href={view === "garden" ? "/gardens" : "/"}
              aria-label="กลับ"
            >
              <Icon name="arrow-left" />
            </Link>
            <h1>
              {view === "garden"
                ? (selected?.name ?? "รายละเอียดสวน")
                : view === "records"
                  ? "บันทึกและรายการ"
                  : "สวนของฉัน"}
            </h1>
          </header>
        )}
        {loading && (
          <div role="status" className="loading-state">
            <div className="loading-block" />
            <div className="loading-block" />
            <p>กำลังโหลดข้อมูลสวน…</p>
          </div>
        )}
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            <button className="text-button" onClick={() => void load()}>
              ลองโหลดใหม่
            </button>
          </div>
        )}
        <p
          className={notice ? "save-notice" : "sr-only"}
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
        {!loading &&
          ready &&
          view === "garden" &&
          (selected ? (
            <>
              {selected.archived && (
                <p className="section-note">สวนที่เก็บเป็นประวัติ</p>
              )}
              <section className="hero detail-hero">
                <h2>ยอดสุทธิของสวน</h2>
                <div className="total">{baht(selected.netMinor)}</div>
                <p>บาท · ยอดยกมา + รายรับขาย − รายจ่ายทั้งหมด</p>
                {selected.laborPendingMinor > 0 && (
                  <p>ค่าแรงค้างจ่าย {baht(selected.laborPendingMinor)} บาท</p>
                )}
              </section>
              <p>
                รายจ่ายอื่นค้างจ่าย {baht(selected.expensePendingMinor)} บาท
              </p>
              <p>
                หนี้ก่อนเริ่มระบบค้างจ่าย{" "}
                {baht(selected.openingDebtPendingMinor)} บาท
              </p>
              <div className="actions">
                <button className="secondary" onClick={() => open(selected)}>
                  <Icon name="pencil-simple" />
                  แก้ไขสวน
                </button>
                <button className="secondary" onClick={archive} disabled={busy}>
                  {selected.archived
                    ? "นำสวนกลับมาใช้งาน"
                    : "เก็บสวนเป็นประวัติ"}
                </button>
              </div>
            </>
          ) : (
            <p className="empty" role="status">
              ไม่พบสวนที่ต้องการ <Link href="/gardens">กลับหน้าสวน</Link>
            </p>
          ))}
        {!loading && ready && view === "records" && (
          <>
            <div className="actions">
              <button
                ref={expenseTrigger}
                className="primary"
                onClick={() => setExpenseModal(true)}
              >
                เพิ่มรายจ่าย
              </button>
            </div>
            <SaleForm gardens={gardens} onSaved={load} />
            <Payables
              entries={payables}
              onRefresh={load}
              gardens={gardens}
              onSaved={async () => {
                await load();
                setNotice("บันทึกข้อมูลแล้ว");
              }}
            />
            <div className="section-heading records-heading">
              <h2>รายจ่ายทั่วไป ค่าแรงรายวัน และปุ๋ย</h2>
            </div>
            <ExpenseList expenses={expenses} onError={setError} />
            {expenseModal && (
              <ExpenseForm
                gardens={gardens}
                onSaved={async () => {
                  await load();
                  setNotice("บันทึกรายจ่ายแล้ว");
                }}
                onClose={() => {
                  setExpenseModal(false);
                  setTimeout(() => expenseTrigger.current?.focus(), 0);
                }}
              />
            )}
            <div className="section-heading records-heading">
              <div>
                <span className="eyebrow">SALES HISTORY</span>
                <h2>รายการขาย</h2>
              </div>
            </div>
            {sales.length === 0 ? (
              <section className="empty">
                <h2>ยังไม่มีบิลขาย</h2>
                <p>บันทึกบิลขายรายการแรกได้จากแบบฟอร์มด้านบน</p>
              </section>
            ) : (
              <section className="sale-list" aria-label="รายการขาย">
                {sales.map((sale) => (
                  <article className="sale-row" key={sale.id}>
                    <div>
                      <strong>{sale.buyer}</strong>
                      <span>
                        {sale.gardenName} ·{" "}
                        {new Date(
                          sale.saleDate + "T00:00:00",
                        ).toLocaleDateString("th-TH")}
                      </span>
                      <small>
                        บิล {sale.invoiceNumber} · {sale.weightKg} กก. ×{" "}
                        {baht(Math.round(Number(sale.priceBahtPerKg) * 100))}{" "}
                        บาท/กก.
                      </small>
                      {sale.deductions.length > 0 && (
                        <small>
                          หัก:{" "}
                          {sale.deductions
                            .map(
                              (item) =>
                                `${item.description} ${baht(item.amountMinor)} บาท`,
                            )
                            .join(" · ")}
                        </small>
                      )}
                      {sale.labor.map((item) => (
                        <small key={item.id} className="labor-history">
                          ค่าแรง
                          {item.mode === "daily"
                            ? "รายวัน"
                            : "รายน้ำหนัก"} · {item.payee} · {item.quantity}{" "}
                          {item.mode === "daily" ? "วัน" : "กก."} ×{" "}
                          {item.rateBaht} บาท/
                          {item.mode === "daily" ? "วัน" : "ตัน"} ={" "}
                          {baht(item.amountMinor)} บาท · ค้างจ่าย{" "}
                          {baht(item.pendingMinor)} บาท
                        </small>
                      ))}
                    </div>
                    <b>
                      {baht(sale.netMinor)}
                      <small>บาท</small>
                    </b>
                    {sale.receipt && (
                      <button
                        className="secondary receipt-open"
                        onClick={async () => {
                          const popup = window.open("about:blank", "_blank");
                          if (popup) popup.opener = null;
                          try {
                            const signed = await api(
                              "receipts/" + sale.receipt!.id,
                            );
                            if (popup) popup.location.href = signed.url;
                            else
                              setError(
                                "เบราว์เซอร์บล็อกหน้าต่างรูปบิล กรุณาอนุญาตป๊อปอัปแล้วลองอีกครั้ง",
                              );
                          } catch (problem) {
                            popup?.close();
                            setError(message(problem));
                          }
                        }}
                      >
                        เปิดรูปต้นฉบับ
                      </button>
                    )}
                  </article>
                ))}
              </section>
            )}
          </>
        )}
        {!loading && ready && view !== "garden" && view !== "records" && (
          <>
            {view === "home" && (
              <section className="hero overview-hero">
                <div className="hero-content">
                  <span className="balance-label">
                    <span className="status-dot" />
                    ภาพรวมทุกสวน
                  </span>
                  <h2>ยอดสุทธิรวมทุกสวน</h2>
                  <div className="total">{baht(total)}</div>
                  <p>บาท · ยอดยกมา + รายรับขาย − รายจ่ายทั้งหมด</p>
                  {summary.laborPendingMinor > 0 && (
                    <p>ค่าแรงค้างจ่าย {baht(summary.laborPendingMinor)} บาท</p>
                  )}
                  <p>
                    รายจ่ายอื่นค้างจ่าย {baht(summary.expensePendingMinor)} บาท
                  </p>
                  <p>
                    หนี้ก่อนเริ่มระบบค้างจ่าย{" "}
                    {baht(summary.openingDebtPendingMinor)} บาท
                  </p>
                  <p>
                    ส่วนกลางยังไม่แบ่ง {baht(summary.sharedUnallocatedMinor)}{" "}
                    บาท · หักในยอดสุทธิรวมแล้ว
                  </p>
                  <p>
                    ในนี้ค้างจ่ายส่วนกลาง{" "}
                    {baht(summary.sharedUnallocatedPendingMinor)} บาท
                  </p>
                  <span className="hero-detail">
                    รวมสวนที่เก็บเป็นประวัติแล้ว
                  </span>
                </div>
                <div className="hero-art">
                  <PalmLandscape />
                  <span className="orchard-caption">
                    <span className="status-dot" />
                    ทุกการเติบโต เริ่มต้นที่สวน
                  </span>
                </div>
              </section>
            )}
            <div className="garden-summary" aria-label="สรุปจำนวนสวน">
              <div>
                <span className="summary-icon">
                  <Icon name="plant" />
                </span>
                <span>
                  สวนที่ใช้งาน
                  <strong>
                    {gardens.filter((g) => !g.archived).length}
                    <small>สวน</small>
                  </strong>
                </span>
              </div>
              <div>
                <span className="summary-icon history-icon">
                  <Icon name="tree-palm" />
                </span>
                <span>
                  เก็บเป็นประวัติ
                  <strong>
                    {gardens.filter((g) => g.archived).length}
                    <small>สวน</small>
                  </strong>
                </span>
              </div>
            </div>
            <div className="section-heading">
              <div>
                <span className="eyebrow">YOUR GARDENS</span>
                <h2>
                  สวนของฉัน{" "}
                  <span className="count-badge">{gardens.length}</span>
                </h2>
              </div>
              {gardens.length > 0 && (
                <button
                  className="primary add-garden-shortcut"
                  onClick={() => open()}
                >
                  <Icon name="plus" />
                  เพิ่มสวน
                </button>
              )}
            </div>
            {gardens.length === 0 ? (
              <section className="empty">
                <Icon name="plant" />
                <h2>เริ่มจากสวนแรกของคุณ</h2>
                <p>
                  เพิ่มชื่อสวนและยอดสุทธิยกมา
                  <br />
                  แล้วค่อย ๆ ดูแลทุกยอดไปด้วยกัน
                </p>
              </section>
            ) : (
              <section className="garden-list" aria-label="สวนทั้งหมด">
                {gardens.map((g, index) => (
                  <Link
                    className={`garden-row ${g.archived ? "is-archived" : ""}`}
                    href={"/gardens/" + g.id}
                    key={g.id}
                  >
                    <span className={`garden-symbol tone-${index % 3}`}>
                      <Icon name="tree-palm" />
                    </span>
                    <span className="garden-name">
                      <strong>{g.name}</strong>
                      <small>
                        <span className="status-dot" />
                        {g.archived ? "เก็บเป็นประวัติ" : "กำลังดูแล"}
                      </small>
                    </span>
                    <b>
                      {baht(g.netMinor)}
                      <small>บาท</small>
                    </b>
                    <Icon name="caret-right" />
                  </Link>
                ))}
              </section>
            )}
            {gardens.length === 0 && (
              <div className="actions add-action">
                <button className="primary" onClick={() => open()}>
                  <Icon name="plus" />
                  เพิ่มสวนแรก
                </button>
              </div>
            )}
          </>
        )}
        <footer className="app-footer">
          <p className="section-note footnote">
            ยอดสุทธิเป็นยอดของสวน ไม่ใช่ยอดเงินในบัญชีธนาคาร
          </p>
          <span>เติบโตอย่างสบายใจ 🌱</span>
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="เมนูหลัก">
        <Link href="/" aria-current={view === "home" ? "page" : undefined}>
          <Icon name="house-fill" />
          ภาพรวม
        </Link>
        <Link
          href="/records"
          aria-current={view === "records" ? "page" : undefined}
        >
          <Icon name="receipt" />
          รายการ
        </Link>
        <Link
          href="/gardens"
          aria-current={
            view === "gardens" || view === "garden" ? "page" : undefined
          }
        >
          <Icon name="plant" />
          สวน
        </Link>
      </nav>
      {modal && (
        <GardenForm
          garden={modal.garden}
          onSaved={saved}
          onClose={close}
          onConflict={load}
        />
      )}
    </div>
  );
}
