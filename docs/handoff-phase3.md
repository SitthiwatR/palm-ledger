# ส่งต่องาน Palm Ledger — ผล Phase 3

อัปเดต 21 ตุลาคม 2569 · Repository `SitthiwatR/palm-ledger` · Branch `main`

## ผลส่งมอบ Phase 3

**ผู้ใช้รับงานและให้ปิด Phase 3 แล้ว วันที่ 21 ตุลาคม 2569** Phase 1–3 ปิดแล้ว งานถัดไป Phase 4 ใช้ [handoff-phase4.md](handoff-phase4.md) และ [ข้อความเริ่มแชท](start-phase4.md) ตรวจสิ่งที่ทำไว้กับบิลแล้วก่อนเติมส่วนที่ยังขาด

- หน้า `/records` มีปุ่ม **เพิ่มรายจ่าย** เปิด dialog: สวน วันที่เกิดรายจ่าย ผู้รับเงิน หมายเหตุ และรูปหลักฐานที่ไม่บังคับ รองรับค่าแรงรายวัน ปุ๋ยที่ใช้จริง วัตถุดิบ บำรุงรักษา และรายจ่ายอื่น
- ครึ่งวัน × 500 บาท = 250 บาท ใช้สูตรค่าแรงเดิมและ `labor_profiles` ร่วมกับบิลขาย เลือกชื่อเดิมแล้วเติมอัตราให้ แม้ข้อมูลอัตราโหลดช้ากว่าการพิมพ์ชื่อ; ปิด “จำอัตรานี้” เพื่อแก้เฉพาะรายการโดยไม่ทับอัตราที่จำไว้
- ปุ๋ย 4 กระสอบ × 800 บาท = 3,200 บาท รับรู้เฉพาะที่ใช้จริง ไม่มีรายการซื้อเก็บ/ระบบสต็อก
- จ่ายครบ/บางส่วน/ยังไม่จ่าย พร้อมวันที่และยอดจ่ายครั้งแรก เก็บ `expenses` + `expense_payments` + รูป + profile + audit + idempotency ใน transaction เดียว ยอดค้างคำนวณจากประวัติ ส่วนยอดสุทธิหักยอดเต็มครั้งเดียว
- `sale_labor` เดิมยังคงอยู่ ไม่มี backfill/copy เป็นรายจ่ายใหม่ ไม่เปลี่ยนยอดบิลหรือค่าแรงย้อนหลัง; ยอดสุทธิรวม/รายสวนหัก `expenses` เพิ่มและแสดงยอดค้างแยกจากค่าแรงผูกบิล
- ใช้ signed upload/private Storage/ตรวจ signature, MIME, ขนาดและ checksum ชุดเดิม เปิดรูปผ่าน owner API; `receipt_files` ผูกได้กับ sale หรือ expense อย่างใดอย่างหนึ่ง
- ฟอร์มมี lock กันกดซ้ำ เก็บค่าหลัง error ย้าย focus ไปข้อความผิดพลาดและกลับปุ่มเดิมเมื่อปิด รองรับมือถือ/reduced motion และรักษา UI/Three.js เดิม

### ข้อมูลและ API ที่เพิ่ม

- Migration เพิ่มเติม `20261021081458_phase3_expenses.sql` ไม่แก้ migration ที่ apply แล้ว ไม่ล้างหรือ seed production
- `public.expenses`: quantity × 1,000, rate/amount เป็นสตางค์ พร้อม constraints หน่วย/ชนิด/ครึ่งวัน/สูตรยอดและ owner FK
- `public.expense_payments`: ประวัติการจ่าย มี trigger แบบ security invoker ใน schema private ล็อกแถวรายจ่ายและป้องกันยอดจ่ายรวมเกินยอดเต็ม; ตารางใหม่เปิด RLS ให้ owner อ่าน และไม่อนุญาต client เขียนโดยตรง
- `POST /api/v1/expenses` รับ `gardenId`, `expenseDate`, `kind`, `payee`, `note`, `unit`, `quantity`, `rateBaht`, `paymentStatus`, `paidBaht`, `paymentDate`, `rememberRate` และ `pendingReceiptId` (ไม่บังคับ) พร้อม Idempotency-Key
- หน่วย: daily_labor → day, fertilizer → sack, material/maintenance/other → item; จำนวน/อัตราเป็น decimal string ให้ server คำนวณใหม่
- `paidBaht` ใช้เฉพาะ partial และต้อง > 0, < ยอดเต็ม; full ให้ server ใช้ยอดเต็ม, unpaid ไม่สร้าง payment row และไม่มี paymentDate
- `GET /api/v1/expenses` คืนรายการล่าสุด 200 รายการ พร้อมยอดเต็ม/จ่ายแล้ว/ค้าง รูปและประวัติการจ่าย; pagination/filter/export ยังคงตามเฟสถัดไป
- `GET summary`, `GET gardens`, `GET gardens/:id` และผล write garden เพิ่ม `expensePendingMinor`; `laborPendingMinor` ยังหมายถึงค่าแรงที่ผูกบิลเดิม

