// The 4 end-of-block sounds, ported from v1 (web/js/timer.js). They are
// synthesized with Web Audio — there are no audio files to bundle.
//
// The only change from v1 is that each synth now takes its AudioContext as an
// argument instead of closing over a module-level one. In MV3 the sound plays
// from an offscreen document (service workers have no AudioContext), which is
// created and torn down repeatedly, so the context cannot be a singleton here.

// Sine chord: C5, E5, G5, arpeggiated.
function playChime(ctx, now, volume) {
    [523.25, 659.25, 783.99].forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = freq;

        gainNode.gain.setValueAtTime(0, now + i * 0.1);
        gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + i * 0.1 + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.8);

        oscillator.start(now + i * 0.1);
        oscillator.stop(now + i * 0.1 + 0.8);
    });
}

// 3 short square-wave beeps at 880Hz: 0.1s on, 0.1s off.
function playDigital(ctx, now, volume) {
    for (let i = 0; i < 3; i++) {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'square';
        oscillator.frequency.value = 880;

        const startTime = now + i * 0.2;
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.2, startTime + 0.01);
        gainNode.gain.setValueAtTime(volume * 0.2, startTime + 0.09);
        gainNode.gain.linearRampToValueAtTime(0, startTime + 0.1);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.1);
    }
}

// Deep resonant gong: A2 (110Hz) with harmonics at 220Hz and 330Hz.
function playGong(ctx, now, volume) {
    const gains = [1, 0.5, 0.25];
    [110, 220, 330].forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = freq;

        const peakGain = volume * 0.4 * gains[i];
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(peakGain, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 2);

        oscillator.start(now);
        oscillator.stop(now + 2);
    });
}

// Ascending C5, E5, G5, C6 — 0.15s notes at 0.12s spacing, so they overlap.
function playMelody(ctx, now, volume) {
    [523, 659, 784, 1047].forEach((freq, i) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = freq;

        const startTime = now + i * 0.12;
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.02);
        gainNode.gain.setValueAtTime(volume * 0.3, startTime + 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.15);
    });
}

export const SOUNDS = {
    chime: playChime,
    digital: playDigital,
    gong: playGong,
    melody: playMelody,
};

// How long each sound needs before its context can be torn down. The offscreen
// document uses this to know when it is safe to close.
export const SOUND_DURATION_MS = {
    chime: 1100,
    digital: 700,
    gong: 2100,
    melody: 700,
};

export function playSound(ctx, name, volume) {
    if (!volume) return 0;
    const synth = SOUNDS[name] || SOUNDS.chime;
    synth(ctx, ctx.currentTime, volume);
    return SOUND_DURATION_MS[name] || SOUND_DURATION_MS.chime;
}
