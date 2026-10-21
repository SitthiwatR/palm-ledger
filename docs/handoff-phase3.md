# ส่งต่องาน Palm Ledger — เริ่ม Phase 3

อัปเดต 21 ตุลาคม 2569 · Repository `SitthiwatR/palm-ledger` · Branch `main`

## คำตัดสินล่าสุดของผู้ใช้

- **Phase 1 และ Phase 2 รับงานและปิดเฟสแล้ว** ให้เดินงานเฟสถัดไป ไม่ต้องขออนุมัติเริ่ม Phase 2 ใหม่
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

## งานถัดไป: Phase 3 — รายจ่ายทั่วไป ค่าแรงรายวัน และปุ๋ย

Implement ตามแผนเดิมจาก UI → API → PostgreSQL/private Storage ให้ครบ:

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

## หลักฐานและการทดสอบ

รอบสุดท้ายก่อนปิด Phase 2: model **4/4**, unit/API/CLI **38/38**, Chromium ของ production build **7/7**, typecheck/format/build ผ่าน รูปจริงอ่านค่าหลักได้ราว 15–22 วินาทีในเครื่องทดสอบ ผลนี้ไม่หักล้างผลทดสอบของผู้ใช้ว่า extraction ยังไม่ดี

Tests มี guard ให้ใช้ `.env.test.local` เฉพาะ PostgreSQL/Auth/REST/Storage localhost แยกจาก production อ่าน `docs/development.md` ก่อนรัน ใช้บริการ test เดิมหากพร้อม; อย่ารัน API/browser suites พร้อมกันเพราะ reset ฐานเดียวกัน และอย่า build ทับ `.next` ขณะ app test ใช้อยู่

เมื่อทำ Phase 3 เสร็จ ให้ทดสอบตาม acceptance criteria และ regression ที่เกี่ยวข้อง อัปเดตแผน/handoff, commit/push และตรวจ Vercel ของ commit ล่าสุดเป็น Ready พร้อม build/migration logs โดยรักษาข้อมูลเดิม

## ข้อความสำหรับแชทถัดไป

คัดลอกจาก [start-phase3.md](start-phase3.md) ได้ทันที
