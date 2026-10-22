# ส่งต่องาน Palm Ledger — ผล Phase 7

อัปเดต 22 ตุลาคม 2569 · `SitthiwatR/palm-ledger` · `main`

## สถานะและขอบเขต

ผู้ใช้รับงาน Phase 6 แล้วและอนุญาต Phase 7 ไม่ทำ Phase 1–6 ซ้ำ Phase 7 เพิ่มค้นหา/ตัวกรอง รายงาน CSV และแก้/ยกเลิกต้นทางทั้ง `sales`, `sale_labor`, `expenses`, `opening_debts` โดยรักษารูปและประวัติเดิม **รอผู้ใช้ตรวจรับ ไม่ปิดเฟสแทนผู้ใช้**

หน้า `/records` กด **ค้นหา / แก้รายการ / รายงาน** เพื่อเปิดพื้นที่ตรวจย้อนหลัง กด **กลับหน้าบันทึก** กลับ workflow รูปก่อน/กรอกเองเดิม ไม่มีการแก้ OCR หรือ Three.js งาน extraction และ Safari/iPhone จริงยัง Phase 10

## พฤติกรรมและข้อมูล

- ทุกรายการมี source version, updated time และ soft void พร้อมเหตุผล ห้ามแก้ประวัติที่ยกเลิกแล้ว การแก้จากแท็บเก่าได้ 409 พร้อมปุ่มโหลดล่าสุดที่ผู้ใช้กดเอง ฟอร์มไม่หายเมื่อ network/validation/conflict
- คำนวณยอดใหม่ฝั่งเซิร์ฟเวอร์ด้วยจำนวนเต็ม ตรวจยอดใหม่ไม่น้อยกว่าการจ่ายที่ยังมีผล ไม่เปลี่ยนอัตราที่จำ ไม่เปลี่ยน receipt/payment IDs ไม่สร้างรายจ่าย/การจ่ายสำเนา
- ค่าแรงผูกบิลมี `garden_id`/`labor_date` ของตนเอง Migration เติม snapshot จากบิลเดิมโดยไม่เปลี่ยนยอด การแก้สวน/วันที่หรือยกเลิกบิลขายไม่ย้ายหรือยกเลิกค่าแรงตาม แสดงแต่ละทีม/คน สวน วันที่ ยอดและยอดจ่าย พร้อมปุ่มเปิดค่าแรงแก้แยก ต้องยืนยัน snapshot ของ version ค่าแรงก่อนแก้/ยกเลิกบิล
- รายจ่ายส่วนกลางที่แบ่งแล้ว เมื่อเปลี่ยนยอด/ย้ายสวนต้องยืนยันชุดแบ่งใหม่ทั้งชุดใน transaction เดียว ตรวจรวมครบยอดและสิทธิ์สวน `allocation_version` เปลี่ยนเมื่อยอด/สวน/ชุดแบ่งเปลี่ยน และการแทนชุดแบ่งทำให้ source version เปลี่ยนด้วย จึงกัน stale editor ทั้งสองทาง
- ยกเลิกต้นทางที่มีประวัติจ่ายต้องตรวจผลกระทบและยืนยัน active payment IDs ล่าสุด ยกเลิกการจ่ายที่ยังมีผลทั้งหมดพร้อมต้นทางและ audit ใน transaction เดียว เก็บทุก payment row รวมรายการที่ยกเลิกอยู่ก่อนแล้วไว้ ไม่จำลองโอน/คืนเงินจริง ยกเลิกรายจ่ายทำให้สุทธิเพิ่มตามต้นทุน ยกเลิกขายทำให้รายได้ลด ยกเลิกหนี้เดิมไม่เปลี่ยนสุทธิ
- รูปเดิมเปิดดูได้แม้ต้นทางยกเลิก ประวัติการเปลี่ยนแปลงแสดงเวลา เหตุผล ยอดก่อน/หลัง และสวน วันที่ ผู้รับ/ผู้ซื้อ จำนวน อัตรา หมายเหตุ ชุดแบ่ง/รายการหักที่เปลี่ยน การจ่ายเดิมที่ยกเลิกซ้ำยัง idempotent แม้ต้นทางถูกยกเลิกแล้ว

## API และ transaction

