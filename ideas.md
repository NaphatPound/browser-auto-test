# โปรเจกต์: Customizable Auto-Test Browser (เบราว์เซอร์สำหรับการทดสอบอัตโนมัติแบบปรับแต่งได้)

## 📌 ภาพรวมของโปรเจกต์ (Project Overview)
สร้างเบราว์เซอร์แอปพลิเคชันบนเดสก์ท็อปที่ออกแบบมาเพื่อนักพัฒนาและ QA โดยเฉพาะ เน้นความสามารถในการปรับแต่งขั้นสุด (Highly Customizable) และมีเครื่องมือในการช่วยสร้าง ทดสอบ และรัน Automated Web Tests ได้ในตัว โดยมีฟีเจอร์หลักคือการบันทึกการกระทำบนเว็บ (Action Recording) และแปลงออกเป็นโค้ดเทสต์ในเฟรมเวิร์กยอดนิยม รวมถึงสามารถรันเทสต์เหล่านั้นได้อัตโนมัติจากในแอป

## 🎯 ฟีเจอร์หลัก (Core Features)

### 1. Browser Window & DevTools
*   หน้าต่างเบราว์เซอร์ที่สามารถใช้งานเว็บไซต์ได้จริง (ใช้ Chromium engine)
*   มาพร้อมกับ DevTools ในตัวเพื่อช่วยหาองค์ประกอบในหน้าเว็บ
*   รองรับการจำลองอุปกรณ์อัตโนมัติ (Responsive & Mobile Testing)

### 2. Action Recorder (ระบบจดจำและบันทึกสเต็ป)
*   **Smart Locator:** บันทึกการกระทำต่างๆ เช่น Click, Type, Hover, Scroll, Navigation หน้าเว็บ พร้อมดึงตัวระบุ (Locator) ที่คงทนที่สุดมาให้โดยอัตโนมัติ (เช่น id, data-testid, aria-label หรือ text)
*   **Visual Step Editor:** แสดงรายการสเต็ปการทำงานเป็น UI ที่อ่านง่าย สามารถกดลบ แก้ไขลำดับ แทรกการหยุดรอ (Wait) หรือแก้ไขข้อความที่จะพิมพ์ได้โดยตรง

### 3. Code Generator (ระบบแปลงสเต็ปเป็นโค้ดเทสต์)
*   แปลงสเต็ปการใช้งานหน้าเว็บให้เป็น Source Code สำหรับการทดสอบโดยอัตโนมัติแบบ Real-time
*   **Multi-Framework Support:** สามารถสลับและส่งออกโค้ดไปยังภาษาและเฟรมเวิร์กสวิทช์ไปมาได้ เช่น:
    *   **Playwright** (Node.js, Python, Java, .NET) - แนะนำเป็น Default
    *   **Puppeteer** (Node.js)
    *   **Cypress** (JavaScript / TypeScript)
    *   **Selenium WebDriver** (Python, Java, etc.)
    *   **Robot Framework**

### 4. Integrated Test Runner (ระบบรันเทสต์อัตโนมัติในตัว)
*   มีระบบรันเนอร์ที่สามารถป้อน Test Case เข้าไปและกดปุ่ม **"Run Test"** ให้เบราว์เซอร์ขยับและทำงานตามสเต็ปให้ดูแบบอัตโนมัติ
*   แสดงผลลัพธ์ว่าสเต็ปไหน Pass สเต็ปไหน Fail พร้อม Log รายละเอียด
*   สามารถชะลอความเร็วในการรันได้ (Slow Motion) เพื่อให้ง่ายต่อการจับตาดูบั๊ก

### 5. Plugin & Customization System (ระบบปลั๊กอินและปรับแต่งอิสระ)
*   **Custom Test Templates:** ผู้ใช้สามารถเขียนรูปแบบเทมเพลตตั้งต้นของโค้ดของตัวเองได้ (เช่น มี Custom Wrapper สำหรับบางฟังก์ชันของบริษัทตัวเอง)
*   **Extension Sandbox:** เปิดให้รันสคริปต์ JS เพิ่มเติมเข้าไปได้ง่าย ๆ หรือติดตั้งส่วนเสริมเพื่อมอนิเตอร์ Network Requests (เช่น เอาไปตรวจจับ API response ว่าถูกต้องไหม ควบคู่ไปกับ UI Test)

