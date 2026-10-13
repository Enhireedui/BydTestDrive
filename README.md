# BYD Event Test Drive 2 — бүртгэлийн landing page

Sain Motors · 2026.10.17 (Бямба гараг) · 11:00–20:00 · BYD 4S Showroom, Цамбагаравын баруун урд

Framework-гүй статик сайт (HTML/CSS/JS) + Google Apps Script backend → Google Sheets.

```
index.html               Хуудас
assets/css/styles.css    Загвар (mobile-first)
assets/js/app.js         Форм, баталгаажуулалт, илгээлт
assets/js/config.js      Apps Script URL, Google Maps линк  ← орчин бүрт засна
assets/img/              Оновчилсон logo (WebP), OG зураг, icon
apps-script/Code.gs      Sheets руу бичих backend
tests/                   Backend unit тест (node --test)
dev/server.mjs           Локал preview — жинхэнэ Code.gs-ийг санах ойн sheet дээр ажиллуулна
scripts/build.mjs        Production build → dist/
```

## 1. Google Sheets backend суулгах

1. Бүртгэлийн Google Sheet-ээ нээнэ → **Extensions → Apps Script**.
2. `Code.gs`-ийн агуулгыг `apps-script/Code.gs`-ээр солино.
   **Project Settings → Show "appsscript.json"** асаагаад `apps-script/appsscript.json`-ийг хуулна.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Зөвшөөрөл өгөөд гарсан **Web app URL** (`https://script.google.com/macros/s/…/exec`)-ийг хуулж авна.

Анхны бүртгэл ирэхэд `Registrations` sheet толгой мөртэйгээ автоматаар үүснэ.
Spreadsheet ID frontend-д хэзээ ч ил гарахгүй.

> `Code.gs`-ийг өөрчилсний дараа **Deploy → Manage deployments → Edit → New version** хийхгүй бол өөрчлөлт хэрэгжихгүй.

## 2. Build ба deploy

```bash
node scripts/build.mjs \
  --site https://ТАНЫ-ДОМЭЙН \
  --endpoint https://script.google.com/macros/s/XXXX/exec \
  --map https://maps.app.goo.gl/ЖИНХЭНЭ-ПИН
```

`dist/` хавтсыг ямар ч статик hosting-д байршуулна (Netlify, Vercel, Cloudflare Pages, GitHub Pages, nginx).
Build нь canonical, Open Graph URL, Event schema-ийн зургийн хаягийг таны домэйнээр бөглөж, URL буруу бол зогсоно.

**Google Maps:** одоогийн линк нь хайлтын линк. Showroom-ын албан ёсны pin-ийн share линкийг `--map`-аар өгнө үү.

## 3. Локал шалгах

```bash
node dev/server.mjs      # http://localhost:5173
npm test                 # backend unit тест
```

Backend-ийн алдааг туршихдаа: `http://localhost:5173/__mode?m=fail` (`ok | fail | slow | busy | http500 | unverified`),
хадгалагдсан мөрүүд: `/__rows`, цэвэрлэх: `/__reset`.

## Өгөгдлийн найдвартай байдал

- Амжилтын дэлгэц зөвхөн сервер мөрийг бичиж, **буцаан уншиж шалгаад** `{ ok: true, id }` буцаасны дараа л гарна.
- Алдаа гарвал оруулсан мэдээлэл хадгалагдаж, товч сэргэж, дахин оролдох боломжтой.
- Нэг утасны дугаараар давхар бүртгэл үүсэхгүй. Дахин илгээвэл анхны бүртгэлийг буцаана. Тиймээс timeout-ийн дараа дахин оролдох нь аюулгүй.
- Сервер талд: нэр, 8 оронтой дугаар, цагийн бүсийг шалгана. Sheets formula injection-ээс хамгаална. Honeypot болон минутад 60 бүртгэлийн хязгаартай. `LockService`-ээр зэрэг ирсэн хүсэлтүүдийг дарааллуулна.

## Sheet-ийн баганууд

Timestamp · Registration ID (`BYD-X7K2P9`) · Name · Phone (`99112233`) · Time Slot (`13:00–15:00`) · Event · Source · UTM Source · UTM Medium · UTM Campaign · UTM Content · Referrer · Status (`Confirmed`)
