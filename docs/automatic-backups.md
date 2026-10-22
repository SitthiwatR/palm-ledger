# สำรองอัตโนมัติ — Phase 9

## สถานะการเปิดใช้งาน

โค้ดและ workflow templates มีแล้ว **ยังไม่ได้เปิดตารางงาน production**: source repository `SitthiwatR/palm-ledger` เป็น public ต้องเลือก private repository สำหรับสำรองก่อน GitHub API จาก workspace นี้ถูก network policy ปฏิเสธ และ connector ที่มีไม่มีคำสั่งตั้ง repository secrets/สร้าง private repository จึงยังตรวจโควตาจริง ตั้ง secrets เปิด schedule หรือพิสูจน์การส่งแจ้งเตือนจริงไม่ได้ หน้า `/tools` แสดง **ยังไม่ได้เชื่อมตัวรันสำรองส่วนตัว** จนกว่าจะมีงานจากตัวรัน private จริง ไม่ใช้ manual backup ทำให้สถานะเขียว

## รูปแบบที่เตรียมไว้

- GitHub-hosted Linux runner ใน **private repository แยกจาก source และ Supabase** รันทุกวัน 19:17 UTC (02:17 Asia/Bangkok) ไม่ขึ้นกับ process/deployment ของเว็บ
- ใช้ snapshot/encryption/restore format จาก Phase 8: PostgreSQL ของแอป + Auth identity/password hash ที่จำเป็น + รูปต้นฉบับจริง พร้อม manifest/checksum และ scrypt/AES-256-GCM ไม่มี live sessions/platform secrets การสำรอง PostgreSQL อย่างเดียว [ไม่รวม Storage bytes](https://supabase.com/docs/guides/platform/backups)
- เก็บ immutable artifacts 7 วัน ชุดไม่เกิน 40 MiB; สำรองวันเดียวกันที่สำเร็จแล้วไม่สร้างซ้ำ Retry ที่ล้มเหลวสร้าง attempt ใหม่ ไม่เขียนทับสำเนาที่ดี SDK ตรึง `@actions/artifact` 6.3.1 และ lockfile ใช้ local JavaScript action เพื่อรับ artifact runtime credentials ของ GitHub โดยตรง ไม่พึ่งการมี token ใน shell step
- ต้อง upload แล้ว download กลับมา ตรวจ SHA-256 ถอดรหัส และเทียบ archive ทั้งชุดก่อนสร้าง proof artifact/commit สถานะสำเร็จพร้อม audit ใน DB Proof ระบุเวลา snapshot จึงไม่ใช้เวลา upload ใหม่ทำให้ข้อมูลเก่าดูสด
- PostgreSQL daily lease ป้องกันคำขอพร้อมกัน Lease 30 นาที/runner timeout 20 นาที ถ้าถูก kill หลังอัปโหลดจะไม่ถูกนับว่า complete ในแอปจนกว่าตรวจครบ รอบใหม่หลัง lease หมด retry ได้ รหัสผ่าน/รายละเอียด error จาก provider ไม่ลง DB/log
- Watchdog แยก workflow ทุกสองชั่วโมง ตรวจว่า proof และ archive คู่กันยังมีอยู่และ snapshot ไม่เกิน 24 ชั่วโมง **ไม่ต้องเชื่อม Supabase หรือเว็บ** หากหาย/เก่า/อ่านปลายทางไม่ได้ จะจบด้วย failure ให้ GitHub แจ้งผู้ดูแลตาม notification settings
- ถ้า DB commit/audit ล้มเหลวหลังส่ง proof แล้ว ไฟล์ที่ตรวจถูกต้องยังอยู่ offsite แต่แอปคงสถานะ failed และ workflow ล้มเหลว ไม่ลบสำเนาที่ดี Watchdog อาจเห็นจุดสำรองที่กู้ได้จริงนี้ได้ ขณะที่แอปยังไม่ยืนยันการบันทึกสถานะ

## โควตาและข้อจำกัดที่ต้องตรวจตอนติดตั้ง

[GitHub Free](https://docs.github.com/en/billing/concepts/product-billing/github-actions) ระบุ private-repository standard runner 2,000 นาที/เดือน และ artifact storage 500 MB ที่ใช้ร่วมกับงานอื่นในบัญชี เจ็ดชุดขนาดสูงสุดประมาณ 280 MiB + ZIP/proofs; ตัวรันปฏิเสธก่อน export ถ้า artifacts ที่ยังไม่หมดอายุใน backup repository รวมพื้นที่สำรองรอบใหม่จะเกิน 350 MiB ไม่ลบ backup ที่ยังดีเพื่อเปิดทางให้งานใหม่ SDK ตรวจว่า retention ของ upload ไม่ถูกลดต่ำกว่า 7 วัน

**ยังไม่ยืนยัน remaining quota ของบัญชีจริง** ต้องตรวจ usage/budget ของเจ้าของ repository และตั้ง budget/stop usage เพื่อไม่ให้มีค่าใช้จ่ายก่อนเปิด schedule ไม่รับรองว่าฟรีหากบัญชีมีงานอื่นใช้โควตาร่วม การรัน backup timeout 20 นาที/watchdog 5 นาทีเป็นเพดาน ไม่ใช่ระยะใช้จริงหรือการอนุมัติค่าใช้จ่าย

[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) อาจล่าช้าหรือถูกข้าม จึงเป็นเป้าหมาย RPO ประมาณหนึ่งวัน ไม่ใช่ SLA ห้ามรับรองว่าไม่สูญเสียข้อมูลเกิน 24 ชั่วโมงทุกสถานการณ์ Watchdog ตรวจทุกสองชั่วโมงจึงอาจแจ้งหลังข้าม threshold ได้ถึงประมาณสองชั่วโมงบวกเวลา queue หาก GitHub ทั้งบริการหยุด งานสำรองและ watcher อาจไม่รัน ต้องตรวจ monitoring/budget เป็นระยะ

## ติดตั้งโดยผู้ดูแล

1. เลือก private repository ที่เจ้าของเข้าถึงได้ เช่น `SitthiwatR/palm-ledger-backups` ห้ามเปลี่ยน source repository เป็น private หรือส่งไฟล์สำรองขึ้น repository public โดยพลการ จำกัด collaborators เปิด Actions ตรวจ artifact retention อย่างน้อย 7 วัน ตรวจ Free remaining usage และตั้ง stop spending
2. ใน private repository สร้าง repository variable `PALM_SOURCE_SHA` เป็น **full 40-character SHA ของ code Phase 9 ที่ตรวจแล้ว** ตัวรัน checkout เฉพาะ SHA นี้ ไม่ checkout main ที่เปลี่ยนตามเวลา อัปเดต pin หลังปล่อย schema/code ที่ตรวจแล้ว เพื่อให้ archive schema และตัวกู้ตรงกัน ไม่รับ source SHA จาก untrusted dispatch input
3. ตั้ง Actions secrets ใน private repository โดยกรอกผ่านหน้า GitHub หรือ CLI แบบรับ stdin ที่ไม่แสดงค่า:
   - `PALM_DATABASE_URL`: connection เดิมของ Supabase `feotpdylvprtihgklndj` ผ่าน direct DB หรือ Session pooler ที่ตรง project ใช้ TLS ตรวจ CA/hostname ตัวรันดาวน์โหลด/ตรวจ official CA เดิม ไม่ปิด TLS verification
   - `PALM_SUPABASE_SERVICE_ROLE_KEY`: key เดิมสำหรับอ่าน Auth/รูปจาก source ไม่ใช้ project เก่า ไม่เปลี่ยน key ของ production และไม่ส่ง key นี้ให้ browser
   - `PALM_BACKUP_ENCRYPTION_PASSWORD`: สุ่มอย่างน้อย 32 ตัวอักษร (แนะนำ random 32 bytes หรือมากกว่า) **สร้างรหัสสำรองใหม่แยกจาก SESSION_ENCRYPTION_KEY** เก็บสำเนาใน password manager/offline ของผู้ดูแลก่อนเปิดงาน หากเสีย secret พร้อมบัญชี GitHub จะต้องมีสำเนานี้เพื่อกู้ไฟล์ ห้ามใส่ค่าลับใน issue/chat/Git/config ที่ commit
4. Copy [daily workflow](../ops/github/automatic-backup.yml) และ [watchdog](../ops/github/backup-watchdog.yml) ไป `.github/workflows/` ของ **private repository** Templates ใน public source เป็นไฟล์อ้างอิงนอก `.github/workflows` จึงไม่เปิด schedule ของ source repo ทั้งสอง workflow guard private repository และ checkout/setup-node ตรึง SHA ของ actions
5. รัน daily workflow ด้วย `workflow_dispatch` หลังตรวจสิทธิ์ปลายทางและโควตา งานนี้เป็นการสำรอง production จริงแบบอ่านข้อมูล ไม่ใช่ seed หรือสร้างรายการทดสอบ ต้องได้ conclusion success มี archive + verified proof, ดาวน์โหลดไฟล์ได้ และ `/tools` แสดงเวลาจุดข้อมูล/เวลาตรวจสำเร็จจริง
6. ผู้ดูแลเปิด [GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications) สำหรับ private repository และเลือกแจ้ง failure ทาง email/GitHub ตามต้องการ ผู้แก้ cron ล่าสุดเป็นผู้รับแจ้ง schedule ตามกติกา GitHub อย่าอ้างว่า email ส่งสำเร็จจาก exit code ของ script เพียงอย่างเดียว ต้องตรวจการรับแจ้งจริงกับผู้ดูแล ทดสอบ failure/old point ใน sandbox private repository/fixtures ไม่แก้รหัส production เพื่อให้ล้มเหลว
7. รัน watcher ด้วย `workflow_dispatch` ตรวจ fresh point ผ่าน และปล่อย schedule หลังหลักฐานชุดแรกครบ เก็บ workflow run URL/artifact IDs/วันที่ซ้อมกู้ใน handoff โดยไม่บันทึก secrets

ไม่มีการรัน migrate/seed/owner reset ใน workflow โค้ด export ตรวจ source project และ strict TLS ก่อนเชื่อม ตัวรันมีสิทธิ์เขียนเฉพาะ metadata/audit ผ่านโค้ดเส้นทางนี้ แต่ DATABASE_URL เดิมเป็นสิทธิ์ผู้ดูแล จึงต้องรักษา private repo, reviewed SHA, Actions secrets และ trusted dependencies ไม่อ้างว่า credential นี้เป็น DB read-only role

## กู้คืนและตรวจผล

ดาวน์โหลด **archive artifact** แล้วแตก ZIP จะได้ `backup.palmbackup` ใช้ `PALM_BACKUP_ENCRYPTION_PASSWORD` ที่เก็บแยก ตรวจด้วย CLI และทำตาม [คู่มือ Phase 8](backup-recovery.md) init/preview/restore ใน Supabase ใหม่ที่ว่างเท่านั้น เทียบยอด รูป ประวัติ username/password และทดลองเข้าเว็บปลายทางก่อนสลับใช้งาน ไม่ restore ทับ `feotpdylvprtihgklndj` และไม่สลับ production ไป test fixtures

ไฟล์สำรองรวม trusted migration checksums ต้องใช้ checkout/schema ที่ตรงกัน การกู้ app data ไม่ย้าย schedule/credentials ของโครงการเก่าตามโดยอัตโนมัติ ตั้งตัวรัน/ปลายทางใหม่แยกหลังตรวจระบบที่กู้แล้ว

## ทดสอบใน workspace

Source และ recovery Supabase ใช้ localhost แยกเหมือน Phase 8 มี guard ก่อนล้าง fixture `TEST_APP_MODE=production npm test` ทดสอบไฟล์เข้ารหัสที่เขียน/readback ผ่าน offsite filesystem adapter แล้วกู้เข้า Supabase อีกชุดจริง เพื่อพิสูจน์ข้อมูล รูป และบัญชี Fault injection ครอบคลุม public destination, corrupt download, audit rollback, retry/concurrency, quota เต็ม และ old snapshot

Adapter ทดสอบไม่ใช่หลักฐานว่า GitHub upload/schedule/notifications production เปิดแล้ว หลักฐานจริงส่วนนี้ยังต้องทำขั้นติดตั้งเมื่อ private destination และสิทธิ์ GitHub API พร้อม
