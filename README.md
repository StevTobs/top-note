# Top Note

แอปโน้ตบนคลาวด์ตาม [BLUEPRINT.md](BLUEPRINT.md) สำหรับคอมพิวเตอร์และหน้าจอมือถือ เข้าสู่ระบบด้วยบัญชี Google เก็บข้อมูลบน Supabase พร้อมธีม Evangelion-inspired abstract, editor ภาษาไทย และ AI ที่สรุปเฉพาะส่วนที่เลือก

## ตั้งค่า Supabase และ Google login (ทำครั้งเดียว)

1. **สร้างตาราง**: เปิด Supabase → SQL Editor แล้วรันไฟล์ [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql), [0002_project_planning.sql](supabase/migrations/0002_project_planning.sql) และ [0003_reorder_and_favorites.sql](supabase/migrations/0003_reorder_and_favorites.sql) ทีละไฟล์ตามลำดับ สร้างตาราง `categories`, `notes`, `assets`, `preferences`, `projects`, `tasks`, `task_dependencies`, `project_members`, ฟังก์ชันสำหรับลบ/กู้คืน, คอลัมน์ลำดับ/รายการโปรด, Storage bucket ส่วนตัว `note-assets` และ Row Level Security ที่ให้แต่ละบัญชีเห็นเฉพาะข้อมูลของตัวเอง
2. **เปิด Google provider**: Google Cloud Console → APIs & Services → Credentials → สร้าง *OAuth client ID* (Web application) แล้วใส่ Authorized redirect URI เป็น `https://<project-ref>.supabase.co/auth/v1/callback` จากนั้นนำ Client ID/Secret ไปกรอกที่ Supabase → Authentication → Sign In / Providers → Google แล้วเปิดใช้งาน
3. **ตั้ง Redirect URLs**: Supabase → Authentication → URL Configuration ใส่ Site URL และเพิ่ม Redirect URLs ของทุก origin ที่ใช้ เช่น `http://127.0.0.1:5173/`, `http://127.0.0.1:4173/`, URL ที่ deploy จริง และสำหรับแอปเดสก์ท็อป `http://127.0.0.1:47831/auth/callback`
4. **ใส่คีย์ใน `.env`** (คัดลอกจาก [.env.example](.env.example)): `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY` (ชื่อ `NEXT_PUBLIC_*` ก็อ่านได้) ใช้เฉพาะ publishable/anon key ห้ามใส่ secret หรือ `service_role` ค่าใน `.env` ถูกฝังในไฟล์ที่ build ออกมา ความปลอดภัยของข้อมูลมาจาก RLS ไม่ใช่การซ่อน key

## เริ่มใช้งาน

ต้องมี Node.js 22.12+ หรือ Node.js 24 และ npm

```powershell
npm.cmd ci
npm.cmd run dev
```

เปิด URL ที่ Vite แสดงใน terminal โดยปกติคือ `http://127.0.0.1:5173`

สำหรับ production และการทดสอบติดตั้ง PWA / offline:

```powershell
npm.cmd run build
npm.cmd run preview -- --port 4173
```

เปิด `http://127.0.0.1:4173` ติดตั้งผ่านเมนูติดตั้งของ browser หรือปุ่ม “ติดตั้งแอป” ใน sidebar เมื่อ browser รองรับ service worker แคชเฉพาะตัวแอป (app shell และ font) ส่วนโน้ตอ่าน/บันทึกผ่านอินเทอร์เน็ตเสมอ จึงใช้งานแบบออฟไลน์ไม่ได้ การ deploy ใช้ไฟล์ใน `dist/` บน static hosting ที่มี HTTPS และตั้ง navigation fallback เป็น `index.html` ต้องตั้งค่า `VITE_SUPABASE_*` ตอน build

ข้อมูลผูกกับบัญชี Google ไม่ใช่ browser หรือ origin เปิดจากอุปกรณ์ไหนก็ได้ที่ล็อกอินบัญชีเดิม (ต้องเพิ่ม origin นั้นใน Redirect URLs ของ Supabase) หากเคยใช้รุ่น local-only บน browser นี้ ระบบจะพบข้อมูลเดิมใน IndexedDB และถามก่อนอัปโหลดขึ้นบัญชี (ดู “ย้ายข้อมูลเดิม”)

## ติดตั้งเป็นโปรแกรม Windows (.exe)

แอปเดสก์ท็อปห่อเว็บแอปเดียวกันด้วย Electron (โค้ดอยู่ใน [electron/](electron/)) ต้องตั้งค่า Supabase และมี `.env` ตามด้านบนก่อน เพราะค่าถูกฝังตอน build

