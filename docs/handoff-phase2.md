# ส่งต่องาน Palm Ledger — เริ่ม Phase 2

อัปเดต 21 ตุลาคม 2569 (Asia/Bangkok) · Repository `SitthiwatR/palm-ledger` · ใช้ `main` ล่าสุด

## ข้อตกลงและผลเฟสแรก

**Phase 1 เสร็จและผู้ใช้รับงานแล้ว** ผู้ใช้ยืนยันว่า login/UI และการทดสอบเฟสแรกใช้งานได้ปกติ และสั่งให้ทำเรื่องถัดไปในแชทใหม่ งานของแชทนี้คือบันทึกผลและส่งต่อ ไม่ได้เริ่ม implement Phase 2

- Next.js รวม frontend/API, TypeScript, Node.js 24, Supabase PostgreSQL/Auth
- บัญชีเจ้าของคนเดียว ใช้ username/password, session 30 วัน, logout และคำสั่งผู้ดูแลสร้าง/รีเซ็ตรหัส
- เพิ่ม/แก้สวนและยอดสุทธิยกมา เก็บสวนเป็นประวัติ ดูยอดรวม มี validation, audit, RLS, idempotency และป้องกันข้อมูลจากแท็บเก่าทับข้อมูลใหม่
- UI เขียว–ครีม ฟอนต์ไทยที่เสิร์ฟเอง มือถือใช้เมนูล่าง/desktop ใช้ sidebar; มี Three.js สวนปาล์มในหน้า login/ภาพรวม โหลดแยก มี SVG fallback, Reduce Motion, หยุดเมื่อไม่เห็น และคืน GPU resources เมื่อออกจากหน้า
- Code baseline ที่ deploy และรับงาน: `a010403` (เอกสารส่งต่อนี้อยู่ใน commit ภายหลัง ให้ใช้ HEAD ล่าสุด)
- ผลตรวจ: model เดิม 4/4, API integration กับ PostgreSQL/Auth/REST จริงในเครื่อง 8/8, CLI/diagnostics 12/12, Chromium ของ production build 4/4, typecheck/format/build ผ่าน
- ผู้ใช้ไม่ได้แจกแจงอุปกรณ์/ผล Safari focus/keyboard ทุกข้อ และผู้ช่วยยังไม่ได้ยืนยันการปิด public signup บน hosted project โดยตรง เก็บรายการตรวจเฉพาะไว้ใน Phase 10 ไม่อ้างว่าตรวจผ่านแล้ว และไม่ย้อนกลับไปขออนุมัติเริ่ม Phase 2 ซ้ำ

## อ่านก่อนลงมือ

1. [แผน 10 ขั้น](../plans/palm-ledger.md) — Phase 2 และ acceptance criteria เป็นขอบเขตงานถัดไป
2. [สเปก](../app-spec.md) — user stories 10–16, 39, 43 และกติกาข้อมูล/รูป/เงิน
3. [User flow](../user-flow.md) และ [วิธีพัฒนา/ทดสอบ](development.md)
4. `AGENTS.md` และคู่มือ Next.js รุ่นที่ติดตั้งใน `node_modules/next/dist/docs/` ก่อนเขียนโค้ด

ไม่ต้องเริ่ม grill-me หรือร่างแผนใหม่ ผู้ใช้ตกลงสถาปัตยกรรมและแผน 10 ขั้นแล้ว คง UI/Three.js ที่ผู้ใช้รับงานไว้ ปรับเพิ่มเฉพาะความสามารถที่ Phase 2 ต้องใช้

## Production และบทเรียนการตั้งค่า

