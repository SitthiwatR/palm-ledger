# พัฒนาและทดสอบ Palm Ledger — ขั้น 1

## สิ่งที่ทำแล้ว

Next.js หน้าเว็บและ API ในโปรเจกต์เดียว เข้าด้วยชื่อผู้ใช้/รหัสผ่านผ่าน Supabase Auth, session ฝั่งเซิร์ฟเวอร์ 30 วัน, ออกจากระบบ/ผู้ดูแลตั้งรหัสใหม่, เพิ่ม/แก้ชื่อ/แก้ยอดยกมา/เก็บสวนเป็นประวัติ, ยอดรวมทุกสวน, audit, ป้องกันคำขอซ้ำและแท็บเก่าทับข้อมูล

ยังไม่มีรายการขาย/รายจ่าย รูปบิล OCR หรือระบบสำรองตามขั้นถัดไป ต้นแบบเดิมเป็นไฟล์แยก ไม่ใช่ frontend ของระบบฐานข้อมูลใหม่นี้

## เริ่มพัฒนาในเครื่อง

ต้องมี Node.js 24 LTS, Docker daemon และ Docker Compose ใช้ checkout นี้ได้เลย ไม่ต้องสร้าง worktree เพิ่ม

```sh
npm ci
npm run local:setup
npm run db:migrate
npm run owner:create -- ชื่อเจ้าของ
npm run dev
```

`owner:create` รับรหัสผ่าน 12–128 ตัวอักษรผ่าน prompt ที่ซ่อนข้อความ และสร้างบัญชีเจ้าของได้เพียงบัญชีเดียว ผู้ใช้ไม่ต้องมีอีเมล ชื่อผู้ใช้รับตัวอักษรไทย/อังกฤษ ตัวเลข `_` `.` `-` ยาว 3–40 ตัวอักษร

`local:setup` สร้าง `.env.local` แบบสิทธิ์อ่านเฉพาะเจ้าของไฟล์โดยไม่พิมพ์ค่าลับ หากมีไฟล์อยู่จะรักษาไว้ และปฏิเสธการเริ่ม local stack หากไฟล์นั้นเป็นการตั้งค่า hosted ห้ามนำ credentials ที่สร้างสำหรับ local development ไปใช้ production

ชุดพัฒนาเป็น PostgreSQL 17 + Supabase GoTrue/Auth + PostgREST จริงและ gateway สำหรับขั้น 1 ใช้ image ที่ตรึง digest โดยเปิดพอร์ตเฉพาะ loopback: API 54321 และ PostgreSQL 54322 ชุดนี้ไม่มี Storage/Studio/Realtime และไม่ใช่การติดตั้ง Supabase สำหรับ production ใช้ชุดย่อยเพื่อลดพื้นที่ image ของ PostgreSQL ทั้งชุดที่เกินข้อจำกัดของ cloud นี้

ใช้ตัวรัน migration ของโปรเจกต์ผ่าน `db:migrate` ซึ่งตรวจ checksum, ทำ transaction, บันทึกเวอร์ชัน และแจ้ง REST ให้โหลด schema ใหม่ การรันซ้ำคงข้อมูลเดิม ห้ามแก้ migration ที่ถูก apply แล้ว

Docker volumes และ `.env.local` คงข้อมูลไว้ แต่ process ต้องเริ่มใหม่ในแต่ละ task รัน `local:setup` อีกครั้งแล้วเริ่ม `npm run dev` ได้ หยุดเฉพาะชุดพัฒนาด้วย:

```sh
docker compose --env-file .env.local -f compose.local.yml stop
```

ไม่ใช้คำสั่งลบ volumes กับข้อมูลที่ต้องการเก็บ

## เจ้าของลืมรหัสผ่าน

ผู้ดูแลตรวจยืนยันเจ้าของตามช่องทางที่ตกลงกัน แล้วรัน:

```sh
npm run owner:reset -- ชื่อเจ้าของ
```

