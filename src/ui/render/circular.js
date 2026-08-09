import { formatTime } from '../../core/clock.js';

// Matches the SVG in the markup: r=45, so 2 * PI * 45.
const CIRCUMFERENCE = 283;

// The progress ring. It is fed fractional milliseconds rather than whole
// seconds, so the sweep stays smooth instead of stepping once a second — v1
// needed a separate requestAnimationFrame loop for this, but deriving the
// fraction straight from the deadline gets it for free.
export function createCircular(root) {
    const text = root.querySelector('.timer-text');
    const ring = root.querySelector('.ring-progress');

    return {
        render(ms, plannedMs) {
            text.textContent = formatTime(Math.ceil(ms / 1000));
            const fraction = plannedMs > 0 ? Math.max(0, Math.min(1, ms / plannedMs)) : 0;
            ring.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - fraction)));
        },
        reset() {
            ring.setAttribute('stroke-dashoffset', '0');
        },
    };
}