- เว็บ: <https://palm-ledger-nine.vercel.app>
- Supabase ที่ใช้จริง: `feotpdylvprtihgklndj` — **อย่าใช้** project เดิม `xljxowrsywlwozzcbnlw`
- Vercel project `palm-ledger`, ID `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team ID `team_PnTYWZ1rB5hOoQSGOZwv0aFW`; GitHub `main` เป็น production branch
- Deployment ของ UI baseline: `dpl_GPnpxkFjCm9Aak4P32HdTs1No17G` เป็น Ready, `Migrations applied.`, `Owner login: configured`; ผู้ใช้ยืนยันเว็บใช้งานได้
- `APP_URL` ต้องเป็น `https://palm-ledger-nine.vercel.app`; `SUPABASE_URL` ต้องเป็น `https://feotpdylvprtihgklndj.supabase.co`
- `DATABASE_URL` ใช้ Supabase **Session pooler** พอร์ต 5432; direct IPv6 เคยล้มเหลวบน Vercel ต้องคง TLS chain/hostname verification และ CA ที่ deploy เตรียมให้
- `SUPABASE_SERVICE_ROLE_KEY` ต้องเป็น admin secret/service_role ของ project นี้ ไม่ใช่ publishable key; ผู้ใช้แก้และสร้าง owner สำเร็จแล้ว ไม่สร้างบัญชีซ้ำ ไม่เปลี่ยนรหัสหรือ encryption key โดยไม่จำเป็น
- เคยเกิดกรณี Vercel Supabase integration ค้าง URL/keys ของ project เก่า แก้ `.env.hosted.local` บน Windows ไม่อัปเดต Vercel ให้เอง ปัจจุบันแก้แล้วและผู้ใช้ login ได้
- หากแก้ตัวแปรผ่าน REST: PATCH ตัวแปรเดิมตาม env ID และตรวจค่าที่ไม่ใช่ความลับกลับมา การ POST/upsert เคยได้ `ENV_CONFLICT` กับตัวแปร integration อย่าสรุปว่าอัปเดตสำเร็จโดยไม่ตรวจ response และผลจริง
- **อย่าเขียนทับค่าบน Vercel จาก cloud runtime โดยไม่ตรวจ**: ค่าที่ inject เข้ามาในรอบเก่าเคยเป็น direct DB URL, APP_URL เก่า และ publishable key ในชื่อ service_role แม้ production ถูกแก้ถูกต้องแล้ว
- Windows เคยต่อ PostgreSQL timeout บนเน็ตเดิม แต่ผ่านเมื่อเปลี่ยนเป็น hotspot ไม่ใช่หลักฐานว่า key ผิด; Node ใช้ inherited environment ก่อน `--env-file` มีตัวตรวจ `scripts/check-auth.ts`, `scripts/check-database-network.ts` และ `scripts/owner.ts check`
- ค่าลับไม่อยู่ใน Git ไม่ต้องให้ผู้ใช้ส่งรหัสผ่าน/key ในแชต ตรวจ readiness และชนิดของ credentials โดยไม่พิมพ์ค่า เก็บ production data เดิมไว้

เครื่องมือ Vercel/Supabase plugins อาจต่างกันในแชทใหม่ ให้ตรวจเครื่องมือที่มีจริง ในรอบนี้ใช้ Vercel REST ผ่าน credential/proxy ที่ตั้งไว้ตามปกติ Cloud network policy ยังไม่อนุญาตเว็บจริงและโดเมน Supabase ใหม่สำหรับตรวจโดยตรง มี draft เพิ่มโดเมนไว้แต่ยังไม่มีหลักฐานว่า publish แล้ว อย่าข้าม proxy/ปิด TLS เพื่อทดสอบ

## Phase 2 ที่ต้องทำ

ทำการบันทึกขายจากหน้าจอถึง PostgreSQL และ private Storage ให้ครบ ไม่เปลี่ยนเป็น prototype/localStorage และไม่ใช้ `schema.sql` ที่ root ซึ่งเป็น SQLite อ้างอิงรุ่นเก่า