รับรหัสใหม่ผ่าน prompt ที่ซ่อนข้อความ รีเซ็ตรหัสใน Supabase Auth และยกเลิก app sessions เดิมพร้อม audit ไม่มี endpoint กู้บัญชีสาธารณะที่ข้ามการตรวจเจ้าของ ตั้ง `SUPPORT_CONTACT` เป็นข้อความติดต่อผู้ดูแลเพื่อแสดงใน “ลืมรหัสผ่าน?” ได้

## ทดสอบโดยไม่แตะข้อมูลพัฒนา

```sh
npm run local:test:setup
npm test
npm run test:browser
npm run typecheck
npm run format:check
npm run build
```

ชุดทดสอบใช้ `.env.test.local` และ Docker project/volume แยกชื่อ `palm-ledger-test`: Auth/REST 54421, PostgreSQL 54422 และ Next.js 3100 ชุดพัฒนาปกติไม่ถูกล้าง Fixture จะล้างเฉพาะฐานทดสอบนี้หลังตรวจ marker/พอร์ต และสร้างรหัสบัญชีทดสอบสุ่มในหน่วยความจำ ห้ามแก้ marker ให้ชี้ข้อมูลจริง

`npm test` ตรวจ model ต้นแบบเดิม 4 กรณี และ API integration 8 กรณี: สิทธิ์/Origin/ปิด signup, login/cookie, สวน/ยอดรวม/idempotency พร้อมกัน, validation, stale version/archive/audit, REST RLS, expiry/logout/password reset และ login throttling ชุด Auth ทดสอบออก JWT อายุ 45 วินาทีเพื่อให้ flow ปกติใช้ refresh จริง โดยไม่ต่ออายุ session หลักให้เกิน 30 วัน

Browser suite ส่งคำขอจริงไป API/Auth/PostgreSQL ตรวจ login, focus ของฟอร์ม, เพิ่ม/แก้ไข/เก็บสวน, reload, เปิดอีกอุปกรณ์, ยอดรวม, overflow ที่ 390 px, reduced motion, network failure ที่ยังเก็บค่าฟอร์ม และ reset/logout ใช้ Chromium ที่ติดตั้งในเครื่องถ้ามี หรือกำหนด `CHROMIUM_EXECUTABLE`; หากไม่มีให้ติดตั้ง browser ตาม Playwright ก่อน

WebKit เป็นชุดแยก ไม่รันปนเป็นผลผ่านของ Chromium:

```sh
npx playwright install webkit
TEST_WEBKIT=1 npm run test:browser
```

ใน cloud รอบนี้ Chromium รันได้ แต่ดาวน์โหลด WebKit ถูก proxy ปฏิเสธที่ `cdn.playwright.dev` และ `playwright.download.prss.microsoft.com` จึงยังไม่ยืนยัน WebKit หรือ Safari จริง ต้องอนุญาตโดเมนดาวน์โหลดผ่าน environment settings หรือตรวจบนเครื่องที่มี browser แล้ว ส่วน Safari บน iPhone จริงยังเป็น acceptance ที่ค้างอยู่

รัน suite ทีละชุด เพราะใช้ฐานทดสอบและพอร์ตเดียวกัน หยุด Next.js ที่ใช้ `.next` ก่อน production build; fixtures เริ่มและหยุดเฉพาะ test server ของตัวเอง

ตรวจ runtime ของ production build ได้หลัง `npm run build` ด้วย `TEST_APP_MODE=production npm test` และ `TEST_APP_MODE=production npm run test:browser` โดยยังใช้ฐานทดสอบแยก ไม่เปลี่ยน environment เป็นข้อมูลจริง

## เชื่อมโปรเจกต์ Supabase ที่โฮสต์อยู่

