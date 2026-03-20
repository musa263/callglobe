# CallGlobe UI/UX Design Specification
## Version 1.0 | March 2026

---

## 1. Design Philosophy

CallGlobe uses a **dark-mode-first, mobile-native** design language. The aesthetic is premium yet accessible — targeting users who may not be tech-savvy but appreciate a clean, modern interface. Every screen is designed for one-handed use on mobile.

**Design Principles:**
- Dark background reduces eye strain during evening calls (when most diaspora calls happen)
- High-contrast green (#00D4AA) for actionable elements ensures visibility
- Large touch targets (min 48px) for the keypad and call controls
- Minimal text — information hierarchy through size, weight, and color
- No clutter — each screen has one primary action

---

## 2. Color System

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--color-primary` | `#00D4AA` | 0, 212, 170 | Primary CTA, active states, success, balance |
| `--color-primary-light` | `rgba(0,212,170,0.12)` | — | Card backgrounds, hover states |
| `--color-secondary` | `#0099FF` | 0, 153, 255 | Gradient pairing, secondary accent |
| `--color-bg` | `#0A0A0F` | 10, 10, 15 | App background |
| `--color-surface` | `rgba(255,255,255,0.03)` | — | Cards, inputs |
| `--color-surface-hover` | `rgba(255,255,255,0.06)` | — | Hover/active surface |
| `--color-border` | `rgba(255,255,255,0.06)` | — | Dividers, card borders |
| `--color-border-active` | `rgba(0,212,170,0.4)` | — | Active/selected borders |
| `--color-text-primary` | `#FFFFFF` | 255, 255, 255 | Headings, key data |
| `--color-text-secondary` | `#6A7A8A` | 106, 122, 138 | Labels, descriptions |
| `--color-text-muted` | `#4A5A6A` | 74, 90, 106 | Timestamps, hints |
| `--color-error` | `#FF3B3B` | 255, 59, 59 | Errors, decline, end call, remove |
| `--color-warning` | `#FFA500` | 255, 165, 0 | Upsells, promotions |
| `--color-whatsapp` | `#25D366` | 37, 211, 102 | WhatsApp share button |

**Gradient (Primary):** `linear-gradient(135deg, #00D4AA, #0099FF)`
**Gradient (Background):** `linear-gradient(160deg, #0A0A0A 0%, #1A0A2E 40%, #0D1B3E 70%, #0A0A0A 100%)`
**Gradient (Warning CTA):** `linear-gradient(135deg, #FFA500, #FF6B00)`

---

## 3. Typography

| Element | Font | Size | Weight | Color | Tracking |
|---------|------|------|--------|-------|----------|
| App Title | DM Sans | 32px | 700 | Gradient clip | -0.02em |
| Screen Heading | DM Sans | 22px | 700 | #FFFFFF | -0.01em |
| Section Heading | DM Sans | 18px | 700 | #FFFFFF | — |
| Body Text | DM Sans | 14-15px | 400 | #FFFFFF or #6A7A8A | — |
| Caption | DM Sans | 11-12px | 500 | #5A6A7A | 0.06-0.08em |
| Label (uppercase) | DM Sans | 11px | 500 | #6A7A8A | 0.08em |
| Balance Amount | DM Sans | 28px | 700 | Gradient clip | — |
| Call Timer | DM Sans | 40px | 300 | #FFFFFF | 0.05em |
| Keypad Digits | DM Sans | 22px | 500 | #FFFFFF | — |
| Phone Number | DM Sans | 22px | 600 | #FFFFFF | 0.03em |
| Referral Code | Monospace | 20px | 700 | #00D4AA | 0.08em |

**Notes:**
- All number displays use `font-variant-numeric: tabular-nums` for alignment
- Load Google Fonts: `DM Sans` weights 400, 500, 600, 700

---

## 4. Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | 4px | Inner icon gaps |
| `--space-sm` | 8px | Tight gaps between related items |
| `--space-md` | 12px | Card internal gaps |
| `--space-lg` | 16px | Section gaps |
| `--space-xl` | 20px | Screen horizontal padding |
| `--space-2xl` | 24px | Large section gaps |
| `--radius-sm` | 8px | Small buttons, tags |
| `--radius-md` | 12px | Inputs, regular buttons |
| `--radius-lg` | 14-16px | Cards |
| `--radius-xl` | 18-20px | Hero cards |
| `--radius-full` | 50% | Call buttons, avatars |

**Safe Areas:**
- Top padding: `env(safe-area-inset-top) + 12px` (for notch devices)
- Bottom padding: `env(safe-area-inset-bottom) + 8px` (for tab bar)
- Tab bar height: ~60px + bottom safe area

---

## 5. Component Library

### 5.1 Balance Card
- Location: Top of dialer screen
- Background: `linear-gradient(135deg, rgba(0,212,170,0.08), rgba(0,153,255,0.08))`
- Border: `1px solid rgba(0,212,170,0.1)`
- Border-radius: 18px
- Content: Balance (gradient text, 28px bold), estimated minutes, destination country
- Layout: Flex row, space-between

### 5.2 Number Chip (Caller ID Selector)
- Location: My Numbers card on dialer
- Background (inactive): `rgba(255,255,255,0.02)`
- Background (active): `rgba(0,212,170,0.1)`
- Border (active): `1px solid rgba(0,212,170,0.4)`
- Content: Flag emoji (16px) + phone number (12px bold) + "Active caller ID" / "Tap to use" (9px)
- Layout: Horizontal scroll, flex-shrink: 0

### 5.3 Dial Pad
- Grid: 3 columns, 10px gap, max-width 300px, centered
- Button: 56px height, 16px border-radius
- Background: `rgba(255,255,255,0.04)`
- Active state: `rgba(0,212,170,0.15)`
- Text: 22px, 500 weight

### 5.4 Call Button (Green)
- Size: 64px diameter, circle
- Background: `linear-gradient(135deg, #00D4AA, #00B894)`
- Shadow: `0 4px 24px rgba(0,212,170,0.3)`
- Icon: Phone SVG, white, 28px
- Disabled: `rgba(255,255,255,0.06)`, no shadow

### 5.5 End Call Button (Red)
- Size: 72px diameter, circle
- Background: `#FF3B3B`
- Shadow: `0 4px 30px rgba(255,59,59,0.3)`
- Icon: Phone-off SVG, white, 32px

### 5.6 Recharge Tier Card
- Padding: 16px 18px
- Border-radius: 14px
- Border (inactive): `1px solid rgba(255,255,255,0.06)`
- Border (selected): `1px solid rgba(0,212,170,0.4)`
- Background (selected): `rgba(0,212,170,0.08)`
- Content: Amount (20px bold), bonus % (13px green), total credit (15px bold right-aligned)

### 5.7 Share Button (Referral)
- Padding: 16px 18px
- Border-radius: 14px
- Layout: Flex row, icon (24px emoji) + text + subtext
- Variants: WhatsApp (green tint), SMS (blue tint), More (neutral)

### 5.8 Tab Bar
- Position: Fixed bottom
- Background: `rgba(10,10,15,0.95)` with `backdrop-filter: blur(20px)`
- Top border: `1px solid rgba(255,255,255,0.06)`
- Padding: 8px top, 28px bottom (safe area)
- Tab item: Flex column, centered, icon (20px emoji) + label (10px, 600 weight)
- Active color: `#00D4AA`, Inactive: `#4A5A6A`

### 5.9 Country Picker (Modal)
- Full screen overlay, background: `rgba(0,0,0,0.85)`
- Search input at top with back button
- Scrollable list: Flag (24px) + name + dial code + rate/min (green)
- Item padding: 14px 8px, border-bottom separator

### 5.10 Incoming Call Screen
- Full screen, centered layout
- Pulsing animation on avatar ring: `ringPulse 1.5s ease-in-out infinite`
- Caller name: 26px bold
- Caller number: 16px, gray
- "to your number" line showing which DID was called
- Two circle buttons: Decline (red, 68px) and Answer (green, 68px)

---

## 6. Screen Flow Diagram

```
[Splash 2s] → [Login/Signup]
                    ↓
              [Main App Shell]
              ├── Tab: Dialer
              │   ├── My Numbers Card (+ Get Number modal)
              │   ├── Balance Card
              │   ├── Country Picker → [Country Modal]
              │   ├── Dial Pad
              │   └── Call Button → [Active Call Screen]
              │                     └── [End] → [Call History updated]
              │
              ├── Tab: History
              │   └── Scrollable list (incoming/outgoing)
              │
              ├── Tab: Numbers
              │   ├── Active Caller ID highlight
              │   ├── Number cards (Set as Caller ID / Test / Remove)
              │   ├── [+ Get Number] → [Number Store Modal]
              │   └── How it works section
              │
              ├── Tab: Recharge
              │   ├── Current balance
              │   ├── Tier cards ($10-$100)
              │   └── Pay with Stripe → [Payment Modal] → [Success]
              │
              └── Tab: Invite
                  ├── Give $2 / Get $2 hero
                  ├── Referral code + copy
                  ├── Share (WhatsApp / SMS / More)
                  ├── How it works
                  ├── Stats (invited / earned)
                  └── Comparison promo

[Incoming Call] → (overlays any screen)
    ├── Answer → [Active Call Screen]
    └── Decline → (returns to previous screen)
```

---

## 7. Animation Specifications

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| Splash logo pulse | 2s loop | ease-in-out | Scale 1→1.05→1 |
| Incoming call ring | 1.5s loop | ease-in-out | Scale + box-shadow expand |
| Fade in (screen transition) | 0.3s | ease-out | translateY(8px)→0, opacity 0→1 |
| Button press | 0.15s | ease | scale(0.97) on :active |
| Tab color change | 0.2s | ease | color transition |
| Card selection | 0.2s | ease | border-color + background transition |

---

## 8. Accessibility Notes

- All interactive elements: minimum 44x44px touch target
- Color contrast: White on dark (#0A0A0F) exceeds WCAG AAA (21:1)
- Green on dark (#00D4AA on #0A0A0F) exceeds WCAG AA (8.5:1)
- Screen reader: Emoji icons have aria-labels in production build
- Keyboard navigation: Tab order follows visual layout
- Font size: Never below 10px, body never below 13px
