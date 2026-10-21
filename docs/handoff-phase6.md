# ส่งต่องาน Palm Ledger — ผล Phase 6

อัปเดต 21 ตุลาคม 2569 · `SitthiwatR/palm-ledger` · `main`

## สถานะ

ผู้ใช้รับงาน Phase 5 และอนุญาตเดิน Phase 6 แล้ว ไม่ทำ Phase 1–5 ซ้ำ Phase 6 implement และทดสอบแล้ว ผลตรวจและ deployment อยู่ด้านล่าง **รอผู้ใช้ตรวจรับ ไม่ปิดเฟสแทนผู้ใช้**

## สิ่งที่เพิ่ม

- ฟอร์มรายจ่ายเดิมเลือก **ส่วนกลาง — ยังไม่แบ่งเข้าสวน** ได้ ใช้หมวด สูตรค่าแรง อัตราที่จำ รูป private และการจ่ายครั้งแรกเดิม แม้ยังไม่มีสวนก็ลงส่วนกลางได้ ไม่สร้างสวนจำลอง
- ส่วนกลางที่ยังไม่แบ่งหักจากยอดสุทธิรวมเต็มจำนวนครั้งเดียว แสดงยอดเต็ม/ค้างที่ยังเป็นส่วนกลางแยกจากรายสวนอย่างชัดเจน ไม่หักการจ่ายซ้ำ
- ส่วน **หนี้และการจ่าย** แสดงรายการส่วนกลางและปุ่ม **แบ่งเข้าสวน / แก้ชุดแบ่ง** แบ่งยอดต้นทุนเต็มให้ครบ ไม่ใช่แบ่งเฉพาะยอดค้าง คงรายการต้นทาง รูปและ payment IDs เดิม
- แสดงยอดต้นทุน จ่ายตามสัดส่วน และค้างของแต่ละสวน กรองสวนแล้วหัวข้อค้างใช้เฉพาะส่วนของสวนนั้น รวมถึงเลือกดูส่วนกลางที่ยังไม่แบ่งได้
- จ่ายเพิ่ม/void หลังแบ่งใช้ payment API เดิม ยอดรายสวนคำนวณใหม่จากการจ่ายที่ยังมีผล ไม่มีการคัดลอกเป็นการจ่ายใหม่หรือจำลองโอนเงินจริง
- แก้ชุดแบ่งทั้งชุดด้วย expected version ป้องกันแท็บเก่าทับกัน ถ้า stale คงค่าที่กรอกและให้โหลดชุดล่าสุดก่อนแก้ต่อ; network error คงค่า/focus และ retry ใช้ key เดิม
- เว้นว่างหรือใส่ 0 สำหรับสวนที่ไม่แบ่งให้; เลือก **เก็บทั้งหมดเป็นส่วนกลาง** แล้วกดยืนยันเพื่อเอาชุดแบ่งออกทั้งชุด ยอดกลับเป็นส่วนกลางโดยต้นทางและประวัติไม่เปลี่ยน
- คง UI เขียว–ครีม/Three.js, บัญชี/sessions/รูป/ข้อมูลเดิม ไม่แก้ OCR; การแก้/ยกเลิกรายการต้นทางยัง Phase 7

## Schema และกติกายอด

Migration ใหม่ `20261021160407_phase6_shared_expenses.sql` ไม่แก้ migrations ที่ apply แล้ว ไม่ backfill/คัดลอกรายการหรือ payment และไม่มี reset/truncate/seed บน production

