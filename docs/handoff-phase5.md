# ส่งต่องาน Palm Ledger — ผล Phase 5

อัปเดต 21 ตุลาคม 2569 · `SitthiwatR/palm-ledger` · `main`

## สถานะและขอบเขต

Phase 1–3 ผู้ใช้รับงานและปิดแล้ว Phase 4 implement/ทดสอบแล้ว และผู้ใช้อนุญาตให้เดิน Phase 5 โดยไม่ทำ Phase 4 ซ้ำ Phase 5 implement แล้ว ผลตรวจและ deployment อยู่ด้านล่าง **รอผู้ใช้ตรวจรับ ไม่ปิดเฟสแทนผู้ใช้**

- `/records` มีส่วน **หนี้และการจ่าย** ต่อจากฟอร์มขาย กรองสวน คน/ทีม/ร้าน และเฉพาะหนี้ที่ยังค้าง ดูยอดค้างปัจจุบันรวมของเจ้าหนี้ที่เลือก และเปิดประวัติรายครั้งได้ รวมรายการจ่ายครบแล้ว
- เพิ่มหนี้ก่อนเริ่มระบบแยกสวน/เจ้าหนี้/วันที่/หมายเหตุ โดยไม่หักยอดสุทธิยกมาหรือเพิ่มต้นทุนงวดใหม่
- จ่ายภายหลังหลายครั้งได้ทั้ง `sale_labor` แบบ daily/weight, `expenses` ทุกชนิด รวมค่าแรงทีมตามผลผลิตแยกบิล และหนี้เดิม ไม่มีรอบจ่ายบังคับและไม่มีการโอนเงินจริง
- ยกเลิกเฉพาะการจ่ายผิดพร้อมเหตุผล แล้วบันทึกใหม่ ประวัติเดิมยังอยู่ พร้อมวันที่จ่าย ยอด เหตุผลและเวลายกเลิก รองรับการยกเลิก **การจ่ายครั้งแรกจาก Phase 3/4** ด้วย
- ฟอร์มมี lock กันส่งซ้ำ เก็บ payload/key สำหรับ retry เมื่อคำตอบหาย คงข้อมูลและ focus ข้อผิดพลาด; dialog มี native focus trap และคืน focus เมื่อปิด ยอดเปลี่ยนหลัง backend ยืนยันและโหลดผลจริง
- คง OCR/manual fallback, UI เขียว–ครีม, Three.js, sessions, รูปต้นฉบับและข้อมูลเดิม

## Schema และกติกายอด

Migration เพิ่มเติม `20261021153814_phase5_debts_and_payments.sql` ไม่แก้ migrations ที่ apply แล้ว ไม่ reset/truncate/seed production และไม่ backfill/คัดลอกข้อมูลค่าแรงหรือการจ่ายเก่า

- เพิ่ม `public.opening_debts`: owner, garden, debt date, payee, note, amount เป็นสตางค์ พร้อม owner FK/RLS และสิทธิ์ client อ่านเท่านั้น
- ขยาย **`public.expense_payments` เดิม** ให้มีเป้าหมายอย่างใดอย่างหนึ่ง: `expense_id`, `sale_labor_id`, `opening_debt_id` พร้อม composite owner FK ของทุกเป้าหมาย การจ่ายเก่าใช้ ID/แถวเดิม
- เพิ่ม `voided_at`, `void_reason`; คู่ต้องครบและเหตุผลไม่ว่าง การจ่ายใหม่ต้อง active ข้อมูลจำนวนเงิน วันที่ เป้าหมาย เจ้าของและ ID แก้ทับไม่ได้ ตารางปฏิเสธการลบประวัติ ใช้ void ครั้งเดียว
- Trigger `private.check_expense_payment` แบบ security invoker/search path ว่าง ล็อกแถวต้นทางและตรวจผลรวมการจ่ายที่ยังมีผล ไม่ให้เกินยอดเต็ม คงสิทธิ์ client เขียนโดยตรงไม่ได้ และ revoke execute ของ function จาก client/PUBLIC
- API ใช้ transaction, ตรวจ owner/auth epoch, advisory lock ตาม owner+idempotency key และล็อกต้นทางก่อนอ่านยอดหรือเปลี่ยนการจ่าย (void ล็อกต้นทางก่อน payment) การจ่าย/audit/idempotency commit พร้อมกัน ถ้าล้มเหลวย้อนทั้งชุด
- retry key เดิม/body เดิมคืน response เดิม; key เดิม/body หรือ resource ต่างกันได้ 409 การ void ที่ยกเลิกไปแล้วแม้ใช้ key ใหม่ไม่เพิ่มหนี้หรือ audit ซ้ำ คืนยอดปัจจุบัน
- สุทธิ = ยกมา + ขาย − ค่าแรงผูกบิลเต็มจำนวน − รายจ่ายเต็มจำนวน **ไม่หักหนี้เดิมหรือการจ่าย** ค้าง = ยอดเต็ม − ผลรวม payment ที่ `voided_at is null`
- `laborPendingMinor` เป็น **ค้างจริงของค่าแรงผูกบิลหลังการจ่าย/void**; `expensePendingMinor` เป็นค้างรายจ่ายแยกบิล; เพิ่ม `openingDebtPendingMinor` แยกหนี้เดิมใน summary/gardens/detail/write garden ไม่ปะปนกับต้นทุน
- `GET sales` เพิ่ม paid/pending ของค่าแรง และ `GET expenses` คงประวัติทั้งหมดรวม void แต่ paid/pending นับเฉพาะที่ยังมีผล

