# พัฒนาและทดสอบ Palm Ledger

## สถานะล่าสุด — Phase 8

ผู้ใช้รับงาน Phase 7 และอนุญาต Phase 8 แล้ว เปิด **สวน → สำรอง กู้คืน และย้ายข้อมูล** (`/tools`) เพื่อสร้างชุดสำรองเข้ารหัสรวมรูป ตรวจไฟล์ก่อนกู้ หรือ preview/นำเข้า JSON จากต้นแบบเดิม ดู [handoff Phase 8](handoff-phase8.md) และ [คู่มือสำรอง/กู้คืน](backup-recovery.md) รอผู้ใช้ตรวจรับ Phase 8

Full restore ใช้ CLI ใน Supabase ใหม่ที่ว่าง ตรวจบัญชีเดิม ยอด ประวัติและรูปก่อนสลับใช้งาน ปฏิเสธ production/ต้นทาง/ฐานไม่ว่างและ TLS ไม่ตรวจ certificate ชุดสำรองมีข้อมูลแอป/Auth identity/รูปพร้อม checksum แต่ไม่ export live sessions หรือ platform secrets ต้องเข้าสู่ระบบใหม่ ไม่เปลี่ยน credentials/encryption key/session production เดิม

JSON ต้นแบบ version 1 แยกข้อมูลตัวอย่าง/จริง ตรวจซ้ำและ before/after ยอด แปลง paid ที่ไม่มีประวัติครั้งเดียวพร้อมป้ายไม่ทราบวันที่จ่าย น้ำหนัก/อัตราที่ต้นแบบไม่เก็บเป็น unknown ไม่แต่งหน่วย รักษาการแก้/ยกเลิกต้นทางและรายงาน/CSV ของ [Phase 7](handoff-phase7.md) รวมค้างส่วนกลาง/หนี้เดิมโดยไม่หักสุทธิซ้ำ

สำรองอัตโนมัติรายวันนอกระบบหลักยัง Phase 9; OCR และ Safari/iPhone จริงยัง Phase 10 ไม่มี test writes บน production

## หลักฐาน Phase 5

Phase 5 เพิ่มหนี้ก่อนเริ่มระบบ การจ่ายภายหลังหลายครั้งและยกเลิกการจ่ายผิด โดยใช้ `expense_payments` เดิมร่วมกับ `sale_labor`, `expenses` รวมค่าแรงทีมแยกบิล และ `opening_debts` ใหม่ การจ่าย/void เปลี่ยนเฉพาะค้าง ไม่หักสุทธิซ้ำ ดู [handoff Phase 5](handoff-phase5.md) สำหรับ API, migration, หลักฐานทดสอบและ deployment ล่าสุด ผู้ใช้อนุญาตเดิน Phase 5 โดยไม่ทำ Phase 4 ซ้ำ ผู้ใช้รับงาน Phase 5 และให้เดิน Phase 6 แล้ว

ไม่มีการแก้ OCR หรือทดสอบเขียนบน production งาน extraction/iPhone/Safari จริงยัง Phase 10 ส่วนการแก้/ยกเลิกต้นทางเพิ่มใน Phase 7 แล้ว

## สิ่งที่ทำแล้วในเฟสก่อนหน้า

Phase 3 เพิ่มรายจ่ายทั่วไป ค่าแรงรายวันแยกจากบิล และปุ๋ยที่ใช้จริง พร้อมการจ่ายครั้งแรก/private receipt/ยอดค้างและสุทธิ ดู [handoff Phase 3](handoff-phase3.md) สำหรับ migration, API และผลทดสอบล่าสุด ส่วนการจ่ายภายหลัง/แก้การจ่ายผิดเพิ่มแล้วใน Phase 5 และ OCR/Safari จริงยัง Phase 10

