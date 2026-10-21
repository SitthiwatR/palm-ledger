# ส่งต่องาน Palm Ledger — ผล Phase 4

อัปเดต 21 ตุลาคม 2569 (Asia/Bangkok) · `SitthiwatR/palm-ledger` · `main`

## สถานะ

Phase 1–3 ผู้ใช้รับงานและปิดแล้ว **Phase 4 implement และทดสอบแล้ว รอผู้ใช้ตรวจรับ** ไม่ปิดเฟสแทนผู้ใช้ งานถัดไปตามแผนคือ Phase 5 ไม่ได้ implement การจ่ายหนี้ภายหลังในรอบนี้

## ตรวจช่องว่างและสิ่งที่เติม

- ของเดิมมีฟอร์มขาย daily/weight, สูตรจำนวนเต็ม, ฐานน้ำหนักแก้ได้, `sale_labor`, `labor_profiles`, การเชื่อมบิลในรายการขาย และ transaction/retry อยู่แล้ว ใช้ต่อทั้งหมด
- เติม checkbox **จำอัตรานี้ไว้ใช้ครั้งถัดไป** รายคน/ทีมในฟอร์มขาย ปิดเพื่อเปลี่ยนอัตราเฉพาะบิลได้ `rememberRate: false` ไม่สร้าง/ทับ profile ทั้งในฐานและ state ฝั่ง browser; ไม่ส่ง field ยังใช้พฤติกรรมเดิม จึงคง fingerprint ของคำขอเก่าได้
- เติมรายจ่าย **ค่าแรงทีมตามผลผลิต** แยกจากบิลขาย (`kind: weight_labor`, `unit: kg`) ใช้ `expenses`/`expense_payments`/รูปเดิมและ `calculateLabor` ไม่สร้างบิลขายจำลอง ไม่คัดลอก `sale_labor`
- ฟอร์มรายจ่ายจำ/เติมชื่อและอัตรา weight จาก `labor_profiles` เดียวกับฟอร์มขาย รองรับ override ที่ไม่ทับอัตราเดิม พร้อมหมายเหตุ รูป และจ่ายครบ/บางส่วน/ยังไม่จ่ายครั้งแรกตาม Phase 3
- ประวัติรายจ่ายแสดงน้ำหนักกิโลกรัมกับบาทต่อตันชัดเจน ส่วนค่าแรงผูกบิลเปิดตรวจในแถวบิลเดิมพร้อมเลขบิล น้ำหนักขาย ฐานค่าแรง อัตรา และยอดรวมทีม ไม่แบ่งสมาชิก

## Schema และการรวมยอด

Migration ใหม่ `20261021123258_phase4_weight_labor.sql` ขยาย constraints ของ `expenses` โดยไม่แก้ migration เดิม ไม่แปลง/ลบข้อมูลเดิม ไม่เพิ่มสิทธิ์เขียน client หรือเปลี่ยน owner RLS

- `sale_labor`: weight เก็บกรัม; daily เก็บจำนวนครึ่งวัน คงเดิม
- `expenses.quantity_milli`: จำนวน × 1,000 ตาม `unit`; weight คือกิโลกรัม × 1,000 (เชิงตัวเลขตรงกับกรัม); daily คือวัน × 1,000 ต่างจากจำนวนครึ่งวันของ `sale_labor`
- `weight_labor.rate_minor`: สตางค์ต่อตัน สูตร `(quantity_milli × rate_minor + 500000) / 1000000` ปัดลงหลังบวกครึ่ง; ชนิดเดิมใช้ตัวหาร 1,000
- constraints ตรวจ kind/unit/ขอบเขต rate/ยอดคำนวณ ให้ตรงกับ API และสูตรค่าแรงเดิม
- สุทธิ = ยกมา + `sales.net_minor` − `sale_labor.amount_minor` − `expenses.amount_minor` หักต้นทุนครั้งเดียว การจ่ายครั้งแรกลดเฉพาะค้าง ไม่หักสุทธิซ้ำ
- `laborPendingMinor` ยังหมายถึงค่าแรงผูกบิล; `expensePendingMinor` รวมรายจ่ายทีมแยกบิล ไม่ย้าย/นับ `sale_labor` ซ้ำ

## หลักฐานทดสอบ

ใช้ PostgreSQL/Auth/PostgREST/Storage จริงใน isolated localhost test stack ผ่าน `.env.test.local`/guard เดิม รัน suites ทีละชุด ไม่สร้างรายการ รูป หรือการจ่ายทดสอบบน production