### หลักฐานทดสอบรอบ Phase 3

ใช้ PostgreSQL/Auth/PostgREST/Storage จริงที่ localhost ผ่าน `.env.test.local` และ guard เดิมเท่านั้น รัน suites ตามลำดับ ไม่สร้างข้อมูลทดสอบหรือรูปบน hosted production

- Model เดิม 4/4; unit/API/CLI 41/41; typecheck, format:check, production build และ git diff --check ผ่าน
- API ตรวจทั้ง 5 หมวด, ครึ่งวัน/อัตราที่จำ/override, การปัดเศษสตางค์, สถานะจ่ายทั้งสาม, ยอดค้าง/ยอดสุทธิ, invalid kind/unit/จำนวน/อัตรา/ยอดจ่ายเกิน, owner/RLS/direct-write denial, receipt access, retry และคำขอ key เดียวพร้อมกันทั้งที่มี/ไม่มีรูป
- จำลอง failure ตอนเขียน expense audit หลังเพิ่ม payment/profile/รูปแล้ว → rollback ทั้งหมด, upload ยัง pending และ retry ได้รายการเดียว; ตรวจ DB constraints และ trigger จ่ายเกินด้วย
- Chromium กับ production build: **7 ผ่าน, 1 ข้าม** กรณีข้ามคือรูปส่วนตัวสำหรับ OCR ที่ไม่ได้ส่งเข้ารอบนี้ ไม่ใช่งานหลัก Phase 3; flow รายจ่ายใหม่ผ่านครบ รวม form preservation/focus, rates after reload, override, private image, ยอดค้างและสุทธิ, ไม่มี console error/overflow ใน flow ที่ตรวจ
- Safari/iPhone จริงและคุณภาพ OCR ยังคง Phase 10 ไม่อ้างว่าผ่านจากผล Chromium; ไม่แก้ extraction/provider ใน Phase 3

### ขอบเขตเฟสถัดไป

Phase 4 ตรวจ/เติมค่าแรงทีมผูกบิลจากฐานที่มีอยู่; Phase 5 ทำการจ่ายหนี้ภายหลัง ยกเลิกการจ่ายผิด และหนี้เดิม โดยรองรับทั้ง `sale_labor` เดิมและ `expenses` ใหม่ ห้ามหักสุทธิซ้ำจากการจ่าย การบันทึกจ่ายครั้งแรกในเฟสนี้ไม่ใช่การปิด Phase 5 ส่วนการแก้/ยกเลิกรายจ่ายและตัวกรองยังตามแผนเดิม

### Deployment Phase 3 ที่ตรวจแล้ว

