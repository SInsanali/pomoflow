// A small DOM shim: enough to import a src/ui page module in node and drive it.
// Headless Chrome does not complete in this project's environment, so this is
// how page wiring gets tested at all.
//
// It computes no layout — heights are whatever the test feeds it. That makes it
// the right tool for "does popup.js do the right arithmetic with the heights it
// is given" and the wrong tool for "is the sheet the right height". The second
// question needs a real browser.

function makeStyle() {
    const style = {};
    style.setProperty = (k, v) => { style[k] = v; };
    style.removeProperty = (k) => { delete style[k]; };
    style.getPropertyValue = (k) => style[k] ?? '';
    return style;
}

export class El {
    constructor(tag = 'div') {
        this.tagName = String(tag).toUpperCase();
        this.children = [];
        this.parentNode = null;
        this.previousElementSibling = null;
        this.nextElementSibling = null;
        this._text = '';
        this._classes = new Set();
        this._listeners = new Map();
        this._attrs = new Map();
        this.style = makeStyle();
        this.dataset = {};
        this.hidden = false;
        this.options = [];
        this.selectedIndex = 0;
        this.checked = false;
        this.value = '';
        this.title = '';
        this.type = '';
        // Layout the harness controls.
        this._scrollHeight = 0;
        this._clientHeight = 0;
        this._offsetHeight = 0;

        const self = this;
        this.classList = {
            add: (...c) => c.forEach(x => self._classes.add(x)),
            remove: (...c) => c.forEach(x => self._classes.delete(x)),
            contains: (c) => self._classes.has(c),
            toggle: (c, on) => {
                const want = on === undefined ? !self._classes.has(c) : !!on;
                if (want) self._classes.add(c); else self._classes.delete(c);
            },
        };
    }

    get className() { return [...this._classes].join(' '); }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }

    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); }

    get scrollHeight() { return this._scrollHeight; }
    set scrollHeight(v) { this._scrollHeight = v; }
    get clientHeight() { return this._clientHeight; }
    set clientHeight(v) { this._clientHeight = v; }
    get offsetHeight() { return this._offsetHeight; }
    set offsetHeight(v) { this._offsetHeight = v; }

    // Crude, deliberately: the only innerHTML in play is font-picker.js's
    // toggle markup, and all the code after it wants is to find the node by
    // class and set its text and font-family.
    set innerHTML(html) {
        this.children = [];
        for (const m of String(html).matchAll(/<(\w+)[^>]*class="([^"]+)"/g)) {
            const child = new El(m[1]);
            child.className = m[2];
            this.append(child);
        }
    }
    get innerHTML() { return ''; }

    setAttribute(k, v) { this._attrs.set(k, String(v)); }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }

    append(...nodes) { nodes.forEach(n => this.appendChild(n)); }
    appendChild(node) {
        node.parentNode = this;
        const prev = this.children[this.children.length - 1] || null;
        if (prev) { prev.nextElementSibling = node; node.previousElementSibling = prev; }
        this.children.push(node);
        return node;
    }

    // select.before(picker) — the sibling link is what syncFontFace navigates.
    before(node) {
        const parent = this.parentNode || new El('div');
        const at = parent.children.indexOf(this);
        parent.children.splice(at < 0 ? 0 : at, 0, node);
        node.parentNode = parent;
        node.nextElementSibling = this;
        this.previousElementSibling = node;
    }

    _matches(sel) {
        if (sel.startsWith('.')) return this._classes.has(sel.slice(1));
        if (sel.startsWith('#')) return this.getAttribute('id') === sel.slice(1) || this.id === sel.slice(1);
        return this.tagName === sel.toUpperCase();
    }

    _walk(out = []) {
        for (const c of this.children) { out.push(c); c._walk(out); }
        return out;
    }

    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
        if (sel.includes(' ') || sel.includes(',')) return [];   // none of the compound ones matter here
        return this._walk().filter(n => n._matches(sel));
    }

    addEventListener(type, fn) {
        if (!this._listeners.has(type)) this._listeners.set(type, []);
        this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
        const list = this._listeners.get(type) || [];
        const at = list.indexOf(fn);
        if (at >= 0) list.splice(at, 1);
    }
    dispatchEvent(event) {
        event.target = event.target || this;
        for (const fn of this._listeners.get(event.type) || []) fn(event);
        // Bubble to the root so document-level handlers see it.
        if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
        return true;
    }
    click() { this.dispatchEvent({ type: 'click', target: this, closest: () => null }); }
    focus() { globalThis.document.activeElement = this; }
}

// A FontFaceSet whose `ready` the harness resolves on demand, so the webfont
// swap-in can be replayed as the two-stage event it actually is.
class Fonts {
    constructor() { this._arm(); }
    _arm() { this._ready = new Promise(res => { this._resolve = res; }); }
    get ready() { return this._ready; }
    load() { return Promise.resolve([]); }
    land() { const done = this._resolve; this._arm(); done(); return new Promise(r => setTimeout(r, 0)); }
}

export function installDom({ ids = [] } = {}) {
    const registry = new Map();
    const doc = new El('body');
    doc.className = 'popup';

    const document = {
        documentElement: new El('html'),
        body: doc,
        title: '',
        activeElement: null,
        // A real document always has one, and surface.js gates the end-of-block
        // acknowledgment on it. Tests flip it to 'hidden' to stand in for a
        // pop-out parked behind other windows.
        visibilityState: 'visible',
        fonts: new Fonts(),
        createElement: (tag) => new El(tag),
        getElementById: (id) => {
            if (!registry.has(id)) {
                const node = new El('div');
                node.id = id;
                node.setAttribute('id', id);
                doc.appendChild(node);
                registry.set(id, node);
            }
            return registry.get(id);
        },
        querySelector: (sel) => doc.querySelector(sel),
        querySelectorAll: (sel) => doc.querySelectorAll(sel),
        addEventListener: (t, fn) => doc.addEventListener(t, fn),
        removeEventListener: (t, fn) => doc.removeEventListener(t, fn),
        dispatchEvent: (event) => doc.dispatchEvent(event),
    };

    for (const id of ids) document.getElementById(id);

    globalThis.document = document;
    // window carries real listener plumbing rather than a no-op, because a
    // surface acknowledges the end-of-block "!" on regaining focus and that has
    // to be replayable.
    const windowEl = new El('window');
    globalThis.window = {
        innerHeight: 600,
        innerWidth: 340,
        addEventListener: (t, fn) => windowEl.addEventListener(t, fn),
        removeEventListener: (t, fn) => windowEl.removeEventListener(t, fn),
        dispatchEvent: (event) => windowEl.dispatchEvent(event),
        close: () => {},
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
    };
    globalThis.requestAnimationFrame = () => 0;
    globalThis.cancelAnimationFrame = () => {};
    globalThis.Event = class Event {
        constructor(type, opts = {}) { this.type = type; this.bubbles = !!opts.bubbles; }
        preventDefault() {}
    };
    globalThis.getComputedStyle = globalThis.window.getComputedStyle;

    return { document, registry, El };
}
