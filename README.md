# Palm Ledger · สวนปาล์ม

เว็บรายรับรายจ่ายสำหรับเจ้าของสวนปาล์มหลายสวน ใช้งานผ่าน Safari เน้นหน้าจอเรียบง่ายและยอดสุทธิแยกตามสวน

**สถานะ:** **ขั้น 1 เสร็จและผู้ใช้ทดสอบรับงานแล้ว** วันที่ 21 ตุลาคม 2569 มีบัญชี/session, จัดการสวน/ยอดยกมา, audit และ UI เขียว–ครีมพร้อม Three.js รองรับ Reduce Motion/ภาพสำรองเมื่อ WebGL ใช้ไม่ได้ deploy บน [Vercel](https://palm-ledger-nine.vercel.app) กับ hosted Supabase แล้ว งานถัดไปคือ **ขั้น 2: บันทึกขายและแนบรูปบิล** ซึ่งยังไม่ implement เริ่มแชทใหม่จาก [เอกสารส่งต่องาน](docs/handoff-phase2.md) รายการตรวจเฉพาะ Safari/hosted Auth settings ที่ยังไม่มีหลักฐานแยกเก็บไว้ตรวจต่อในขั้น 10

## เอกสารเริ่มต้น

- [ส่งต่องานแชทใหม่ — ผลขั้น 1 และจุดเริ่มขั้น 2](docs/handoff-phase2.md)
- [สเปกและแผนพัฒนา 6 ช่วง](app-spec.md)
- [แผนลงมือพัฒนา 10 ขั้น พร้อมเกณฑ์ตรวจรับ](plans/palm-ledger.md)
- [วิธีรัน Next.js และทดสอบขั้น 1](docs/development.md)
- [User flow — 4 หน้าหลักและ 7 เส้นทาง](user-flow.md)
- [แบบ SQL เดิมสำหรับ SQLite — ใช้อ้างอิงกติกา ยังต้องเขียน PostgreSQL migrations](schema.sql)
- [ภาพอ้างอิงแบบที่เลือก](docs/design-reference.png)
- [ข้อจำกัดการตรวจภาพต้นแบบ](design-qa.md)

## เทคโนโลยีตามแผน

หน้าเว็บและ API: Next.js + React + TypeScript ในโปรเจกต์เดียว · ข้อมูล: Supabase PostgreSQL พร้อม SQL migrations · บัญชี: Supabase Auth ผ่านหน้าชื่อผู้ใช้ + รหัสผ่าน · รูปบิล: Supabase Storage แบบ private · Motion: สั้นและเบา รองรับ reduced motion

เจ้าของมีบัญชีเดียว จำการเข้าสู่ระบบ 30 วันบนเครื่องส่วนตัว และให้ผู้ดูแลช่วยตั้งรหัสใหม่ เป้าหมายคือสำรองฐานข้อมูลและรูปทุกวันแยกจากระบบหลัก ยอมรับข้อมูลสูญหายย้อนหลังได้ไม่เกินประมาณ 24 ชั่วโมง

เลือกโฮสต์ที่แพ็กเกจฟรีอนุญาตให้ใช้กับงานนี้และรองรับ Next.js ฝั่งเซิร์ฟเวอร์ได้จริง Vercel เป็นตัวเลือกที่ต้องตรวจเงื่อนไขก่อน ไม่ได้ผูกเป็นข้อบังคับ โฮสต์ งานสำรอง ปลายทางสำรอง และโควตา Supabase ยังต้องตรวจล่าสุดก่อน deploy จึงยังไม่รับรองว่าทุกส่วนใช้งานจริงได้ฟรี รายละเอียดอยู่ในสเปก

## HTML prototype

Open `index.html` in a current browser. This single file contains the application, styles, model and Phosphor icons, without runtime dependencies or a server. It is not a deployed website. On iPhone, HTML file handling varies; a hosted version is needed for normal Safari use by URL.

The initial view is explicitly labeled sample data. Choose “เริ่มข้อมูลจริง” to replace it with your own first garden and opening net balance. This action asks for confirmation inside the form. Additional gardens and legacy debts can be added from the Gardens view.

Included: per-garden and combined net balances, photo attachment with manual receipt entry, full-received sales, optional linked team wages, daily wages including half-days, fertilizer expenses only on actual application, other expenses, partial/complete payable settlement, shared expense allocation, garden management, date/garden filters, edits, deletions, JSON backup/restore and CSV export. Original accepted JPG/PNG/WebP photo bytes are preserved as data URLs, limited to 2 MB per attachment.

Net = opening net balance + recorded sales − incurred expenses. Pending expense payments do not deduct net a second time. Legacy debt is tracked separately without deducting historical costs again. Shared expenses reduce the combined net once until allocation moves them into gardens. Fertilizer is recorded only when applied, with no purchase/stock records in this phase.

Records are saved only to localStorage in the browser/device being used. There is no server, cross-device synchronization, authentication, or OCR integration. Browser storage quotas apply, especially with photos. JSON backups include photos. Do not rely on this prototype as the only copy of business records. Multiple-tab updates block writes in the stale tab until it is reloaded.

The original HTML handoff had no browser or visual verification because browser tooling was unavailable at that time. Its model checks do not verify Safari compatibility or rendered fidelity. Chromium checks for the new Next.js app are documented separately in the development instructions; they do not establish Safari compatibility of this prototype.

## Next.js development

Requires Node.js 24 LTS and Docker with Compose. Run `npm ci`, `npm run local:setup`, then `npm run db:migrate`. Create the owner with `npm run owner:create -- <username>`; the terminal prompts for a hidden password. Start the app with `npm run dev`. Configuration stays in ignored `.env.local`; see [development instructions](docs/development.md) for isolated tests and hosted Supabase configuration.

## HTML prototype development

Requires Node.js 24 LTS and Python 3. No package installation is required for the current prototype.

```sh
node --test model.test.mjs
python3 build.py
```

The build embeds the committed Phosphor icons and license into the self-contained HTML. It does not download dependencies or rely on files outside this repository. Icons are MIT-licensed; see [PHOSPHOR-LICENSE.txt](PHOSPHOR-LICENSE.txt).

The existing root SQL schema targets SQLite 3.37 or newer with JSON functions. It is a historical bootstrap proposal, not the production PostgreSQL schema. Phase 1 PostgreSQL migrations now live under `supabase/migrations`; later ledger tables remain to be implemented. Do not apply the old SQLite schema to Supabase or an existing production database. Runtime databases, uploaded receipts, backups and secrets are excluded from Git.
