# ส่งต่องาน Palm Ledger — Phase 9

> อัปเดตตามคำสั่งล่าสุด: ผู้ใช้ให้พัก Phase 9 เพราะยังไม่มีลูกค้า แล้วให้เดิน Phase 10 เก็บโค้ดเดิม แต่ไม่เปิด schedule/สร้าง private repository ในรอบ Phase 10 ดู [handoff ล่าสุด](handoff-phase10.md)

22 ตุลาคม 2569 · [แผน](../plans/palm-ledger.md) · [ติดตั้ง/ดูแลสำรองอัตโนมัติ](automatic-backups.md)

## สถานะ

ผู้ใช้รับงาน Phase 8 และสั่งเดิน Phase 9 แล้ว ฐานล่าสุด `b3c9e51fa16dc1b99673deff0597b82e70b383b4` (code Phase 8 `8beab17`) `main` และ production READY ไม่ implement Phase 1–8 ซ้ำ

Phase 9 เพิ่มตัวรันสำรองรายวัน/การตรวจ freshness แยกจากเว็บ หน้าแสดงเวลาสำเร็จ และ workflow templates สำหรับ private GitHub repository **ยังไม่เปิด production schedule และยังไม่ปิด Phase 9** ต้องเลือก private destination เชื่อม secrets/ตรวจโควตาจริง และรับแจ้งเตือนจริงให้ครบ

ข้อจำกัดที่ยืนยันแล้ว: source `SitthiwatR/palm-ledger` เป็น **public** จึงไม่เก็บ artifacts ข้อมูลสวนที่นั่น `gh api` สำหรับ repo/Actions/secrets ถูก network policy ปฏิเสธ (`api.github.com` ไม่อยู่ใน effective allowed hosts) GitHub connector อ่าน repo metadata ได้และผู้ใช้มี admin แต่ไม่มี tools สำหรับสร้าง private repo/ตั้ง Actions secrets/dispatch workflow จึงไม่อ้างว่าระบบสำรองอัตโนมัติเปิดแล้ว เตรียมงานที่ทดสอบ/ตรวจรับได้ก่อนตามคู่มือติดตั้ง

## สิ่งที่ทำแล้ว

- `src/server/recovery/automatic.ts` ใช้ snapshot/encryption จาก Phase 8 เดิม PostgreSQL จริง/Auth identity/รูปต้นฉบับ/manifest/checksum รวมทุกตารางธุรกิจและประวัติที่รองรับ ไม่ export session tokens/platform secrets
- `private.automatic_backup_runs` owner/day unique, advisory/row locking, bounded lease, attempt metadata, complete/failed/error codes ไม่มีค่าลับหรือ provider error ข้อความดิบ กดซ้ำ/คำขอพร้อมกันไม่เขียนทับสำเนาที่ดีหรือสร้าง complete ซ้ำ วันใหม่ที่ล้มเหลวยังแสดงจุดสำเร็จก่อนหน้า
- สำเร็จเมื่อส่งไฟล์เข้ารหัสนอกระบบแล้วดาวน์โหลดกลับมา SHA/decrypt/full archive equality ผ่าน สร้าง verified proof แล้ว commit complete + audit ใน transaction เดียว Audit failure rollback status/audit พร้อมกัน เก็บ artifact ที่กู้ได้ไว้ ไม่ทำลายสำเนาดีเมื่อ DB บันทึกสถานะไม่ได้
- SDK `@actions/artifact` 6.3.1 ตรึงใน dev dependency/lockfile ใช้จาก CLI เท่านั้น ไม่มี GitHub credentials ไป browser หรือ Next API ตัวรันตรวจ private destination, source project `feotpdylvprtihgklndj`, strict TLS และ explicit enable ก่อนทำงาน ไม่ย้ายไป project เก่า/ไม่เปลี่ยน credentials/session key
- Daily workflow 19:17 UTC / watchdog ทุกสองชั่วโมง แยกจากเว็บ process/deployment ตัวตรวจใช้ GitHub artifact inventory ไม่ต้องใช้ PostgreSQL/Storage/app จับ missing/expired/incomplete proof, old snapshot >24h และ offsite access failure ได้ แต่ยังต้องติดตั้งให้รันจริง
- Retention 7 วัน, archive <=40 MiB, repository quota guard 350 MiB ก่อน export เผื่อสำเนาใหม่ ไม่ลบ backup ดีเพื่อคืนพื้นที่ ไม่ใช้ GitHub schedule เป็น SLA และยังไม่รับรอง remaining quota/cost ของบัญชีจริง
- `GET /api/v1/backups/automatic-status` owner-only คืน not-configured/healthy/stale/failed พร้อม lastSuccess/ latest timestamps ไม่คืน lease token อ่าน last successful point ทั้งประวัติ ไม่จำกัดเฉพาะ 30 งานล่าสุด
- หน้า `/tools` แสดงสถานะอัตโนมัติและเวลาจุดข้อมูล/ตรวจสำเร็จแยกจาก manual backup ฟอร์มเดิมและ UI/Three.js/OCR/รูป/session เดิมยังอยู่ ไม่มี endpoint เปิดรัน privileged backup ให้ browser

