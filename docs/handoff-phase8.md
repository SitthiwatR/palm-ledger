# ส่งต่องาน Palm Ledger — Phase 8

วันที่ 22 ตุลาคม 2569 · [แผน](../plans/palm-ledger.md) · [คู่มือสำรอง/กู้คืน](backup-recovery.md)

## สถานะ

ผู้ใช้รับงาน Phase 7 และสั่งเดิน Phase 8 แล้ว ฐานเริ่มต้น `173dd8f1d602b6ca508f1bbf69e56b7da842aee0` บน `main` (code Phase 7 `ed96e54`), deployment `dpl_9TbPQrKCXAaWP4vMEp89pMy5sfWz` READY ไม่ทำ Phase 1–7 ซ้ำ

Phase 8 เพิ่มสำรองรวมรูป กู้คืนในระบบใหม่ และนำเข้า JSON ต้นแบบ พร้อม preview/ยืนยันและตรวจยอด **รอผู้ใช้ตรวจรับ Phase 8 ไม่ปิดแทนผู้ใช้หรือเดิน Phase 9 อัตโนมัติ** ไม่แก้ OCR/Three.js/credentials/encryption key/TLS ไม่สร้าง test fixtures บน production

## พฤติกรรมที่ส่งมอบ

หน้า **สวน → สำรอง กู้คืน และย้ายข้อมูล** (`/tools`) รักษา UI เขียว–ครีม มีสถานะทำงาน/สำเร็จ/ผิดพลาด focus ที่ error และคงไฟล์/ค่าที่กรอก/การยืนยันเมื่อล้มเหลว

- เจ้าของตั้งรหัส สร้างและดาวน์โหลด `.palmbackup` ที่เข้ารหัส scrypt + AES-256-GCM มี manifest/checksum รวมข้อมูลแอป 12 ตาราง + Auth users/identities + import mappings + รูปต้นฉบับ ข้อมูลแต่ละตารางอยู่ใน repeatable-read snapshot เดียว รูปถาวรเป็น immutable objects ดาวน์โหลดตรวจ bytes/hash ทุกไฟล์ ภาพขาดไม่สร้างชุดครึ่งชุด
- รวมยอดยกมา ค่าแรงผูกบิลและแยกบิล labor snapshots/profiles หนี้เดิม payment history ทั้ง active/voided source versions/void metadata allocations/deductions/receipt metadata/audit คงความหมายสุทธิและค้าง ไม่รวม active sessions/tokens หรือ platform secrets หลังย้ายบัญชีต้องเข้าสู่ระบบใหม่
- ตรวจไฟล์สำรองบนเว็บก่อนยืนยัน **เป็นชุดสำหรับผู้ดูแลกู้ใน environment ใหม่** ไม่แทนฐานที่ใช้อยู่ Full restore ใช้ CLI ที่บังคับ fresh target/explicit config/project matching/strict TLS และห้าม production/source project ตรวจและ lock private bucket settings ก่อนคัดลอกรูป คู่มือมี init → inspect → preview → restore → ตรวจบัญชี/ยอด/รูปก่อนสลับใช้งาน ไม่มีการสลับ production ไปข้อมูลทดสอบในงานนี้
- Restore ตรวจ trusted migration checksum ให้ตรง ใช้ parameterized fixed-table inserts ไม่ execute SQL จากไฟล์สำรอง Preview ทดลอง constraints แล้ว rollback จริง Restore คัดลอกและอ่านรูปตรวจ SHA ก่อน commit DB/Auth; รูปใช้ namespace ใหม่ทุก attempt เพื่อ retry หลัง rollback ได้โดยไม่ชน asynchronous delete ของ Storage ทุก ID/bytes เดิมคงอยู่ รายงานบอก key mapping
- JSON version 1 จากต้นแบบแยกจริง/ตัวอย่าง (ต้องยืนยัน demo เพิ่ม) ตรวจ IDs/version/links/รูป/ชนชื่อสวน/เคยนำเข้า แสดง before/after ก่อนยืนยัน ค่าแรงผูกบิลลง `sale_labor` ครั้งเดียว ไม่คัดลอกเป็น expense ซ้ำ
- `paid` เดิมที่มากกว่าผลรวม payment rows เติมเฉพาะส่วนต่างพร้อมป้ายไม่ทราบวันที่จ่าย ไม่สร้างประวัติซ้ำ หนี้เดิมไม่หักสุทธิ; shared opening debt นับค้างส่วนกลางได้ รูปเชื่อมได้ทั้งสี่ source
- ฐานคำนวณน้ำหนัก/จำนวน/อัตราที่ต้นแบบไม่ได้เก็บหรือไม่ตรงยอดเป็น NULL มี provenance และ UI อธิบายให้แก้ยอดเดิมโดยไม่สมมติหน่วย รายการใหม่ใช้ validation เดิม ความหมายข้อมูลที่ต้นแบบมีเก็บใน immutable `legacy_details`; `allocatedFrom` เก็บตามต้นฉบับ ไม่แต่งประวัติแบ่งใหม่ รายรับส่วนกลาง/links กำกวมปฏิเสธชัดเจน
- Import stage รูปก่อน DB transaction โดยมี durable cleanup tracking; owner lock + business baseline กัน preview เก่า แถวธุรกิจ/mapping/audit/idempotency/final status commit พร้อมกัน Retry body/key เดิมคืนเดิม ต่าง body ได้ conflict จ่ายพร้อมสำรองไม่ทำ snapshot ครึ่งช่วง รหัสผิดแล้วตรวจไฟล์เดิมใหม่ได้โดยไม่อัปโหลดทับ