- `expenses.garden_id` อนุญาต NULL หมายถึง **ต้นทางส่วนกลาง** แม้แบ่งแล้วก็ยังเป็น NULL รายการที่ผูกสวนเดิมยังคงเดิมและแบ่งไม่ได้
- `expenses.allocation_version` เริ่ม 1 แยกจาก version ของสวน เพิ่มเมื่อแทนชุดแบ่งสำเร็จ ไม่เปลี่ยนเมื่อเพิ่ม/void payment
- `public.expense_allocations`: PK expense+garden, owner FK และ composite owner FK ไป expense/garden, amount เป็นสตางค์บวก พร้อม indexes/RLS owner SELECT และ client เขียนโดยตรงไม่ได้
- Trigger security invoker ใน schema private ล็อกแถว expense ตรวจว่าต้นทางเป็นส่วนกลางและยอดสะสมไม่เกินต้นทาง; deferred constraint triggers ตรวจตอน commit ว่าชุดแบ่งต้อง **ครบเท่ายอดเต็ม** หรือ **ไม่มีแถวทั้งชุด** เท่านั้น รวมถึงป้องกันการแก้สวน/ยอดต้นทางให้ขัดกับชุดแบ่งที่มีอยู่
- API ตรวจ owner/auth epoch, Origin, idempotency, expected version และล็อก expense ก่อนอ่าน/ลบ/เขียนชุดแบ่ง ใช้ lock ต้นทางเดียวกับ payment/void การแบ่ง/audit/version/idempotency จบใน transaction เดียว ไม่เรียกบริการภายนอกระหว่าง transaction
- แบ่งใหม่ได้เฉพาะสวนที่ใช้งาน; สวนที่เก็บเป็นประวัติและอยู่ในชุดเดิมยังรักษา/ปรับส่วนเดิมได้ ไม่บังคับย้ายประวัติออก การเลือกสวนที่ไม่มี/ไม่ใช่ของ owner ถูกปฏิเสธ
- `private.expense_attributions` เป็น view `security_invoker=true` ไม่เปิดผ่าน Data API/revoke client access คำนวณยอดสวนหรือส่วนกลางจากต้นทางและ payment ที่ยังมีผล ใช้เป็นแหล่งยอดเดียวกันสำหรับ overview/gardens/detail/write garden/รายละเอียดชุดแบ่ง

ให้ยอดเต็มต้นทาง `T`, จ่ายที่ยังมีผล `P`, ยอดต้นทุนสะสมก่อนสวนนี้ `Cprev` และหลังสวนนี้ `C` เรียง **garden UUID คงที่**:

`paidShare = roundHalfUp(P × C / T) − roundHalfUp(P × Cprev / T)`

คำนวณด้วย PostgreSQL numeric/integer ไม่ใช้ floating point เป็นยอด authoritative; ค้างของสวน = ต้นทุนที่แบ่ง − paidShare ผลรวม paidShare เท่ากับ P และแต่ละสวนไม่ติดลบหรือเกินต้นทุน เศษหนึ่งสตางค์อาจย้ายระหว่างสวนเมื่อ P เปลี่ยนตามการปัดเศษ แต่ไม่ใช่ประวัติการโอนเงินจริงรายสวน

สุทธิรวม = ผลรวมสุทธิทุกสวน − ต้นทุนส่วนกลางที่ยังไม่แบ่ง ยอดจ่ายไม่หักสุทธิ การแบ่งเปลี่ยนเฉพาะการระบุต้นทุน/ค้างเข้าสวน ไม่เปลี่ยนสุทธิหรือค้างรวมของเจ้าหนี้

## API

- `POST /api/v1/expenses`: `gardenId: null` สำหรับส่วนกลาง นอกนั้นใช้ contract เดิม; payload เก่าที่ใช้ UUID และ fingerprint ของคำขอเก่ายังใช้ได้
- `PUT /api/v1/expenses/:id/allocations`: `{ expectedVersion, allocations: [{ gardenId, amountBaht }] }` พร้อม owner session/Origin/Idempotency-Key ยอดบาทเป็น decimal string, สวนไม่ซ้ำ, สูงสุด 200 สวนและรวมต้องตรงยอดเต็ม ส่ง `allocations: []` เพื่อเก็บทั้งหมดเป็นส่วนกลาง
- คืน `{ id, allocationVersion, allocations }` พร้อมแต่ละสวน: `gardenId`, `gardenName`, `amountMinor`, `paidMinor`, `pendingMinor`
- 422 เมื่อยอดไม่ครบ/เกิน/สวนซ้ำ/ข้อมูลผิด/ต้นทางไม่ใช่ส่วนกลาง; 404 source/สวนไม่พบ; 409 stale version หรือ reuse key กับ body/resource อื่น retry คำขอเดิมคืน response เดิม
- `GET expenses` และ `GET payables` เพิ่ม `allocationVersion`/`allocations` รายการส่วนกลางยังมี `gardenId: null` และ `gardenName: ส่วนกลาง` แม้แบ่งแล้ว ส่วน payment history ยังคงเป็นประวัติของต้นทาง
- `GET gardens` เพิ่ม `summary` จาก SQL snapshot เดียวกับรายการสวน หน้าเว็บใช้ net รวมนี้แทนการบวกสวนเอง ส่วน `GET summary` เพิ่ม `sharedUnallocatedMinor`, `sharedUnallocatedPendingMinor`
- `expensePendingMinor` ใน summary รวมค้างรายสวนและส่วนกลาง ส่วนใน garden DTO เป็นเฉพาะส่วนของสวนนั้น `laborPendingMinor` และ `openingDebtPendingMinor` คงความหมายเดิม
- Audit ใหม่ `expense.allocations.replaced` เก็บ version/ชุดแบ่งก่อนและหลัง ไม่แก้ audit/payment เดิม