## API ที่เพิ่ม

ทุก endpoint ต้องมี owner session; ทุก write ตรวจ Origin และ `Idempotency-Key` UUID ใช้ error envelope เดิม (422 ข้อมูลผิด, 404 ไม่พบ/ไม่ใช่ของเจ้าของ, 409 key ชนหรือจ่ายเกินค้าง)

- `GET /api/v1/payables`: อ่านทั้งสามแหล่งพร้อม source/id, สวน, วันที่ธุรกิจ, payee, note, ยอดเต็ม/จ่ายแล้ว/ค้าง, เลขบิลของค่าแรงผูกบิล และประวัติพร้อมสถานะ void ไม่ตัดประวัติที่จ่ายครบแล้ว ไม่มี pagination/filter รายงานวันที่จาก Phase 7 ใน endpoint นี้
- `POST /api/v1/opening-debts`: `{ gardenId, debtDate, payee, amountBaht, note? }` สร้างได้เฉพาะสวนที่ใช้งาน
- `POST /api/v1/expenses/:id/payments`
- `POST /api/v1/sale-labor/:id/payments`
- `POST /api/v1/opening-debts/:id/payments`
  ทั้งสามรับ `{ paymentDate, amountBaht }` จำนวนบาทเป็น decimal string ไม่เกิน 2 ตำแหน่ง server แปลงสตางค์และตรวจค้างใหม่ภายใต้ lock จ่ายหนี้สวนที่เก็บเป็นประวัติได้
- `POST /api/v1/payments/:id/void`: `{ reason }` ไม่ต้องลบ/ยกเลิกรายการต้นทางและไม่จำลองคืนเงินจริง

Audit ใหม่: `opening_debt.created`, `payment.created`, `payment.voided` (before/after ของการจ่ายที่ยกเลิก) คง audit การจ่ายครั้งแรก `expense.payment.created` เดิม

## หลักฐานทดสอบ

ทดสอบกับ PostgreSQL/Auth/PostgREST/Storage จริงบน localhost test stack แยก `.env.test.local` และ guard เดิม รัน suites ทีละชุด ไม่มีรายการ รูปหรือการจ่ายทดสอบบน hosted production

