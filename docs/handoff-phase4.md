# ส่งต่องาน Palm Ledger — เริ่ม Phase 4

อัปเดต 21 ตุลาคม 2569 (Asia/Bangkok) · Repository `SitthiwatR/palm-ledger` · Branch `main` ล่าสุด

## คำตัดสินล่าสุด

ผู้ใช้ยืนยันให้ **จบ Phase 3** แล้ว จึงปิด Phase 1–3 และเริ่มงานถัดไป Phase 4: ค่าแรงทีมที่ผูกกับบิลขายตามแผนเดิม ไม่ต้องขอรับงานหรือเริ่ม Phase 3 ซ้ำ ไม่เริ่ม implement Phase 4 ในรอบเขียน handoff นี้

OCR/data extraction ปัจจุบันยังให้ผลไม่ดีตามการทดสอบของผู้ใช้ งานปรับวิธี extraction, iPhone/Safari จริง และเป้าหมายจบใน 1 นาทีคงอยู่ **Phase 10** คง OCR ปัจจุบันและทางกรอก/แก้เองไว้ ไม่เปลี่ยน provider หรือเพิ่มบริการเสียเงินโดยอัตโนมัติ การปิด Phase 3 ไม่ใช่การรับรองคุณภาพ OCR หรือผล Safari

## อ่านก่อนลงมือ

1. `AGENTS.md` และคู่มือ Next.js รุ่นที่ติดตั้งใน `node_modules/next/dist/docs/` ก่อนแก้โค้ด
2. [แผน 10 ขั้น](../plans/palm-ledger.md) — Phase 4 ทั้ง What to build และ acceptance criteria
3. [สเปก](../app-spec.md), [user flow](../user-flow.md), [วิธีพัฒนา/ทดสอบ](development.md)
4. [ผล Phase 3](handoff-phase3.md), [ประวัติ Phase 2](handoff-phase2.md), [workflow บิลและค่าแรง](receipt-first-workflow.md)

ไม่ต้องสัมภาษณ์ brief หรือร่างแผนใหม่ สถาปัตยกรรม Next.js App Router + React/TypeScript + Supabase PostgreSQL/Auth/private Storage ตกลงและใช้งานแล้ว ปัจจุบัน Next.js 16.4.2 / Node.js 24

## ฐานที่ส่งมอบและรับงานแล้ว

- Phase 1: เจ้าของคนเดียว login ด้วย username/password, session 30 วัน, ผู้ดูแล reset, สวน/ยอดยกมา/archive, owner authorization/RLS, audit, idempotency และ version conflict
- Phase 2: ขายรับเงินเต็มจำนวน แนบรูปต้นฉบับ private Storage, รูปก่อน → OCR draft → ตรวจแก้เอง → เลือกค่าแรง → ยืนยัน; server คำนวณจำนวนเต็ม บิลซ้ำมีคำเตือน และ sale/labor/รูปบันทึก atomic
- ค่าแรงผูกบิลที่ย้ายมาทำก่อน: daily หลายคน/ครึ่งวัน หรือ weight ทีมเดียว ใช้น้ำหนักจากบิลและแก้ฐานได้ จำชื่อ/อัตราใน `labor_profiles`; `sale_labor` เป็นรายจ่ายค้างจ่ายและหักสุทธิแล้วครั้งเดียว
- Phase 3: รายจ่ายแยกจากบิล 5 หมวด (daily_labor/fertilizer/material/maintenance/other), ค่าแรงครึ่งวัน × 500 = 250 บาท, ปุ๋ยที่ใช้จริง 4 × 800 = 3,200 บาท, รูป/หมายเหตุ, จ่ายครบ/บางส่วน/ยังไม่จ่ายพร้อมประวัติครั้งแรกแบบ atomic
- `expenses` ใช้จำนวน × 1,000 และเงินสตางค์; `expense_payments` เก็บประวัติ ลดเฉพาะค้าง; `receipt_files` ผูก sale หรือ expense อย่างใดอย่างหนึ่ง; `labor_profiles` ใช้ร่วมกัน มีตัวเลือกเปลี่ยนอัตราเฉพาะรายจ่ายรายวัน
- ยอดสุทธิรวม/รายสวน = ยอดยกมา + sales.net_minor − sale_labor.amount_minor − expenses.amount_minor; `laborPendingMinor` หมายถึงค่าแรงผูกบิลเดิม ส่วน `expensePendingMinor` คือค้างของรายจ่ายแยกบิล ไม่คัดลอก `sale_labor` ไป `expenses`
- UI เขียว–ครีม ฟอนต์ไทยเสิร์ฟเอง เมนูมือถือ/desktop และ Three.js พร้อม fallback/reduced motion ที่ผู้ใช้รับงานแล้ว