```powershell
npm.cmd run desktop      # build แล้วเปิดแอปเดสก์ท็อปทันที (ทดสอบ)
npm.cmd run dist:win     # สร้างตัวติดตั้ง release/Top Note Setup <version>.exe
```

- แอปเสิร์ฟไฟล์จาก `http://127.0.0.1:47831` (เปลี่ยนพอร์ตด้วยตัวแปร `TOP_NOTE_PORT`) จึงต้องเพิ่ม `http://127.0.0.1:47831/auth/callback` ใน Redirect URLs ของ Supabase
- Google ไม่อนุญาต login ภายใน webview ที่ฝังอยู่ในแอป ปุ่ม “เข้าสู่ระบบด้วย Google” จึงเปิดเบราว์เซอร์ปกติ เมื่อเสร็จแล้วผลจะถูกส่งกลับเข้าหน้าต่างแอปเอง
- ตัวติดตั้งยังไม่ได้เซ็นโค้ด (code signing) Windows SmartScreen อาจเตือน “Unknown publisher” ให้กด More info → Run anyway และไอคอนของไฟล์ .exe ยังเป็นค่าเริ่มต้นของ Electron (ตั้ง `signAndEditExecutable: false` ไว้เพื่อ build ได้โดยไม่ต้องใช้สิทธิ์ผู้ดูแล)
- หากรันคำสั่งจากเทอร์มินัลของ VS Code แล้ว Electron ปิดทันที เพราะตัวแปร `ELECTRON_RUN_AS_NODE=1` สคริปต์ `scripts/desktop.mjs` ลบตัวแปรนี้ให้แล้ว

## ความสามารถในรุ่นนี้

- H1–H3, สารบัญ, ตัวหนา/เอียง/ขีดฆ่า, inline code, quote, lists และ checklist
- ไฮไลต์สามสี เพิ่ม/แก้ไข/ลบลิงก์ และเปิดลิงก์ด้วย Ctrl/⌘ + คลิก
- อัปโหลด ลากวาง หรือ paste รูป PNG, JPEG, WebP, GIF สูงสุด 10 MB ต่อภาพ
- คลิกรูปเพื่อปรับความกว้าง ตำแหน่ง คำบรรยาย และ alt text
- หมวดหมู่ซ้อนกัน เปลี่ยนชื่อ ย้ายหมวด/โน้ต รวมหมวดย่อย และค้นหาชื่อ/ข้อความ
- ลากจัดลำดับหมวดหมู่ โน้ต (เมื่อเปิด "เรียงลำดับเอง") โปรเจกต์ และงาน พร้อมปักหมุดรายการโปรดได้ทุกประเภท
- ถังขยะ กู้คืนโน้ต/หมวดหมู่ และยืนยันก่อนลบโน้ตถาวร
- **วางแผนโปรเจกต์**: สร้างโปรเจกต์ แบ่งงาน/งานย่อย/เหตุการณ์สำคัญ กำหนด dependency แบบ Finish-to-Start ติดตามความคืบหน้า และดูภาพรวมผ่าน 4 มุมมอง (ภาพรวม, รายการงาน, Kanban, Gantt Chart) ที่ใช้ข้อมูลชุดเดียวกัน
- เข้าสู่ระบบด้วย Google ผ่าน Supabase Auth และ autosave ขึ้น Supabase (Postgres) พร้อม revision check ป้องกันการเขียนทับข้ามอุปกรณ์ และ Web Locks สำหรับสิทธิ์แก้ไขโน้ตระหว่างแท็บในเครื่องเดียวกัน
- AI สรุปข้อความที่เลือก บล็อกปัจจุบัน หรือหัวข้อและเนื้อหาภายใต้หัวข้อนั้น
- สแกน QR Code จากรูปภาพ (วางหรืออัปโหลด) แล้วแทรกเป็นลิงก์ในโน้ตทันที
- OCR อ่านตัวอักษรจากรูปภาพด้วย AI connection เดียวกับที่ใช้สรุป แล้วแทรกข้อความหรือคัดลอกไปใช้งานได้
- Preview ก่อนแทรก/แทนที่, Undo หนึ่งครั้ง, ตรวจต้นฉบับที่เปลี่ยน และยกเลิกคำขอได้
- ZIP backup/import รวมภาพ พร้อมสร้าง ID ใหม่และนำเข้าเป็นหมวดใหม่
- Export Markdown พร้อมภาพเป็น ZIP
- Focus mode, ปรับขนาดตัวอักษร, ธีม Eva/Quiet และ reduced motion
- PWA ติดตั้งได้ พร้อม font และ app shell ที่แคชไว้ (ข้อมูลต้องออนไลน์)

