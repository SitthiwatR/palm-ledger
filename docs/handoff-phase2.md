# ส่งต่องาน Palm Ledger — ผล Phase 2

อัปเดต 21 ตุลาคม 2569 (Asia/Bangkok) · Repository `SitthiwatR/palm-ledger` · ใช้ `main` ล่าสุด

## ข้อตกลงและผลเฟสแรก

**Phase 1 เสร็จและผู้ใช้รับงานแล้ว; Phase 2 deploy แล้วและผู้ใช้ยืนยันใช้งานได้** หลังผู้ใช้เพิ่มสิทธิ์ Vercel ตรวจ `main` ที่ `911322c` ได้ deployment `dpl_D4kfo1hH7eJvu8g3ayKdzzjRe8ba` เป็น READY พร้อม `Migrations applied.` และ `Owner login: configured`. ไม่ติดปัญหา 403 เดิมแล้ว

**คำสั่งเพิ่มเติม 21 ตุลาคม 2569:** เปลี่ยนเป็นอัปโหลดรูป → รีวิว/แก้เฉพาะข้อมูลที่ผิด → เลือกค่าแรงรายวันหรือรายน้ำหนัก เป้าหมายจบใน 1 นาที ผู้ใช้เลือก OCR ฟรีในเบราว์เซอร์ ทำแล้วใน `3fc6e19`, production deployment `dpl_DspeWgS4c7Pzayqqso8rzdBaipFH` READY พร้อม migration log และ production metadata/HTTP checks ผ่าน รายละเอียดผลตรวจ/ข้อจำกัดด้านอุปกรณ์จริงอยู่ใน [receipt-first-workflow.md](receipt-first-workflow.md)

**แก้ OCR ตามภาพจริงที่ผู้ใช้แจ้ง:** เพิ่มตัดฉากหลัง/ปรับแสง/เส้นตารางเอียง และจัดแถวจากตำแหน่งคำ อ่านช่องน้ำหนักสุทธิซ้ำพร้อมเทียบยอดที่พิมพ์ รูปจริงใน isolated test stack ได้ 1,480 กก. × 8.70 = 12,876 บาท พร้อมวันที่/เลขบิลตรงภาพ ประมาณ 15–22 วินาที แก้ใน `17bf75f`, Vercel `dpl_BdQ3ZrAYZz3ttT5JWu7rrDhdiqkt` READY และตรวจโค้ดที่เว็บจริงเสิร์ฟแล้ว Full Chromium 7/7 ผ่าน ไม่เก็บรูปส่วนตัวใน Git และไม่สร้างรายการขายทดสอบบน production; ยังต้องตรวจ iPhone/Safari กับผู้ใช้

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

## Phase 2 ที่ทำแล้ว

ทำการบันทึกขายจากหน้าจอถึง PostgreSQL และ private Storage โดยคง UI/Three.js เดิม ไม่ใช้ `schema.sql` ที่ root ซึ่งเป็น SQLite อ้างอิงรุ่นเก่า

- เลือกสวน วันที่ ผู้รับซื้อ เลขบิล กรอกน้ำหนักสุทธิ ราคาต่อกิโลกรัม และรายการหักพร้อมคำอธิบาย บันทึกเฉพาะการขายที่รับเงินเต็มจำนวน
- คำนวณฝั่งเซิร์ฟเวอร์ด้วย integer/decimal arithmetic: 3,500 กก. × 5 บาท − 500 บาท = รายรับ 17,000 บาท ส่งผลเข้ายอดสุทธิรายสวนและยอดรวมจริง
- เพิ่ม versioned PostgreSQL migration, API และหน้ารายการ/รายละเอียดที่จำเป็น มี audit, owner authorization, idempotency/retry, duplicate-bill warning ที่ให้ตรวจยืนยัน และ conflict เมื่อ key เดิมใช้กับข้อมูลต่างกัน
- แนบ/เปิดรูปต้นฉบับผ่าน Supabase **private Storage** เก็บ opaque key, MIME, ขนาดและ checksum ใน SQL ตรวจสิทธิ์ทุกครั้ง ใช้ signed access อายุสั้นตามความเหมาะสม
- สเปกรูปรองรับ JPEG/PNG/WebP/HEIC/HEIF ไม่เกิน **10 MB** เก็บต้นฉบับและสร้าง preview ที่จำเป็น ห้ามลดขอบเขตหรือบีบอัดทับต้นฉบับเพื่อหลบข้อจำกัดโฮสต์ ต้องพิสูจน์ upload limit/การแปลงภาพบน runtime จริง เช่นออกสิทธิ์อัปโหลดตรงไป Storage หลังตรวจ owner แทนส่งไฟล์ใหญ่ผ่าน Next.js function ทั้งก้อน
- ข้อมูลฟอร์มยังอยู่เมื่อบันทึก/upload ล้มเหลว ไม่สร้างรายรับซ้ำหรือข้อมูลครึ่งชุด มีวิธีจัดการ orphan uploads

**ผลทดสอบ:** PostgreSQL/Auth/PostgREST และ Supabase Storage API จริงทำงานใน local test stack ที่แยกจาก production; browser tests รันกับ local services เท่านั้น ไม่ได้สร้างรายการขายหรือแตะ Storage บน hosted production

**ขอบเขตหลักฐาน:** ทดสอบ HEIC fixture จริงจากตัวอย่าง libheif ซึ่งพิสูจน์การเก็บ/อ่านไฟล์ HEIC แต่ยังไม่ได้ทดสอบภาพจาก iPhone โดยตรงหรือทดสอบ Safari บนอุปกรณ์จริง จึงคง acceptance ข้อนี้ไว้ pending ตามแผน

คำสั่งเพิ่มเติมข้างต้นย้าย OCR ฟรีและค่าแรงรายวัน/รายน้ำหนักที่ผูกบิลมาทำก่อน ส่วนรายจ่ายทั่วไป ปุ๋ย การจ่ายหนี้ และสำรองยังคงตามเฟสเดิม ไม่ถือว่างานส่วนอื่นของ Phase 3–10 เสร็จแล้ว

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

เมื่อแก้ flow เพิ่มเติม ให้ตรวจ deployment ที่สร้างจาก `main` จนเป็น Ready และตรวจ build/migration log โดยรักษาข้อมูลและบัญชีเดิม บันทึกผลรอบใหม่ใน [receipt-first-workflow.md](receipt-first-workflow.md) และ [แผน](../plans/palm-ledger.md)