## งาน Phase 4

เริ่มด้วยตรวจเทียบ implementation กับแผนและทำรายการช่องว่างสั้น ๆ แล้วเติมเฉพาะที่ยังขาด ไม่สร้างระบบขาย/ค่าแรงผูกบิลใหม่ทั้งชุด และไม่ถือว่างาน Phase 4 เสร็จเพียงเพราะบางส่วนทำไว้แล้ว

เกณฑ์ที่ต้องพิสูจน์จาก UI → API → PostgreSQL จริงในฐานทดสอบ:

- 3,500 กก. × 1,000 บาท/ตัน = ค่าแรงทีม 3,500 บาท จำชื่อและอัตราทีมสำหรับครั้งถัดไป
- เสนอน้ำหนักจากบิล แต่แก้ฐานคิดค่าแรงให้ต่างจากน้ำหนักขายได้ก่อนยืนยัน เก็บฐาน/หน่วย/อัตรา/ยอดชัดเจน การปรับอัตราเฉพาะรายการต้องไม่ทับอัตราที่จำไว้โดยไม่ตั้งใจ ตรวจเส้นทาง sale ด้วย เพราะ Phase 3 เพิ่มตัวเลือกนี้เฉพาะรายจ่ายรายวัน
- บันทึก sale + ค่าแรงทีมสำเร็จทั้งชุดหรือ rollback ทั้งชุด รวมรูป/profile/audit/idempotency; retry และคำขอพร้อมกันไม่เพิ่มรายการหรือค่าแรงซ้ำ
- เปิดตรวจความเชื่อมโยงบิลกับค่าแรงได้ ค่าแรงเป็นยอดรวมทีม ไม่แบ่งให้สมาชิกทีม
- **What to build ของ Phase 4 รวมค่าแรงตามผลผลิตที่ลงแยกจากบิลขายด้วย**: Phase 3 ยังรองรับแยกบิลเฉพาะรายวัน อย่าข้ามส่วนนี้เพราะไม่ได้แยกเป็น checkbox ในแผน ต้องใช้วิธีคำนวณ/อัตราทีมเดิม รักษายอดสุทธิและค้างให้ถูกต้อง และไม่สร้างบิลขายจำลองเพื่อรองรับค่าแรง

การเพิ่มชนิดรายจ่าย/ฐานคำนวณให้ใช้ migration ใหม่ที่คงข้อมูลเดิมและตรวจหน่วยอย่างชัดเจน `sale_labor` เดิมเก็บ weight เป็นกรัมและ daily เป็นจำนวนครึ่งวัน ส่วน `expenses` เก็บ quantity_milli ห้ามตีความหน่วยเหมือนกันโดยไม่แปลง ตรวจความเข้ากันได้กับรูป/ยอดค้าง/อัตราเดิมก่อนเปลี่ยน schema หรือ DTO

Phase 5 ยังรับผิดชอบหนี้เดิม การจ่ายภายหลัง และยกเลิกการจ่ายผิด; Phase 7 รับผิดชอบแก้/ยกเลิกรายการตามแผน อย่าขยายการแก้อัตราก่อนบันทึกเป็นการแก้บิลย้อนหลังโดยเงียบ ๆ ห้ามนับต้นทุนซ้ำเมื่อมีการจ่ายเงินจริง