- Model **4/4**, unit/API/CLI **48/48** ผ่านทั้ง dev และ production build; typecheck/format/build/diff ผ่าน
- ยกมา 5,000 + หนี้เดิม 1,000 → สุทธิ 5,000 และค้างหนี้เดิม 1,000 แยกกัน
- หนี้ 10,000 จ่าย 6,000 แล้ว 4,000 → ค้าง 0; ตรวจ daily/weight ค่าแรงผูกบิลและค่าแรงทีมแยกบิลด้วย ยอดสุทธิไม่เปลี่ยนจากการจ่าย
- คำขอ key เดียวพร้อมกันคืน payment เดียว; key เดิมข้อมูลเปลี่ยนได้ 409; คำขอคนละ key ที่รวมเกินค้างได้ 200+409 ทั้งสามแหล่ง; trigger ป้องกัน concurrent SQL writes โดยตรงด้วย
- หนี้ 10,000 จ่ายผิด 5,000 → ค้าง 5,000; void → 10,000; ลงจริง 500 → 9,500 เก็บแถวเดิมและประวัติใหม่ การ void ซ้ำไม่เพิ่มค้าง/audit แม้ใช้ key ใหม่
- payment แข่งกับ void ให้ผลรวมถูกต้องทุกแหล่ง; ยกเลิกการจ่ายครั้งแรกเดิมได้และ expense history/summary คำนวณใหม่
- จำลอง audit failure หลังสร้างหนี้/เพิ่ม payment/เปลี่ยน void แล้ว ตรวจว่าแถว ประวัติ audit และ idempotency ย้อนพร้อมกัน จากนั้น retry key เดิมสำเร็จครั้งเดียว
- ปฏิเสธจำนวนศูนย์/ติดลบ/ทศนิยมเกิน/ไม่ใช่ตัวเลข/เกินขอบเขต วันผิด เหตุผลว่าง source ไม่พบ unauthorized/cross-origin; owner อ่านผ่าน RLS ได้ outsider/anon อ่านไม่ได้ client INSERT/PATCH/DELETE โดยตรงไม่ได้

Chromium กับ production build **9 ผ่าน + 1 ข้าม** (รูปส่วนตัว OCR ไม่ได้ส่งเข้ารอบนี้) รวม flow Phase 5: เพิ่มหนี้ 1,000 จากยกมา 5,000 → เพิ่มหนี้อีก 10,000 → ส่งจ่าย 5,000 ล้มเหลวแล้วคงค่า/focus และ retry → void พร้อมเหตุผล → ลงใหม่ 500 → reload ค้าง 9,500 และประวัติสองครั้งยังอยู่ สุทธิสวนยัง 5,000 ตรวจความกว้าง 320 px ไม่ล้นและไม่มี page error พร้อม regression สวน/รูป private/HEIC/manual/อัตราเดิมและ Three.js ทั้ง reduced motion/WebGL fallback ผ่าน

ผลนี้ไม่ใช่การตรวจ Safari/iPhone จริงหรือการรับรองคุณภาพ OCR งานเหล่านั้นยัง Phase 10

## Deployment และการรักษาข้อมูล

Production <https://palm-ledger-nine.vercel.app> · Supabase **`feotpdylvprtihgklndj`** · Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`

GitHub `main` เป็น production branch; push เรียก `deploy:build` apply migrations แบบ transaction/checksum ก่อน build ต้องตรวจ deployment ของ **HEAD ล่าสุดหลัง push** พร้อม repository/branch/SHA, alias และ migration/owner/build logs

ไม่เปลี่ยน credentials, encryption key, Auth settings หรือ TLS verification ในงานนี้ Security advisor ก่อน deploy มี warning เดิมเรื่อง [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ไม่ใช่ข้อแจ้งใหม่ของ Phase 5

## งานถัดไป

รอผู้ใช้ตรวจรับ Phase 5 ก่อนปิดเฟส ไม่ implement เฟสอื่นในรอบนี้

- Phase 6: ค่าใช้จ่ายส่วนกลาง/แบ่งเข้าสวน ต้องใช้ต้นทางและประวัติจ่ายชุดเดิม ไม่คัดลอก payment และรักษายอดสุทธิ/ค้างรวม
- Phase 7: แก้/ยกเลิกรายการต้นทาง รายงาน ตัวกรองวันที่และ CSV ยังไม่ทำ การยกเลิก payment ใน Phase 5 ไม่ใช่การยกเลิกต้นทาง
- Phase 10: extraction และ iPhone/Safari จริงยังคงค้าง ผล Chromium ไม่แทนการตรวจอุปกรณ์จริงหรือคุณภาพ OCR

ก่อนงานถัดไปอ่าน `AGENTS.md`, คู่มือ Next.js ที่ติดตั้ง, แผน, `app-spec.md`, `docs/development.md` และ handoff นี้ ใช้หนี้/การจ่ายที่มีแล้วต่อ ไม่ implement Phase 1–5 ซ้ำ