ทุก endpoint ต้องมี owner session; writes ต้อง Origin ตรง APP_URL, `Idempotency-Key` UUID และ JSON มี body limit เดิม ทุก write rechecks owner/auth epoch ใน transaction ก่อน lock/idempotency

- `GET /api/v1/entries`: คืน `entries`, `total`, `page`, `pageSize`, `report` จาก SQL snapshot เดียว
- `GET /api/v1/entries/export`: ตัวกรองเดียวกัน ส่ง UTF-8 BOM/CRLF/quoted CSV พร้อมภาษาไทย ชื่อชนิดภาษาไทย และ escape quotes/newlines ทุกข้อความที่อาจเป็น formula (`= + - @` รวม whitespace/control prefix) ใส่ apostrophe ส่งออกรายการทุกหน้าไม่เกิน 25,000 แถว เกินคืน validation ให้กรองเพิ่ม ไม่มี silent truncation
- Filters: `gardenId` UUID หรือ `shared` (ส่วนกลางที่ยังไม่แบ่ง), `from`/`to` ISO inclusive, `source` = sales/expenses/sale-labor/opening-debts, `kind`, `q` (ผู้ซื้อ/ผู้รับ/เลขบิล/หมายเหตุ แบบ literal ไม่ใช่ SQL wildcard), `paymentStatus` pending/settled, `status` active(default)/all/voided, `page`, `pageSize` (default 20/max 100)
- `GET /api/v1/entries/:source/:id`: raw source fields + `date`, payments ทั้งประวัติ, deductions, allocations, linked labor, receipt IDs, audit, effective paid/pending
- `PATCH /api/v1/entries/:source/:id`: `expectedVersion`, `reason` และข้อมูลธุรกิจที่แก้ครบชุด decimal strings ใช้ `date` ร่วมกัน; expense ส่ง `allocations` ใหม่เมื่อยอด/สวนของชุดแบ่งเปลี่ยน; sale ส่ง `receivedFull:true`, `acknowledgeLabor`, `laborVersions:[{id,version}]` และ `confirmDuplicate` หลังตรวจคำเตือนเลขบิลซ้ำ
- `POST /api/v1/entries/:source/:id/void`: `expectedVersion`, `reason`, `acknowledgePayments`, `activePaymentIds`; sale ต้องยืนยัน linked labor เช่นเดียวกับ edit ถ้ายกเลิกอยู่แล้วคืนสถานะเดิมโดยไม่เขียนซ้ำ
- 422 validation/ยอดต่ำกว่าจ่าย/ชุดแบ่งไม่ครบ; 404 source/สวนไม่ใช่ของเจ้าของ; 409 stale/review snapshot เปลี่ยน/เลขบิลซ้ำ/เปลี่ยน payload ของ key เดิม/source ยกเลิก; retry body+key เดิมคืน response เดิม
- Payment/edit/void/allocation ใช้ source row lock เดียวกัน audit และ idempotency commit/rollback พร้อมข้อมูลธุรกิจ ไม่แยก HTTP writes แล้วถือว่า atomic

## รายงานและความหมายยอด

รายการ รายงาน และ CSV ใช้เงื่อนไขเดียวกัน สวนที่เลือกนับเฉพาะส่วนของต้นทุนที่สวนรับ แม้ต้นทางเป็นส่วนกลาง แสดงยอดเต็มต้นทางแยกจากยอดตามตัวกรอง ไม่คัดลอก payment rows

รายได้ − ต้นทุน = **ความเคลื่อนไหว**; หนี้ก่อนเริ่มระบบไม่ใช่ต้นทุน และการจ่ายไม่หักสุทธิอีกครั้ง รายงานทุกช่วงแสดงยอดยกมาแยก เฉพาะไม่กรองวันที่/ข้อความ/ประเภท/ชนิด/ค้าง และไม่เลือกเฉพาะยกเลิก จึงรวมยอดยกมาในสุทธิ รายสวน/ส่วนกลางรวมกันตรงรายงานรวม

**ค้างปัจจุบันของรายการที่ตรงตัวกรอง** ใช้การจ่ายที่มีผลทั้งหมดแม้จ่ายหลังวันสิ้นช่วง ไม่ใช่ historical balance ณ วันสิ้นช่วง รายการยกเลิกปรากฏเมื่อตั้ง status แต่ไม่รวมรายได้/ต้นทุน/ค้างปัจจุบัน CSV แสดงสถานะเพื่อแยกประวัติได้

