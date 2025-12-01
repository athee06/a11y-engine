// ==UserScript==
// @name         Web Accessibility Heuristic Enhancer
// @namespace    https://github.com/athee06/a11y-engine
// @version      1.0
// @author       Athiban
// @description  Automatically improves accessibility on any website using smart heuristics for ARIA roles, labels, keyboard interaction, dialogs, forms, regions, and dynamic UI elements. Lightweight, fast, and fully reversible.
// @match        *://*/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/athee06/a11y-engine/main/a11y.user.js
// @downloadURL  https://raw.githubusercontent.com/athee06/a11y-engine/main/a11y.user.js
// ==/UserScript==

(function () {
    'use strict';

    /* ---------------------------------------------------------
       VERSION / UPDATE
    --------------------------------------------------------- */

    const A11Y_VERSION = "1.0";

    function checkForScriptUpdate() {
        try {
            const stored = localStorage.getItem("a11y_engine_version");
            if (stored !== A11Y_VERSION) {
                // simple one-time announce; live region will be created on first announce/use
                setTimeout(() => {
                    const region = document.getElementById("a11y-live-region");
                    if (region) {
                        region.textContent = `A11Y Engine updated to v${A11Y_VERSION}`;
                    }
                }, 800);
                localStorage.setItem("a11y_engine_version", A11Y_VERSION);
            }
        } catch (e) {
            // ignore storage errors
        }
    }

    /* ---------------------------------------------------------
       GLOBAL STATE
    --------------------------------------------------------- */

    let a11yEnabled = false;
    let mutationObserver = null;
    let enhancementScheduled = false;

    const A11Y_FLAG = 'data-a11y-flag';

    // Tracks per-element original attrs/styles
    const changeLog = new Map(); // Map<Element, { attrs: {}, styles: {} }>

    // References for added elements/styles
    let skipLinkEl = null;
    let liveRegionEl = null;
    let globalStyleEl = null;

    // Perf / GC
    let mutationCounter = 0;
    let pendingItemCount = 0; // for infinite scroll announcements

    /* ---------------------------------------------------------
       UTILITIES
    --------------------------------------------------------- */

    function toArray(nodeList) {
        return Array.prototype.slice.call(nodeList || []);
    }

    function isElement(el) {
        return el && el.nodeType === 1;
    }

    function isVisible(el) {
        if (!isElement(el)) return false;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function uniqueId(prefix) {
        return prefix + '-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now();
    }

    function ensureEntry(el) {
        if (!changeLog.has(el)) {
            changeLog.set(el, { attrs: {}, styles: {} });
        }
        return changeLog.get(el);
    }

    function setAttrTracked(el, attr, value) {
        const entry = ensureEntry(el);
        if (!Object.prototype.hasOwnProperty.call(entry.attrs, attr)) {
            entry.attrs[attr] = el.hasAttribute(attr) ? el.getAttribute(attr) : null;
        }
        el.setAttribute(attr, value);
    }

    function removeAttrTracked(el, attr) {
        const entry = ensureEntry(el);
        if (!Object.prototype.hasOwnProperty.call(entry.attrs, attr)) {
            entry.attrs[attr] = el.hasAttribute(attr) ? el.getAttribute(attr) : null;
        }
        el.removeAttribute(attr);
    }

    function setStyleTracked(el, prop, value) {
        const entry = ensureEntry(el);
        if (!Object.prototype.hasOwnProperty.call(entry.styles, prop)) {
            entry.styles[prop] = el.style[prop] || '';
        }
        el.style[prop] = value;
    }

    function clearAllTrackedChanges() {
        changeLog.forEach((entry, el) => {
            if (!isElement(el)) return;

            if (entry.attrs) {
                Object.keys(entry.attrs).forEach(attr => {
                    const oldVal = entry.attrs[attr];
                    if (oldVal === null) {
                        el.removeAttribute(attr);
                    } else {
                        el.setAttribute(attr, oldVal);
                    }
                });
            }

            if (entry.styles) {
                Object.keys(entry.styles).forEach(prop => {
                    el.style[prop] = entry.styles[prop];
                });
            }
        });
        changeLog.clear();
    }

    // GC: clean out entries for elements no longer in DOM
    function garbageCollect() {
        for (const el of changeLog.keys()) {
            if (!el.isConnected) {
                changeLog.delete(el);
            }
        }
    }

    function elementHasOwnAccessibility(el) {
        if (el.hasAttribute('role')) return true;
        if (el.hasAttribute('aria-label')) return true;
        if (el.hasAttribute('aria-labelledby')) return true;
        if (el.hasAttribute('aria-describedby')) return true;
        return false;
    }

    function inputHasAssociatedLabel(input) {
        if (!isElement(input)) return false;
        const id = input.id;
        if (id) {
            const label = document.querySelector('label[for="' + id + '"]');
            if (label) return true;
        }
        const parentLabel = input.closest('label');
        return !!parentLabel;
    }

    function getFocusable(root) {
        const selector = [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled]):not([type="hidden"])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            '[contenteditable="true"]',
            '[tabindex]:not([tabindex="-1"])',
            '[role="button"]'
        ].join(',');
        return toArray((root || document).querySelectorAll(selector)).filter(isVisible);
    }

    /* ---------------------------------------------------------
       TOGGLE BUTTON
    --------------------------------------------------------- */

    function createToggleButton() {
        if (!document.body) return;
        if (document.getElementById('a11y-toggle-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'a11y-toggle-btn';
        btn.type = 'button';
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '20px',
            right: '20px',
            zIndex: '2147483647',
            padding: '8px 12px',
            borderRadius: '6px',
            border: 'none',
            fontSize: '13px',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            color: '#fff'
        });

        a11yEnabled = (localStorage.getItem('a11y_enabled') === 'true');

        function updateBtnVisual() {
            if (a11yEnabled) {
                btn.textContent = 'A11Y: ON';
                btn.style.background = '#28a745';
                btn.setAttribute('aria-pressed', 'true');
            } else {
                btn.textContent = 'A11Y: OFF';
                btn.style.background = '#dc3545';
                btn.setAttribute('aria-pressed', 'false');
            }
        }

        updateBtnVisual();
        document.body.appendChild(btn);

        btn.addEventListener('click', () => {
            a11yEnabled = !a11yEnabled;
            localStorage.setItem('a11y_enabled', String(a11yEnabled));
            updateBtnVisual();
            if (a11yEnabled) {
                enableA11Y();
            } else {
                disableA11Y();
            }
        });

        if (a11yEnabled) {
            enableA11Y();
        }
    }

    /* ---------------------------------------------------------
       GLOBAL STYLES, SKIP LINK, LIVE REGION
    --------------------------------------------------------- */

    function addGlobalStyles() {
        if (globalStyleEl || !a11yEnabled) return;
        if (!document.head) return;

        const style = document.createElement('style');
        style.id = 'a11y-global-style';
        style.textContent = `
            :where(a, button, input, textarea, select, [tabindex]):focus-visible {
                outline: 3px solid #005fcc !important;
                outline-offset: 2px !important;
            }

            .a11y-skip-link {
                position: absolute;
                left: -999px;
                top: -999px;
                background: #000;
                color: #fff;
                padding: 6px 10px;
                z-index: 2147483647;
            }
            .a11y-skip-link:focus {
                left: 10px;
                top: 10px;
            }

            .a11y-live-region {
                position: absolute;
                left: -9999px;
                width: 1px;
                height: 1px;
                overflow: hidden;
            }
        `;
        document.head.appendChild(style);
        globalStyleEl = style;
    }

    function removeGlobalStyles() {
        if (globalStyleEl && globalStyleEl.parentNode) {
            globalStyleEl.parentNode.removeChild(globalStyleEl);
        }
        globalStyleEl = null;
    }

    function addSkipLink() {
        if (!a11yEnabled) return;
        if (!document.body) return;
        if (skipLinkEl && skipLinkEl.parentNode) return;

        let mainCandidate = document.querySelector('main');
        if (!mainCandidate) {
            mainCandidate = document.body;
        }
        if (!mainCandidate.id) {
            setAttrTracked(mainCandidate, 'id', 'a11y-main');
        }

        const skip = document.createElement('a');
        skip.href = '#' + mainCandidate.id;
        skip.className = 'a11y-skip-link';
        skip.textContent = 'Skip to main content';
        document.body.insertBefore(skip, document.body.firstChild);
        skipLinkEl = skip;
    }

    function removeSkipLink() {
        if (skipLinkEl && skipLinkEl.parentNode) {
            skipLinkEl.parentNode.removeChild(skipLinkEl);
        }
        skipLinkEl = null;
    }

    function getLiveRegion() {
        if (!a11yEnabled) return null;
        if (liveRegionEl && liveRegionEl.parentNode) return liveRegionEl;

        const region = document.createElement('div');
        region.id = 'a11y-live-region';
        region.className = 'a11y-live-region';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
        liveRegionEl = region;
        return region;
    }

    function removeLiveRegion() {
        if (liveRegionEl && liveRegionEl.parentNode) {
            liveRegionEl.parentNode.removeChild(liveRegionEl);
        }
        liveRegionEl = null;
    }

    function announce(text) {
        if (!a11yEnabled) return;
        if (!text) return;
        const region = getLiveRegion();
        if (!region) return;
        region.textContent = '';
        setTimeout(() => {
            region.textContent = text;
        }, 50);
    }

    /* ---------------------------------------------------------
       ADVANCED BUTTON LABELING
    --------------------------------------------------------- */

    function enhanceUnlabeledButtons(root) {
        if (!a11yEnabled) return;

        const container = root || document;

        const candidates = container.querySelectorAll(
            'button, [role="button"], [onclick], [class*="btn"], [class*="button"]'
        );

        candidates.forEach(btn => {
            if (!isElement(btn)) return;
            if (!isVisible(btn)) return;

            if (btn.hasAttribute("aria-label") || btn.hasAttribute("aria-labelledby")) return;

            // Skip if it already has visible text
            if ((btn.innerText || "").trim().length > 0) return;

            let label = null;

            // 1. ICON-BASED HEURISTICS
            const classStr = btn.className || "";
            const svg = btn.querySelector("svg");

            const iconHints = {
                Search: /search|magnify/i,
                Menu: /menu|hamburger|bars/i,
                Close: /close|times|x-mark|dismiss/i,
                Next: /next|arrow-right|chevron-right/i,
                Previous: /prev|previous|arrow-left|chevron-left/i,
                Add: /add|plus/i,
                Remove: /minus|remove|delete|trash/i,
                Upload: /upload/i,
                Download: /download/i,
                Settings: /settings|gear|cog/i,
                Play: /play/i,
                Pause: /pause/i,
                Share: /share/i
            };

            for (const [name, regex] of Object.entries(iconHints)) {
                if (regex.test(classStr)) {
                    label = name;
                    break;
                }
                if (svg && regex.test(svg.outerHTML)) {
                    label = name;
                    break;
                }
            }

            if (label) {
                setAttrTracked(btn, "aria-label", label);
                return;
            }

            // 2. ONCLICK INTENT ANALYSIS
            const onclick = btn.getAttribute("onclick") || "";
            const clickIntent = {
                Close: /close|dismiss|hide/,
                Open: /open|show|toggle/,
                Submit: /submit|save|send/,
                Delete: /delete|remove|trash/,
                Next: /next|forward/,
                Previous: /prev|previous|back/,
                Copy: /copy|duplicate/,
                Refresh: /refresh|reload/,
                Play: /play/,
                Pause: /pause/
            };

            for (const [name, regex] of Object.entries(clickIntent)) {
                if (regex.test(onclick)) {
                    label = name;
                    break;
                }
            }
            if (label) {
                setAttrTracked(btn, "aria-label", label);
                return;
            }

            // 3. SIBLING TEXT HEURISTICS
            const prevText = btn.previousElementSibling?.innerText?.trim().toLowerCase() || "";
            const nextText = btn.nextElementSibling?.innerText?.trim().toLowerCase() || "";
            const siblingText = (prevText + " " + nextText);

            if (/menu/.test(siblingText)) label = "Menu";
            else if (/search/.test(siblingText)) label = "Search";
            else if (/close/.test(siblingText)) label = "Close";
            else if (/next/.test(siblingText)) label = "Next";
            else if (/prev|back/.test(siblingText)) label = "Previous";
            else if (/settings/.test(siblingText)) label = "Settings";

            if (label) {
                setAttrTracked(btn, "aria-label", label);
                return;
            }

            // 4. CSS BACKGROUND IMAGE HEURISTICS
            const bg = getComputedStyle(btn).backgroundImage || "";
            if (/search|magnify/i.test(bg)) label = "Search";
            else if (/menu|bars/i.test(bg)) label = "Menu";
            else if (/close|times/i.test(bg)) label = "Close";
            else if (/arrow-right/i.test(bg)) label = "Next";
            else if (/arrow-left/i.test(bg)) label = "Previous";

            if (label) {
                setAttrTracked(btn, "aria-label", label);
                return;
            }

            // 5. CURSOR INTENT
            const cursor = getComputedStyle(btn).cursor;
            if (cursor === "zoom-in") label = "Zoom in";
            else if (cursor === "zoom-out") label = "Zoom out";
            else if (cursor === "grab" || cursor === "grabbing") label = "Drag";

            if (label) {
                setAttrTracked(btn, "aria-label", label);
                return;
            }

            // 6. CHILD ARIA (e.g., role=img aria-label on inner element)
            const childAria = btn.querySelector("[aria-label]");
            if (childAria) {
                setAttrTracked(btn, "aria-label", childAria.getAttribute("aria-label") || "Button");
                return;
            }

            // 7. CONTEXTUAL FORM LABELING
            if (btn.closest("form")) {
                setAttrTracked(btn, "aria-label", "Submit");
                return;
            }

            // 8. URL-BASED INTENT (for <a role=button> or clickable links)
            if (btn.tagName === "A") {
                const href = btn.getAttribute("href") || "";
                if (/logout/i.test(href)) label = "Logout";
                else if (/settings/i.test(href)) label = "Settings";
                else if (/download/i.test(href)) label = "Download";
                else if (/upload/i.test(href)) label = "Upload";
                else if (href.endsWith(".pdf") || href.endsWith(".zip") || href.endsWith(".docx"))
                    label = "Download file";

                if (label) {
                    setAttrTracked(btn, "aria-label", label);
                    return;
                }
            }

            // 9. LAST RESORT FALLBACK
            setAttrTracked(btn, "aria-label", "Button");
        });
    }

    /* ---------------------------------------------------------
       ADVANCED LINK LABELING (non-button links)
    --------------------------------------------------------- */

    function enhanceUnlabeledLinks(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const links = container.querySelectorAll('a[href]');
        links.forEach(a => {
            if (!isElement(a)) return;
            if (!isVisible(a)) return;

            // Skip if already accessible name present
            if (a.hasAttribute("aria-label") || a.hasAttribute("aria-labelledby")) return;

            const text = (a.innerText || "").trim();
            if (text.length > 0) return; // already has visible text

            // Skip if explicitly decorative
            if (a.getAttribute("aria-hidden") === "true") return;

            let label = null;

            const href = a.getAttribute("href") || "";
            const classStr = a.className || "";
            const svg = a.querySelector("svg");

            // 1. Icon / class-based patterns
            const iconHints = {
                "View profile": /avatar|profile|user/i,
                "Download": /download/i,
                "Upload": /upload/i,
                "Open menu": /menu|hamburger|bars/i,
                "Search": /search|magnify/i,
                "Next page": /next|arrow-right|chevron-right/i,
                "Previous page": /prev|previous|arrow-left|chevron-left/i,
                "Close": /close|times|x-mark|dismiss/i,
                "External link": /external-link|open-in-new/i
            };

            for (const [name, regex] of Object.entries(iconHints)) {
                if (regex.test(classStr)) {
                    label = name;
                    break;
                }
                if (svg && regex.test(svg.outerHTML)) {
                    label = name;
                    break;
                }
            }

            if (label) {
                setAttrTracked(a, "aria-label", label);
                return;
            }

            // 2. URL-based inference
            if (/logout|signout/i.test(href)) label = "Logout";
            else if (/login|signin/i.test(href)) label = "Login";
            else if (/register|signup/i.test(href)) label = "Sign up";
            else if (/cart|basket/i.test(href)) label = "View cart";
            else if (/settings|preferences/i.test(href)) label = "Open settings";
            else if (/help|support/i.test(href)) label = "Help";
            else if (/contact/i.test(href)) label = "Contact";
            else if (/profile|account/i.test(href)) label = "View profile";
            else if (/download/i.test(href)) label = "Download";
            else if (/upload/i.test(href)) label = "Upload";
            else if (href.endsWith(".pdf")) label = "Open PDF";
            else if (href.match(/\.(zip|rar|7z)$/i)) label = "Download archive";
            else if (href.match(/\.(jpg|jpeg|png|gif|webp)$/i)) label = "View image";

            if (label) {
                setAttrTracked(a, "aria-label", label);
                return;
            }

            // 3. Sibling text hints
            const prevText = a.previousElementSibling?.innerText?.trim().toLowerCase() || "";
            const nextText = a.nextElementSibling?.innerText?.trim().toLowerCase() || "";
            const siblingText = prevText + " " + nextText;

            if (/next/.test(siblingText)) label = "Next page";
            else if (/prev|previous|back/.test(siblingText)) label = "Previous page";
            else if (/learn more|details/.test(siblingText)) label = "Learn more";

            if (label) {
                setAttrTracked(a, "aria-label", label);
                return;
            }

            // 4. Role or context clues
            if (a.getAttribute("role") === "button") {
                setAttrTracked(a, "aria-label", "Button link");
                return;
            }

            // 5. Fallback generic
            setAttrTracked(a, "aria-label", "Link");
        });
    }

    /* ---------------------------------------------------------
       INPUTS & FORMS
    --------------------------------------------------------- */

    function enhanceInputsAndForms(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        // required fields detection via *
        const labels = container.querySelectorAll('label');
        labels.forEach(label => {
            if (!label.textContent) return;
            if (!label.textContent.includes('*')) return;
            const forId = label.getAttribute('for');
            let input = null;
            if (forId) input = document.getElementById(forId);
            else input = label.querySelector('input, select, textarea');
            if (input && !input.hasAttribute('aria-required')) {
                setAttrTracked(input, 'aria-required', 'true');
            }
        });

        const inputs = container.querySelectorAll('input, textarea, select');
        inputs.forEach(input => {
            if (!isVisible(input)) return;
            if (elementHasOwnAccessibility(input)) return;
            if (inputHasAssociatedLabel(input)) return;

            const placeholder = input.getAttribute('placeholder');
            if (placeholder && placeholder.trim().length > 0 && !input.hasAttribute('aria-label')) {
                setAttrTracked(input, 'aria-label', placeholder.trim());
            }
        });

        // error association
        inputs.forEach(input => {
            if (!isVisible(input)) return;
            const parent = input.parentElement;
            if (!parent) return;

            const error = parent.querySelector('.error, .error-text, .field-error, .help-block, .invalid-feedback');
            if (error && error.textContent.trim().length > 0) {
                if (!error.id) {
                    setAttrTracked(error, 'id', uniqueId('a11y-error'));
                }
                if (!input.hasAttribute('aria-describedby')) {
                    setAttrTracked(input, 'aria-describedby', error.id);
                }
                if (error.textContent.match(/required|invalid|error|must|missing/i) && !input.hasAttribute('aria-invalid')) {
                    setAttrTracked(input, 'aria-invalid', 'true');
                }
            }
        });
    }

    /* ---------------------------------------------------------
       CLICKABLE ROLES (div/span → button)
    --------------------------------------------------------- */

    function enhanceClickableRoles(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        container.querySelectorAll('div, span').forEach(el => {
            if (!isVisible(el)) return;
            if (elementHasOwnAccessibility(el)) return;
            if (el.tagName === 'BUTTON' || el.tagName === 'A') return;

            const clickable = typeof el.onclick === 'function' ||
                el.getAttribute('onclick') ||
                el.matches('.clickable, [class*="btn"], [class*="button"]');

            if (clickable) {
                setAttrTracked(el, 'role', 'button');
                if (!el.hasAttribute('tabindex')) {
                    setAttrTracked(el, 'tabindex', '0');
                }
            }
        });
    }

    /* ---------------------------------------------------------
       DROPDOWNS & ACCORDIONS (local)
    --------------------------------------------------------- */

    function enhanceLocalDropdowns(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const selector = [
            '[data-toggle]',
            '[data-accordion]',
            '.dropdown-toggle',
            '.accordion-title',
            '.accordion-header',
            '.faq-question',
            '.collapsible',
            '.collapse-toggle',
            '.menu-toggle',
            '.nav-toggle'
        ].join(',');

        container.querySelectorAll(selector).forEach(toggle => {
            if (toggle.getAttribute(A11Y_FLAG + '-dropdown') === '1') return;
            setAttrTracked(toggle, A11Y_FLAG + '-dropdown', '1');

            let panel = null;

            const controlsId = toggle.getAttribute('aria-controls');
            if (controlsId) {
                panel = document.getElementById(controlsId);
            }
            if (!panel && toggle.nextElementSibling) {
                panel = toggle.nextElementSibling;
            }
            if (!panel) return;

            if (!panel.id) {
                setAttrTracked(panel, 'id', uniqueId('a11y-panel'));
            }

            if (!elementHasOwnAccessibility(toggle)) {
                setAttrTracked(toggle, 'role', 'button');
                if (!toggle.hasAttribute('tabindex')) {
                    setAttrTracked(toggle, 'tabindex', '0');
                }
                setAttrTracked(toggle, 'aria-controls', panel.id);
            }

            const originallyVisible = isVisible(panel);
            const panelEntry = ensureEntry(panel);
            if (!Object.prototype.hasOwnProperty.call(panelEntry.styles, 'display')) {
                panelEntry.styles.display = panel.style.display || '';
            }

            if (!toggle.hasAttribute('aria-expanded')) {
                setAttrTracked(toggle, 'aria-expanded', originallyVisible ? 'true' : 'false');
            }

            if (!originallyVisible && !panel.style.display) {
                setStyleTracked(panel, 'display', 'none');
                setAttrTracked(panel, 'hidden', 'hidden');
            }

            function togglePanel() {
                if (!a11yEnabled) return;
                const expanded = toggle.getAttribute('aria-expanded') === 'true';
                const open = !expanded;
                setAttrTracked(toggle, 'aria-expanded', String(open));
                if (open) {
                    setStyleTracked(panel, 'display', panelEntry.styles.display || '');
                    removeAttrTracked(panel, 'hidden');
                } else {
                    setStyleTracked(panel, 'display', 'none');
                    setAttrTracked(panel, 'hidden', 'hidden');
                }
            }

            toggle.addEventListener('click', togglePanel);
            toggle.addEventListener('keydown', e => {
                if (!a11yEnabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    togglePanel();
                }
            });
        });
    }

    /* ---------------------------------------------------------
       LOCAL LIVE REGIONS & SLIDERS
    --------------------------------------------------------- */

    function enhanceLocalLiveRegions(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const notif = container.querySelectorAll('.toast, .notification, .alert, .snackbar');
        notif.forEach(n => {
            if (!isVisible(n)) return;
            if (n.getAttribute(A11Y_FLAG + '-live') === '1') return;
            setAttrTracked(n, A11Y_FLAG + '-live', '1');

            if (!elementHasOwnAccessibility(n)) {
                setAttrTracked(n, 'role', 'status');
                setAttrTracked(n, 'aria-live', 'polite');
            }
        });
    }

    function enhanceSliders(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const sliderCand = container.querySelectorAll('.slider, .range, [data-slider]');
        sliderCand.forEach(slider => {
            if (slider.getAttribute(A11Y_FLAG + '-slider') === '1') return;
            setAttrTracked(slider, A11Y_FLAG + '-slider', '1');

            setAttrTracked(slider, 'role', 'slider');
            if (!slider.hasAttribute('tabindex')) {
                setAttrTracked(slider, 'tabindex', '0');
            }

            const min = Number(slider.getAttribute('data-min') || 0);
            const max = Number(slider.getAttribute('data-max') || 100);
            let value = Number(slider.getAttribute('data-value') || min);

            setAttrTracked(slider, 'aria-valuemin', String(min));
            setAttrTracked(slider, 'aria-valuemax', String(max));
            setAttrTracked(slider, 'aria-valuenow', String(value));

            function updateVal(delta) {
                if (!a11yEnabled) return;
                value = Math.min(max, Math.max(min, value + delta));
                setAttrTracked(slider, 'aria-valuenow', String(value));
            }

            slider.addEventListener('keydown', e => {
                if (!a11yEnabled) return;
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    updateVal(1);
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    updateVal(-1);
                } else if (e.key === 'Home') {
                    e.preventDefault();
                    value = min;
                    setAttrTracked(slider, 'aria-valuenow', String(value));
                } else if (e.key === 'End') {
                    e.preventDefault();
                    value = max;
                    setAttrTracked(slider, 'aria-valuenow', String(value));
                }
            });
        });
    }

    /* ---------------------------------------------------------
       REGIONS / TABS / DIALOGS / STICKY HEADERS (GLOBAL)
    --------------------------------------------------------- */

    function enhanceRegionsGlobal() {
        if (!a11yEnabled || !document.body) return;
        const bodyChildren = toArray(document.body.children);

        // header / banner
        let header = document.querySelector('header');
        if (!header) {
            header = bodyChildren.find(el =>
                el.className && el.className.match(/header|top-bar|topbar|site-header/i)
            );
        }
        if (header && !header.hasAttribute('role')) {
            setAttrTracked(header, 'role', 'banner');
        }

        // navigation
        let nav = document.querySelector('nav');
        if (!nav) {
            nav = bodyChildren.find(el => {
                const links = el.querySelectorAll ? el.querySelectorAll('a') : [];
                return links.length > 5 && (el.className || '').match(/nav|menu|main-menu|top-nav/i);
            });
        }
        if (nav && !nav.hasAttribute('role')) {
            setAttrTracked(nav, 'role', 'navigation');
        }

        // main
        let main = document.querySelector('main');
        if (!main) {
            main = bodyChildren.reduce((largest, el) => {
                if (!el.innerText) return largest;
                const len = el.innerText.trim().length;
                if (!largest) return len > 200 ? el : largest;
                const currentLen = largest.innerText.trim().length;
                return len > currentLen ? el : largest;
            }, null);
        }
        if (main && !main.hasAttribute('role')) {
            setAttrTracked(main, 'role', 'main');
        }

        // footer / contentinfo
        let footer = document.querySelector('footer');
        if (!footer) {
            footer = bodyChildren.find(el =>
                el.innerText && el.innerText.match(/©|copyright|privacy|terms/i)
            );
        }
        if (footer && !footer.hasAttribute('role')) {
            setAttrTracked(footer, 'role', 'contentinfo');
        }

        // complementary (sidebars)
        document.querySelectorAll('[class*="sidebar"], [class*="side-bar"]').forEach(side => {
            if (!side.hasAttribute('role')) {
                setAttrTracked(side, 'role', 'complementary');
            }
        });
    }

    function enhanceTabsGlobal(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const tabListSelector = '[role="tablist"], .tabs, .tab-list, .nav-tabs, .tab-container';

        container.querySelectorAll(tabListSelector).forEach(tablist => {
            if (tablist.getAttribute(A11Y_FLAG + '-tablist') === '1') return;
            setAttrTracked(tablist, A11Y_FLAG + '-tablist', '1');

            if (!tablist.hasAttribute('role')) {
                setAttrTracked(tablist, 'role', 'tablist');
            }

            const tabs = toArray(tablist.querySelectorAll('[role="tab"], .tab, li, a')).filter(isVisible);

            tabs.forEach((tab, i) => {
                if (!tab.hasAttribute('role')) {
                    setAttrTracked(tab, 'role', 'tab');
                }
                if (!tab.hasAttribute('tabindex')) {
                    setAttrTracked(tab, 'tabindex', i === 0 ? '0' : '-1');
                }
                if (!tab.id) {
                    setAttrTracked(tab, 'id', uniqueId('a11y-tab'));
                }

                if (tab.tagName === 'A' && tab.getAttribute('href') && tab.getAttribute('href').charAt(0) === '#') {
                    const target = document.querySelector(tab.getAttribute('href'));
                    if (target) {
                        if (!target.hasAttribute('role')) {
                            setAttrTracked(target, 'role', 'tabpanel');
                        }
                        if (!target.hasAttribute('aria-labelledby')) {
                            setAttrTracked(target, 'aria-labelledby', tab.id);
                        }
                        if (!target.id) {
                            setAttrTracked(target, 'id', uniqueId('a11y-tabpanel'));
                        }
                        if (!tab.hasAttribute('aria-controls')) {
                            setAttrTracked(tab, 'aria-controls', target.id);
                        }
                    }
                }
            });

            const panels = [];
            tabs.forEach((tab, i) => {
                let panel = null;
                const cid = tab.getAttribute('aria-controls');
                if (cid) panel = document.getElementById(cid);
                if (!panel) {
                    const containerEl = tab.closest('[class*="tabs"], [class*="tab-container"]');
                    if (containerEl) {
                        const maybePanels = toArray(containerEl.parentNode.querySelectorAll('.tab-panel, [role="tabpanel"]'));
                        panel = maybePanels[i] || null;
                    }
                }
                if (panel) {
                    if (!panel.hasAttribute('role')) {
                        setAttrTracked(panel, 'role', 'tabpanel');
                    }
                    if (!panel.hasAttribute('aria-labelledby')) {
                        setAttrTracked(panel, 'aria-labelledby', tab.id);
                    }
                    if (!panel.id) {
                        setAttrTracked(panel, 'id', uniqueId('a11y-tabpanel'));
                    }
                    if (!tab.hasAttribute('aria-controls')) {
                        setAttrTracked(tab, 'aria-controls', panel.id);
                    }
                    panels.push(panel);
                } else {
                    panels.push(null);
                }
            });

            function activateTab(tab) {
                if (!a11yEnabled) return;
                tabs.forEach((t, idx) => {
                    const selected = (t === tab);
                    setAttrTracked(t, 'aria-selected', selected ? 'true' : 'false');
                    setAttrTracked(t, 'tabindex', selected ? '0' : '-1');

                    const cid = t.getAttribute('aria-controls');
                    const panel = cid ? document.getElementById(cid) : panels[idx];
                    if (panel) {
                        if (selected) {
                            removeAttrTracked(panel, 'hidden');
                        } else {
                            setAttrTracked(panel, 'hidden', 'hidden');
                        }
                    }
                });
                tab.focus();
            }

            tabs.forEach(tab => {
                tab.addEventListener('click', e => {
                    if (!a11yEnabled) return;
                    e.preventDefault();
                    activateTab(tab);
                });

                tab.addEventListener('keydown', e => {
                    if (!a11yEnabled) return;
                    const idx = tabs.indexOf(tab);

                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        activateTab(tabs[(idx + 1) % tabs.length]);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        activateTab(tabs[(idx - 1 + tabs.length) % tabs.length]);
                    } else if (e.key === 'Home') {
                        e.preventDefault();
                        activateTab(tabs[0]);
                    } else if (e.key === 'End') {
                        e.preventDefault();
                        activateTab(tabs[tabs.length - 1]);
                    }
                });
            });
        });
    }

    function normalizeTabIndexGlobal(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const tabbables = container.querySelectorAll('[tabindex]');
        tabbables.forEach(el => {
            const val = parseInt(el.getAttribute('tabindex'), 10);
            if (!isNaN(val) && val > 0) {
                setAttrTracked(el, 'tabindex', '0');
            }
        });
    }

    function enhanceDialogsGlobal(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const modalSelector = [
            '.modal',
            '.dialog',
            '.popup',
            '.lightbox',
            '[data-modal]',
            '[data-dialog]'
        ].join(',');

        container.querySelectorAll(modalSelector).forEach(dialog => {
            if (!isVisible(dialog)) return;
            if (dialog.getAttribute(A11Y_FLAG + '-dialog') === '1') return;
            setAttrTracked(dialog, A11Y_FLAG + '-dialog', '1');

            if (!dialog.hasAttribute('role')) {
                setAttrTracked(dialog, 'role', 'dialog');
            }
            if (!dialog.hasAttribute('aria-modal')) {
                setAttrTracked(dialog, 'aria-modal', 'true');
            }

            const heading = dialog.querySelector('h1, h2, h3, .title, .dialog-title, .modal-title');
            if (heading) {
                if (!heading.id) {
                    setAttrTracked(heading, 'id', uniqueId('a11y-dialog-title'));
                }
                if (!dialog.hasAttribute('aria-labelledby')) {
                    setAttrTracked(dialog, 'aria-labelledby', heading.id);
                }
            }

            dialog.addEventListener('keydown', e => {
                if (!a11yEnabled) return;
                if (e.key !== 'Tab') return;
                const focusables = getFocusable(dialog);
                if (!focusables.length) return;

                const first = focusables[0];
                const last = focusables[focusables.length - 1];

                if (e.shiftKey) {
                    if (document.activeElement === first) {
                        e.preventDefault();
                        last.focus();
                    }
                } else {
                    if (document.activeElement === last) {
                        e.preventDefault();
                        first.focus();
                    }
                }
            });

            if (isVisible(dialog)) {
                const focusables = getFocusable(dialog);
                if (focusables.length) {
                    focusables[0].focus();
                } else {
                    setAttrTracked(dialog, 'tabindex', '-1');
                    dialog.focus();
                }
            }
        });
    }

    function enhanceStickyHeadersGlobal(root) {
        if (!a11yEnabled) return;
        const container = root || document;

        const headers = toArray(container.querySelectorAll('header, [class*="header"], [class*="top-bar"]'))
            .filter(isVisible)
            .filter(el => {
                const style = getComputedStyle(el);
                return style.position === 'sticky' || style.position === 'fixed';
            });

        if (headers.length > 1) {
            const mainHeader = headers[0];
            headers.slice(1).forEach(h => {
                if (h.innerText && mainHeader.innerText &&
                    h.innerText.trim() === mainHeader.innerText.trim()) {
                    setAttrTracked(h, 'aria-hidden', 'true');
                }
            });
        }
    }

    function enhanceInfiniteScrollGlobal(addedCount = 0) {
        if (!a11yEnabled) return;
        if (addedCount > 0) {
            announce(addedCount + ' more items loaded');
        }
    }

    /* ---------------------------------------------------------
       KEYBOARD INTERACTIONS (global listener)
    --------------------------------------------------------- */

    function setupKeyboardInteractions() {
        document.addEventListener('keydown', e => {
            if (!a11yEnabled) return;

            const el = document.activeElement;
            if (!el) return;
            const role = el.getAttribute('role');

            // Enter/Space on buttons/tabs
            if ((e.key === 'Enter' || e.key === ' ') &&
                (role === 'button' || el.tagName === 'BUTTON' || role === 'tab')) {
                if (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT') {
                    e.preventDefault();
                    el.click();
                }
            }

            // ESC to close dialog
            if (e.key === 'Escape') {
                const dialogs = toArray(document.querySelectorAll('[role="dialog"][aria-modal="true"], .modal[role="dialog"]'))
                    .filter(isVisible);
                if (dialogs.length) {
                    const dialog = dialogs[dialogs.length - 1];
                    const closeBtn = dialog.querySelector(
                        'button[aria-label*="close" i], ' +
                        '[role="button"][aria-label*="close" i], ' +
                        '.close, .btn-close, .modal-close'
                    );
                    if (closeBtn) {
                        closeBtn.click();
                    } else {
                        setStyleTracked(dialog, 'display', 'none');
                        setAttrTracked(dialog, 'aria-hidden', 'true');
                    }
                }
            }
        }, true);
    }

    /* ---------------------------------------------------------
       HYBRID ENHANCEMENT ROUTING
    --------------------------------------------------------- */

    function runLocalEnhancements(root) {
        enhanceUnlabeledButtons(root);
        enhanceUnlabeledLinks(root);
        enhanceInputsAndForms(root);
        enhanceClickableRoles(root);
        enhanceLocalDropdowns(root);
        enhanceLocalLiveRegions(root);
        enhanceSliders(root);
    }

    function runGlobalEnhancements(addedCount = 0) {
        enhanceRegionsGlobal();
        enhanceTabsGlobal();
        enhanceDialogsGlobal();
        enhanceStickyHeadersGlobal();
        normalizeTabIndexGlobal();
        enhanceInfiniteScrollGlobal(addedCount);
    }

    /* ---------------------------------------------------------
       MUTATION OBSERVER — HYBRID + NO LAYOUT THRASH
    --------------------------------------------------------- */

    function startMutationObserver() {
        if (!window.MutationObserver || mutationObserver) return;
        if (!document.body) return;

        mutationObserver = new MutationObserver(mutations => {
            if (!a11yEnabled) return;

            const nodesToEnhance = [];
            let addedNodeCount = 0;

            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
                    m.addedNodes.forEach(n => {
                        if (n.nodeType !== 1) return;
                        nodesToEnhance.push(n);

                        // heuristic: count likely "items" for infinite scroll
                        if (n.matches && n.matches('li, article, [role="listitem"], .card, .tweet, .post')) {
                            addedNodeCount++;
                        }
                    });
                }
            }

            if (nodesToEnhance.length > 0) {
                requestAnimationFrame(() => {
                    nodesToEnhance.forEach(n => runLocalEnhancements(n));
                });

                scheduleEnhancements(addedNodeCount);
            }

            mutationCounter++;
            if (mutationCounter >= 80) {
                garbageCollect();
                mutationCounter = 0;
            }
        });

        mutationObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function stopMutationObserver() {
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
    }

    /* ---------------------------------------------------------
       GLOBAL ENHANCEMENT SCHEDULER
    --------------------------------------------------------- */

    function scheduleEnhancements(count = 0) {
        pendingItemCount += count;

        if (enhancementScheduled) return;
        enhancementScheduled = true;

        requestAnimationFrame(() => {
            enhancementScheduled = false;
            runGlobalEnhancements(pendingItemCount);
            pendingItemCount = 0;
        });
    }

    /* ---------------------------------------------------------
       ENABLE / DISABLE ENGINE
    --------------------------------------------------------- */

    function enableA11Y() {
        addGlobalStyles();
        addSkipLink();
        runLocalEnhancements(document.body);
        runGlobalEnhancements(0);
        startMutationObserver();
    }

    function disableA11Y() {
        stopMutationObserver();
        removeSkipLink();
        removeLiveRegion();
        removeGlobalStyles();
        clearAllTrackedChanges();
        pendingItemCount = 0;
        mutationCounter = 0;
    }

    /* ---------------------------------------------------------
       INIT
    --------------------------------------------------------- */

    function init() {
        checkForScriptUpdate();
        createToggleButton();
        setupKeyboardInteractions();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