## หลักฐานทดสอบ

ใช้ PostgreSQL/Auth/PostgREST/Storage จริงใน localhost test stack ผ่าน `.env.test.local`/guard เดิม รัน suites ทีละชุด ไม่มีการเขียนรายการ/รูป/การจ่ายทดสอบบน production

- Model **4/4**, unit/API/CLI **54/54** ผ่านทั้ง dev และ production build; typecheck/format/build/diff ผ่าน
- ส่วนกลาง 1,000 จ่าย 333.33 ก่อนแบ่ง → หักสุทธิรวม 1,000 ครั้งเดียว ค้าง 666.67 และยอดสวนยังไม่เปลี่ยน; แบ่ง 400/600 → จ่ายตามสัดส่วน 133.33/200.00 ค้าง 266.67/400.00 รวมยังเท่าเดิม พร้อม receipt/payment IDs เดิม
- จ่ายเพิ่ม/void หลังแบ่ง, เปลี่ยนสัดส่วน 250/750 และเก็บกลับส่วนกลาง ไม่เปลี่ยนสุทธิรวมและไม่คัดลอกประวัติ
- ต้นทุน 3 สตางค์แบ่ง 3 สวนสวนละ 1 สตางค์ จ่ายรวม 1/2/3 สตางค์แล้ว void ตรวจ paid/pending ทุกสวนไม่ติดลบ/เกินและรวมตรงต้นทาง
- key เดียวพร้อมกันได้ version/ชุดเดียว; body เปลี่ยนได้ 409; สองแท็บ expected version เดียวกันสำเร็จหนึ่งและ conflict หนึ่ง; การจ่ายแข่งกับการแบ่งใช้ lock เดียวและได้ผลถูกต้อง
- ยอดไม่ครบ/เกิน/ศูนย์/ไม่ใช่ตัวเลข/สวนซ้ำ/source ผิด/ไม่มีสิทธิ์/Origin ผิดถูกปฏิเสธ โดยข้อมูลไม่เปลี่ยน DB ปฏิเสธ partial commit, ลบชุดแบ่งบางสวน หรือย้ายต้นทางที่มีชุดแบ่งเข้ากับสวนโดยตรง
- จำลอง audit failure หลังแทนชุดแบ่งและเพิ่ม version → rollback แถว/version/audit/idempotency ทั้งชุด จากนั้น retry สำเร็จครั้งเดียว ตรวจ RLS owner reads/outsider/anon denial และห้าม client INSERT/PATCH/DELETE ตารางใหม่
- Targeted Chromium production build ผ่าน: ส่วนกลาง → ชุดแบ่ง/ยอดผิด/network failure/retry → stale editor/load latest → เปลี่ยนชุด → จ่าย/void → คืนส่วนกลาง/reload พร้อมตรวจ 320 px ไม่มี overflow/page error

Full Chromium กับ production build **10 ผ่าน + 1 ข้าม** (รูปส่วนตัว OCR ไม่ได้ส่งเข้ารอบนี้) รวม Phase 6 และ regression Phase 1–5/รูป/HEIC/manual/Three.js/reduced motion/WebGL fallback ผลนี้ไม่ใช่หลักฐาน Safari/iPhone จริงหรือการรับรอง OCR

## Deployment และข้อมูล production

Production <https://palm-ledger-nine.vercel.app> · Supabase **`feotpdylvprtihgklndj`** (ไม่ใช้ project เก่า) · Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`

ฐานก่อน Phase 6: code Phase 5 `f4dacef`, docs `c183ce0`; deployment ของ docs `dpl_EwucxmEXXGmjMhhxjHa5YwUEFT96` **READY** ผู้ใช้ยืนยันขึ้นแล้วและอนุญาต Phase 6