**การรับงาน:** วันที่ 21 ตุลาคม 2569 ผู้ใช้ยืนยันว่าเฟสแรกทดสอบได้ปกติและให้เดินเฟสถัดไป จึงปิดงานพัฒนาเฟส 1 และเริ่มเฟส 2 ในแชทใหม่ตาม [เอกสารส่งต่องาน](handoff-phase2.md) ผลตรวจแยกประเภทด้านล่างยังคงระบุขอบเขตหลักฐานจริง ไม่ถือว่าการรับงานแทนหลักฐาน Safari หรือ hosted Auth settings ทุกข้อ

Next.js หน้าเว็บและ API ในโปรเจกต์เดียว เข้าด้วยชื่อผู้ใช้/รหัสผ่านผ่าน Supabase Auth, session ฝั่งเซิร์ฟเวอร์ 30 วัน, ออกจากระบบ/ผู้ดูแลตั้งรหัสใหม่, เพิ่ม/แก้ชื่อ/แก้ยอดยกมา/เก็บสวนเป็นประวัติ, ยอดรวมทุกสวน, audit, ป้องกันคำขอซ้ำและแท็บเก่าทับข้อมูล

มีรายการขายพร้อมรูปต้นฉบับใน private Storage และเพิ่ม workflow รูปก่อน + OCR ฟรีในเบราว์เซอร์ + ค่าแรงรายวัน/รายน้ำหนักที่ผูกบิลแล้ว ดู [รายละเอียดรอบปรับ workflow](receipt-first-workflow.md) รายจ่ายทั่วไป ปุ๋ย และการจ่ายครั้งแรกทำแล้วใน Phase 3; การจ่ายภายหลังเพิ่มแล้วใน Phase 5; ระบบสำรองยังอยู่ในแผนเฟสถัดไป

## UI และสวนปาล์ม 3D

หน้า login/ภาพรวมใช้โทนเขียว–ครีม, Noto Sans Thai ที่เสิร์ฟจากแอพเอง, ปุ่มแสดง/ซ่อนรหัสผ่าน, ยอดเงิน/จำนวนสวนจริง และเมนู sidebar บน desktop หรือเมนูด้านล่างบนมือถือ ไม่เพิ่มยอดหรือกราฟตัวอย่างเข้าข้อมูลจริง

`npm ci`, `npm run dev` และ build เตรียม OCR worker, WASM และโมเดลไทย/อังกฤษไว้ใน `public/ocr` จาก dependencies ที่ตรึงเวอร์ชัน ไฟล์ generated ไม่อยู่ใน Git และไม่ใช้ CDN ภายนอกในการอ่านบิล รูปต้นฉบับยังอัปโหลดตรงเข้า private Storage ส่วน HEIC preview/OCR แปลงบนเครื่องผู้ใช้ รายละเอียดและข้อจำกัดอยู่ในเอกสาร workflow

`src/ui/palm-landscape.tsx` แสดงภาพ SVG ก่อน แล้วโหลด `palm-scene.ts`/Three.js แยกเมื่อเห็นพื้นที่ภาพ ฉากสร้างด้วย geometry ในโค้ด ไม่มี asset ภายนอก จำกัด pixel ratio 1.6 และ render ไม่เกิน 30 fps หยุด animation เมื่อซ่อน tab, ออกนอก viewport หรือเปิด Reduce Motion; ใช้ภาพนิ่ง SVG หาก WebGL/chunk ใช้ไม่ได้ และกลับไปแสดง SVG เมื่อ context สูญหาย พร้อม dispose GPU resources เมื่อออกจากหน้า ใบอนุญาต Three.js/Noto Sans Thai อยู่ใน `public/licenses`

Chromium browser suite เพิ่มการตรวจฉาก WebGL จริง, ภาพหยุดนิ่งเมื่อ Reduce Motion, แสดง/ซ่อนรหัสผ่านโดยค่าคงเดิม, ฟอร์มยังใช้ได้หลังสูญเสีย WebGL และ overflow ที่ 320 px พร้อม screenshot หน้า login/ภาพรวมที่ 390/1440 px ภาพตัวอย่างอยู่ที่ [login desktop](ui-login-desktop.png) และ [ภาพรวม mobile](ui-overview-mobile.png) ใช้ข้อมูลสวนจาก test fixtures เท่านั้น ใช้ SwiftShader เฉพาะใน browser ทดสอบบน cloud; ยังต้องตรวจ Safari/iPhone และประสิทธิภาพบนเครื่องจริงแยก

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