## API / ความปลอดภัย

ทุก endpoint ตรวจ owner session; POST ตรวจ Origin, JSON limit, owner/auth epoch ใน transaction และ UUID Idempotency-Key ในขั้นที่มีผลถาวร

- `POST /api/v1/backups` `{passphrase}`; durable lease กันคำขอทำงานซ้อน สถานะ processing/ready/failed retry ได้ `GET /backups` และ `GET /backups/:id` ให้ signed download 5 นาทีหลังตรวจ owner
- `POST /recoveries/upload-url` `{kind:"prototype"|"restore",sizeBytes}` ส่งตรง private Storage เลี่ยง Vercel request-body limit Token ไม่เขียนทับ object เดิม ถ้า upload สำเร็จแต่ response หาย/รหัส preview ผิด การลองใหม่ใช้ไฟล์เดิม
- `POST /recoveries/:id/preview` `{passphrase?}`; `POST /recoveries/:id/confirm` `{previewHash,acknowledge:true,allowDemo?,passphrase?}` ยืนยัน restore คืน `verified-for-new-environment` ไม่อ้างว่าฐานปัจจุบันถูกกู้แล้ว
- ชุดดาวน์โหลด 7 วัน/ไฟล์ candidate 24 ชั่วโมง มี bounded cleanup เมื่อ POST ครั้งถัดไป ไม่มี cron/offsite backup ใน Phase 8 จำกัด 40 MiB/1,000 รูป/เนื้อรูป 28 MiB, JSON 15 MiB
- เก็บ fingerprint ของรหัสด้วย HMAC ที่ผูก session encryption key/context ไม่เก็บรหัสหรือ unkeyed password hash Files private/read by signed URL เท่านั้น ตารางควบคุม private มี RLS/owner policy และ revoke client grants ทั้งหมด

## Migrations

เพิ่ม `20261022004032_phase8_backup_recovery.sql`, `20261022005155_phase8_transfer_objects.sql` และ `20261022012344_phase8_transfer_free_tier_limit.sql` ไม่แก้ checksum เดิม เพิ่ม `legacy_details`, payment `legacy_date_unknown`, receipt labor/debt FK, private transfer_jobs/legacy_imports/transfer_objects และ private `palm-transfers` bucket

Unknown calculation อนุญาตเฉพาะ legacy provenance และ NULL เป็นคู่ Opening debt สวน nullable รองรับ shared debt Payment guard เดิมตรวจ immutable unknown-date flag เพิ่ม ฟังก์ชันใหม่ security invoker/search_path ว่าง/revoke execute มี owner RLS ทุกตารางใหม่ รูป/IDs/session ciphertext/ค่าธุรกิจเดิมไม่ถูกแก้โดย migrations

