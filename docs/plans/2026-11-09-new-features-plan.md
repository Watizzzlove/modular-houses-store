# Implementation Plan: Profile Redesign, Phone Push Auth, Header Icons, Payment & Admin Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview
This plan implements the complete set of requested features:
1. Fix logout functionality and redirect.
2. Full visual redesign of `profile.html` to match the main dark/glass aesthetic with a fixed/sticky header that stays in view on scroll.
3. Redesign header buttons: Account and Cart become clean icons to the left of «Оставить заявку» with smooth hover expansion of labels.
4. Registration exclusively by phone number via push verification (Phone + Password + Confirm Password -> Push code entry).
5. Real test payment integration (YooKassa test mode & Stripe Checkout).
6. Complete removal of all admin links from the public site; `/admin.html` accessible only by direct URL and always prompts with login and test credentials shown.
7. Media management improvements: compact wrapping filters, mobile sticky filter widget, 2-column mobile photo grid, mobile collapsible sidebar drawer, live photo filtering bugfix, and perfectly centered circular close buttons.
8. DO NOT push to GitHub until user explicitly approves.

---

### Task 1: Fix Logout Button & Redesign Profile Page to Match Main Site with Sticky Header
- [ ] Update `site-header` in `public/css/style.css` to be `position: fixed` with glass background on scroll.
- [ ] Add header markup and style to `public/profile.html` matching `index.html`.
- [ ] Fix logout logic: clearing tokens, resetting state, and redirecting to login view or `/`.
- [ ] Apply dark/glass theme styling to `profile.html` containers, cards, and stepper.

### Task 2: Redesign Header Icons (Account & Cart) with Smooth Expand Hover
- [ ] In `public/css/style.css`, create `.header-action-icon` styles:
  - Transparent background, no borders, icon only by default.
  - Smooth label transition: `max-width: 0`, `opacity: 0` -> expands to `max-width: 100px`, `opacity: 1` on hover/focus.
- [ ] Update header markup in `public/index.html`, `public/houses.html`, `public/saunas.html`, and `public/profile.html` so Account and Cart icons appear to the left of `btn-header-cta`.
- [ ] Preserve cart badge counter on the cart icon.

### Task 3: Phone Registration via Push / SMS Verification
- [ ] In `src/routes/auth.js`:
  - Add `/api/auth/send-push-code` endpoint to generate and dispatch push/SMS verification codes.
  - Add `/api/auth/register-phone` endpoint validating phone, matching passwords, and verifying code.
- [ ] In `public/profile.html` and `public/js/cart.js`:
  - Update registration form: Phone + Password + Confirm Password.
  - Add Step 2 Push Code verification modal/view: «На номер отправлен push с кодом».
  - Add Firebase Auth Web SDK integration (`RecaptchaVerifier`, `signInWithPhoneNumber`) with fallback to backend push code.

### Task 4: Real Test Payment Integration
- [ ] In `src/routes/orders.js`:
  - Enhance `/api/orders/:id/pay` to create real YooKassa test payment session if credentials configured.
  - Add `/api/orders/:id/stripe-session` supporting Stripe Checkout test session.
- [ ] In `public/payment.html`:
  - Update interface to support real test checkout, test card auto-completion, and instant status callback.
- [ ] In `public/admin.html`:
  - Provide settings fields in Payments tab for YooKassa Test and Stripe API keys.

### Task 5: Remove Public Admin Links & Always Show Admin Login Prompt
- [ ] Remove all `<a href="/admin.html">` links from:
  - `public/index.html`
  - `public/houses.html`
  - `public/saunas.html`
  - `public/order-success.html`
- [ ] In `public/js/admin.js`:
  - Always display login overlay when opening `/admin.html` (do not silently auto-enter).
- [ ] In `public/admin.html`:
  - Display test credentials callout banner on the login card:
    `Логин: admin@modul-haus.ru | Пароль: admin123`.

### Task 6: Overhaul Admin Photo Management & Responsive Sidebar
- [ ] In `public/admin.html` and `public/css/admin.css`:
  - Refactor media filters into a compact wrapping flexbox (`gap: 8px; flex-wrap: wrap`).
  - Add filter dropdowns: Category (Все / Дома / Бани), Series (with category tag), Color, Kind.
  - Add sticky filter widget styling for mobile screens (`@media (max-width: 768px)`).
  - Set media grid on mobile to 2 columns (`grid-template-columns: repeat(2, 1fr)`).
  - Update sidebar on mobile to collapse to icon strip (60px) and expand into an offcanvas drawer on tap.
  - Fix modal and delete close buttons with `.admin-modal-close-btn` (32px circular, centered cross).
- [ ] In `public/js/admin.js`:
  - Fix photo filtering logic: trigger re-fetch and render when any filter dropdown changes.

### Task 7: Verification & Testing
- [ ] Run `npm test` and `node test/features.test.js`.
- [ ] Verify visually with Puppeteer MCP across desktop and mobile viewports.
- [ ] Ensure git status is clean locally and NOT pushed to GitHub.
