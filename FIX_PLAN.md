# NOVA OPTIMIZER - 4 CRITICAL FIXES [BLACKBOXAI]

**USER REQUESTS:** Startup/Fade-in, Mods section cool colors, Startup apps, Custom background

## 🔍 DIAGNOSIS FROM FILE ANALYSIS

**1. Startup & Fade-in BROKEN**
```
index.html: runLoadingSequence() not called - loading-screen stays
main.ts: DOMContentLoaded → await runLoadingSequence() missing
```
**FIX:** Add loading trigger + JS fallback

**2. Mods Section HIDDEN**
```
index.html: #mods-section { display: none }
main.ts: pill click → modsSection.style.display not triggered
```
**FIX:** JS toggle + neon CSS glows

**3. Startup Apps EMPTY**
```
main.ts: loadStartupPrograms() → novaAPI.getStartupPrograms() → PS Win32_StartupCommand FAIL
```
**FIX:** Robust PS + fallback UI

**4. Custom Background BROKEN**
```
main.ts: btnSelectBg → novaAPI.selectBackground() → electron-main.cjs handler exists but dialog fail
```
**FIX:** Robust dialog + fallback

## 📋 EXECUTE PLAN

**PHASE 1: JS FIXES (main.ts)**
```
- Add runLoadingSequence() trigger
- Fix mods pill toggle logic
- Robust startup programs load
- Background picker fallback
```

**PHASE 2: CSS (style.css)**
```
- Mods neon glows/colors
- Loading screen reliability
```

**PHASE 3: Backend (electron-main.cjs)**
```
- Robust getStartupPrograms PS
- Background dialog permissions
```

**DEPENDENT FILES:**
```
main.ts (priority 1)
style.css
electron-main.cjs
index.html (mods visibility)
```

**FOLLOWUP:**
```
1. Kill dev terminals
2. npm run electron:dev
3. TEST: Loading → Mods neon → Startup loads → Background picker works
4. attempt_completion
```

**Approve edits? Reply YES → Execute Phase 1-3**

