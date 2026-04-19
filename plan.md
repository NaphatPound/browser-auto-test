# Development Plan & Tasks: Customizable Auto-Test Browser

แผนการพัฒนานี้อ้างอิงจาก `ideas.md` เพื่อใช้เป็น Roadmap ในการทำงานทีละขั้นตอน (Step-by-Step) ออกแบบมาให้ AI หรือนักศึกษาสามารถนำไปประยุกต์และสร้างชิ้นงานได้ทันที

---

## 🚀 Phase 1: Project Initialization & Scaffold
**เป้าหมาย:** สร้างโครงสร้างพื้นฐานของโปรเจกต์ด้วย Tech Stack ที่กำหนด

*   [ ] **Task 1.1:** สร้างโปรเจกต์ Electron + React + TypeScript 
    *   *คำแนะนำ:* แนะนำให้ใช้ Vite (เช่น `npm create vite@latest`) เพื่อการเริ่มต้นที่รวดเร็ว
*   [ ] **Task 1.2:** สร้างโครงสร้างโฟลเดอร์สำหรับ Electron โฟกัสไปที่ `main/`, `preload/` และ `renderer/` เพื่อแยกฟังก์ชันการทำงานส่วนหน้าและส่วนหลัง
*   [ ] **Task 1.3:** ติดตั้งและตั้งค่า Tailwind CSS 
    *   *คำแนะนำ:* นำไปใช้ในส่วน `renderer` สำหรับจัดการ UI สวยงาม
*   [ ] **Task 1.4:** ติดตั้ง Dependencies หลักเบื้องต้น: `@monaco-editor/react`, `playwright-core`, `lucide-react` (สำหรับไอคอน)

---

## 🌐 Phase 2: Basic Browser UI & Routing
**เป้าหมาย:** สร้างหน้าต่างแอปที่จะทำหน้าที่เป็นเบราว์เซอร์

*   [ ] **Task 2.1:** ออกแบบ Layout หลัก แบ่งเป็น 2 ส่วน:
    *   *Left Sidebar:* สำหรับระบบ Control Panel (เครื่องมือสร้างเทสต์)
    *   *Right Panel:* พื้นที่สำหรับแสดงผลเบราว์เซอร์
*   [ ] **Task 2.2:** ใช้ Webview Tag (`<webview>`) ของ Electron ลงใน Right Panel
    *   *คำแนะนำ:* ต้องแน่ใจว่าเปิดใช้งาน `webviewTag: true` ใน `webPreferences` ของ Electron Main
*   [ ] **Task 2.3:** สร้าง Address Bar ดำเนินการ Navigation (ฟังก์ชันระบุ URL, ปปุ่ม Back, Forward, Refresh)
*   [ ] **Task 2.4:** สร้างปุ่ม Toggle Inspect (เปิด DevTools ภายใน `<webview>`)

---

## 👁️ Phase 3: Action Recording System (หัวใจของแอป)
**เป้าหมาย:** ระบบดักจับการกระทำของผู้ใช้บนหน้าเว็บ (Webview)

*   [ ] **Task 3.1:** เริ่มสร้าง Content Script (`inject.js`) สำหรับดักจับ Event ต่างๆ ในหน้าเว็บ เช่น `click`, `input`, `change`, `keydown`
*   [ ] **Task 3.2:** สร้างระบบ Smart Locator ภายใน Content Script
    *   *คำแนะนำ:* ค้นหา attribute ที่ดีที่สุดจาก element ที่ถูกคลิก (เรียงลำดับความสำคัญ `data-testid` > `id` > `name` > `aria-label` > `text` > `CSS Selector`)
*   [ ] **Task 3.3:** ทำระบบ IPC (Inter-Process Communication)
    *   *Flow:* Content Script ดักจับ event -> ยิง message เข้า Webview -> ส่งต่อให้ Electron Main -> ส่งเข้า React (Renderer)
*   [ ] **Task 3.4:** สร้าง Global State (ใช้ React Context, Zustand หรือ Redux) เก็บข้อมูล Array ของ `Steps`
*   [ ] **Task 3.5:** สร้าง UI Visual Step Editor นำ `Steps` จาก State มาแสดงแบบลิสต์ รองรับปุ่ม ลบ และแก้ไข (เช่น แก้ข้อความอินพุต)

---

## 💻 Phase 4: Code Generation & Monaco Editor
**เป้าหมาย:** เปลี่ยน "Steps" การคลิกให้เป็นโค้ดเทสต์ของจริง

*   [ ] **Task 4.1:** สร้าง Componenent ฝังเครื่องมือ **Monaco Editor** ใน Sidebar หรือหน้าต่างแยกต่างหาก
*   [ ] **Task 4.2:** สร้าง Generator Function (Mapper) ที่แปลง State ของ `Steps` เบื้องหลังให้เป็นโค้ด Playwright 
    *   *ตัวอย่าง:* สเต็ป { type: 'click', loc: 'button#login' } แปลงเป็น `await page.click('button#login');`
*   [ ] **Task 4.3:** เชื่อม State ของสเต็ปเข้ากับข้อความในโมนาโก (ให้พิมพ์อัปเดตโค้ดอัตโนมัติ เมื่อเรามีสเต็ปใหม่เข้ามา)

---

## ⚙️ Phase 5: Test Execution & Interactive Results 
**เป้าหมาย:** สั่งเทสต์โปรเจกต์จากโค้ดได้โดยตรงภายในแอปพลิเคชัน

*   [ ] **Task 5.1:** พัฒนาระบบ Run Script แยกในฝั่ง Electron Main 
    *   คำสั่งคือการชกโค้ดออกมาเป็นไฟล์ชั่วคราว (`.spec.ts`) ในเครื่องและรัน Playwright CLI ผ่าน `child_process` ของ Node.js
*   [ ] **Task 5.2:** สร้างปุ่ม "▶ Run Test" ป้อนสคริปต์ไปยัง Task 5.1
*   [ ] **Task 5.3:** ดักจับ Streaming Log (stdout/stderr) ของการรันทดสอบและส่งกลับไปที่หน้า Renderer (React UI) เพื่อแสดงเป็น Console Log เหมือนรันในคอมมานด์ไลน์
*   [ ] **Task 5.4:** ทำสัญลักษณ์ Pass/Fail (สีเขียว/สีแดง) ตรงข้างหน้า UI ของ Visual Steps ตามผลการรันทดสอบในแต่ละบรรทัด (ถ้าเฟรมเวิร์กสามารถทำ Test Report ออกมาเป็น JSON ได้จะดีมาก)

---

## 🛠️ Phase 6: Polish & Customization Features
**เป้าหมาย:** เสริมความยืดหยุ่น เพิ่มความเป็น Product 

*   [ ] **Task 6.1:** เพิ่มเมนู "Framework Template" ให้ผู้ใช้เลือกได้ว่าอยากให้ Gen โค้ดออกมาเป็น Playwright, Puppeteer หรือ Cypress
*   [ ] **Task 6.2:** เพิ่มระบบ Save & Load ให้บันทึกการคอนฟิก (เช่น เซฟชุด Test Case นี้เป็นชื่อไฟล์ `.json`)
*   [ ] **Task 6.3:** สร้างหน้า Settings จำลอง Properties (GeoLocation API, User-Agents)
*   [ ] **Task 6.4:** ทำระบบ Export โค้ดเป็นไฟล์ซิป หรือไฟล์ `.ts` ส่งออกไปรันข้างนอก 