## Migration

`20261022073812_phase9_automatic_backups.sql` เพิ่มเฉพาะ private control table/index/owner RLS policy และ revoke all client grants ไม่แก้ migration เดิม ไม่เปลี่ยน business rows หรือ storage buckets ไม่ reset/truncate/seed production

Archive ไม่รวม control table ใหม่นี้: การกู้ข้อมูลธุรกิจไม่ควรเปิด schedule/นำ credentials ของ environment เดิมตามไปเอง ประวัติ audit สำเร็จยังรวมใน snapshot ถัดไปเช่นเดิม

## หลักฐานที่ต้องแยกกัน

ทดสอบบน localhost source/recovery Supabase สองชุดจริงเท่านั้น Offsite ใช้ adapter ที่เขียน/readback ไฟล์เข้ารหัสใน filesystem แยก เพื่อ inject failure ได้ **ไม่ใช่หลักฐานว่า GitHub upload production หรือ notification เปิดแล้ว**

- จำลอง public destination, download เสีย, audit failure หลัง upload, concurrent retry/same-day duplicate และโควตาเต็ม พิสูจน์ไม่มี complete ครึ่งชุด ไม่เปลี่ยนยอดสุทธิ/ค้าง หรือไฟล์ดีของรอบก่อน
- Watchdog ตรวจ missing/คู่ไม่ครบ/คนละ run/expired/future/older-than-24h โดยไม่ใช้แอปหรือ DB; success timestamp ใน UI ใช้ snapshot time ไม่ใช้วันที่อัปโหลดใหม่
- สร้างไฟล์ด้วย automatic runner แล้วกู้ลง Supabase recovery ใหม่จริง เปรียบเทียบยอด รูปทุกไฟล์ SHA และ username/password เดิม รวมเข้า Next API ปลายทางด้วยบัญชีเดิม
- Regression Phase 1–8 และ upgrade preservation/owner/RLS/idempotency ใช้ฐานทดสอบเดิมที่มี localhost guards; ไม่ใช้ข้อมูลทดสอบบน production

**ผลรวม:** model 4/4, unit/API/CLI **76/76** กับ production build ผ่าน; full Chromium **13 ผ่าน + 1 ข้าม** (รูป OCR ส่วนตัวไม่ได้ส่งเข้า suite), TypeScript/format/build/diff ผ่าน ทดสอบ 320 px ไม่มี overflow/page error และ manual backup ไม่เปลี่ยนสถานะ automatic เป็น healthy Dependency audit ของ lockfile รอบนี้ไม่พบ advisory (0)

Daily workflow เรียก local JavaScript action (`ops/actions/automatic-backup`) เพื่อให้ official artifact SDK ได้ short-lived runtime credentials จาก GitHub Actions อย่างถูกต้อง ไม่พึ่ง token ที่ shell step อาจไม่ได้รับ Action wrapper ตรวจ runtime context ก่อน spawn CLI ไม่ใส่ค่าลับใน arguments Watchdog ใช้เพียง GITHUB_TOKEN สำหรับอ่าน inventory

ไม่ใช้ผล local แทนการตรวจ provider/schedule/notification จริง Deployment/SHA/migration/build logs บันทึกหลัง push ด้านล่าง

## Deployment ที่ตรวจแล้ว

