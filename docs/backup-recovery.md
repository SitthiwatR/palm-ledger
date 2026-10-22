# สำรอง กู้คืน และย้ายข้อมูล — Phase 8

## เจ้าของใช้งานผ่านเว็บ

เปิด **สวน → สำรอง กู้คืน และย้ายข้อมูล** (`/tools`) ตั้งรหัสชุดสำรองอย่างน้อย 12 ตัวอักษรแล้วสร้างชุดรวมรูป ดาวน์โหลดไฟล์ `.palmbackup` ไปเก็บนอกระบบหลัก และเก็บรหัสแยกจากไฟล์ หากลืมรหัสจะเปิดไฟล์ไม่ได้

ชุดสำรองเป็น logical snapshot ของข้อมูลแอปและรูปต้นฉบับ มี SHA-256 ของข้อมูล บัญชี และแต่ละรูป เข้ารหัสด้วย scrypt + AES-256-GCM ครอบคลุมสวน ยอดยกมา ขาย/รายการหัก ค่าแรงผูกบิล/แยกบิล รายจ่าย หนี้เดิม การจ่ายและการยกเลิก ชุดแบ่งส่วนกลาง versions/void metadata audit และ mapping ที่เคยนำเข้าต้นแบบ รวม Auth user/password hash/identity และชื่อผู้ใช้ที่จำเป็นต่อการเข้าใช้ในระบบใหม่ **ไม่รวม live sessions/tokens, deployment credentials, encryption key หรือการตั้งค่าระดับแพลตฟอร์ม** หลังย้ายต้องเข้าสู่ระบบใหม่

ไฟล์บนเซิร์ฟเวอร์ดาวน์โหลดได้ 7 วัน ลิงก์ดาวน์โหลดมีอายุ 5 นาที ไฟล์ที่อัปโหลดเพื่อตรวจมีอายุ 24 ชั่วโมง การกวาดไฟล์หมดอายุทำเมื่อมี POST สำรอง/นำเข้าครั้งถัดไป มีโค้ดสำรองอัตโนมัติใน Phase 9 แล้ว แต่ยังต้องเชื่อม private runner/destination ก่อนเปิดจริง ดู [สถานะและคู่มือ](automatic-backups.md) ยังไม่มี scheduled cleanup ของไฟล์ manual อย่าใช้พื้นที่นี้เป็นสำเนาสำรองเพียงแห่งเดียว

