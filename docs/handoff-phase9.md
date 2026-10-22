# ส่งต่องาน Palm Ledger — Phase 9

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

## งานที่ต้องทำก่อนรับ Phase 9

1. ผู้ใช้เลือก private backup repository และช่องทางแจ้งผู้ดูแล (แนะนำ GitHub Actions notifications) พร้อมสิทธิ์ตั้ง secrets/dispatch ผ่าน GitHub API หรือให้ผู้ดูแลทำตาม [คู่มือ](automatic-backups.md)
2. ตรวจ remaining minutes/artifact storage และ zero-spend budget ของบัญชี ตั้ง retention >=7 วัน เก็บรหัส backup แยก offline โดยไม่เปลี่ยน SESSION_ENCRYPTION_KEY/credentials เดิม
3. ติดตั้ง workflows/vars/secrets ใน private repository pin reviewed source SHA แล้ว dispatch สำรอง production จริงแบบอ่านอย่างเดียว ตรวจ artifacts/readback/status ในเว็บ และการรับแจ้ง failure/stale จริงใน sandbox
4. ซ้อมกู้ **ไฟล์จาก provider จริง** ลง target ใหม่ ตรวจบัญชี/ยอด/รูปก่อนเรียก Phase 9 ครบเกณฑ์ ไม่สลับ production ไป test fixtures

ยังไม่เดิน Phase 10/แก้ OCR หรืออ้างว่าทดสอบ Safari/iPhone จริงผ่าน