- Code `811fae4927d243878eeaeb5349acf0fa31611a1f` push `main` แล้ว; Vercel production `dpl_H27xMDMHg1PF49cBca7ngZQQest5` เป็น **READY** และ alias เว็บจริงตรงกับ deployment นี้
- [เว็บจริง](https://palm-ledger-nine.vercel.app) · [deployment](https://vercel.com/self-ade5/palm-ledger/H27xMDMHg1PF49cBca7ngZQQest5) · Next.js 16.4.2; build output ประมาณ 18 วินาที, จากเริ่ม build ถึง Ready ประมาณ 24 วินาที
- Build logs: `Migrations applied.`, `Owner login: configured`, `Compiled successfully`, `Deployment completed` — migration เพิ่ม schema โดยคงข้อมูล/บัญชี/รูปเดิม ไม่มีการแก้ env หรือ reset production
- ตรวจแบบอ่านอย่างเดียวบน production: `/login` และ `/records` → HTTP 200, `/api/v1/expenses` ไม่มี session → 401; JavaScript ที่เว็บจริงเสิร์ฟมีปุ่มเพิ่มรายจ่ายและ `expensePendingMinor` แล้ว ไม่สร้างรายการ/รูปทดสอบบน production
- Runtime error/fatal scan ของ deployment นี้ในช่วง 10 นาทีที่ตรวจ: ไม่พบแถว error; project ยังไม่มี drains จึงเป็นหลักฐานเฉพาะช่วงที่ตรวจ ไม่อ้างการเฝ้าระวังระยะยาว
- เอกสารผลตรวจ `c6de590` มี deployment `dpl_MAhXdaXFTNzimBe46deBdQDrTPCy` **READY** พร้อม SHA ตรงและ migration/owner/build logs ผ่านแล้ว; เอกสารปิดเฟสอยู่ใน commit ถัดมา ให้ตรวจ HEAD ล่าสุดหลัง push

## คำตัดสินล่าสุดของผู้ใช้

- **Phase 1–3 รับงานและปิดเฟสแล้ว** ให้เดิน Phase 4 ตาม handoff ล่าสุด ไม่ต้องเปิด Phase 3 หรือขอรับงานซ้ำ
- ผู้ใช้ทดสอบและระบุว่า **OCR/data extraction ให้ผลไม่ดี** แม้มีผล automation กับบิลสังเคราะห์และรูปจริงบางรูปผ่าน จึงยังไม่รับรองความแม่นยำหรือเป้าหมายทำจบใน 1 นาที
- ย้ายงานปรับวิธีอ่านบิลไป **Phase 10** ตามแผน คง browser OCR ปัจจุบันและทางกรอก/แก้เองไว้ ไม่เปลี่ยน provider/ปิด OCR/เพิ่มบริการเสียเงินในงาน Phase 3 โดยอัตโนมัติ
- แนวทาง server-side vision model เคยแนะนำเป็นตัวเลือก ยังไม่ได้เลือกบริการหรืออนุมัติค่าใช้จ่าย ต้องเทียบบิลจริงหลายรูปแบบ ความถูกต้องรายช่อง เวลา จำนวนช่องที่ต้องแก้ และต้นทุนก่อนเลือก
- หลักฐาน iPhone/Safari จริง รวม HEIC/HEIF จากอุปกรณ์และเวลาจบทั้ง flow ยังคงค้างใน Phase 10 ไม่ได้ทำเครื่องหมายว่าทดสอบผ่านเพราะปิด Phase 2

## อ่านก่อนลงมือ

1. `AGENTS.md` และคู่มือ Next.js รุ่นที่ติดตั้งก่อนแก้โค้ด (ปัจจุบัน Next.js 16.4.2 / Node.js 24)
2. [แผน](../plans/palm-ledger.md) — acceptance criteria ของ Phase 3 เป็นขอบเขตหลัก
3. [สเปก](../app-spec.md), [user flow](../user-flow.md), [วิธีพัฒนาและทดสอบ](development.md)
4. [ประวัติ Phase 2](handoff-phase2.md) และ [workflow/OCR/ค่าแรง](receipt-first-workflow.md)

## Phase 2 ที่ส่งมอบแล้ว

- บันทึกขายและรายการหักด้วยการคำนวณจำนวนเต็มฝั่ง server พร้อมยอดรายสวน/รวม, owner authorization/RLS, audit, duplicate warning, idempotency และ retry
- รูปก่อน → draft ให้ตรวจแก้เอง → เลือกไม่มีค่าแรง/รายวัน/รายน้ำหนัก → ยืนยันรับเงินเต็มจำนวนและบันทึก
- รูปต้นฉบับ JPEG/PNG/WebP/HEIC/HEIF ไม่เกิน 10 MiB อยู่ใน private Storage มี MIME/ขนาด/checksum และ signed access; HEIC preview แปลงสำเนาโดยไม่ทับต้นฉบับ
- ค่าแรงผูกบิลบันทึกเป็น **ค้างจ่าย** พร้อม sale ใน transaction เดียว รองรับหลายคน/ครึ่งวัน/บาทต่อตัน/แก้ฐานน้ำหนักและจำชื่ออัตรา ค่าแรงลดสุทธิครั้งเดียว ยังไม่มีเส้นทางจ่ายเงินจริงหรือรายจ่ายทั่วไปครบ Phase 3
- Form preservation, upload verification/retry, rollback และ pending/orphan policy มีแล้ว
- จุดเริ่มอ่านโค้ด: `src/server/api.ts`, `src/ui/sale-form.tsx`, `src/ui/ledger.tsx`, `src/lib/sale-math.ts`, `supabase/migrations/`, `tests/integration.test.ts` และ `tests/browser/phase1.spec.ts`
- ใช้ตาราง `sale_labor` / `labor_profiles` ที่มีอยู่เป็นฐาน ตรวจการรวมยอดก่อนเพิ่มรายจ่ายใหม่ **ห้ามนับค่าแรงผูกบิลเดิมซ้ำ** หรือทำให้รายรับ/รูป/ยอด production เปลี่ยนย้อนหลัง

## ขอบเขต Phase 3 ที่ส่งมอบ

พัฒนาตามแผนเดิมจาก UI → API → PostgreSQL/private Storage:

- บันทึกรายจ่ายพร้อมสวน วันที่ ผู้รับเงิน รูปและหมายเหตุ รวมค่าแรงรายวันที่ลงแยกจากบิลขาย
- ค่าแรงครึ่งวันที่ 500 บาท/วัน = 250 บาท จำอัตราเดิมและแก้เฉพาะรายการได้ ใช้ความสามารถจำชื่อ/อัตราที่มีแล้วอย่างสอดคล้องกัน
- ใช้ปุ๋ย 4 กระสอบ × 800 บาท = 3,200 บาท รับรู้เฉพาะปุ๋ยที่ใช้จริง ไม่สร้างบัญชีซื้อ/สต็อกปุ๋ยที่ยังไม่ได้ใช้
- เลือกจ่ายครบ/บางส่วน/ยังไม่จ่าย ยอดค้างถูกต้อง รายจ่ายลดสุทธิครั้งเดียวเมื่อเกิดรายการ และบันทึกประวัติการจ่ายครั้งแรกใน transaction เดียวกัน
- ตรวจชนิด/หน่วย/จำนวนติดลบ/ยอดจ่ายเกิน, owner/RLS, audit, retry/idempotency และรูป private Storage ด้วยบริการจริงในฐานทดสอบแยก
- Phase 5 ยังรับผิดชอบการจ่ายหนี้ภายหลังและแก้ยอดจ่ายผิด อย่าอ้างว่างานนี้ครบแล้วจากการบันทึกจ่ายครั้งแรกของ Phase 3

## รักษา production และ UI

- Production: <https://palm-ledger-nine.vercel.app>; Supabase `feotpdylvprtihgklndj` (อย่าใช้ project เก่า)
- Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`; `main` deploy production
- Code ล่าสุดก่อนปิดเฟส `17bf75f`; docs `53ace2e` ตรวจ Vercel `dpl_FKgoPxvJ3MHEXsiUjGHqSW2oKHtP` READY แล้ว เอกสารปิดเฟสจะอยู่ใน commit ถัดมา ให้ใช้ `main` ล่าสุดเสมอ
- รักษา UI เขียว–ครีม ฟอนต์/เมนูมือถือ/desktop และ Three.js พร้อม reduced motion/fallback ที่รับงานไว้
- ห้าม reset/truncate/seed production หรือทดสอบสร้างรายการ/รูป/การจ่ายบน production ใช้ migration เพิ่มเติมที่คงข้อมูลเดิม ไม่รัน `schema.sql` SQLite เก่าที่ root
- คง Session pooler/TLS verification และค่า credentials ที่ถูกต้อง อย่าทับ env ของ Vercel จาก cloud โดยไม่ตรวจ ไม่พิมพ์ secrets หรือขอ key ในแชต ตรวจ readiness ปัจจุบันก่อนใช้บริการ

## หลักฐานก่อนเริ่ม Phase 3

รอบสุดท้ายก่อนปิด Phase 2: model **4/4**, unit/API/CLI **38/38**, Chromium ของ production build **7/7**, typecheck/format/build ผ่าน รูปจริงอ่านค่าหลักได้ราว 15–22 วินาทีในเครื่องทดสอบ ผลนี้ไม่หักล้างผลทดสอบของผู้ใช้ว่า extraction ยังไม่ดี

Tests มี guard ให้ใช้ `.env.test.local` เฉพาะ PostgreSQL/Auth/REST/Storage localhost แยกจาก production อ่าน `docs/development.md` ก่อนรัน ใช้บริการ test เดิมหากพร้อม; อย่ารัน API/browser suites พร้อมกันเพราะ reset ฐานเดียวกัน และอย่า build ทับ `.next` ขณะ app test ใช้อยู่

การส่งมอบ Phase 3 ต้องทดสอบตาม acceptance criteria และ regression อัปเดตแผน/handoff, commit/push และตรวจ Vercel ของ commit ล่าสุดเป็น Ready พร้อม build/migration logs โดยรักษาข้อมูลเดิม ดูผลรอบนี้ด้านบนและบันทึก deployment

## ข้อความเริ่ม Phase 3 เดิม

[start-phase3.md](start-phase3.md) เก็บเป็นประวัติ งานถัดไปให้ใช้สถานะล่าสุดในเอกสารนี้และแผน Phase 4