ใช้ `npm run deploy:build` apply migrations แบบ transaction/checksum ก่อน build ต้องตรวจ deployment ของ **HEAD ล่าสุดหลัง push** พร้อม repository/branch/SHA/alias และ migration/owner/build logs รอบ Phase 5 auto-deploy ไม่เริ่มและใช้ Git-source deployment ตาม SHA ใน project/team เดิมแทน ห้ามเปลี่ยน credentials/encryption key/Auth settings หรือปิด TLS verification เพื่อแก้การเข้าถึง

## ผล deployment Phase 6 ที่ตรวจแล้ว

Code `4efe66f9f041d15a40c680513b7cde235fa3271a` push `main` แล้ว; Vercel production [`dpl_DqsHbryMzzH6PpzHbJu1CoHMjd2p`](https://vercel.com/self-ade5/palm-ledger/DqsHbryMzzH6PpzHbJu1CoHMjd2p) **READY** พร้อม repository/branch/SHA/alias เว็บจริงตรงกัน Build logs มี `Migrations applied.`, `Owner login: configured`, `Compiled successfully`, `Build Completed` (18 วินาที) และ `Deployment completed`

รอบนี้ยังไม่พบ deployment ของ SHA ใหม่เริ่มอัตโนมัติ จึงใช้ Git-source deployment จาก SHA โดยตรงใน project/team/Git connection เดิม ตรวจ build command เป็น `npm run deploy:build` ไม่อัปโหลด local source หรือเปลี่ยน env/credentials

ตรวจ production แบบอ่านอย่างเดียว:

- Migration Phase 6 applied จริง checksum `fcd85073573ad7e3cf7f12d4f64910359fe14f9428d03954a39e97ee9368f0f1` ตรงไฟล์ใน Git; checksum migrations เดิมทั้งหกไม่เปลี่ยน
- `expense_allocations` เปิด RLS พร้อม owner SELECT; authenticated อ่านได้แต่ INSERT/UPDATE/DELETE ไม่ได้ anon อ่านไม่ได้ View private มี `security_invoker=true` และ client/anon อ่านไม่ได้ สอง function เป็น security invoker/search path ว่างและ client/anon execute ไม่ได้
- Security advisors ไม่มีข้อแจ้งใหม่ของ Phase 6 มี warning เดิมเรื่อง [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ไม่เปลี่ยน Auth settings ในงานนี้
- `/login` และ `/records` → 200; unauthenticated `/api/v1/payables` และ `/api/v1/expenses` → 401 ตรวจ JavaScript ที่ `/records` เสิร์ฟจริงพบทั้ง `sharedUnallocatedMinor` และ `allocationVersion`
- Error/fatal runtime scan ของ deployment นี้ช่วง 10 นาทีที่ตรวจไม่พบแถว log ไม่ใช่การรับรอง monitoring ระยะยาว ไม่สร้างรายการ รูปหรือการจ่ายทดสอบบน production

เอกสารผลตรวจอยู่ใน commit ถัดจาก code นี้ ต้องตรวจ deployment ของ **HEAD ล่าสุดหลัง push เอกสาร** อีกครั้ง ไม่ใช้สถานะของ code commit เก่าแทนผลตรวจ HEAD

## ขอบเขตถัดไป

รอผู้ใช้ตรวจรับ Phase 6 ก่อนปิดเฟส ไม่ implement Phase 7 ในรอบนี้

- Phase 7: แก้/ยกเลิกต้นทาง รายงาน/ตัวกรองวันที่/CSV ต้องรักษาชุดแบ่งและยอดจ่ายที่ยังมีผล ห้ามแก้ยอดต้นทางต่ำกว่ายอดจ่ายหรือทำให้ชุดแบ่งไม่ตรง ต้องจัดการ source version ให้เหมาะกับชุดแบ่งที่มีแล้ว
- Phase 8–9: สำรอง/กู้คืนและสำรองอัตโนมัติ รวมตารางแบ่งใหม่และประวัติจ่ายต้นทางเดิม
- Phase 10: extraction/Safari/iPhone จริงยังค้าง คง manual fallback และไม่อ้างผล Chromium แทนการตรวจเครื่องจริง

ก่อนงานถัดไปอ่าน `AGENTS.md`, Next.js guides ที่ติดตั้ง, แผน, `app-spec.md`, `docs/development.md` และ handoff นี้ ไม่ทำ Phase 1–6 ซ้ำ