ชุดพัฒนาเป็น PostgreSQL 17 + Supabase GoTrue/Auth + PostgREST + Supabase Storage API จริงและ gateway ใช้ image ที่ตรึง digest โดยเปิดพอร์ตเฉพาะ loopback: API 54321 (รวม Storage `/storage/v1/`) และ PostgreSQL 54322 ชุดนี้ไม่มี Studio/Realtime และไม่ใช่การติดตั้ง Supabase สำหรับ production ใช้ชุดย่อยเพื่อแยกทดสอบโดยไม่ต้องเข้าถึง project production

Phase 2 เพิ่ม private bucket `palm-receipts` จำกัด 10 MiB และ JPEG/PNG/WebP/HEIC/HEIF; browser ขอ signed upload หลังผ่าน owner authorization แล้วอัปโหลดตรงเข้า Storage เพื่อไม่ส่งไฟล์ผ่าน Next.js function ส่วน API ตรวจ signature/ชนิด/ขนาดจริงและสร้าง SHA-256 ก่อนผูก metadata เข้ากับ sale transaction รูปที่ยังไม่ถูกผูกจะหมดอายุใน 24 ชั่วโมงและถูกเก็บกวาดเมื่อมีการขอ upload URL ครั้งถัดไป ชุดทดสอบมี HEIC fixture จริง แต่ยังไม่มีผลทดสอบภาพจากอุปกรณ์ iPhone หรือ Safari บนอุปกรณ์จริง

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

Build log แรกระบุ `Owner login: not configured yet` ต่อมาผู้ใช้สร้างบัญชีด้วยคำสั่งผู้ดูแลและยืนยัน login บนเว็บจริงสำเร็จแล้ว ยังต้องตรวจปิด public signup และ flow สวนครบชุดบนเว็บจริง ห้ามนำบัญชีจาก local tests มาใช้จริง ฝั่ง cloud นี้ยังตรวจเว็บโดยตรงไม่ได้เพราะ network policy ยังไม่อนุญาตโดเมนเว็บและ Supabase project ใหม่ (มี configuration draft รอ publish)

### สร้างบัญชีสำหรับ login เว็บจริงครั้งแรก

ทำใน terminal บนเครื่องผู้ดูแลที่มี Node.js 24 และเชื่อม Supabase Session pooler ได้ เปิดโฟลเดอร์ repository แล้วรัน `npm ci` จากนั้นสร้างไฟล์ `.env.hosted.local` ที่ root (ถูก Git ignore) และใส่ `DATABASE_URL` แบบ Session pooler พร้อมรหัสฐานข้อมูล, `SUPABASE_URL` และ `SUPABASE_SERVICE_ROLE_KEY` ของ project `feotpdylvprtihgklndj` คัดลอกค่าจากการตั้งค่าบริการโดยตรง ไม่ส่งค่าลับผ่านแชต และไม่ใช้ `.env.local` ของ local development แทน

เตรียม CA และสร้าง username ตัวอย่าง `palm` ด้วยคำสั่งต่อไปนี้ เปลี่ยนชื่อได้ตามต้องการ:

```sh
node --env-file=.env.hosted.local --import tsx scripts/prepare-database-ca.ts
node --env-file=.env.hosted.local --import tsx scripts/owner.ts create palm
```

เมื่อขึ้น `New password (12+ characters, hidden):` ให้ตั้งรหัสผ่าน 12–128 ตัวอักษรแล้ว Enter ขณะพิมพ์จะไม่แสดงตัวอักษร เมื่อสำเร็จจะขึ้น `Owner updated. No credentials were printed.` คำสั่งนี้สร้างทั้ง Supabase Auth user และ mapping ของ username พร้อม audit จึงไม่ต้องสร้าง user ผ่านหน้า Supabase Auth แยกเอง หากมีเจ้าของแล้วให้ใช้ `reset` แทน `create` โดยระบุ username เดิม

