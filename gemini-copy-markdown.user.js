// ==UserScript==
// @name         Gemini Canvas - Copy as Markdown
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Adds a "Copy as Markdown" button to the Canvas toolbar in Google Gemini
// @author       Steve Hanov
// @license      MIT
// @homepageURL  https://github.com/smhanov/tampers
// @supportURL   https://github.com/smhanov/tampers/issues
// @updateURL    https://raw.githubusercontent.com/smhanov/tampers/main/gemini-copy-markdown.user.js
// @downloadURL  https://raw.githubusercontent.com/smhanov/tampers/main/gemini-copy-markdown.user.js
// @match        https://gemini.google.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'tm-copy-markdown-btn';
    const DEBUG = true;

    function log(...args) {
        if (DEBUG) {
            console.log('[Gemini Copy Markdown]', ...args);
        }
    }

    log('Script loaded', {
        url: window.location.href,
        readyState: document.readyState,
    });

    // ── HTML → Markdown converter ──────────────────────────────────────

    function htmlToMarkdown(element) {
        return convertNode(element).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    function convertNode(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();
        if (isMathNode(node)) {
            return convertMath(node);
        }
        const children = () => convertChildren(node);

        switch (tag) {
            case 'h1': return `\n# ${children().trim()}\n\n`;
            case 'h2': return `\n## ${children().trim()}\n\n`;
            case 'h3': return `\n### ${children().trim()}\n\n`;
            case 'h4': return `\n#### ${children().trim()}\n\n`;
            case 'h5': return `\n##### ${children().trim()}\n\n`;
            case 'h6': return `\n###### ${children().trim()}\n\n`;

            case 'p': return `${children()}\n\n`;

            case 'strong':
            case 'b':
                return `**${children()}**`;

            case 'em':
            case 'i':
                return `*${children()}*`;

            case 's':
            case 'del':
                return `~~${children()}~~`;

            case 'code': {
                // Inline code (not inside <pre>)
                if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
                    return children();
                }
                return formatInlineCode(children());
            }

            case 'pre': {
                const codeEl = node.querySelector('code');
                const lang = codeEl
                    ? ([...codeEl.classList].find(c => c.startsWith('language-')) || '').replace('language-', '')
                    : '';
                const text = (codeEl || node).textContent;
                return `\n\`\`\`${lang}\n${text.replace(/\n$/, '')}\n\`\`\`\n\n`;
            }

            case 'blockquote':
                return '\n' + children().trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';

            case 'ul':
                return '\n' + convertList(node, false) + '\n';

            case 'ol':
                return '\n' + convertList(node, true) + '\n';

            case 'li':
                return children();

            case 'table':
                return '\n' + convertTable(node) + '\n';

            case 'a': {
                const href = node.getAttribute('href') || '';
                return `[${children().replace(/\]/g, '\\]')}](${href.replace(/\)/g, '%29')})`;
            }

            case 'img': {
                const alt = node.getAttribute('alt') || '';
                const src = node.getAttribute('src') || '';
                return `![${alt}](${src})`;
            }

            case 'br':
                return '\n';

            case 'hr':
                return '\n---\n\n';

            default:
                return children();
        }
    }

    function isMathNode(node) {
        return node.classList?.contains('math-node') ||
            node.tagName.toLowerCase() === 'math-inline' ||
            node.tagName.toLowerCase() === 'math-block';
    }

    function convertMath(node) {
        const math = getMathSource(node);
        const tag = node.tagName.toLowerCase();
        const isBlock = tag === 'math-block' || node.classList.contains('math-block');
        if (isBlock) {
            return `\n$$\n${math}\n$$\n\n`;
        }
        return `$${math}$`;
    }

    function getMathSource(node) {
        const source = node.getAttribute('data-math') ||
            node.getAttribute('aria-label') ||
            node.querySelector('.math-src')?.textContent ||
            node.textContent;
        return source.trim();
    }

    function formatInlineCode(text) {
        const longestRun = Math.max(0, ...[...text.matchAll(/`+/g)].map(match => match[0].length));
        const fence = '`'.repeat(longestRun + 1);
        const needsPadding = text.startsWith('`') || text.endsWith('`');
        const content = needsPadding ? ` ${text} ` : text;
        return `${fence}${content}${fence}`;
    }

    function convertChildren(node) {
        let result = '';
        for (const child of node.childNodes) {
            result += convertNode(child);
        }
        return result;
    }

    function convertList(ul, ordered, depth = 0) {
        const indent = '  '.repeat(depth);
        let lines = [];
        let idx = 1;
        for (const li of ul.children) {
            if (li.tagName.toLowerCase() !== 'li') continue;
            const marker = ordered ? `${idx++}.` : '-';
            let parts = [];
            for (const child of li.childNodes) {
                const childTag = child.tagName ? child.tagName.toLowerCase() : '';
                if (childTag === 'ul') {
                    parts.push('\n' + convertList(child, false, depth + 1));
                } else if (childTag === 'ol') {
                    parts.push('\n' + convertList(child, true, depth + 1));
                } else {
                    parts.push(convertNode(child).replace(/\n+$/, ''));
                }
            }
            const text = parts.join('').replace(/^\n+/, '');
            lines.push(`${indent}${marker} ${text}`);
        }
        return lines.join('\n');
    }

    function convertTable(table) {
        const rows = [...table.querySelectorAll('tr')];
        if (rows.length === 0) return '';

        const matrix = rows.map(row =>
            [...row.querySelectorAll('th, td')].map(cell =>
                escapeTableCell(convertChildren(cell).trim())
            )
        );

        // Column widths
        const cols = Math.max(...matrix.map(r => r.length));
        const widths = Array(cols).fill(3);
        for (const row of matrix) {
            for (let i = 0; i < row.length; i++) {
                widths[i] = Math.max(widths[i], row[i].length);
            }
        }

        const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
        const formatRow = row => '| ' + widths.map((w, i) => pad(row[i] || '', w)).join(' | ') + ' |';

        let out = formatRow(matrix[0]) + '\n';
        out += '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |\n';
        for (let i = 1; i < matrix.length; i++) {
            out += formatRow(matrix[i]) + '\n';
        }
        return out;
    }

    function escapeTableCell(text) {
        return text
            .replace(/\s*\n+\s*/g, '<br>')
            .replace(/\|/g, '\\|');
    }

    // ── Button injection ───────────────────────────────────────────────

    function createCopyButton() {
        log('Creating copy button element');
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.setAttribute('aria-label', 'Copy as Markdown');
        btn.className = 'tm-copy-markdown-button';
        btn.title = 'Copy as Markdown';
        Object.assign(btn.style, {
            appearance: 'none',
            WebkitAppearance: 'none',
            border: '1px solid rgba(127, 127, 127, 0.35)',
            background: 'rgba(127, 127, 127, 0.10)',
            color: 'inherit',
            minWidth: '144px',
            height: '40px',
            padding: '0 14px',
            margin: '0 8px 0 0',
            borderRadius: '9999px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            cursor: 'pointer',
            font: '500 14px/1 Arial, sans-serif',
            lineHeight: '1',
            flex: '0 0 auto',
            position: 'relative',
            zIndex: '1',
            boxSizing: 'border-box',
        });

        const badge = document.createElement('span');
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = 'MD';
        Object.assign(badge.style, {
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '22px',
            height: '22px',
            borderRadius: '9999px',
            border: '1px solid currentColor',
            fontSize: '10px',
            fontWeight: '700',
            letterSpacing: '0.04em',
        });

        const label = document.createElement('span');
        label.textContent = 'Copy as Markdown';

        btn.append(badge, label);

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(127, 127, 127, 0.12)';
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'transparent';
        });

        btn.addEventListener('click', () => {
            log('Copy button clicked');
            const editor = findCanvasEditor();
            if (!editor) {
                log('Canvas editor not found when button was clicked');
                showTooltip(btn, 'No canvas content found');
                return;
            }
            const md = htmlToMarkdown(editor);
            log('Canvas editor found; markdown length:', md.length);
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(md, 'text');
            } else {
                navigator.clipboard.writeText(md).catch(() => {});
            }
            showTooltip(btn, 'Copied!');
        });

        return btn;
    }

    function findCanvasToolbar() {
        const toolbar = document.querySelector(
            'toolbar.extended-response-toolbar, .extended-response-toolbar, immersive-panel toolbar'
        );
        log('findCanvasToolbar()', toolbar ? 'found' : 'not found');
        return toolbar;
    }

    function findCanvasEditor() {
        const editor = document.querySelector(
            '#extended-response-markdown-content .ProseMirror, .immersive-editor .ProseMirror'
        );
        log('findCanvasEditor()', editor ? 'found' : 'not found');
        return editor;
    }

    function showTooltip(anchor, text) {
        const tip = document.createElement('div');
        tip.textContent = text;
        Object.assign(tip.style, {
            position: 'fixed',
            background: '#333',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: '999999',
            pointerEvents: 'none',
            transition: 'opacity 0.3s',
        });
        document.body.appendChild(tip);
        const rect = anchor.getBoundingClientRect();
        tip.style.top = `${rect.bottom + 6}px`;
        tip.style.left = `${rect.left + rect.width / 2 - tip.offsetWidth / 2}px`;
        setTimeout(() => { tip.style.opacity = '0'; }, 1200);
        setTimeout(() => tip.remove(), 1600);
    }

    // ── Observer: inject button when Canvas toolbar appears ────────────

    function tryInjectButton() {
        log('tryInjectButton() start');
        try {
            const toolbar = findCanvasToolbar();
            if (!toolbar) {
                log('No toolbar found; skipping button injection');
                return;
            }
            if (toolbar.querySelector(`#${BUTTON_ID}`)) {
                log('Button already present in toolbar; skipping');
                return;
            }

            log('Toolbar found', toolbar);

            const actions = toolbar.querySelector('.action-buttons');
            if (!actions) {
                log('Toolbar found but .action-buttons is missing', toolbar);
                return;
            }

            log('Toolbar actions container found', actions);
            log('Current action children:', [...actions.children].map((el) => ({
                tag: el.tagName,
                className: el.className,
                testId: el.getAttribute('data-test-id'),
            })));

            const btn = createCopyButton();
            const firstAction = actions.querySelector('print-button, share-button, canvas-create-button, [data-test-id="close-button"]');

            log('First existing toolbar action', firstAction || 'none');

            if (firstAction) {
                const insertionTarget = firstAction.closest('print-button, share-button, canvas-create-button, button') || firstAction;
                log('Insertion target resolved to', insertionTarget, 'parent is', insertionTarget?.parentNode);
                try {
                    actions.insertBefore(btn, insertionTarget);
                    log('Inserted button before first action', insertionTarget);
                } catch (error) {
                    log('insertBefore failed; falling back to prepend', error);
                    actions.prepend(btn);
                    log('Fallback prepend completed');
                }
            } else {
                actions.prepend(btn);
                log('Prepended button to toolbar actions');
            }

            requestAnimationFrame(() => {
                const buttonInDom = document.getElementById(BUTTON_ID);
                log('Post-insert check:', {
                    present: !!buttonInDom,
                    parentTag: buttonInDom?.parentElement?.tagName,
                    parentClass: buttonInDom?.parentElement?.className,
                    rect: buttonInDom?.getBoundingClientRect(),
                    computedDisplay: buttonInDom ? getComputedStyle(buttonInDom).display : null,
                    computedVisibility: buttonInDom ? getComputedStyle(buttonInDom).visibility : null,
                    computedOpacity: buttonInDom ? getComputedStyle(buttonInDom).opacity : null,
                });
            });
        } catch (error) {
            log('tryInjectButton() failed', error);
        }
    }

    // Watch for DOM changes (Canvas is loaded dynamically)
    const observer = new MutationObserver((mutations) => {
        log('MutationObserver fired', {
            count: mutations.length,
            readyState: document.readyState,
        });
        tryInjectButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    log('MutationObserver attached');

    // Also try immediately in case already loaded
    log('Running initial injection attempt');
    tryInjectButton();
})();