## Migration

`20261022000531_phase7_records_reports.sql` เป็น migration ใหม่ ไม่แก้ checksum ของ migrations ที่ใช้แล้ว

- เพิ่ม version/void metadata และ snapshot labor โดยคงแถว/ยอด/IDs เดิม
- Source history trigger กันลบ/แก้รายการยกเลิก เปลี่ยน owner/identity/parent และแก้ยอดต่ำกว่าจ่าย พร้อมเพิ่ม version อัตโนมัติ
- Payment/allocations DB guards ปฏิเสธต้นทางที่ยกเลิก ข้อจำกัด complete allocation เดิมยังทำงานแบบ deferred
- ตรวจ gross math และผลรวม deductions ของ sale ก่อน commit
- `private.expense_attributions_all` เก็บการคำนวณทุกสถานะ; `private.expense_attributions` นับเฉพาะต้นทางปัจจุบัน; `private.ledger_records`/`ledger_attributions` สำหรับรายงาน ทุก view security invoker และไม่ให้ anon/client อ่าน private schema; functions security invoker/search_path ว่าง/ไม่ให้ client execute ตาราง public คง owner RLS/read-only clients เดิม

## ผลตรวจ

ใช้เฉพาะ localhost test PostgreSQL/Auth/PostgREST/Storage จริง มี guard ก่อนสร้าง/ล้าง fixtures ไม่สร้างรายการ รูป การจ่ายทดสอบบน production

- Model **4/4**, unit/API/CLI **64/64** ผ่านกับ production build (รวม upgrade 1 กรณี); รอบ dev ก่อนหน้าผ่าน 63/63 และรัน upgrade แยก 1/1; typecheck/format/build/diff ผ่าน
- สวน A รายได้ 48,000 − ต้นทุน 20,000 = 28,000; B 30,000 − 15,200 = 14,800; รวม 42,800 ทดสอบกรองวันที่และเปิดเผยยอดยกมา 5,000 แยก ไม่บวกซ้ำ การจ่ายหลังช่วงทำให้ค้างปัจจุบันลดถูกต้อง
- สองแท็บ/คำขอซ้ำ/เปลี่ยน body/key, paid floor ทั้ง API/DB, ค่าแรงไม่ย้ายตามบิลและแก้แยกโดยไม่ทับ profile, expense allocations ต้องครบ/กัน stale ข้าม editor
- จำลอง audit failure หลังเปลี่ยน source/ชุดแบ่ง และหลังยกเลิก payments ก่อน void source ตรวจ rollback version/แถว/ประวัติ/audit/idempotency ทั้งชุด แล้ว retry เดิมสำเร็จครั้งเดียว
- Payment แข่งกับลดต้นทุนหรือ void ใช้ lock เดียว ผลจบไม่มีจ่ายเกินหรือข้อมูลครึ่งชุด ตรวจ owner/Origin/RLS/private privileges และ CSV Thai/BOM/formula/quotes/newlines/filter/pagination
- Upgrade test สร้าง database ชั่วคราวแยกบน localhost ใช้ migrations 1–6 จริงและข้อมูลรูปแบบก่อน Phase 7 แล้ว apply migration ใหม่ เปรียบเทียบทุกคอลัมน์เดิมทุกแถว รวม ciphertext ของ session, receipt metadata, audit, profiles, payments active/voided, allocations, owner และยอด attribution ได้เหมือนเดิม เติม snapshot labor ถูกต้อง (Auth/Storage ใน upgrade-only DB เป็น schema stub; main integration suite ใช้ services จริง)
- Full Chromium production build **12 ผ่าน + 1 ข้าม** รวม regression Phase 1–6/รูป/HEIC/manual/Three.js/reduced motion/WebGL fallback; targeted Phase 7 **2/2** ผ่านกับ build ล่าสุดอีกครั้งหลังเพิ่มรายละเอียด audit (สวน/วันที่ก่อน–หลัง) ตรวจ 320 px ไม่มี overflow/page error และ CSV download จริง Safari/iPhone จริงและรูปส่วนตัว OCR ไม่อยู่ในหลักฐานรอบนี้

## Deployment

Production <https://palm-ledger-nine.vercel.app> · Supabase `feotpdylvprtihgklndj` · Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`