พิมพ์ `/` ในย่อหน้าว่างเพื่อเปิดเมนูเพิ่มเนื้อหา ใช้ Ctrl/⌘ + K เพื่อค้นหา

## ตั้งค่า AI

1. เปิด **ตั้งค่า → AI connection**
2. กรอกชื่อ, Base URL ของ API แบบ OpenAI-compatible และ Model ID
3. กรอก API key (เว้นว่างได้สำหรับ local endpoint ที่ไม่ต้องใช้ key)
4. กดทดสอบ และบันทึกการตั้งค่า
5. เลือกข้อความแล้วกด **สรุปส่วนนี้** หรือใช้ปุ่มสรุปบล็อก/หัวข้อที่ท้าย editor

แอปเรียก `POST <base-url>/chat/completions` และอ่าน `choices[0].message.content` โดยตรงจาก browser Endpoint ต้องอนุญาต CORS จาก origin ของแอป และ remote endpoint ต้องเป็น HTTPS อนุญาต HTTP สำหรับ loopback เช่น `http://localhost:11434/v1`

Base URL ไม่ใช่หน้าเว็บสนทนาของ provider และชื่อ model ต้องเป็น ID ที่ endpoint นั้นรองรับ รุ่นนี้ไม่มี proxy สาธารณะหรือ backend สำหรับเก็บ secret หาก provider ไม่อนุญาต browser requests ให้ใช้ endpoint/proxy ที่คุณควบคุมเองและตั้ง CORS ให้เหมาะสม

API key อยู่เฉพาะ memory ของแท็บ ไม่ลง IndexedDB, localStorage หรือ backup เมื่อ reload ต้องกรอกใหม่ การทดสอบเชื่อมต่อส่งข้อความทดสอบสั้นและอาจมีค่าใช้จ่ายตาม provider

AI ไม่ได้ส่งทั้งโน้ต รูปภาพ หรือเนื้อหาหน้าเว็บปลายทางของลิงก์ไปด้วย Preview แสดงข้อความที่จะส่งจริง จำกัดครั้งละ 24,000 ตัวอักษร ไม่มีการ retry โดยอัตโนมัติ และคำขอหมดเวลาที่ 60 วินาที

การแทนที่บางส่วนของย่อหน้าใช้ข้อความปกติ ส่วนการแทนที่ทั้งบล็อก/หัวข้อใช้ summary block หากขอบเขตมีภาพหรือเส้นคั่น ให้แทรกสรุปหรือเลือกเฉพาะข้อความใหม่ ส่วน Undo ใช้ใน session ปัจจุบัน ไม่ใช่ประวัติข้ามการเปิดแอป

## ข้อมูลและการกู้คืน

ข้อมูลอยู่ใน Supabase: โน้ต/หมวดหมู่/การตั้งค่าอยู่ใน Postgres ส่วนรูปเป็นไฟล์ใน Storage bucket ส่วนตัว `note-assets` โฟลเดอร์ละหนึ่งผู้ใช้ ทุกตารางเปิด RLS (`user_id = auth.uid()`) รายการโน้ตโหลดเฉพาะ metadata ส่วนเนื้อหาโหลดเมื่อเปิดโน้ต การเขียนโน้ตใช้ `revision` เป็นเงื่อนไข หากมีอุปกรณ์อื่นบันทึกไปก่อน แอปจะแจ้งให้เก็บสำเนาแล้วโหลดใหม่ แทนที่จะเขียนทับเงียบ ๆ การลบ/กู้คืนหมวดหมู่และลบโน้ตถาวรทำผ่านฟังก์ชัน Postgres ในธุรกรรมเดียว

การสำรองใช้ ZIP ที่มี `manifest.json` (format version 1) และ `assets/` ไม่รวมการเชื่อมต่อหรือ API key รูปแบบเดียวกับรุ่นก่อน จึงนำเข้าไฟล์เก่าได้ ควรสำรองไว้อีกชุดเป็นระยะ หากบันทึกไม่สำเร็จ (เช่นเน็ตหลุด) แอปจะแจ้งเตือนและยังส่งออก Markdown ของข้อความที่กำลังแก้ไขได้

Import ตรวจเวอร์ชัน โครงสร้างเอกสาร หมวดหมู่ที่เป็นวงจร ภาพที่หาย และขนาด archive ก่อนเขียน จำกัดไฟล์ ZIP 100 MB และขนาดคลายไฟล์รวม 200 MB การนำเข้าไม่เขียนทับโน้ตที่มีอยู่ Supabase ไม่มีธุรกรรมข้ามหลายคำขอ จึงเขียนเป็นชุดแล้วย้อนลบสิ่งที่เขียนไปแล้วหากขั้นใดล้มเหลว (best-effort)

