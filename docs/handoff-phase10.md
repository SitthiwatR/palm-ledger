# Handoff — Phase 10: กรอกบิลและตรวจ flow รวม

## ขอบเขตตามคำสั่งล่าสุด

ผู้ใช้รับ Phase 1–8 แล้ว ให้พัก Phase 9 เพราะยังไม่มีลูกค้า และให้ทำ Phase 10 ก่อนทยอยเก็บรายละเอียดจากการใช้งาน ระหว่างทำถามว่าไม่ควรใช้ OCR หรือไม่ จึงเสนอและปรับ **แนบรูปแล้วกรอกเองเป็นค่าเริ่มต้น โดยมี OCR เป็นตัวช่วยเลือกใช้** เป็นการตัดสินใจ UX ที่แก้กลับได้ ยังไม่ใช่คำสั่งให้ถอด OCR ทั้งหมด และไม่อ้างว่าผู้ใช้รับงาน OCR/เวลา 1 นาทีแล้ว

เก็บ automatic backup runner/workflow templates ของ Phase 9 ไว้ แต่ไม่เปิด schedule หรือสร้าง private repository ในงานนี้ Manual backup/restore ของ Phase 8 ยังอยู่ ดู [Phase 9](handoff-phase9.md)

เริ่มจาก `main` HEAD `f3f1ede20c723633cd8b88677e72bd809ff31518` ตรวจ fetch แล้วไม่มี remote commit ค้าง ไม่ implement เฟสก่อนซ้ำ ใช้ Supabase `feotpdylvprtihgklndj` และ Vercel project/team เดิมเท่านั้น

## สิ่งที่เปลี่ยน

- ถ่าย/เลือกรูป → อัปโหลดต้นฉบับและเตรียม preview → กรอกข้อมูล → เลือกค่าแรง → ยืนยัน ไม่มีการโหลด worker/โมเดล OCR ก่อนกดอ่าน ระบบคำนวณเงิน/ค่าแรง/ค้างด้วยสูตรเดิม บิลใหม่ล้างเลขบิล น้ำหนัก ราคา และรายการหักจาก draft เก่า แต่รักษาค่าจำสวน/ผู้รับซื้อ/อัตราเดิม
- ใน “ตัวช่วยอ่านบิล (OCR) · เลือกใช้ได้” หมุนภาพทีละ 90° และเลือกขอบ 0–40% ด้วย slider ได้ อ่านในเครื่อง ไม่มี API key/ค่าบริการ OCR ต่อบิล ไม่แก้รูปต้นฉบับ ผลใหม่แสดงให้เลือกแทนข้อมูลบิลหรือเก็บข้อมูลที่แก้ไว้ ยกเลิกอ่านได้ ฟอร์มยืนยันถูกล็อกระหว่างอ่าน และไม่สร้างขาย/ค่าแรง/upload ใหม่
- OCR เดิมมี preprocessing และอ่าน net cell อยู่แล้ว จึงเติมเฉพาะการตรวจยอดก่อนหยุดอ่าน อ่านภาพสีเดิมเมื่อจำเป็น แยกเลขที่อยู่/ทะเบียนรถจากเลขบิล ไม่รวมวันที่ข้างเลขบิลเป็นเลขบิล และรองรับ “เป็นเงิน” กับลานเทปาล์ม คง model/dependencies เดิม ไม่เดาน้ำหนักหรือราคาจากยอดเงิน
- จำกัดคำขอ API/อัปโหลด 60 วินาที (ใช้ AbortController ที่รองรับ browser เดิม) อ่าน OCR เสริม 45 วินาที เก็บค่าฟอร์ม/idempotency key เพื่อ retry หลังคำตอบหลุด ตรวจไฟล์ที่อาจถึง Storage แล้วก่อนรายงานผล ไม่แจ้งสำเร็จก่อน backend ตอบ
- มือถือให้เลื่อนถึง input/ปุ่มได้ และนำเมนู fixed ออกจากทางขณะ input/textarea/select มี focus ยังต้องตรวจคีย์บอร์ดจริงบน iPhone
- เพิ่ม `scripts/check-auth.ts --public-settings` แบบอ่านอย่างเดียว ตรวจ public signup/anonymous พร้อม exit code ไม่พิมพ์ key ไม่สร้างบัญชีทดสอบ

ไม่มี schema change/migration ใหม่ ไม่มีการเปลี่ยน accounts/sessions, encryption key, TLS verification, Three.js หรือข้อมูล/รูป production

## หลักฐานและข้อจำกัด

ดู [ผลประเมิน/ขั้นตอนตรวจจริง](phase10-acceptance.md) สำหรับวิธีรัน benchmark และ checklist iPhone/Safari

บิลจริงสองรูปแบบมาจากรูปเดิมใน private Storage ดาวน์โหลดแบบอ่านอย่างเดียว ตรวจ SHA-256 แล้วทดสอบกับ local stack แยก ไม่ commit รูป/ข้อความ OCR/เลขบิลจริง ไม่เรียก vision ภายนอก Ground truth รอบนี้มีวันที่ เลขบิล น้ำหนัก ราคา และยอดพิมพ์ รวม 5 ช่องต่อรูป ชื่อผู้รับซื้อ/รายการหักหลากหลายยังไม่ได้รับรอง

