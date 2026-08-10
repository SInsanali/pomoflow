// The timer-font picker.
//
// Eight names rendered in one typeface tell you nothing — you cannot choose
// Raleway over Montserrat by reading the words. Styling <option> does not fix
// it: Chrome draws the native select menu in its own font on macOS and ignores
// font-family there, which is exactly what this replaces.
//
// So the <select> stays in the DOM as the source of truth (hidden), and a list
// we own is drawn over it. Changing the list writes back to the select and
// fires its 'change' event, so every existing listener keeps working untouched.

import { FONT_STACKS } from '../core/defaults.js';

let requested = false;

// The @font-face rules only fetch when something renders in them, so the first
// open would otherwise paint the list in the fallback face and reflow once the
// files land. Ask for all eight up front — they are local, and the weight has
// to match the declarations (500) or the request resolves against nothing.
function preloadFaces() {
    if (requested || !document.fonts) return;
    requested = true;
    for (const stack of Object.values(FONT_STACKS)) {
        document.fonts.load(`500 14px ${stack}`).catch(() => {});
    }
}

function stackFor(value) {
    return FONT_STACKS[value] || FONT_STACKS.system;
}

// Keeps the button label in the chosen face. Separate because loading a form
// sets select.value programmatically, which fires no event.
export function syncFontFace(select) {
    const picker = select.previousElementSibling;
    if (!picker || !picker.classList.contains('font-picker')) return;

    const option = select.options[select.selectedIndex];
    const label = picker.querySelector('.font-picker-value');
    label.textContent = option ? option.textContent : '';
    label.style.fontFamily = stackFor(select.value);

    for (const item of picker.querySelectorAll('.font-picker-option')) {
        const chosen = item.dataset.value === select.value;
        item.classList.toggle('selected', chosen);
        item.setAttribute('aria-selected', String(chosen));
    }
}

export function showFontFaces(select) {
    preloadFaces();
    if (select.previousElementSibling?.classList.contains('font-picker')) return;

    const picker = document.createElement('div');
    picker.className = 'font-picker';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'font-picker-toggle';
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="font-picker-value"></span>'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
        + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="m6 9 6 6 6-6"/></svg>';

    const list = document.createElement('div');
    list.className = 'font-picker-list';
    list.setAttribute('role', 'listbox');
    list.hidden = true;

    for (const option of select.options) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'font-picker-option';
        item.setAttribute('role', 'option');
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        // The whole point: every row wears the face it names.
        item.style.fontFamily = stackFor(option.value);
        list.append(item);
    }

    picker.append(toggle, list);
    select.before(picker);
    select.hidden = true;

    // Whatever box would clip the list: the nearest scrolling ancestor (the
    // popup's .qs-body, the full page's .modal-body) or the viewport.
    function clipBounds() {
        for (let node = picker.parentElement; node; node = node.parentElement) {
            const overflowY = getComputedStyle(node).overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') {
                return node.getBoundingClientRect();
            }
        }
        return { top: 0, bottom: window.innerHeight };
    }

    // Both surfaces put this control inside a scroll box, and in the full page
    // it sits at the very top of one — so a list long enough to pass the bottom
    // edge would simply be cut off. Flip it above the button when that side has
    // more room, and cap the height to whichever side it lands on.
    const GAP = 14;
    function place() {
        list.classList.remove('up');
        list.style.maxHeight = '';

        const bounds = clipBounds();
        const rect = toggle.getBoundingClientRect();
        const below = bounds.bottom - rect.bottom - GAP;
        const above = rect.top - bounds.top - GAP;
        if (list.scrollHeight <= below) return;

        const flip = above > below;
        list.classList.toggle('up', flip);
        list.style.maxHeight = `${Math.max(120, flip ? above : below)}px`;
    }

    function open(isOpen) {
        list.hidden = !isOpen;
        toggle.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen) return;
        place();   // after unhiding: a hidden element has no measurable height
        (list.querySelector('.selected') || list.firstElementChild)?.focus();
    }

    function choose(value) {
        select.value = value;
        syncFontFace(select);
        // Bubbles, so the surfaces' own change handlers persist it as before.
        select.dispatchEvent(new Event('change', { bubbles: true }));
        open(false);
        toggle.focus();
    }

    toggle.addEventListener('click', () => open(list.hidden));
    list.addEventListener('click', (e) => {
        const item = e.target.closest('.font-picker-option');
        if (item) choose(item.dataset.value);
    });

    // Roving focus, so the list is usable without a mouse now that the native
    // control's keyboard behaviour is gone.
    list.addEventListener('keydown', (e) => {
        const items = [...list.querySelectorAll('.font-picker-option')];
        const at = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            items[(at + step + items.length) % items.length].focus();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            open(false);
            toggle.focus();
        }
    });

    // Pointerdown, not click: a click listener would fire after the toggle's
    // own handler had already reopened the list.
    document.addEventListener('pointerdown', (e) => {
        if (!list.hidden && !picker.contains(e.target)) open(false);
    });

    syncFontFace(select);
}