### ย้ายข้อมูลเดิม

หลัง login ครั้งแรก หาก browser นี้มี IndexedDB `clever-note` จากรุ่น local-only แอปจะแสดงจำนวนโน้ต/หมวด/รูป และให้กดอัปโหลดขึ้นบัญชี ต้นฉบับในเครื่องไม่ถูกแก้ไขหรือลบ การอัปโหลดไม่เขียนทับรายการที่มี ID เดียวกันในบัญชี จึงกดซ้ำได้อย่างปลอดภัยหากขัดข้องกลางทาง เลือก “ข้าม” แล้วกลับมาทำที่ ตั้งค่า → บัญชี ภายหลังได้

## ตรวจสอบโปรเจกต์

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

หากยังไม่มี Chromium สำหรับ Playwright:

```powershell
npx.cmd playwright install chromium
```

Unit tests ตรวจ revision conflicts, การแปลงข้อมูลกับ Postgres, การเรียกฟังก์ชันหมวดหมู่ (ใช้ Supabase client จำลอง), การอ่านข้อมูล IndexedDB เดิม, ขอบเขตหัวข้อ และ AI payload

> **สถานะ browser tests:** ชุดใน `tests/e2e` เขียนสำหรับรุ่น local-only (IndexedDB, ไม่ต้อง login, ทดสอบ offline) จึงถูกข้าม (`test.skip`) ไว้จนกว่าจะเขียนใหม่ให้ใช้ Supabase จำลองหรือโปรเจกต์ทดสอบแยก ห้ามชี้ไปที่โปรเจกต์จริงเพราะเทสต์จะสร้าง/ลบข้อมูล

การทดสอบ API จำลองตรวจรูปแบบและขอบเขตคำขอ ส่วนการเชื่อมต่อ provider จริงต้องทดสอบด้วย endpoint/model/key ของผู้ใช้

## โครงสร้างไฟล์

```text
src/
  App.tsx                   หน้าหลัก หมวดหมู่ รายการโน้ต และ responsive navigation
  supabase.ts               Supabase client, Google sign-in และการแปลง error
  db.ts                     อ่าน/เขียน Postgres (RLS), revision check, RPC หมวดหมู่, bulk write
  store.ts                  cache ในหน่วยความจำของรายการโน้ต/หมวดหมู่/การตั้งค่า
  assets.ts                 อัปโหลด/ดาวน์โหลด/ลบรูปใน Supabase Storage
  legacy.ts                 อ่าน IndexedDB รุ่นเก่าและย้ายขึ้นบัญชี
  model.ts                  ชนิดข้อมูลและ utility
  ordering.ts               คำนวณลำดับสำหรับลากจัดเรียง (gap-based, resequence อัตโนมัติ)
  ai.ts                     API adapter, timeout และข้อผิดพลาด
  backup.ts                 ZIP backup/import และ Markdown export
  planner/                  วางแผนโปรเจกต์: Planner.tsx, model.ts, db.ts, มุมมอง Overview/Task List/Kanban/Gantt
  editor/
    extensions.tsx          Local image, summary block และ block IDs
    schema.ts               Editor schema ที่ใช้ร่วมกับ import validation
    scope.ts                การคำนวณขอบเขตข้อความ/หัวข้อ
  components/
    NoteEditor.tsx          Editor, autosave, Web Locks และ AI panel
    Settings.tsx            การตั้งค่าและสำรองข้อมูล
    CategoryDialog.tsx      จัดการหมวดหมู่
    Modal.tsx               Native dialog พร้อม keyboard focus
    LoginScreen.tsx         หน้า Sign in with Google และหน้าแจ้งให้ตั้งค่า .env
    LegacyPanel.tsx         ย้ายข้อมูลเดิมในเครื่องขึ้นบัญชี
  styles.css                ธีมและ responsive layout
tests/
  unit/                     ทดสอบ data และ API boundaries
  e2e/                      ทดสอบ browser
public/                     ไอคอนสำหรับ PWA
electron/                   Electron main/preload (แอปเดสก์ท็อป)
scripts/                    สร้างไอคอน และ desktop.mjs สำหรับเปิดแอปเดสก์ท็อป
supabase/migrations/        SQL: ตาราง, RLS, ฟังก์ชัน, Storage bucket
```

Sync ข้ามอุปกรณ์ทำแล้ว (ผ่าน Supabase) ส่วน offline editing, desktop keychain, backlinks และ version history ยังเป็นงานรุ่นถัดไป

เอกสารอ้างอิงสำหรับ integration: [Tiptap React](https://tiptap.dev/docs/editor/getting-started/install/react), [Vite PWA service worker](https://vite-pwa-org.netlify.app/guide/register-service-worker)
