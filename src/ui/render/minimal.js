import { formatTime } from '../../core/clock.js';

// The plain MM:SS readout. Each renderer is a factory over its own DOM subtree
// and exposes the same { render, reset } pair, so the surface can swap clock
// styles without knowing anything about them.
export function createMinimal(el) {
    return {
        render(ms) {
            el.textContent = formatTime(Math.ceil(ms / 1000));
        },
        reset() {},
    };
}