ผลก่อนแก้: A 5/5, B 2/5; หลังแก้ A 5/5, B 3/5 ยังต้องแก้ราคา/ยอดพิมพ์ใน B การเลือกช่วงเองยังไม่แก้สองช่องนี้ โมเดล `best_int` ที่ทดลองไม่เพิ่มความถูกต้อง จึงไม่เปลี่ยน model นี่เป็นเหตุผลที่ใช้กรอกเองเป็นทางหลัก ไม่เรียก OCR ว่าผ่าน acceptance

### ผลตรวจสุดท้าย

- Model **4/4**, unit/API/CLI **80/80** ผ่านกับ production build ครอบคลุม transaction/rollback, concurrent/idempotent payments, owner/RLS/audit, source edit/void และ full backup/restore ลง isolated Supabase ใหม่
- Full Chromium ของ production build **17/17 ผ่าน ไม่มี skip** ส่งรูปส่วนตัวเข้าทดสอบผ่าน path นอก Git (ไม่ใช้ production เป็นฐานทดสอบ) รวม HEIC preview/manual save, เครือข่ายล้มเหลว, login ด้วยรหัสใหม่หลัง admin reset, ฉาก Three.js/reduced motion/WebGL fallback, 320/390 px และ Phase 1–8
- ทดสอบค่าเริ่มต้น manual ว่าไม่มี request ไป OCR assets และฟิลด์น้ำหนักยังว่างก่อนเจ้าของเลือกใช้ตัวช่วย หลังหมุน/เลือกช่วง/ยกเลิกอ่าน ค่าที่แก้เองยังอยู่; อ่านใหม่ไม่เพิ่ม upload/sale
- กักคำตอบหลัง server commit แล้วตัดการเชื่อมต่อ ฟอร์มไม่แจ้งสำเร็จและคงชื่อทีม Retry ใช้ key เดิม ได้ขายหนึ่งใบ/ค่าแรงทีมหนึ่งรายการ ยอดสุทธิ 14,500 และค้าง 500 ตาม fixture หลัง reload ไม่คัดลอกค่าแรงเป็น expense
- OCR เสริมรอบเต็ม: A **5/5 ช่อง**, **13.66 วินาที**; B **3/5 ช่อง**, **13.75 วินาที** ต้องแก้ราคา/ยอดพิมพ์ 2 ช่อง ตัวเลขนี้รวม upload → เลือกใช้ OCR → ใช้ draft ผ่าน automation ไม่รวมเวลามนุษย์แก้/เลือกค่าแรง/บันทึก และไม่ใช่ Safari จริง
- TypeScript, format, production build และ `git diff --check` ผ่าน ไม่มี dependency หรือ migration ใหม่ ทั้ง **12 migration checksums** ตรง production เดิม

Deployment และการเทียบข้อมูลเดิมหลัง push บันทึกในส่วนถัดไป เมื่อ Ready แล้วต้องตรวจ HEAD เอกสารล่าสุดอีกครั้ง

### สิ่งที่ยังต้องทำภายนอกก่อนปิด acceptance เต็ม

1. **Supabase public signup ยังเปิด:** hosted Auth admin read สำเร็จ แต่ `/auth/v1/settings` ให้ `disable_signup: false`, anonymous ปิดอยู่ CLI ใหม่ตรวจพบและ exit 1 ถูกต้อง Owner/API/RLS ยังจำกัดบัญชีเดิม แต่ต้องปิด “Allow new users to sign up” ใน Dashboard แล้วตรวจซ้ำ เครื่องมือไม่มี Auth-config mutation และ CLI ไม่มี management token จึงไม่แก้ด้วยการข้ามสิทธิ์หรือสร้างบัญชีบน production
2. **iPhone/Safari จริง/เวลาทั้ง flow:** ไม่มีอุปกรณ์จริง และ WebKit install ถูก policy ปฏิเสธสอง download hosts Chromium/viewport 390/320 px ไม่ใช่ Safari จริง ต้องให้เจ้าของตรวจกล้อง/HEIC/คีย์บอร์ด/Reduce Motion/เวลา 1 นาทีตาม checklist
3. **สิทธิ์โฮสต์:** Supabase organization เป็น Free มี quota/พักหลังไม่ใช้งานตาม pricing; Vercel Hobby จำกัด non-commercial ยังไม่ทราบ billing tier จาก connector จึงไม่รับรองว่า Free ใช้บัญชีสวนเชิงธุรกิจได้ ไม่เปลี่ยนแพ็กเกจเสียเงินหรือย้าย production เอง
4. **OCR:** เป็นทางเลือกและกรอกเองได้ครบ ยังไม่รับรองบิลทุกแบบ/คุณภาพตามที่เจ้าของคาดหวัง หากเลือกถอด OCR ทั้งหมดภายหลัง ให้ถอด UI/worker/model/dependencies พร้อมแก้ tests/docs ไม่เปลี่ยนหลักฐานรูป/สูตรบัญชี

Phase 9 พักตามผู้ใช้ จึงยังไม่อ้างว่าระบบครบทุกเฟสหรือผ่าน RPO รายวัน ไม่ปิด Phase 10 แทนผู้ใช้ และไม่เรียก production-ready ทั้งเกณฑ์ข้างต้นยังค้าง
