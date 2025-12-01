# Web Accessibility Heuristic Enhancer

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/userscript-Tampermonkey-orange" alt="Userscript">
  <img src="https://img.shields.io/github/stars/athee06/a11y-engine?style=social" alt="GitHub Stars">
  <img src="https://img.shields.io/badge/accessibility-enhancer-8A2BE2" alt="A11Y">
</p>

A high-performance userscript that automatically improves accessibility on any website using advanced heuristics.  
It enhances unlabeled buttons, links, forms, dialogs, regions, keyboard navigation, focus management, dynamic components, and infinite-scroll announcements — all without external APIs or dependencies.

## ✨ Features
- Smart ARIA role inference  
- Advanced button + link labeling heuristics  
- Repairs icon-only or visually unlabeled buttons  
- Enhanced keyboard support (Enter, Space, Escape, Tab)  
- Modal accessibility (focus trap, aria-modal)  
- Dropdown & accordion accessibility  
- Tab accessibility (roving tabindex + ARIA linking)  
- Form accessibility (labels, errors, aria-required)  
- Automatic region detection (header, nav, main, footer)  
- Infinite scroll announcements (zero layout thrashing)  
- Sticky header deduplication  
- Fully reversible rollback system  
- Memory-safe (GC for removed nodes)  
- Hybrid MutationObserver scanning optimized for SPAs  

## 🔧 Installation (Tampermonkey)
1. Install Tampermonkey in your browser.  
2. Click **“Create a new script”**.  
3. Paste the RAW script from:

```
https://raw.githubusercontent.com/athee06/a11y-engine/main/a11y.user.js
```

4. Save and refresh any website to enable.

## 🧠 Why This Project Exists
Many websites fail basic WCAG and ARIA guidelines, especially dynamic modern UIs.  
This script provides an automated, lightweight accessibility layer to improve everyday browsing.

## 📜 License
MIT License

## ✨ Author
**Athiban**  
GitHub: https://github.com/athee06