หากสร้างไม่สำเร็จ ให้อัปเดตโค้ดด้วย `git pull` เวอร์ชันใหม่แสดง `Owner update failed [ขั้นที่ล้มเหลว]: ...` พร้อมคำแนะนำ แยกขั้นตรวจ username/password, configuration, database, Supabase Auth และบันทึก owner ได้ หากติด database ให้ตรวจแบบอ่านอย่างเดียวโดยไม่กรอกรหัสผ่านบัญชีและไม่สร้าง/แก้ user:

```sh
node --env-file=.env.hosted.local --import tsx scripts/owner.ts check
```

คำสั่งตรวจ connection และตาราง owner เมื่อเกิด connection error จะแสดง `Database details:` ที่ปิดบัง connection URLs, credentials ใน environment, รหัสฐานข้อมูลที่ decode แล้ว และรหัสผ่านที่พิมพ์ โดยไม่แสดง stack/response ดิบ พร้อมตาม nested error เพื่อช่วยตรวจ timeout หรือ AggregateError ส่งเฉพาะข้อความวินิจฉัยนี้เพื่อช่วยตรวจต่อ ไม่ส่งไฟล์ `.env.hosted.local` หรือรหัสผ่าน หากเป็น database password ให้ตรวจ URI ของ Session pooler และ percent-encode ตัวอักษรพิเศษในรหัสผ่าน หากเป็น admin access ให้ใช้ service_role/secret key ไม่ใช่ anon/publishable key

หาก `Test-NetConnection` บน Windows ผ่าน แต่คำสั่งยัง timeout ให้ใช้ตัวตรวจแยก protocol:

```sh
node --env-file=.env.hosted.local --import tsx scripts/check-database-network.ts
```

แสดง hostname/port และผลว่า pooler username ตรง Supabase project หรือไม่โดยไม่แสดง username/password จากนั้นตรวจ TCP → PostgreSQL SSL negotiation → TLS ที่ตรวจ CA/hostname จริง → authentication/query แบบอ่านอย่างเดียว ช่วง probe ไม่ส่ง credentials และไม่ยอม downgrade เป็น plaintext ขั้น authentication ให้เวลาเชื่อมต่อ 30 วินาทีเพื่อแยกกรณีช้ากว่าค่า 5 วินาทีของแอพ ใช้ไฟล์ CA ที่เตรียมไว้เดิม หากหยุดก่อน TLS ผ่าน ให้ตรวจเส้นทางเครือข่าย/endpoint ตามขั้นที่รายงาน หาก TLS ผ่านแต่ query ล้มเหลว ให้ตรวจ project/username/password และสถานะ pooler หาก probe ผ่านทุกขั้นแต่คำสั่งสร้าง owner ยัง timeout ต้องปรับ connection timeout สำหรับงานผู้ดูแลตามผลตรวจ ไม่สรุปว่าเป็นรหัสผ่านผิดจาก TCP timeout เพียงอย่างเดียว

ตัว probe มี tests แยก 3 กรณีสำหรับ SSL negotiation ที่ค้าง, server ไม่รับ TLS และ TLS handshake ล้มเหลว ตรวจเพิ่มเติมในเครื่องด้วย certificate ชั่วคราวแล้วว่าผ่านเมื่อระบุ CA ที่ถูกต้อง และปฏิเสธ certificate เดิมเมื่อไม่มี CA ที่เชื่อถือ ผลนี้ไม่ใช่ผลตรวจเครือข่ายบน Windows ของผู้ใช้

หากผ่านฐานข้อมูลแล้วแต่สร้าง owner ติด Supabase Auth 401/403 ให้ตรวจสิทธิ์ admin แบบอ่านอย่างเดียว:

```sh
node --env-file=.env.hosted.local --import tsx scripts/check-auth.ts
```