## 🛠️ Stack เทคโนโลยีที่แนะนำ (Tech Stack)

*   **Desktop Wrapper & Backend:** **Electron** (ความสามารถเจาะลึกไปถึงระบบ OS, เข้าถึง Node.js สำหรับรันเทสต์ได้ตรงๆ)
*   **Frontend UI / Dashboard:** **React** หรือ **Next.js (Export Static)** + **Tailwind CSS** (จัดหน้า UI ได้รวดเร็ว ดูสวยงามสมัยใหม่)
*   **Browser Render Engine:** `<webview>` tag ใน Electron หรือ IPC ควบคุมเบราว์เซอร์ที่ซ่อนอยู่
*   **Core Automation Engine:** **Playwright** (มีฟีเจอร์เกี่ยวกับการ Trace สเต็ปได้ดีดั้งเดิมอยู่แล้ว นำมาต่อยอดเขียนเป็น IDE ได้ดีมาก)
*   **Code Editor Component:** **Monaco Editor** (ตัวเดียวกับที่ใช้ใน VS Code ได้ Syntax Highlight พิมพ์โค้ดง่าย)

## 🗺️ แผนการพัฒนา (Development Roadmap สำหรับ AI Coder)

*ให้ AI Agent หรือ Coder นำแผนกนี้ไปทำงานทีละสเต็ป:*

### Phase 1: Foundation & Basic Browser (สร้างเปลือก)
*   Setup โปรเจกต์ `Electron` + `React` + `TypeScript`.
*   สร้าง UI พื้นฐาน: สองพาเนลหลักคือ **ฝั่งขวา** สำหรับ Rendering หน้าเว็บ และ **ฝั่งซ้าย** เป็นแผงควบคุม (Control Panel) สำหรับทำงาน.
*   ทำการโหลดหน้าเว็บพื้นฐานสำเร็จ สามารถใช้พิมพ์ URl นำทางได้.

### Phase 2: Action Recording System (ระบบอัดหน้าจอ)
*   เขียน Content Script ให้ Inject เข้าไปใน Webview ทุกครั้งที่โหลดหน้าเพจ เพื่อดักจับ Event (Click, Input, Change ยืนยันฟอร์ม).
*   คำนวณหา CSS Selector / XPath ที่เหมาะสม เมื่อมีการ click และส่งผ่านโครงสร้าง IPC ส่งกลับมาที่หน้า React เพื่อโชว์ในลิสต์ "Recorded Steps".

### Phase 3: Code Generation & Editor (ส่วนแสดงผลโค้ด)
*   รวบรวมข้อมูลโมเดลจาก "Recorded Steps" ไปเขียน Logics ในการ Render เป็นโค้ด Playwright หรือ Cypress.
*   เอาตัว Monaco Editor มาแสดงผลโค้ด และเมื่อสเต็ปถูกแก้ไขฝั่ง UI, โค้ดที่โมนาโกต้องเปลี่ยนตามทันที.

### Phase 4: Test Execution (ระบบปุ่มกดรันเทสต์)
*   สร้างปุ่ม **Run Test** ใน UI.
*   เมื่อคลิก ให้ส่งโค้ดจาก Editor ไปให้ Electron รันคำสั่งผ่าน Node `child_process` (เช่น สั่งรัน npx playwright test เบื้องหลัง).
*   ส่งผลลัพธ์การรันจาก Terminal มาแสดงผลในรูปแบบ Visual UI ในพาเนลซ้าย.

### Phase 5: App Polish & Customization (ต่อยอดฟีเจอร์)
*   สร้างระบบ Settings สำหรับปรับแต่ง Browser (เช่น ให้ Mock Geolocation ได้, Mock User-Agent).
*   เพิ่มระบบให้คนเซฟไฟล์ออกไปเป็น `.spec.ts` ได้เลย.