## จุดเริ่มอ่านโค้ด

- `src/ui/sale-form.tsx`, `src/ui/expense-form.tsx`, `src/ui/ledger.tsx`
- `src/server/api.ts`: saveSale/saveExpense, sales/preferences, sales/expenses reads และ balanceJoins
- `src/lib/sale-math.ts`, `src/lib/expense-math.ts`
- `supabase/migrations/20261021060717_receipt_first_sales_labor.sql`
- `supabase/migrations/20261021081458_phase3_expenses.sql`
- `tests/integration.test.ts`, `tests/expense.test.ts`, `tests/browser/phase1.spec.ts`, `tests/support.ts`

## Production และหลักฐานล่าสุด

- เว็บ <https://palm-ledger-nine.vercel.app>; Supabase production `feotpdylvprtihgklndj` — ไม่ใช้ project เก่า `xljxowrsywlwozzcbnlw`
- Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`; GitHub `main` เป็น production branch
- Code Phase 3 `811fae4`; เอกสารผลตรวจ `c6de590`; deployment ของ `c6de590` คือ `dpl_MAhXdaXFTNzimBe46deBdQDrTPCy` **READY** พร้อม SHA ตรง, `Migrations applied.`, `Owner login: configured` และ `Deployment completed`
- HTTP แบบอ่านอย่างเดียว: `/login`, `/records` → 200, `/api/v1/expenses` ไม่มี session → 401; JS เว็บจริงมีฟอร์ม/ยอดรายจ่ายใหม่แล้ว Runtime error/fatal scan ไม่พบในช่วงที่ตรวจ ไม่มี drains; ไม่อ้าง monitoring ระยะยาว
- Model 4/4; unit/API/CLI 41/41; Chromium production build 7 ผ่าน + 1 ข้าม (รูป OCR ส่วนตัวไม่ได้ส่งเข้ารอบนั้น); typecheck/format/build/diff checks ผ่าน Safari/iPhone จริงยังไม่ยืนยัน
- เอกสารปิด Phase 3/เริ่ม Phase 4 อยู่ใน commit ถัดมา ให้ใช้ `main` ล่าสุดเสมอ และตรวจ deployment ของ HEAD หลัง push

## การรักษาข้อมูลและทดสอบ

ห้าม reset/truncate/seed production หรือสร้างรายการ/รูป/การจ่ายทดสอบบน production คงบัญชี sessions รูปและข้อมูลเดิม ไม่รัน `schema.sql` SQLite เก่าที่ root และไม่แก้ migration ที่ apply แล้ว

คง Session pooler/TLS verification และ credentials ของ Vercel ที่ถูกต้อง อย่าทับ env จาก cloud runtime โดยไม่ตรวจ ไม่เปลี่ยน encryption key/reset รหัสเจ้าของโดยไม่จำเป็น ไม่พิมพ์ secrets หรือขอ key ในแชต ตรวจ network/readiness ปัจจุบันตามเครื่องมือที่มีจริง

ใช้ isolated localhost test stack และ `.env.test.local` พร้อม guard เดิม รันชุดทดสอบทีละชุดเพราะใช้ฐาน/พอร์ตเดียวกัน อย่า build ทับ `.next` ขณะ test server ทำงาน:

```sh
npm ci
npm run local:test:setup
npm run build
TEST_APP_MODE=production npm test
TEST_APP_MODE=production npm run test:browser
npm run typecheck
npm run format:check
```

ไม่จำเป็นต้องรัน baseline ทั้งชุดซ้ำก่อนเปลี่ยนเอกสารเท่านั้น แต่เมื่อ implement ให้ทดสอบตามช่องว่างและ regression ที่เกี่ยวข้อง เมื่อผ่านให้อัปเดตแผน/handoff, commit/push และตรวจ Vercel ของ commit ล่าสุดเป็น Ready พร้อม migration/build logs รักษาข้อมูล production เดิม

## ข้อความเริ่มแชทถัดไป

คัดลอก [start-phase4.md](start-phase4.md) ได้ทันที
