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

type Garden = {
  id: string;
  name: string;
  openingMinor: number;
  archived: boolean;
  version: number;
};
type Failure = {
  code: string;
  message: string;
  fields?: Record<string, string>;
};
class RequestError extends Error {
  constructor(
    public info: Failure,
    public status: number,
  ) {
    super(info.message);
  }
}
async function api(path: string, method = "GET", data?: unknown, key?: string) {
  const response = await fetch("/api/v1/" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && window.location.pathname !== "/login")
      window.location.replace("/login");
    throw new RequestError(result.error, response.status);
  }
  return result;
}
function message(error: unknown) {
  return error instanceof RequestError
    ? error.message
    : "เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่ ข้อมูลที่กรอกยังอยู่";
}
function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <span
      className="icon"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icons[name] }}
    />
  );
}
function Brand() {
  return (
    <header className="brand">
      <Icon name="tree-palm" />
      <h1>สวนปาล์ม</h1>
      <p>ดูแลทุกสวน เห็นทุกยอด</p>
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
    <main className="shell login-shell">
      <Brand />
      <section aria-labelledby="login-title">
        <h2 id="login-title">เข้าสู่ระบบ</h2>
        <p className="section-note">ใช้ชื่อผู้ใช้และรหัสผ่านของคุณ</p>
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
              required
              maxLength={80}
            />
          </label>
          <label>
            รหัสผ่าน
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </label>
          {error && (
            <p className="error" role="alert" tabIndex={-1} ref={failure}>
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
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
  view: "home" | "gardens" | "garden";
  gardenId?: string;
}) {
  const [gardens, setGardens] = useState<Garden[]>([]),
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
      setError("");
      setReady(true);
    } catch (error) {
      setError(message(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
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
    total = gardens.reduce((sum, g) => sum + g.openingMinor, 0);
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
    <>
      <main className="shell">
        <div className="account">
          <span>บัญชีเจ้าของสวน</span>
          <button className="text-button" onClick={logout} disabled={busy}>
            ออกจากระบบ
          </button>
        </div>
        {view === "home" ? (
          <Brand />
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
                : "สวนของฉัน"}
            </h1>
          </header>
        )}
        {loading && (
          <p role="status" className="empty">
            กำลังโหลดข้อมูลสวน…
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            <button className="text-button" onClick={() => void load()}>
              ลองโหลดใหม่
            </button>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
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
              <section className="hero">
                <h2>ยอดสุทธิของสวน</h2>
                <div className="total">{baht(selected.openingMinor)}</div>
                <p>บาท · ยอดสุทธิยกมา</p>
              </section>
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
        {!loading && ready && view !== "garden" && (
          <>
            {view === "home" && (
              <section className="hero">
                <h2>ยอดสุทธิรวมทุกสวน</h2>
                <div className="total">{baht(total)}</div>
                <p>บาท · รวมยอดยกมาของทุกสวน รวมสวนที่เก็บเป็นประวัติ</p>
              </section>
            )}
            {gardens.length === 0 ? (
              <section className="empty">
                <Icon name="plant" />
                <h2>เริ่มจากสวนแรกของคุณ</h2>
                <p>เพิ่มชื่อสวนและยอดสุทธิยกมา</p>
              </section>
            ) : (
              <section className="garden-list" aria-label="สวนทั้งหมด">
                {gardens.map((g) => (
                  <Link
                    className="garden-row"
                    href={"/gardens/" + g.id}
                    key={g.id}
                  >
                    <Icon name="tree-palm" />
                    <span className="garden-name">
                      <strong>{g.name}</strong>
                      <small>
                        {g.archived ? "เก็บเป็นประวัติ" : "ยอดสุทธิยกมา"}
                      </small>
                    </span>
                    <b>{baht(g.openingMinor)}</b>
                    <Icon name="caret-right" />
                  </Link>
                ))}
              </section>
            )}
            <div className="actions add-action">
              <button className="primary" onClick={() => open()}>
                <Icon name="plus" />
                {gardens.length ? "เพิ่มสวน" : "เพิ่มสวนแรก"}
              </button>
            </div>
          </>
        )}
        <p className="section-note footnote">
          ยอดสุทธิเป็นยอดของสวน ไม่ใช่ยอดเงินในบัญชีธนาคาร
        </p>
      </main>
      <nav className="bottom-nav" aria-label="เมนูหลัก">
        <Link href="/" aria-current={view === "home" ? "page" : undefined}>
          <Icon name="house-fill" />
          ภาพรวม
        </Link>
        <Link
          href="/gardens"
          aria-current={view !== "home" ? "page" : undefined}
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
    </>
  );
}