อิง [Supabase Free file limit 50 MB](https://supabase.com/docs/guides/storage/uploads/file-limits) จำกัดชุดสำรอง 40 MiB/1,000 รูป และเนื้อรูปก่อน base64 รวม 28 MiB; JSON ต้นแบบไม่เกิน 15 MiB ไฟล์ส่งตรง private Storage ผ่าน signed upload จึงไม่ผ่าน body ขนาดใหญ่ของ Vercel Function รหัสเปิดไฟล์ส่งเฉพาะ request JSON หลังยืนยันเจ้าของ ไม่เก็บใน database/localStorage/log

เมื่อตรวจชุดสำรองบนเว็บ ระบบแสดงจำนวนสวน รายการ การจ่าย รูป สุทธิ ค้าง และเวลาของ snapshot ก่อนยืนยัน ปุ่ม **ยืนยันชุดสำหรับกู้คืน** เป็นการรับรองชุดให้ผู้ดูแลกู้ในระบบใหม่ตามขั้นด้านล่าง ยังไม่เปลี่ยนข้อมูลปัจจุบันหรือสลับโครงการ production

## ย้าย JSON จากต้นแบบเดิม

เลือก JSON ที่ export จากต้นแบบ `model.mjs` version 1 ตรวจป้ายข้อมูลจริง/ตัวอย่าง รายชื่อสวน ยอดก่อน/หลัง รูป และคำเตือนก่อนยืนยัน ข้อมูลตัวอย่างต้องยืนยันเพิ่มแยกชัดเจน การนำเข้าเป็นการเพิ่มข้อมูลในบัญชีเดิม ไม่ลบหรือแทนชุดเดิม

- ปฏิเสธ version อื่น, ID ซ้ำภายในไฟล์หรือเคยนำเข้า, ชื่อสวนชนเดิม, references เสีย และรูปไม่ครบ/ชนิดไม่ตรง โดยยังไม่สร้างรายการธุรกิจ
- `paid` สะสมที่ไม่มี payment rows จะเติมประวัติจ่ายเฉพาะส่วนต่างที่ยังไม่มี พร้อมป้าย **ไม่ทราบวันที่จ่าย** ไม่อ้างวันที่เทคนิคเป็นวันที่จ่ายจริง สุทธิ/ค้างก่อนและหลังต้องเท่ากับต้นแบบ
- ค่าแรงที่เชื่อมบิลไป `sale_labor` ไม่คัดลอกเป็น `expenses` ซ้ำ หนี้เดิมไม่เป็นต้นทุน; รองรับหนี้เดิมส่วนกลางโดยไม่ผูกสวน
- หากต้นแบบไม่เก็บน้ำหนัก/จำนวน/อัตราที่ตรงยอด ให้แสดงไม่ทราบและเก็บยอดเดิม แก้ยอดด้วยเหตุผลและประวัติได้ ไม่สมมติ 1 หน่วยหรือแต่งอัตรา ข้อมูลต้นทางที่มีอยู่เก็บใน `legacy_details` ซึ่งแก้ย้อนหลังไม่ได้
- สำเนาการแบ่งจากต้นแบบที่มี `allocatedFrom` เก็บตามแต่ละแถวเดิมพร้อม provenance ไม่สร้างประวัติแบ่งส่วนกลางใหม่ที่ต้นแบบไม่ได้เก็บ รายรับส่วนกลางหรือค่าแรงอ้างบิลกำกวมถูกปฏิเสธพร้อมข้อความให้แก้ไฟล์ต้นทาง
- Preview ไม่ลงบัญชี ถ้ายอดธุรกิจเปลี่ยนก่อนยืนยันต้องตรวจใหม่ การยืนยันบันทึกแถว รูป metadata/mapping/audit/idempotency ใน transaction เดียว ถ้าล้มเหลว rollback และกวาดเฉพาะรูปที่ staging ไว้ การลองใหม่ไม่สร้างรายการซ้ำ

## ผู้ดูแลกู้คืนใน Supabase ใหม่

ใช้ repository และ trusted migrations **ตรงเวอร์ชัน/checksum ที่อยู่ในไฟล์สำรอง** ไม่รัน SQL จากไฟล์ที่ผู้ใช้อัปโหลด ขั้นตอนนี้ต้องใช้สิทธิ์ผู้ดูแลฐานและ Storage จึงเป็น CLI ไม่เปิดสิทธินี้ให้ browser การกู้คืนปฏิเสธโครงการ production `feotpdylvprtihgklndj`, โครงการต้นทาง, ฐานที่มีข้อมูลหรือ Auth users, ปลายทาง Database/Storage คนละ project bucket ที่เปิด public และ TLS ที่ไม่ตรวจ certificate

1. สร้าง Supabase ใหม่ที่แยกจากต้นทางและไม่มีบัญชี/ข้อมูลแอป เตรียม config ส่วนตัว `.env.recovery.local` (ห้าม commit) ใช้ค่าของปลายทางเท่านั้น: `PALM_RECOVERY_TARGET=true`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` และ CA ของปลายทางผ่าน `DATABASE_CA_CERT` หรือ `.certificates/supabase-ca.crt` ต้องตรวจ TLS/hostname จริง ใช้ direct DB หรือ Session pooler ที่ project ตรงกัน ไม่เปลี่ยน credentials/key ของ production
2. สร้าง app schema บนปลายทางว่างด้วย `npm run recovery -- init .env.recovery.local` คำสั่งอ่าน config นี้โดยตรง ไม่รับค่า production มาทับโดย environment ที่ค้างอยู่ ถ้า schema มีอยู่แล้วจะปฏิเสธ ไม่สร้างทับ
3. ตรวจไฟล์ด้วย `npm run recovery -- inspect /private/path/backup.palmbackup` กรอกรหัสผ่าน hidden prompt (หรือ stdin ที่จัดการอย่างปลอดภัย) ห้ามใส่รหัสเป็น command argument/commit ไฟล์ลับ
4. ทดลอง constraint จริงโดยไม่ commit: `npm run recovery -- preview /private/path/backup.palmbackup .env.recovery.local` จะ rollback ทั้งแถวบัญชีและข้อมูล ไม่มีการคัดลอกรูปในขั้น preview ตรวจรายงาน `.preview-report.json`
5. เมื่อผลตรงจึง `npm run recovery -- restore /private/path/backup.palmbackup .env.recovery.local --confirm` คำสั่งตรวจ checksum/relations/sums ใส่บัญชีและข้อมูลลง transaction คัดลอกรูปแล้วดาวน์โหลดตรวจ SHA-256 ทุกไฟล์ก่อน commit ถ้าผิดพลาด rollback DB/Auth และลบเฉพาะ object ของรอบนั้น ปลายทางที่กู้สำเร็จแล้วจะไม่รับ restore ซ้ำทับข้อมูล
6. รายงาน `.restore-report.json` สร้างด้วย mode 0600 แสดงยอด จำนวนรูป ชื่อผู้ใช้ และ receipt key mapping: IDs/เนื้อรูปเดิมคงอยู่ แต่ storage keys ใช้ namespace ใหม่ต่อ attempt เพื่อไม่ชนการลบที่ Storage ทำแบบ asynchronous เก็บรายงานนี้ไว้กับบันทึกการซ้อมกู้
7. ตั้งแอปแยกสำหรับปลายทางด้วย `SUPABASE_URL`, anon/service key, `DATABASE_URL`, `APP_URL` และ `SESSION_ENCRYPTION_KEY` ของแอปใหม่ รัน code/migrations เดียวกัน **ไม่ใช้คำสั่งสร้าง/reset เจ้าของ** เข้าด้วย username/password เดิม ยืนยันสุทธิ/ค้าง/รายสวน การจ่ายที่ถูกยกเลิก ชุดแบ่ง audit และเปิดรูปจริง ตรวจ RLS/private buckets/สิทธิ์ก่อนใช้งาน

ก่อนสลับ production ต้องตรวจผลปลายทางและวางแผนช่วงหยุดเขียน/สำรองสุดท้ายเพื่อไม่ให้รายการใหม่หลัง snapshot ตกหล่น การสลับ URL/config เป็นงานผู้ดูแลแยกจากคำสั่ง restore และไม่ได้ทำในการทดสอบ Phase 8 นี้ โครงการต้นทางและ deployment เดิมยังอยู่เพื่อถอยกลับ ห้ามสลับ production ไปยัง test fixtures

การสำรองนี้ไม่ใช่สำเนาทั้ง Supabase project: Storage bytes รวมอยู่แล้ว แต่การตั้งค่า Auth/provider, DNS, platform secrets และ schema ของบริการ Supabase ให้เตรียมจากระบบที่ไว้ใจ ไม่พยายามย้าย active sessions ของโครงการเก่าไปใช้กับ JWT keys ใหม่

## ซ้อมกู้บนเครื่องพัฒนา

`npm run local:test:setup` ใช้ source stack ports 54421/54422; `npm run local:recovery:test:setup` สร้าง target stack ports 55421/55422 และ `.env.recovery.test.local` แยก ใช้ `npm run build` แล้ว `TEST_APP_MODE=production npm test` เพื่อทดสอบจริงทั้ง PostgreSQL/Auth/Storage และเข้า Next API ของปลายทางด้วยบัญชีเดิม การทดสอบมี guard บังคับ localhost แยกจาก production เสมอ Browser suite: `TEST_APP_MODE=production npm run test:browser` รันแยกจาก API suite เพราะใช้ฐานทดสอบและ port เดียวกัน