- Model **4/4**; unit/API/CLI **42/42**; Chromium production build **8 ผ่าน + 1 ข้าม** (private OCR photo ไม่ได้ส่งเข้ารอบนี้) พร้อม typecheck/format/build/diff ผ่าน
- 3,500 กก. × 1,000 บาท/ตัน = 3,500 บาท ทั้งผูกบิลและแยกบิล; จ่ายครั้งแรก 1,000 → ค้าง 2,500 บาท
- ขาย 3,500 กก. แต่ฐานค่าแรง 3,250 กก. × 1,200 = 3,900 บาท เก็บฐานแยกและคงอัตราที่จำ 1,000 บาท/ตันเมื่อ override; กรณีเศษ 3,250.125 กก. × 1,200 = 3,900.15 บาท
- คำขอ key เดียวพร้อมกันได้รายการเดียวทั้ง sale/labor และ expense; key เดิม body เปลี่ยนได้ 409; หน่วยผิดได้ 422; DB ปฏิเสธสูตรคำนวณที่ผิด 1,000 เท่า
- จำลอง failure กลาง transaction ค่าแรงทีมผูกบิลและตอน expense audit หลังสร้าง payment/profile/รูปแล้ว ตรวจ rollback/retry และ pending รูปที่ใช้ต่อได้
- ตรวจ RLS/owner/direct-write denial, รูป private, daily ครึ่งวัน/อัตราเดิม/ปุ๋ย/รายจ่ายเดิม, ยอดสุทธิรวมและค้างแยก, ฟอร์ม error/focus, HEIC/manual fallback, Three.js/reduced motion/fallback และ mobile overflow
- Browser ใหม่ตรวจค่าแรงทีมแยกบิล → reload → ฟอร์มขายใช้อัตราเดียวกันและน้ำหนักจากบิล → override น้ำหนัก/อัตรา → เปิดดูการเชื่อมบิล → กลับลงรายจ่ายทีมจ่ายครบโดยยอดสุทธิ/ค้างถูกต้อง

## Deployment และการรักษาข้อมูล

Production <https://palm-ledger-nine.vercel.app> · Supabase `feotpdylvprtihgklndj` (ไม่ใช้ project เก่า `xljxowrsywlwozzcbnlw`)

Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`; GitHub `main` เป็น production branch การ push เรียก `deploy:build` apply migration ก่อน build

Code `5c81bf1cd6dc06a9472dcced1fc90c234b9f613e` push `main` แล้ว; production deployment [`dpl_913qDxYEvm5KwZNZyUgLLiEscZSY`](https://vercel.com/self-ade5/palm-ledger/913qDxYEvm5KwZNZyUgLLiEscZSY) **READY** พร้อม repository/branch/SHA ตรงและ alias เว็บจริง Build logs มี `Migrations applied.`, `Owner login: configured`, `Compiled successfully` และ `Deployment completed` (build output ประมาณ 15 วินาที)

ตรวจ production แบบอ่านอย่างเดียว: `/login` และ `/records` → 200, unauthenticated `/api/v1/expenses` → 401; error/fatal scan ของ deployment นี้ช่วง 10 นาทีที่ตรวจไม่พบแถว log ไม่ใช่การรับรอง monitoring ระยะยาว ไม่มีการแก้ env/reset บัญชีหรือสร้างข้อมูล/รูปทดสอบบน production

เอกสารผล deploy อยู่ใน commit ถัดจาก code ข้างต้น ให้ตรวจ deployment ของ HEAD ล่าสุดหลัง push เสมอ

ห้าม reset/truncate/seed production หรือทดสอบสร้างรายการ/รูป/การจ่ายบน production คงบัญชี sessions credentials/encryption key และ TLS verification เดิม ไม่เปลี่ยน UI เขียว–ครีม/Three.js และไม่แก้ OCR ในงานนี้

## ขอบเขตถัดไป

- Phase 5: หนี้เดิม จ่ายภายหลัง และยกเลิกการจ่ายผิด ต้องรองรับ `sale_labor` กับ `expenses` รวม weight_labor โดยไม่หักต้นทุนซ้ำ
- Phase 7: แก้/ยกเลิกรายการย้อนหลัง ไม่เปลี่ยนตามบิลเงียบ ๆ
- Phase 10: ปรับ extraction และตรวจ iPhone/Safari จริง/เป้าหมาย 1 นาที คง OCR ปัจจุบันและทางกรอก/แก้เองไว้ ไม่ถือว่าผล Chromium คือ Safari หรือรับรองคุณภาพ OCR

อ่าน `AGENTS.md`, คู่มือ Next.js ที่ติดตั้ง, แผน, สเปก, `docs/development.md` และ handoff นี้ก่อนงานถัดไป ไม่ต้องทำ Phase 1–4 ซ้ำ