Migration ที่สามลด bucket/control-row limit ให้ตรงแอป 40 MiB ต่ำกว่า [Supabase Free global limit 50 MB](https://supabase.com/docs/guides/storage/uploads/file-limits) โดยไม่เปลี่ยนแพ็กเกจ/global settings หรือ bucket รูปเดิม เนื้อรูปก่อน base64 จำกัด 28 MiB

## หลักฐานการทดสอบ

ใช้ PostgreSQL/Auth/Storage จริงสองชุดแยกบน localhost (source 54421/54422; recovery target 55421/55422) ไม่ใช้ production ข้อมูล fixture กับคำสั่งล้างข้อมูลมี localhost guards

- ตัวอย่างต้นแบบ A รายได้ 48,000 ต้นทุน 20,000 + ยอดยกมา 5,000; B รายได้ 30,000 ต้นทุน 15,200 → สุทธิ 47,800 ค้าง 8,400 รูปสี่ต้นฉบับเปิดได้; เติม paid history ครั้งเดียว ทั้งค่าแรงผูกบิล/รายจ่าย/หนี้เดิม ไม่ทราบจำนวน/อัตราแสดงตรงข้อมูลและแก้ยอดพร้อมประวัติได้
- JSON เสีย/version ผิด/IDs ซ้ำ/import ซ้ำ/รูปเสีย/demo ไม่ยืนยัน ถูกปฏิเสธ ชุดเสีย/รหัสผิด/รูปขาดไม่เปลี่ยนข้อมูล baseline เปลี่ยนต้อง preview ใหม่
- จำลอง audit failure และ Storage upload failure จริงบน local bucket ตรวจไม่มีธุรกิจหรือ mapping/audit/idempotency ครึ่งชุด retry/concurrent confirm ได้ผลเดียว
- Snapshot ระหว่างมี payment commit ตรวจเป็น snapshot ที่สอดคล้องกัน ครอบคลุม active/voided payment, allocations, profiles, original metadata/keys/mappings/Auth identity
- Restore ลง Supabase ใหม่จริง ตรวจ rollback DB/Auth เมื่อ audit fail หลังคัดลอกรูป แล้ว retry สำเร็จ รูปเดิม SHA ตรง บัญชี username/password เดิมเข้า Auth และ Next API ปลายทางได้ สภาพแวดล้อมไม่ว่าง/production/mixed project/insecure TLS ถูกปฏิเสธก่อนเขียน ทุก history trigger กลับมา enabled
- Upgrade preservation ใช้ migrations ก่อน Phase 7 และข้อมูลเก่า แล้ว apply Phase 7–8 เปรียบเทียบคอลัมน์เดิมทุกแถว รวม session ciphertext, IDs, photos metadata, audit, profiles, active/voided payments และ allocations

**ผลรวม:** model 4/4, unit/API/CLI 72/72 กับ production build ผ่าน; full Chromium production build **13 ผ่าน + 1 ข้าม** (ไม่ได้ส่งรูป OCR ส่วนตัวเข้า suite) รวม Phase 1–7/HEIC/manual/Three.js/reduced motion/WebGL fallback และ Phase 8 ที่ 320 px ไม่มี overflow/page error ตรวจ download จริง รหัสผิด→แก้รหัส→ตรวจ/ยืนยันชุดเดิม และ import retry หลัง network failure ได้ TypeScript/format/build/diff ผ่าน ไม่ใช้ Chromium แทน Safari/iPhone จริง

## Deployment

Production <https://palm-ledger-nine.vercel.app> · Supabase `feotpdylvprtihgklndj` · Vercel project `prj_ZCEDsQNX4Kt2Xgj6IPdqI9ip9LT6`, team `team_PnTYWZ1rB5hOoQSGOZwv0aFW`

ใช้ `npm run deploy:build` เดิม (official CA → transactional/checksum migrations → Next build) มี snapshot จำนวนแถว/digest ของคอลัมน์เดิม production ก่อนปล่อย เพื่อเทียบหลัง migrations ตรวจ HEAD ล่าสุด READY พร้อม repo/ref/SHA/alias และ migration/build logs ผลตรวจหลัง push บันทึกในเอกสารถัดจาก code commit

## งานต่อ

รอผู้ใช้ตรวจรับ Phase 8 Phase 9 คือเลือกตัวรัน/ปลายทางนอกระบบ/ระยะเก็บ สำรองรายวัน และแจ้งล้มเหลว/จุดสำรองเก่ากว่า 24 ชั่วโมง ยังไม่ได้ implement งาน extraction และ Safari/iPhone จริงยัง Phase 10 ผล Chromium ไม่แทนการรับงานบนอุปกรณ์จริง
