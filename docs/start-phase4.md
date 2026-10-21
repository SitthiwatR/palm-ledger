> ข้อความเริ่มงานเดิม: Phase 4 implement และทดสอบแล้ว ดู [ผลส่งมอบล่าสุด](handoff-phase4.md) ก่อนใช้ข้อความเก่านี้ ไม่เริ่ม Phase 4 ซ้ำ

ทำงานต่อใน repository SitthiwatR/palm-ledger สาขา main ล่าสุด

อ่าน AGENTS.md, docs/handoff-phase4.md, docs/handoff-phase3.md, docs/handoff-phase2.md, docs/receipt-first-workflow.md, docs/development.md, plans/palm-ledger.md และ app-spec.md ก่อนลงมือ

ผู้ใช้รับงานและปิด Phase 1–3 แล้ว ให้เริ่ม implement Phase 4: ค่าแรงทีมที่ผูกกับบิลขาย ตาม What to build และ acceptance criteria ในแผนเดิม

ค่าแรงรายน้ำหนัก/รายวันผูกบิล การแก้ฐานน้ำหนัก และการจำชื่อ/อัตรามีแล้วบางส่วน ให้ตรวจเทียบและเติมเฉพาะช่องว่าง ไม่ทำระบบเดิมซ้ำ พิสูจน์ 3,500 กก. × 1,000 บาท/ตัน = 3,500 บาท การเปลี่ยนฐานน้ำหนัก/อัตราเฉพาะรายการ การเชื่อมบิลกับค่าแรง และ transaction/retry ที่ไม่สร้างซ้ำ ค่าแรงเป็นยอดรวมทีม ไม่แบ่งสมาชิก

รวมความสามารถลงค่าแรงตามผลผลิตแยกจากบิลขายตาม What to build ด้วย เพราะ Phase 3 เพิ่มรายจ่ายแยกบิลเฉพาะค่าแรงรายวัน ใช้ sale_labor, expenses, expense_payments และ labor_profiles เดิมเป็นฐาน ตรวจหน่วย/การรวมยอดและป้องกันการนับรายจ่ายซ้ำ ไม่สร้างบิลขายจำลองหรือคัดลอกค่าแรงผูกบิลเดิมเป็นรายจ่ายใหม่ การจ่ายภายหลัง/แก้การจ่ายผิดยัง Phase 5

OCR ปัจจุบันให้ผลไม่ดี งานปรับ extraction และการตรวจ iPhone/Safari จริงพร้อมเป้าหมาย 1 นาทียังคง Phase 10 ไม่ต้องแก้ OCR หรือเปลี่ยน provider ในงานนี้ คงทางกรอก/แก้เองไว้

รักษา UI/Three.js บัญชี รูป และข้อมูล production เดิม ใช้ฐานทดสอบแยก เมื่อทดสอบผ่าน ให้อัปเดตแผนและ handoff, commit/push และตรวจ deployment บน Vercel ของ commit ล่าสุดจนเป็น Ready พร้อม build/migration logs