- เลือกสวน วันที่ ผู้รับซื้อ เลขบิล กรอกน้ำหนักสุทธิ ราคาต่อกิโลกรัม และรายการหักพร้อมคำอธิบาย บันทึกเฉพาะการขายที่รับเงินเต็มจำนวน
- คำนวณฝั่งเซิร์ฟเวอร์ด้วย integer/decimal arithmetic: 3,500 กก. × 5 บาท − 500 บาท = รายรับ 17,000 บาท ส่งผลเข้ายอดสุทธิรายสวนและยอดรวมจริง
- เพิ่ม versioned PostgreSQL migration, API และหน้ารายการ/รายละเอียดที่จำเป็น มี audit, owner authorization, idempotency/retry, duplicate-bill warning ที่ให้ตรวจยืนยัน และ conflict เมื่อ key เดิมใช้กับข้อมูลต่างกัน
- แนบ/เปิดรูปต้นฉบับผ่าน Supabase **private Storage** เก็บ opaque key, MIME, ขนาดและ checksum ใน SQL ตรวจสิทธิ์ทุกครั้ง ใช้ signed access อายุสั้นตามความเหมาะสม
- สเปกรูปรองรับ JPEG/PNG/WebP/HEIC/HEIF ไม่เกิน **10 MB** เก็บต้นฉบับและสร้าง preview ที่จำเป็น ห้ามลดขอบเขตหรือบีบอัดทับต้นฉบับเพื่อหลบข้อจำกัดโฮสต์ ต้องพิสูจน์ upload limit/การแปลงภาพบน runtime จริง เช่นออกสิทธิ์อัปโหลดตรงไป Storage หลังตรวจ owner แทนส่งไฟล์ใหญ่ผ่าน Next.js function ทั้งก้อน
- ข้อมูลฟอร์มยังอยู่เมื่อบันทึก/upload ล้มเหลว ไม่สร้างรายรับซ้ำหรือข้อมูลครึ่งชุด มีวิธีจัดการ orphan uploads

**Dependency สำคัญ:** `compose.local.yml` ปัจจุบันมี PostgreSQL/Auth/PostgREST/gateway เท่านั้น ยังไม่มี Supabase Storage ต้องเตรียม Storage สำหรับทดสอบแยกอย่างเหมาะสม ไม่ใช้รูป/ฐาน production เป็น test fixtures และไม่อ้างว่า integration ผ่านจาก mock เพียงอย่างเดียว

OCR อยู่ Phase 10, รายจ่ายอยู่ Phase 3, ค่าแรงทีมผูกบิลอยู่ Phase 4, สำรองตาม Phase 8–9 อย่าเริ่มงานเหล่านี้แทน Phase 2

## เริ่มทำงานในแชทใหม่

ตรวจ `git status` และอ่านเอกสารก่อน หาก checkout มาใหม่ให้ `npm ci` (มี Three.js/font dependencies แล้ว) เตรียม local test services และตรวจ baseline ตามความจำเป็น:

```sh
npm ci
npm run local:test:setup
npm test
npm run typecheck
npm run format:check
npm run build
TEST_APP_MODE=production npm run test:browser
```

คำสั่งชุดนี้สำหรับ bash ใน cloud ใช้ Node.js 24 และ Docker; อย่ารัน API/browser suites พร้อมกันเพราะใช้ test database/พอร์ตเดียวกัน และอย่า build ขณะ test dev server ใช้ `.next` อยู่ Tests โหลด `.env.test.local` และมี guard ว่าชี้เฉพาะฐานทดสอบ localhost เท่านั้น ห้ามแก้ guard ให้ชี้ production

เมื่อพัฒนา Phase 2 เสร็จ ให้ทดสอบส่วนที่เกี่ยวข้อง อัปเดตแผน/ผลตรวจ commit และ push ตาม workflow เดิม ตรวจ Vercel deployment จริงก่อนรายงานว่า deploy สำเร็จ โดยรักษาข้อมูลและบัญชีเดิม