ณ 21 ตุลาคม 2569 ใช้ Vercel project `palm-ledger` เชื่อม GitHub `SitthiwatR/palm-ledger` และ Supabase project `feotpdylvprtihgklndj` ตามที่ผู้ใช้เลือก ตรวจผ่าน Vercel REST API แล้วว่า production deployment ของ commit `8f6b7a8` เป็น Ready และ migrations สำเร็จ เว็บหลักคือ <https://palm-ledger-nine.vercel.app> โดย `APP_URL` ใช้ origin นี้

ตัวแปรของแอพถูกตั้งใน Vercel **Project Settings → Environment Variables → Production** แล้ว ไม่ใช่ระดับ account/team ค่า `DATABASE_URL` ใช้ Session pooler หลัง direct connection ล้มเหลวด้วย IPv6 `ENETUNREACH`; `DATABASE_URL` มีลำดับก่อน `POSTGRES_URL` จึงต้องชี้ Supabase project ที่เลือกให้ตรงกัน

Build log ระบุ `Owner login: not configured yet` จึงยังต้องสร้างบัญชีเจ้าของด้วยคำสั่งผู้ดูแลหลังตั้ง environment สำหรับ hosted project อย่างปลอดภัย และตรวจปิด public signup ห้ามนำบัญชีจาก local tests มาใช้จริง ยังไม่ได้ตรวจ login/สวนผ่านเว็บจริง เพราะ network policy ของ cloud นี้ยังไม่อนุญาตโดเมนเว็บและ Supabase project ใหม่ (มี configuration draft รอ publish)

### สร้างบัญชีสำหรับ login เว็บจริงครั้งแรก

