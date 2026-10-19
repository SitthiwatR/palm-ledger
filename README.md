# Palm Ledger · สวนปาล์ม

เว็บรายรับรายจ่ายสำหรับเจ้าของสวนปาล์มหลายสวน ใช้งานผ่าน Safari เน้นหน้าจอเรียบง่ายและยอดสุทธิแยกตามสวน

**สถานะ:** มีต้นแบบ HTML, user flow, สเปก และแบบฐานข้อมูล SQL แล้ว ระบบ Next.js / Python FastAPI / SQLite ตามแผนยังไม่ได้เริ่ม implement และยังไม่มี OCR หรือ deployment

## เอกสารเริ่มต้น

- [สเปกและแผนพัฒนา 6 ช่วง](app-spec.md)
- [User flow — 4 หน้าหลักและ 7 เส้นทาง](user-flow.md)
- [SQL schema ที่เสนอสำหรับ SQLite](schema.sql)
- [ภาพอ้างอิงแบบที่เลือก](docs/design-reference.png)
- [ข้อจำกัดการตรวจภาพต้นแบบ](design-qa.md)

## เทคโนโลยีตามแผน

Frontend: Next.js + React + TypeScript บน Node.js · Backend: Python FastAPI · Database: SQLite แบบไฟล์พร้อม SQL migrations · Motion: สั้นและเบา รองรับ reduced motion

## HTML prototype

Open `index.html` in a current browser. This single file contains the application, styles, model and Phosphor icons, without runtime dependencies or a server. It is not a deployed website. On iPhone, HTML file handling varies; a hosted version is needed for normal Safari use by URL.

The initial view is explicitly labeled sample data. Choose “เริ่มข้อมูลจริง” to replace it with your own first garden and opening net balance. This action asks for confirmation inside the form. Additional gardens and legacy debts can be added from the Gardens view.

Included: per-garden and combined net balances, photo attachment with manual receipt entry, full-received sales, optional linked team wages, daily wages including half-days, fertilizer expenses only on actual application, other expenses, partial/complete payable settlement, shared expense allocation, garden management, date/garden filters, edits, deletions, JSON backup/restore and CSV export. Original accepted JPG/PNG/WebP photo bytes are preserved as data URLs, limited to 2 MB per attachment.

Net = opening net balance + recorded sales − incurred expenses. Pending expense payments do not deduct net a second time. Legacy debt is tracked separately without deducting historical costs again. Shared expenses reduce the combined net once until allocation moves them into gardens. Fertilizer is recorded only when applied, with no purchase/stock records in this phase.

Records are saved only to localStorage in the browser/device being used. There is no server, cross-device synchronization, authentication, or OCR integration. Browser storage quotas apply, especially with photos. JSON backups include photos. Do not rely on this prototype as the only copy of business records. Multiple-tab updates block writes in the stale tab until it is reloaded.

Browser verification and visual QA are blocked by unavailable browser tooling, as accepted by the user. Automated checks do not verify Safari compatibility or rendered fidelity.

## Development

Requires Node.js 24 LTS and Python 3. No package installation is required for the current prototype.

```sh
node --test model.test.mjs
python3 build.py
```

The build embeds the committed Phosphor icons and license into the self-contained HTML. It does not download dependencies or rely on files outside this repository. Icons are MIT-licensed; see [PHOSPHOR-LICENSE.txt](PHOSPHOR-LICENSE.txt).

The SQL schema targets SQLite 3.37 or newer with JSON functions. It is a proposed bootstrap schema, not a migration to apply to an existing production database. Runtime databases, uploaded receipts, backups and secrets are excluded from Git.