ตัวตรวจรายงานประเภท key, ช่องว่างหัวท้าย, JWT role/project/expiry เฉพาะ metadata ที่ไม่ใช่ค่าลับ (claims ยังไม่ได้ตรวจลายเซ็น) และว่าค่าที่ process ใช้ตรงกับไฟล์ที่เลือกหรือไม่ Node ให้ inherited environment มาก่อน `--env-file` หากไม่ตรง ให้ลบเฉพาะตัวแปรที่ชนกันใน PowerShell เช่น `Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY -ErrorAction SilentlyContinue` แล้วรันใหม่ ตัวตรวจเรียกเฉพาะ admin list-users เพื่อยืนยันสิทธิ์ ไม่สร้าง/แก้ user ไม่พิมพ์รายชื่อผู้ใช้หรือ key หากถูกปฏิเสธจะแสดง HTTP status/code/message ที่ปิดบังค่าลับ เพื่อแยก key ผิดโปรเจกต์/หมดอายุ/ถูกยกเลิก สิทธิ์ไม่พอ และข้อผิดพลาด gateway ห้ามสรุปว่าผู้ใช้คัดลอก key ผิดจาก status อย่างเดียว หาก admin check ผ่านแต่ create ยังไม่ผ่าน ให้ใช้ `Auth details:` ที่คำสั่ง create แสดงเพื่อตรวจ policy ของการสร้างบัญชีต่อ

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

รอบ workflow รูปก่อน: model tests 4/4; unit/API/CLI tests 28/28 กับ PostgreSQL/Auth/PostgREST/Storage จริง; Chromium browser tests 5/5; `typecheck`, `format:check` และ production build ผ่าน Baseline Phase 2 บน `main` ที่ `911322c` ตรวจ Vercel ได้ READY พร้อม migration log หลังผู้ใช้เพิ่มสิทธิ์แล้ว รายละเอียด deployment รอบเปลี่ยน workflow อยู่ใน [receipt-first-workflow.md](receipt-first-workflow.md) ส่วน hosted sale flow และ Safari/WebKit บนอุปกรณ์จริงยังต้องตรวจแยก ผล local เหล่านี้ไม่ใช่หลักฐานว่าทดสอบบน production หรือบน iPhone แล้ว

## ผลตรวจ Phase 4 — 21 ตุลาคม 2569

ดู [handoff](handoff-phase4.md): เพิ่ม `weight_labor` แยกบิลและเลือกจำอัตราเฉพาะรายการในฟอร์มขาย โดยใช้สูตร/ตารางค่าแรงเดิม ไม่เปลี่ยน OCR หรือ UI/Three.js

- Migration เพิ่มเติม `20261021123258_phase4_weight_labor.sql` รักษารายจ่าย/รูป/ค่าแรงเดิมและ RLS/สิทธิ์เดิม เปลี่ยนเฉพาะ constraints ให้รองรับ kg และบาทต่อตัน
- `expenses.quantity_milli` คือกิโลกรัม × 1,000 สำหรับ `weight_labor`; `rate_minor` เป็นสตางค์/ตัน ปัดครึ่งขึ้นด้วยตัวหาร 1,000,000 ต่างจากวัน/กระสอบ/รายการที่ใช้ 1,000 ส่วน `sale_labor` ยังเก็บกรัม/จำนวนครึ่งวันเหมือนเดิม
- Model 4/4; unit/API/CLI 42/42; Chromium production build 8 ผ่าน + 1 ข้าม (private OCR photo ไม่มีในรอบนี้); typecheck, format:check, build และ diff checks ผ่าน
- ตรวจ UI → API → PostgreSQL/Auth/Storage จริงใน localhost test stack: น้ำหนักจากบิล/ฐานต่างจากบิล, อัตราร่วมและ override, รายจ่ายทีมแยกบิล/การจ่ายครั้งแรก, concurrent retry, rollback พร้อมรูป/profile/audit/idempotency และยอดสุทธิ/ค้างไม่ซ้ำ
- ยังไม่ใช่ผล Safari/iPhone จริงหรือการรับรอง OCR; ทั้งสองเรื่องอยู่ Phase 10 การจ่ายหนี้ภายหลังเพิ่มแล้วใน Phase 5