ทำใน terminal บนเครื่องผู้ดูแลที่มี Node.js 24 และเชื่อม Supabase Session pooler ได้ เปิดโฟลเดอร์ repository แล้วรัน `npm ci` จากนั้นสร้างไฟล์ `.env.hosted.local` ที่ root (ถูก Git ignore) และใส่ `DATABASE_URL` แบบ Session pooler พร้อมรหัสฐานข้อมูล, `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ของ project `feotpdylvprtihgklndj` คัดลอกค่าจากการตั้งค่าบริการโดยตรง ไม่ส่งค่าลับผ่านแชต และไม่ใช้ `.env.local` ของ local development แทน

เตรียม CA และสร้าง username ตัวอย่าง `palm` ด้วยคำสั่งต่อไปนี้ เปลี่ยนชื่อได้ตามต้องการ:

```sh
node --env-file=.env.hosted.local --import tsx scripts/prepare-database-ca.ts
node --env-file=.env.hosted.local --import tsx scripts/owner.ts create palm
```

เมื่อขึ้น `New password (12+ characters, hidden):` ให้ตั้งรหัสผ่าน 12–128 ตัวอักษรแล้ว Enter ขณะพิมพ์จะไม่แสดงตัวอักษร เมื่อสำเร็จจะขึ้น `Owner updated. No credentials were printed.` คำสั่งนี้สร้างทั้ง Supabase Auth user และ mapping ของ username พร้อม audit จึงไม่ต้องสร้าง user ผ่านหน้า Supabase Auth แยกเอง หากมีเจ้าของแล้วให้ใช้ `reset` แทน `create` โดยระบุ username เดิม

เปิด <https://palm-ledger-nine.vercel.app/login> แล้วใช้ username และรหัสผ่านที่ตั้ง ไม่ใช่บัญชี GitHub/Vercel/Supabase และไม่ใช่รหัสผ่านฐานข้อมูล ไม่ต้อง redeploy หลังสร้างบัญชี

ทดสอบด้วยสวนที่ระบุชัดว่าเป็นข้อมูลทดสอบ: เพิ่มสองสวนพร้อมยอดยกมา 1,000 และ 2,000 บาท → ยอดรวม 3,000 บาท → reload แล้วข้อมูลยังอยู่ → แก้ชื่อ/ยอดยกมาและเก็บสวนเป็นประวัติ → logout/login อีกครั้ง ทำซ้ำบน Safari/iPhone รวม focus, keyboard และ reduced motion ข้อมูลทดสอบจะอยู่บน hosted database จริงและการเก็บสวนเป็นประวัติไม่ใช่การลบข้อมูล

เมื่อต่อโปรเจกต์พร้อมแล้ว ให้ใส่ค่าผ่าน environment settings ของโฮสต์ตามชื่อใน `.env.example`: `APP_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_ENCRYPTION_KEY` และข้อความ `SUPPORT_CONTACT` ตามต้องการ ค่าทั้งหมดเป็น server-only; อย่าใช้ `NEXT_PUBLIC_` กับ credentials ของ backend และอย่าส่งค่าลับผ่านแชต

- `APP_URL` ต้องเป็น origin ที่ผู้ใช้เข้าเว็บจริง รวม protocol/port ที่ถูกต้อง ใช้ HTTPS เมื่อเปิดออนไลน์ API ตรวจ Origin และ cookie จะเป็น Secure บน HTTPS
- ใช้ PostgreSQL connection/pooler ที่รองรับ transaction จริงและ TLS verification ตามผู้ให้บริการ ไม่ปิดการตรวจ certificate
- หากใช้ Supabase integration ของ Vercel แอพอ่าน `POSTGRES_URL` ได้เมื่อไม่มี `DATABASE_URL` จึงใช้ connection ที่ integration จัดให้โดยไม่ต้องคัดลอก Secret ออกมา
- สำหรับการ deploy นี้ ใช้ Build Command `npm run deploy:build` เพื่อรัน migrations ก่อน build โดยอ่าน environment ของ Vercel ตรง ๆ ตัว runner ใช้ transaction-scoped advisory lock และ checksum ป้องกัน deploy พร้อมกัน/รันซ้ำ ส่วน `npm run build` ปกติยังไม่แก้ฐานข้อมูล หาก migration ไม่ผ่าน deployment ต้องหยุดก่อนปล่อยแอพ
- `deploy:build` เตรียม CA จาก HTTPS download ที่ Supabase Studio ระบุอย่างเป็นทางการ ตรวจว่าเป็น CA ที่ยังไม่หมดอายุ และ bundle ไฟล์ public certificate เข้า server function จากนั้นใช้ TLS ที่ตรวจทั้ง chain และ hostname โดยไม่ปิด verification; ตั้ง `DATABASE_CA_CERT` เป็น PEM ที่ดาวน์โหลดจาก Supabase Database Settings ได้หากต้องการระบุ CA เอง การดาวน์โหลดหรือการตรวจ certificate ล้มเหลวจะหยุด deployment
- ใช้ encryption key สุ่ม 32 bytes แบบ hexadecimal สำหรับ token ที่เข้ารหัสในตาราง session การเปลี่ยน key ต้องยกเลิก session เดิมและให้เข้าใหม่
- ปิด public signup ใน Supabase Auth จริงด้วย และเตรียม owner ผ่านคำสั่งผู้ดูแลหลัง migrations ตรวจ RLS/สิทธิ์และ Auth settings อีกครั้งกับโปรเจกต์ที่เลือก
- ยังต้องตรวจโควตา สิทธิ์ใช้แพ็กเกจฟรีกับงานสวน และงานสำรองตามแผน การ deploy สำเร็จไม่ใช่การรับรองว่า hosted production ฟรีครบทุกส่วนหรือผ่านเกณฑ์ปล่อยใช้งานทั้งหมด

## ผลตรวจปัจจุบัน

API integration กับบริการจริงในเครื่องผ่าน 8/8 และ model เดิมผ่าน 4/4; browser Chromium ผ่าน 2/2; TypeScript และ production build ผ่าน ส่วน hosted Supabase migrations และ Vercel production deployment ผ่านแล้วตาม build log ยังไม่ผ่านการตรวจ hosted login/สวนและ Safari/WebKit ผลเหล่านี้รับรองเฉพาะส่วนที่ตรวจของขั้น 1 ไม่ใช่ขั้น 2–10 หรือ production readiness ทั้งระบบ