Code `021a5e37ca175c7b5c1345a655ec837de04bc0bd` push `main` แล้ว Vercel production [`dpl_DQFHWMY8GG6VRwUzs3bKZg7wDHcy`](https://vercel.com/self-ade5/palm-ledger/DQFHWMY8GG6VRwUzs3bKZg7wDHcy) **READY** Repo `SitthiwatR/palm-ledger`, ref `main`, SHA ตรง alias `palm-ledger-nine.vercel.app`, project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW` Supabase ยังคง `feotpdylvprtihgklndj`

Build logs ยืนยัน `npm run deploy:build`, official database CA verified, `Migrations applied.`, `Owner login: configured`, `Compiled successfully`, `Build Completed` (21 วินาที) และ `Deployment completed` ไม่เปลี่ยน build command/TLS/credentials

ตรวจ production แบบอ่านอย่างเดียว:

- ทั้ง **12 migrations** checksum ตรงไฟล์ local/Git แถวเดิม 11 รายการไม่เปลี่ยน Phase 9 SHA-256 **`7596040c84c105d521377ab6ccc607ccc4f11b1a44812a2d6f5eebce51619867`**
- เทียบจำนวนแถว/digest ของทุกคอลัมน์เดิมทั้ง `sales`, `sale_labor`, `expenses`, `opening_debts`, `expense_payments`, `expense_allocations`, `receipt_files`, `labor_profiles`, `gardens` ก่อน–หลัง migration **ตรงทั้งเก้าตาราง** ไม่มี fixtures/backup จริงที่ agent สร้างบน production
- ตาราง automatic backup ใหม่เปิด RLS มี owner SELECT policy และไม่มี anon/authenticated table privileges มี run count **0** ณ ตอนตรวจ จึงยังแสดง not-configured ไม่อ้างว่าเปิด schedule แล้ว
- Security advisors ไม่มี warning ใหม่ มี warning เดิมเรื่อง [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) ไม่แก้ Auth settings
- `/login`, `/tools`, `/records` → 200; unauthenticated `/api/v1/backups/automatic-status` → 401 JS ที่เสิร์ฟจริงมี `backups/automatic-status` ไม่มี `ACTIONS_RUNTIME_TOKEN` หรือ `PALM_DATABASE_URL` ใน client bundles
- Error/fatal scan ของ deployment ช่วง 10 นาทีที่ตรวจไม่พบ logs ไม่ใช้ผลนี้เป็นการรับรอง monitoring ระยะยาว

ผลนี้อยู่ commit เอกสารถัดจาก code ต้องตรวจ **HEAD ล่าสุดหลัง push เอกสาร** READY พร้อม SHA/migration/build logs อีกครั้ง UI/API production พร้อมให้ตรวจ แต่ Phase 9 ยังมี external setup/acceptance ที่ไม่เสร็จตามรายการด้านล่าง

## งานที่ต้องทำก่อนรับ Phase 9

1. ผู้ใช้เลือก private backup repository และช่องทางแจ้งผู้ดูแล (แนะนำ GitHub Actions notifications) พร้อมสิทธิ์ตั้ง secrets/dispatch ผ่าน GitHub API หรือให้ผู้ดูแลทำตาม [คู่มือ](automatic-backups.md)
2. ตรวจ remaining minutes/artifact storage และ zero-spend budget ของบัญชี ตั้ง retention >=7 วัน เก็บรหัส backup แยก offline โดยไม่เปลี่ยน SESSION_ENCRYPTION_KEY/credentials เดิม
3. ติดตั้ง workflows/vars/secrets ใน private repository pin reviewed source SHA แล้ว dispatch สำรอง production จริงแบบอ่านอย่างเดียว ตรวจ artifacts/readback/status ในเว็บ และการรับแจ้ง failure/stale จริงใน sandbox
4. ซ้อมกู้ **ไฟล์จาก provider จริง** ลง target ใหม่ ตรวจบัญชี/ยอด/รูปก่อนเรียก Phase 9 ครบเกณฑ์ ไม่สลับ production ไป test fixtures

ข้อความข้างต้นเป็นหลักฐานรอบ Phase 9; ผู้ใช้ให้เดิน Phase 10 ต่อแล้ว แต่ยังไม่อ้างว่า Safari/iPhone จริงผ่าน