## ผลตรวจ Phase 5 — 21 ตุลาคม 2569

- Migration ใหม่ `20261021153814_phase5_debts_and_payments.sql` เพิ่ม `opening_debts` และขยาย `expense_payments` เดิมให้ผูกต้นทางได้หนึ่งแหล่ง พร้อม void reason/time, owner FK/RLS และ trigger คุมค้าง/รักษาประวัติ ไม่แก้ migration เดิมหรือ reset/seed production
- `/records` มีหนี้เดิม/เลือกเจ้าหนี้และสวน/จ่ายเพิ่ม/ยกเลิกจ่ายผิด ใช้ได้กับค่าแรงผูกบิลและรายจ่ายทุกชนิด รวมทีมแยกบิล ดู [API และกติกายอด](handoff-phase5.md)
- Model 4/4; unit/API/CLI 48/48 ทั้ง dev และ production build; typecheck/format/build/diff ผ่าน ตรวจ concurrency/idempotency/void/rollback/owner/RLS/audit ด้วย PostgreSQL/Auth/REST/Storage จริงใน isolated test stack เดิม
- Chromium production build 9 ผ่าน + 1 ข้าม (private OCR photo ไม่ได้ส่งเข้ารอบนี้): เพิ่มหนี้เดิม/failed payment/focus/retry/void/new payment/reload/ประวัติ/สุทธิ, 320 px และ regression UI/Three.js เดิมผ่าน
- หนี้เดิม 1,000 แยกจากยกมา 5,000; หนี้ 10,000 จ่าย 6,000+4,000 ค้าง 0; จ่ายผิด 5,000 แล้วยกเลิกและลงจริง 500 ค้าง 9,500 โดยไม่หักสุทธิซ้ำ
- งาน extraction และ Safari/iPhone จริงยัง Phase 10 ส่วนการแก้/ยกเลิกต้นทางเพิ่มใน Phase 7 แล้ว ผู้ใช้รับงาน Phase 6 และอนุญาต Phase 7 แล้ว

หลักฐาน deployment Phase 5 และผลตรวจแบบอ่านอย่างเดียวบน production อยู่ใน [handoff Phase 5](handoff-phase5.md) ต้องตรวจ deployment ของ HEAD ล่าสุดหลัง push เสมอ

## ผลตรวจ Phase 6 — 21 ตุลาคม 2569

- Migration `20261021160407_phase6_shared_expenses.sql` เพิ่ม `expense_allocations`/version และอนุญาต `expenses.garden_id=null` สำหรับต้นทางส่วนกลาง คงค่าแรงผูกบิล รูปและ payment เดิม ใช้ `private.expense_attributions` คำนวณยอดตามสัดส่วนด้วย cumulative half-up rounding ลำดับ garden UUID คงที่
- ยอดสุทธิรวมมาจาก server snapshot เดียวกับรายการสวน หักส่วนกลางที่ยังไม่แบ่งครั้งเดียว และแสดงยอดส่วนกลางแยก การจ่าย/void/แบ่ง/เปลี่ยนชุดแบ่งไม่หักสุทธิซ้ำ
- `PUT expenses/:id/allocations` แทนชุดแบ่งครบทั้งชุดหรือ `[]` เพื่อเก็บส่วนกลาง พร้อม owner/Origin/expected version/idempotency/audit/transaction DB มี immediate limit และ deferred complete-set constraint ไม่ให้ commit ชุดครึ่งเดียว
- Model 4/4; unit/API/CLI 54/54 ทั้ง dev และ production build; typecheck/format/build/diff ผ่าน Chromium production build 10 ผ่าน + 1 ข้าม (private OCR photo ไม่ได้ส่งเข้ารอบนี้)
- ตรวจส่วนกลาง 1,000 จ่าย 333.33 แบ่ง 400/600 → จ่ายตามสัดส่วน 133.33/200.00 ค้าง 266.67/400.00; เศษ 3 สตางค์/3 สวน, จ่ายเพิ่ม/void, แก้/เก็บกลับส่วนกลาง, concurrent payment/สองแท็บ, rollback/retry และ receipt/payment IDs เดิม ผ่านทั้ง API และ browser flow ที่เกี่ยวข้อง
- Browser ตรวจ validation/network error และ focus/คงค่า, stale version/load latest, reload, ภาพรวม/กรองค้างรายสวน, 320 px ไม่มี overflow/page error และ regression UI/Three.js เดิม ใช้ isolated test stack เท่านั้น ไม่สร้างข้อมูลทดสอบบน production