ฐานก่อนเริ่ม `b5dc428469e26a7b64928f89f7828b0f30fab9cc` (docs Phase 6), code `4efe66f`; deployment HEAD เดิม `dpl_CbaBZ4coDms25BXTMzQdqARzAabP` READY ผู้ใช้เห็นแล้วและให้เดิน Phase 7

หลัง push ต้องตรวจ HEAD ล่าสุด READY พร้อม repository/branch/SHA/alias, migration checksum/owner/build logs, RLS/advisors และ production HTTP แบบอ่านอย่างเดียว ใช้ `npm run deploy:build` เดิม ไม่เปลี่ยน credentials/encryption key/Auth settings/TLS ไม่มี reset/truncate/seed บน production

## ผล deployment ที่ตรวจแล้ว

Code `ed96e54138b5329c634012baadd4e04dcdab8cd7` push `main` แล้ว Vercel production [`dpl_AfNWxQpfbQuUyHNAF2R4QQ4RYM25`](https://vercel.com/self-ade5/palm-ledger/AfNWxQpfbQuUyHNAF2R4QQ4RYM25) **READY** ตรวจ meta repo `SitthiwatR/palm-ledger`, ref `main`, SHA ตรง และ alias `palm-ledger-nine.vercel.app`

Git integration เริ่ม deployment อัตโนมัติในรอบนี้ ใช้ project/team เดิม ตรวจ build command `npm run deploy:build` และ Git repository ID `1425885308` ก่อนปล่อย Logs มี `Verified official database CA artifact`, `Migrations applied.`, `Owner login: configured`, `Compiled successfully`, `Build Completed` (15 วินาที) และ `Deployment completed`

ตรวจ production แบบอ่านอย่างเดียว:

- Migration Phase 7 applied จริง checksum **`505331e27a034bc0bf7ee4d4bb1e7a43513f3fce11e1c7a1f0a6ec3a88e6b9ec`** ตรงไฟล์ใน Git; ทั้งแปด migrations checksum ตรงและเจ็ดรายการเดิมไม่เปลี่ยน
- เทียบจำนวนแถวและ digest ของคอลัมน์เดิมก่อน/หลัง migration ทั้ง `sales`, `sale_labor`, `expenses`, `opening_debts`, `expense_payments`, `expense_allocations`, `receipt_files`, `labor_profiles`, `gardens` ได้เหมือนเดิมทั้งหมด Snapshot สวน/วันที่ค่าแรงเดิมตรงบิลทุกแถว (mismatch 0) ไม่พิมพ์ข้อมูลธุรกิจหรือ secrets ลง log
- Public source/payment/allocation tables ยังเปิด RLS; authenticated SELECT เท่านั้น ไม่ให้ INSERT/UPDATE/DELETE และ anon อ่านไม่ได้ Private views ทั้งสี่เป็น security invoker/ไม่ให้ client หรือ anon อ่าน Functions ทั้งห้าเป็น security invoker/search_path ว่าง/ไม่ให้ client หรือ anon execute
- Security advisors ไม่มีข้อแจ้งใหม่ของ Phase 7 มี warning เดิมเรื่อง [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ไม่เปลี่ยน Auth settings
- `/login`, `/records` → 200; unauthenticated `/api/v1/entries`, `/api/v1/entries/export` → 401 JavaScript ที่ production เสิร์ฟจริงมี `laborVersions`, `selected_pending_minor`, `entries/export`
- Error/fatal runtime scan ของ deployment นี้ช่วง 10 นาทีที่ตรวจไม่พบ log ไม่ใช่การรับรอง monitoring ระยะยาว ไม่สร้างรายการ รูปหรือการจ่ายทดสอบบน production

ผลตรวจนี้บันทึกใน commit เอกสารถัดจาก code ต้องตรวจ deployment ของ **HEAD ล่าสุดหลัง push เอกสาร** อีกครั้ง ไม่ใช้ Ready ของ code commit แทน HEAD ล่าสุด

## งานต่อ

รอผู้ใช้ตรวจรับ Phase 7 ก่อนปิดเฟส/เดิน Phase 8 การสำรอง/กู้คืน Phase 8 ต้องรวม snapshot labor ใหม่, versions/void metadata, payment/allocations/audit และรูป/session ตามขอบเขตแผนเดิม งาน extraction/Safari/iPhone จริงยัง Phase 10
