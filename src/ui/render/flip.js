// The flip clock, ported from v1 (web/js/timer.js updateFlipClock / flipDigit).
// The CSS animation and its timings are unchanged; only the state tracking is
// now per-instance instead of module-global, so the popup and the pop-out
// window can each run their own without fighting over shared timeouts.

// Keyframe checkpoints, matched to the .flipping animation in app.css.
const HALFWAY_MS = 150;   // top-flip has passed 90deg — swap the static top
const LANDED_MS = 400;    // bottom-flip lands — swap the static bottom
const CLEANUP_MS = 450;   // animation over — drop the class, settle both faces

export function createFlip(root) {
    const cards = () => root.querySelectorAll('.flip-card');
    let prevDigits = ['', '', '', ''];
    let timeouts = [];

    function setCardValue(card, digit) {
        card.querySelector('.top span').textContent = digit;
        card.querySelector('.bottom span').textContent = digit;
        card.querySelector('.top-flip span').textContent = digit;
        card.querySelector('.bottom-flip span').textContent = digit;
    }

    function flipDigit(card, oldDigit, newDigit) {
        // Before the animation starts everything shows OLD, except bottom-flip,
        // which holds NEW at 90deg waiting to fall into place.
        card.querySelector('.top span').textContent = oldDigit;
        card.querySelector('.bottom span').textContent = oldDigit;
        card.querySelector('.top-flip span').textContent = oldDigit;
        card.querySelector('.bottom-flip span').textContent = newDigit;

        card.classList.remove('flipping');
        void card.offsetWidth; // force reflow so the animation restarts
        card.classList.add('flipping');

        timeouts.push(setTimeout(() => {
            card.querySelector('.top span').textContent = newDigit;
        }, HALFWAY_MS));
        timeouts.push(setTimeout(() => {
            card.querySelector('.bottom span').textContent = newDigit;
        }, LANDED_MS));
        timeouts.push(setTimeout(() => {
            card.classList.remove('flipping');
            card.querySelector('.top-flip span').textContent = newDigit;
        }, CLEANUP_MS));
    }

    function reset() {
        timeouts.forEach(clearTimeout);
        timeouts = [];
        root.querySelectorAll('.flip-card').forEach(c => c.classList.remove('flipping'));
        prevDigits = ['', '', '', ''];
    }

    return {
        render(ms) {
            const total = Math.ceil(ms / 1000);
            const mins = String(Math.floor(total / 60)).padStart(2, '0');
            const secs = String(total % 60).padStart(2, '0');
            const next = [mins[0], mins[1], secs[0], secs[1]];
            const all = cards();

            next.forEach((digit, i) => {
                const card = all[i];
                if (!card) return;
                const old = prevDigits[i];
                if (old === '') {
                    setCardValue(card, digit);      // first paint: no animation
                } else if (old !== digit) {
                    flipDigit(card, old, digit);
                }
            });

            prevDigits = next;
        },
        reset,
    };
}