รายละเอียด API/สูตร/ข้อจำกัดและ deployment ล่าสุดดู [handoff Phase 6](handoff-phase6.md) ผู้ใช้รับงาน Phase 6 แล้วและอนุญาต Phase 7 ไม่อ้างว่าผ่าน Safari/iPhone จริงหรือคุณภาพ extraction ซึ่งยัง Phase 10

## ผลตรวจ Phase 7 — 22 ตุลาคม 2569

Model 4/4, unit/API/CLI 64/64 กับ production build รวม migration upgrade preservation, full Chromium production build 12 ผ่าน + 1 ข้าม และ targeted Phase 7 หลังเติม audit detail ดู [handoff Phase 7](handoff-phase7.md) สำหรับหลักฐานและ SHA/deployment ล่าสุด ไม่ใช้ผล Chromium แทน Safari/iPhone จริง

เพิ่ม migration `20261022000531_phase7_records_reports.sql` โดยไม่แก้ migrations เดิม ทุกรายการต้นทางมี version/soft void และค่าแรงผูกบิลมีสวน/วันที่ของตนเอง Reports ใช้ private invoker views ร่วมกับตัวกรองเดียวกันสำหรับ list/CSV ข้อมูลทดสอบอยู่ใน localhost แยก รวม database ชั่วคราวสำหรับทดสอบอัปเกรด ไม่ใช้ fixtures บน production

Code Phase 7 `ed96e54` → Vercel `dpl_AfNWxQpfbQuUyHNAF2R4QQ4RYM25` READY; migration/build logs, SHA/repo/branch/alias, checksum/RLS/advisors, production HTTP/served JS และ preservation digest ผ่าน รายละเอียดใน handoff เอกสารผลตรวจอยู่ commit ถัดจาก code และต้องตรวจ deployment ของ HEAD ล่าสุดหลัง push เอกสารอีกครั้ง

## ผลตรวจ Phase 8 — 22 ตุลาคม 2569

Model 4/4 และ unit/API/CLI 72/72 กับ production build ผ่าน รวม restore จริงเข้า Supabase ทดสอบอีกชุดและ login ผ่าน username/password เดิม, rollback หลัง upload, retry/idempotency, owner/RLS และ upgrade preservation คู่มือมีคำสั่ง init/inspect/preview/restore และข้อจำกัด snapshot/ไฟล์ Full Chromium 13 ผ่าน + 1 ข้าม; typecheck/format/build/diff ผ่าน ดู SHA/deployment ล่าสุดใน [handoff Phase 8](handoff-phase8.md)

Code Phase 8 `8beab17` → Vercel `dpl_G1Mh8adJVCA7R63tx4xFNWWL8kW2` READY ตรวจ repo/ref/SHA/alias, official CA/migration/build logs, 11 migration checksums, private bucket/RLS/advisors และ production HTTP/served JS แล้ว จำนวนแถว/digest คอลัมน์เดิมทั้งเก้าตารางตรงก่อน migration ไม่มี production test fixtures ผลตรวจอยู่ commit เอกสารถัดจาก code ต้องตรวจ HEAD ล่าสุดหลัง push เอกสารอีกครั้ง
