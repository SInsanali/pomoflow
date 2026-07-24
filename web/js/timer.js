        import { reconcile } from '/js/resume.js';
        import { api } from '/js/api.js';

        // ===== STATE =====
        const state = {
            mode: 'pomodoro',
            timeRemaining: 25 * 60,
            isRunning: false,
            pomodorosInCycle: 0,  // 0-3, resets after long break
            totalPomodoros: 0,
            timerId: null,
            animationId: null,
            startTime: null,
            startTimeRemaining: null,
            sessionGoal: 4,  // default target
            currentBlockId: null
        };

        const settings = {
            pomodoroDuration: 25,
            shortBreakDuration: 5,
            longBreakDuration: 15,
            autoStartBreaks: true,
            autoStartPomodoros: false,
            volume: 0.5,
            sound: 'chime',
            theme: 'mono',
            recentThemes: ['mono', 'dusk', 'ocean', 'glacier'],
            timerStyle: 'flip',
            timerFont: 'system',
            colorBackground: true,
            hideBgWhenRunning: false,
            notifications: true
        };


        // Theme definitions (17 built-in themes)
        const themes = {
            mono: {
                pomodoro: '#e0e0e0',
                shortBreak: '#9e9e9e',
                longBreak: '#757575'
            },
            warm: {
                pomodoro: '#ff7043',
                shortBreak: '#ffb74d',
                longBreak: '#fff176'
            },
            violet: {
                pomodoro: '#ba68c8',
                shortBreak: '#9575cd',
                longBreak: '#7986cb'
            },
            forest: {
                pomodoro: '#66bb6a',
                shortBreak: '#a5d6a7',
                longBreak: '#8d6e63'
            },
            ocean: {
                pomodoro: '#26c6da',
                shortBreak: '#29b6f6',
                longBreak: '#5c6bc0'
            },
            cyberpunk: {
                pomodoro: '#39ff14',
                shortBreak: '#00ffff',
                longBreak: '#ff00ff'
            },
            berry: {
                pomodoro: '#ff4d6d',
                shortBreak: '#6c63ff',
                longBreak: '#2d1b69'
            },
            coffee: {
                pomodoro: '#d7ccc8',
                shortBreak: '#a1887f',
                longBreak: '#6d4c41'
            },
            cherry: {
                pomodoro: '#ff1744',
                shortBreak: '#ff8a80',
                longBreak: '#e91e63'
            },
            mint: {
                pomodoro: '#1de9b6',
                shortBreak: '#64ffda',
                longBreak: '#00bfa5'
            },
            dusk: {
                pomodoro: '#e86a2c',
                shortBreak: '#4a90d9',
                longBreak: '#f5a167'
            },
            terracotta: {
                pomodoro: '#c62828',
                shortBreak: '#ff7043',
                longBreak: '#ffccbc'
            },
            glacier: {
                pomodoro: '#1565c0',
                shortBreak: '#00acc1',
                longBreak: '#4fc3f7'
            },
            nebula: {
                pomodoro: '#8e24aa',
                shortBreak: '#e91e63',
                longBreak: '#b0bec5'
            },
            jade: {
                pomodoro: '#00897b',
                shortBreak: '#4db6ac',
                longBreak: '#b2dfdb'
            },
            honey: {
                pomodoro: '#f9a825',
                shortBreak: '#ffca28',
                longBreak: '#d4a017'
            },
            blossom: {
                pomodoro: '#d81b60',
                shortBreak: '#f48fb1',
                longBreak: '#c2185b'
            }
        };

        // Custom themes (user-created)
        let customThemes = {};

        // ===== THEME FUNCTIONS =====
        function applyTheme(themeName) {
            let theme = customThemes[themeName] || themes[themeName];
            // Fallback to mono if theme is invalid
            if (!isValidTheme(theme)) {
                theme = themes.mono;
            }
            const root = document.documentElement;

            root.style.setProperty('--pomodoro-accent', theme.pomodoro);
            root.style.setProperty('--short-break-accent', theme.shortBreak);
            root.style.setProperty('--long-break-accent', theme.longBreak);

            updateAccentForMode();
        }

        function updateAccentForMode() {
            const root = document.documentElement;
            const style = getComputedStyle(root);
            const body = document.body;

            let cssVar = '--pomodoro-accent';
            if (body.classList.contains('short-break')) {
                cssVar = '--short-break-accent';
            } else if (body.classList.contains('long-break')) {
                cssVar = '--long-break-accent';
            }

            root.style.setProperty('--accent', style.getPropertyValue(cssVar).trim());
        }

        // ===== CUSTOM THEME FUNCTIONS =====
        function isValidColor(color) {
            return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
        }

        function isValidTheme(theme) {
            return theme && isValidColor(theme.pomodoro) && isValidColor(theme.shortBreak) && isValidColor(theme.longBreak);
        }

        function loadCustomThemes() {
            const saved = localStorage.getItem('pomodoro-custom-themes');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // Only load valid themes
                    Object.keys(parsed).forEach(id => {
                        if (isValidTheme(parsed[id])) {
                            customThemes[id] = parsed[id];
                        }
                    });
                } catch (e) {
                    console.error('Failed to load custom themes:', e);
                    customThemes = {};
                }
            }
        }

        function saveCustomThemes() {
            localStorage.setItem('pomodoro-custom-themes', JSON.stringify(customThemes));
        }

        function generateCustomThemeGrid() {
            const grid = document.getElementById('custom-theme-grid');
            if (!grid) return;
            grid.innerHTML = '';

            Object.keys(customThemes).forEach(themeId => {
                const theme = customThemes[themeId];
                if (!isValidTheme(theme)) return; // Skip invalid themes
                const swatch = document.createElement('div');
                swatch.className = 'theme-swatch custom' + (settings.theme === themeId ? ' active' : '');
                swatch.dataset.theme = themeId;

                swatch.innerHTML = `
                    <div class="swatch-colors">
                        <div class="swatch-color" style="background: ${theme.pomodoro}"></div>
                        <div class="swatch-color" style="background: ${theme.shortBreak}"></div>
                        <div class="swatch-color" style="background: ${theme.longBreak}"></div>
                    </div>
                    <div class="swatch-name">${theme.name || themeId}</div>
                    <button class="swatch-edit" onclick="event.stopPropagation(); openThemeEditor('${themeId}')">✎</button>
                `;

                swatch.addEventListener('mouseenter', () => applyTheme(themeId));
                swatch.addEventListener('mouseleave', () => applyTheme(settings.theme));
                swatch.addEventListener('click', () => selectTheme(themeId));

                grid.appendChild(swatch);
            });

            // Add "Create" button
            const createBtn = document.createElement('div');
            createBtn.className = 'theme-swatch create-theme-btn';
            createBtn.innerHTML = `
                <div class="swatch-colors create-placeholder">
                    <span class="plus-icon">+</span>
                </div>
                <div class="swatch-name">Create</div>
            `;
            createBtn.addEventListener('click', () => openThemeEditor());
            grid.appendChild(createBtn);
        }

        function openThemeEditor(themeId = null) {
            const editor = document.getElementById('theme-editor');
            const title = document.getElementById('theme-editor-title');
            const deleteBtn = document.getElementById('delete-theme-btn');

            if (themeId && customThemes[themeId]) {
                title.textContent = 'Edit Theme';
                deleteBtn.style.display = 'block';
                editor.dataset.editingId = themeId;

                const theme = customThemes[themeId];
                document.getElementById('theme-name-input').value = theme.name || '';
                setColorInputs('pomodoro', theme.pomodoro);
                setColorInputs('short-break', theme.shortBreak);
                setColorInputs('long-break', theme.longBreak);
            } else {
                title.textContent = 'Create Theme';
                deleteBtn.style.display = 'none';
                editor.dataset.editingId = '';

                const currentTheme = customThemes[settings.theme] || themes[settings.theme] || themes.mono;
                document.getElementById('theme-name-input').value = '';
                setColorInputs('pomodoro', currentTheme.pomodoro);
                setColorInputs('short-break', currentTheme.shortBreak);
                setColorInputs('long-break', currentTheme.longBreak);
            }

            updateThemePreview();
            editor.classList.add('active');
        }

        function closeThemeEditor() {
            const editor = document.getElementById('theme-editor');
            editor.classList.remove('active');
            editor.dataset.editingId = '';
            applyTheme(settings.theme);
        }

        function setColorInputs(mode, color) {
            document.getElementById(`color-${mode}`).value = color;
            document.getElementById(`color-${mode}-hex`).value = color;
        }

        function getColorFromInputs(mode) {
            const hex = document.getElementById(`color-${mode}-hex`).value;
            if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
            return document.getElementById(`color-${mode}`).value;
        }

        function updateThemePreview() {
            const pomodoro = getColorFromInputs('pomodoro');
            const shortBreak = getColorFromInputs('short-break');
            const longBreak = getColorFromInputs('long-break');

            document.getElementById('preview-pomodoro').style.backgroundColor = pomodoro;
            document.getElementById('preview-short-break').style.backgroundColor = shortBreak;
            document.getElementById('preview-long-break').style.backgroundColor = longBreak;

            // Live preview on main timer
            const root = document.documentElement;
            root.style.setProperty('--pomodoro-accent', pomodoro);
            root.style.setProperty('--short-break-accent', shortBreak);
            root.style.setProperty('--long-break-accent', longBreak);
            updateAccentForMode();
        }

        function saveCustomTheme() {
            const editor = document.getElementById('theme-editor');
            const editingId = editor.dataset.editingId;
            const existingTheme = editingId && customThemes[editingId];

            const name = document.getElementById('theme-name-input').value.trim()
                || 'Custom ' + (Object.keys(customThemes).length + 1);

            const pomodoro = getColorFromInputs('pomodoro') || '#ff6b6b';
            const shortBreak = getColorFromInputs('short-break') || '#6bffb8';
            const longBreak = getColorFromInputs('long-break') || '#6bb3ff';

            const themeData = {
                name: name,
                pomodoro: pomodoro,
                shortBreak: shortBreak,
                longBreak: longBreak,
                createdAt: existingTheme ? existingTheme.createdAt : Date.now()
            };

            const themeId = editingId || ('custom-' + Date.now());
            customThemes[themeId] = themeData;
            settings.theme = themeId;
            updateRecentThemes(themeId);

            saveCustomThemes();
            saveSettings();
            closeThemeEditor();
            generateRecentThemes();
            generateThemeGrid();
            generateCustomThemeGrid();
        }

        function deleteCustomTheme() {
            const editor = document.getElementById('theme-editor');
            const editingId = editor.dataset.editingId;

            if (!editingId || !customThemes[editingId]) return;
            if (!confirm('Delete this custom theme?')) return;

            delete customThemes[editingId];

            // Remove from recent themes if present
            const recentIndex = settings.recentThemes.indexOf(editingId);
            if (recentIndex > -1) {
                settings.recentThemes.splice(recentIndex, 1);
            }

            if (settings.theme === editingId) {
                settings.theme = 'mono';
                applyTheme('mono');
            }

            saveCustomThemes();
            saveSettings();
            closeThemeEditor();
            generateRecentThemes();
            generateThemeGrid();
            generateCustomThemeGrid();
        }

        // ===== TIMER STYLE FUNCTIONS =====
        function updateTimerStyle() {
            const timerDisplay = document.getElementById('timer-display');
            const timerCircular = document.getElementById('timer-circular');
            const timerFlip = document.getElementById('timer-flip');

            // Hide all timer displays
            if (timerDisplay) timerDisplay.classList.add('hidden');
            if (timerCircular) timerCircular.classList.remove('active');
            if (timerFlip) timerFlip.classList.remove('active');

            // Show the selected timer style
            switch (settings.timerStyle) {
                case 'circular':
                    if (timerCircular) timerCircular.classList.add('active');
                    break;
                case 'flip':
                    if (timerFlip) timerFlip.classList.add('active');
                    break;
                default:
                    if (timerDisplay) timerDisplay.classList.remove('hidden');
            }
        }

        function updateTimerFont() {
            const fontMap = {
                'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                'inter': '"Inter", sans-serif',
                'poppins': '"Poppins", sans-serif',
                'montserrat': '"Montserrat", sans-serif',
                'raleway': '"Raleway", sans-serif',
                'jetbrains': '"JetBrains Mono", monospace',
                'space': '"Space Mono", monospace',
                'orbitron': '"Orbitron", sans-serif'
            };
            const font = fontMap[settings.timerFont] || fontMap['system'];
            document.documentElement.style.setProperty('--timer-font', font);
        }

        function updateColorBackground() {
            const showBg = settings.colorBackground && !(settings.hideBgWhenRunning && state.isRunning);
            document.body.classList.toggle('color-bg', showBg);
        }

        // ===== TIMER FUNCTIONS =====
        function getDuration(mode) {
            switch (mode) {
                case 'pomodoro': return settings.pomodoroDuration * 60;
                case 'shortBreak': return settings.shortBreakDuration * 60;
                case 'longBreak': return settings.longBreakDuration * 60;
                default: return 25 * 60;
            }
        }

        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }

        function updateDisplay() {
            const display = document.getElementById('timer-display');
            const timeStr = formatTime(state.timeRemaining);
            display.textContent = timeStr;

            // Update tab title
            const modeNames = {
                pomodoro: 'Pomodoro',
                shortBreak: 'Short Break',
                longBreak: 'Long Break'
            };
            document.title = `${timeStr} - ${modeNames[state.mode]}`;

            // Update favicon
            updateFavicon(timeStr);

            // Update circular timer display
            const circularText = document.getElementById('timer-text-circular');
            if (circularText) {
                circularText.textContent = timeStr;
            }

            // Update circular progress ring (only when not running, animation handles it otherwise)
            if (!state.isRunning) {
                updateRingProgress(state.timeRemaining);
            }

            // Update flip clock digits with animation
            updateFlipClock();
        }

        // Track previous flip clock values for animation
        let prevFlipDigits = ['', '', '', ''];
        let flipAnimationTimeouts = [];

        function updateFlipClock() {
            const mins = Math.floor(state.timeRemaining / 60);
            const secs = state.timeRemaining % 60;
            const minStr = mins.toString().padStart(2, '0');
            const secStr = secs.toString().padStart(2, '0');
            const newDigits = [minStr[0], minStr[1], secStr[0], secStr[1]];

            const allCards = document.querySelectorAll('.flip-card');

            newDigits.forEach((digit, index) => {
                const card = allCards[index];
                if (!card) return;

                const oldDigit = prevFlipDigits[index];

                if (oldDigit !== '' && oldDigit !== digit) {
                    // Digit changed - trigger flip animation
                    flipDigit(card, oldDigit, digit);
                } else if (oldDigit === '') {
                    // Initial load - just set the value
                    setFlipCardValue(card, digit);
                }
            });

            prevFlipDigits = newDigits;
        }

        function setFlipCardValue(card, digit) {
            card.querySelector('.top span').textContent = digit;
            card.querySelector('.bottom span').textContent = digit;
            card.querySelector('.top-flip span').textContent = digit;
            card.querySelector('.bottom-flip span').textContent = digit;
        }

        function clearFlipAnimations() {
            // Clear all pending animation timeouts
            flipAnimationTimeouts.forEach(id => clearTimeout(id));
            flipAnimationTimeouts = [];
            // Remove flipping class from all cards
            document.querySelectorAll('.flip-card').forEach(card => {
                card.classList.remove('flipping');
            });
        }

        function flipDigit(card, oldDigit, newDigit) {
            // Before animation starts - everything shows OLD
            // - static top: OLD (visible)
            // - static bottom: OLD (visible)
            // - top-flip: OLD (covers static top, will flip away to reveal NEW)
            // - bottom-flip: NEW (hidden at 90deg, will flip down to cover static bottom)

            card.querySelector('.top span').textContent = oldDigit;
            card.querySelector('.bottom span').textContent = oldDigit;
            card.querySelector('.top-flip span').textContent = oldDigit;
            card.querySelector('.bottom-flip span').textContent = newDigit;

            // Remove any existing animation class
            card.classList.remove('flipping');

            // Force reflow to restart animation
            void card.offsetWidth;

            // Start the flip
            card.classList.add('flipping');

            // Halfway through: update static top to new value (top-flip has flipped past 90deg)
            flipAnimationTimeouts.push(setTimeout(() => {
                card.querySelector('.top span').textContent = newDigit;
            }, 150));

            // When bottom-flip lands: update static bottom to new value
            flipAnimationTimeouts.push(setTimeout(() => {
                card.querySelector('.bottom span').textContent = newDigit;
            }, 400));

            // Clean up after animation completes
            flipAnimationTimeouts.push(setTimeout(() => {
                card.classList.remove('flipping');
                card.querySelector('.top-flip span').textContent = newDigit;
            }, 450));
        }

        function updateFavicon(timeStr) {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');

            // Background color based on mode and current theme
            let theme = customThemes[settings.theme] || themes[settings.theme];
            if (!isValidTheme(theme)) {
                theme = themes.mono;
            }
            const colors = {
                pomodoro: theme.pomodoro,
                shortBreak: theme.shortBreak,
                longBreak: theme.longBreak
            };

            ctx.fillStyle = colors[state.mode];
            ctx.beginPath();
            ctx.arc(16, 16, 16, 0, 2 * Math.PI);
            ctx.fill();

            // Text
            ctx.fillStyle = 'white';
            ctx.font = 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const mins = Math.floor(state.timeRemaining / 60);
            ctx.fillText(mins.toString(), 16, 16);

            // Update favicon
            const link = document.querySelector("link[rel='icon']");
            link.href = canvas.toDataURL();
        }

        function updateSessionCounter() {
            const counter = document.getElementById('session-counter');
            switch (state.mode) {
                case 'pomodoro':
                    counter.textContent = `Study ${state.pomodorosInCycle + 1}`;
                    break;
                case 'shortBreak':
                    counter.textContent = `Break ${state.pomodorosInCycle}`;
                    break;
                case 'longBreak':
                    counter.textContent = 'Long Break';
                    break;
            }
        }

        // ===== PERSISTENCE / RESUME / SESSION LOGGING =====
        const SNAP_KEY = 'pomoflow-snapshot';

        function saveSnapshot() {
            if (!state.currentBlockId) state.currentBlockId = crypto.randomUUID();
            const planned = getDuration(state.mode);
            // Effective anchor: the startTime that would reproduce the CURRENT
            // timeRemaining if the block had run continuously from it. This
            // keeps reconcile() correct across pause/resume cycles, not just
            // for a block that has run uninterrupted since it began.
            const effectiveStart = Date.now() - (planned - state.timeRemaining) * 1000;
            localStorage.setItem(SNAP_KEY, JSON.stringify({
                id: state.currentBlockId,
                mode: state.mode,
                startTime: effectiveStart,
                plannedSeconds: planned,
                isRunning: state.isRunning,
                timeRemaining: state.timeRemaining
            }));
        }

        function clearSnapshot() {
            localStorage.removeItem(SNAP_KEY);
            state.currentBlockId = null;
        }

        function logCurrentBlock(completed, actualSeconds) {
            const planned = getDuration(state.mode);
            const startedAtMs = Date.now() - (planned - state.timeRemaining) * 1000;
            const payload = {
                id: state.currentBlockId || crypto.randomUUID(),
                mode: state.mode,
                started_at: new Date(startedAtMs).toISOString(),
                ended_at: new Date().toISOString(),
                planned_seconds: planned,
                actual_seconds: actualSeconds,
                completed
            };
            // Capture the payload (incl. the outgoing block's id) and clear the
            // snapshot SYNCHRONOUSLY, before the network call. Callers
            // (onTimerComplete/skipTimer) invoke this and then immediately
            // call advanceToNextMode() -> switchMode(), whose own
            // clearSnapshot() must be a no-op by the time it runs, and must
            // never race ahead of (and wipe) a snapshot for a block that
            // switchMode/startTimer starts next. Keeping this clear
            // synchronous (rather than awaiting the fetch first) guarantees
            // that ordering regardless of network latency.
            clearSnapshot();
            return api.logSession(payload);
        }

        function restoreFromSnapshot() {
            let snap;
            try {
                snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
            } catch (e) {
                snap = null;
            }
            if (!snap) return;

            if (snap.isRunning) {
                const r = reconcile(snap, Date.now(), getDuration);
                if (r.action === 'resume') {
                    // switchMode() itself calls clearSnapshot(), which would
                    // wipe currentBlockId if we set it beforehand — so sync
                    // UI/tabs FIRST, then apply the restored id/remaining,
                    // then startTimer() (which re-saves the snapshot with
                    // the correct final state, overwriting switchMode's
                    // transient idle save).
                    switchMode(snap.mode);
                    state.currentBlockId = snap.id;
                    state.timeRemaining = r.remainingSeconds;
                    startTimer();
                    updateDisplay();
                } else if (r.action === 'complete') {
                    api.logSession(r.completedBlock);
                    clearSnapshot();
                    state.mode = snap.mode;
                    advanceToNextMode();
                } // 'fresh': do nothing
            } else {
                // Paused: do NOT advance by wall-clock time while disconnected.
                // Restore exactly as left, still paused, and keep the snapshot
                // so a further reload (without ever starting) still restores it.
                switchMode(snap.mode);
                state.currentBlockId = snap.id;
                state.timeRemaining = snap.timeRemaining;
                // switchMode() reset timeRemaining to the full duration and
                // saved that idle snapshot; re-save now to persist the
                // actual restored paused position (there's no startTimer()
                // call here to do this overwrite for us).
                saveSnapshot();
                updateDisplay();
            }
        }

        function switchMode(mode, autoStart = false) {
            // A manual/programmatic mode switch discards any in-flight block's
            // snapshot (a new block id will be minted on next start). Callers
            // that need to log the outgoing block (onTimerComplete, skipTimer)
            // MUST call logCurrentBlock()/clearSnapshot() BEFORE invoking
            // switchMode (directly or via advanceToNextMode), since this clear
            // is a no-op by the time it runs there.
            clearSnapshot();

            // Clear any existing timer
            if (state.timerId) {
                clearInterval(state.timerId);
                state.timerId = null;
            }

            state.mode = mode;
            state.timeRemaining = getDuration(mode);
            state.isRunning = false;

            // Clear any pending flip animations and reset tracking
            clearFlipAnimations();
            prevFlipDigits = ['', '', '', ''];

            // Update UI
            document.querySelectorAll('.mode-tab').forEach(tab => {
                tab.classList.toggle('active', tab.dataset.mode === mode);
            });

            // Update body class for colors (preserve color-bg class)
            document.body.classList.remove('short-break', 'long-break');
            if (mode !== 'pomodoro') {
                document.body.classList.add(mode.replace('B', '-b'));
            }

            // Update theme accent for current mode
            updateAccentForMode();

            updateDisplay();
            updateStartButton();
            updateSessionCounter();

            // Persist the (idle, not-yet-started) state for this mode so a
            // reload before pressing Start still restores the right mode/
            // duration. If autoStart kicks in below, startTimer() saves
            // again immediately after with the running state, superseding
            // this.
            saveSnapshot();

            // Auto-start if enabled
            if (autoStart) {
                const shouldAutoStart = mode === 'pomodoro'
                    ? settings.autoStartPomodoros
                    : settings.autoStartBreaks;
                if (shouldAutoStart) {
                    startTimer();
                }
            }
        }

        function startTimer() {
            if (state.isRunning) return;

            // Clear any existing timer just in case
            if (state.timerId) {
                clearInterval(state.timerId);
            }
            if (state.animationId) {
                cancelAnimationFrame(state.animationId);
            }

            state.isRunning = true;
            state.startTime = Date.now();
            state.startTimeRemaining = state.timeRemaining;
            updateStartButton();
            updateColorBackground();

            // Smooth ring animation
            function animateRing() {
                if (!state.isRunning) return;

                const elapsed = (Date.now() - state.startTime) / 1000;
                const smoothTimeRemaining = Math.max(0, state.startTimeRemaining - elapsed);

                // Update ring smoothly
                updateRingProgress(smoothTimeRemaining);

                if (state.isRunning) {
                    state.animationId = requestAnimationFrame(animateRing);
                }
            }
            state.animationId = requestAnimationFrame(animateRing);

            // 1-second interval for text display and completion check
            state.timerId = setInterval(() => {
                state.timeRemaining--;
                updateDisplay();

                if (state.timeRemaining <= 0) {
                    onTimerComplete();
                }
            }, 1000);

            saveSnapshot();
        }

        function pauseTimer() {
            if (!state.isRunning) return;

            state.isRunning = false;
            clearInterval(state.timerId);
            if (state.animationId) {
                cancelAnimationFrame(state.animationId);
                state.animationId = null;
            }
            updateStartButton();
            updateColorBackground();
            saveSnapshot();
        }

        function updateRingProgress(timeRemaining) {
            const ringProgress = document.getElementById('ring-progress');
            if (ringProgress) {
                const totalDuration = getDuration(state.mode);
                const circumference = 283; // 2 * PI * 45
                const offset = circumference * (1 - timeRemaining / totalDuration);
                ringProgress.setAttribute('stroke-dashoffset', offset);
            }
        }

        function toggleTimer() {
            if (state.isRunning) {
                pauseTimer();
            } else {
                requestNotificationPermission();
                startTimer();
            }
        }

        function resetTimer() {
            pauseTimer();
            state.timeRemaining = getDuration(state.mode);
            // Clear any pending flip animations and reset tracking
            clearFlipAnimations();
            prevFlipDigits = ['', '', '', ''];
            updateDisplay();
            // pauseTimer() just saved a snapshot with the pre-reset
            // timeRemaining; re-save so localStorage matches the now-full
            // duration (otherwise a reload after Reset would restore the
            // stale paused position instead of the reset one).
            saveSnapshot();
        }

        function skipTimer() {
            // Compute before pauseTimer()/switchMode() touch state: a block
            // is "in progress" if it's currently running, or paused partway
            // through (elapsed > 0). A skip from a fresh/never-started timer
            // (elapsed === 0, not running) has nothing to log.
            const elapsed = getDuration(state.mode) - state.timeRemaining;
            const blockInProgress = state.isRunning || elapsed > 0;

            pauseTimer();

            if (blockInProgress) {
                // Log the partial block (completed=0) BEFORE advancing, for
                // the same reason as onTimerComplete: advanceToNextMode() ->
                // switchMode() clears the snapshot for the *next* block, and
                // must not race ahead of logging the outgoing one.
                logCurrentBlock(0, elapsed);
            }

            // If skipping a pomodoro, count it as completed
            if (state.mode === 'pomodoro') {
                state.pomodorosInCycle++;
                state.totalPomodoros++;
                updateSessionCounter();
                updateSessionCount();
                updateGoalDisplay();
                saveState();
            }

            advanceToNextMode();
        }

        function updateStartButton() {
            const btn = document.getElementById('start-btn');
            btn.textContent = state.isRunning ? 'Pause' : 'Start';
        }

        function onTimerComplete() {
            pauseTimer();
            playNotification();

            // Log the completed block (all modes, breaks included) BEFORE
            // advancing. advanceToNextMode() -> switchMode() clears the
            // snapshot for the *upcoming* block; logCurrentBlock() has
            // already logged and cleared the *outgoing* block's snapshot by
            // then, so there is no double-clear / lost-log race.
            logCurrentBlock(1, getDuration(state.mode));

            if (state.mode === 'pomodoro') {
                // Completed a pomodoro
                state.pomodorosInCycle++;
                state.totalPomodoros++;

                updateSessionCounter();
                saveState();
                updateSessionCount();
                updateGoalDisplay();
                showBrowserNotification('Pomodoro Complete!', 'Time for a break');
            } else {
                showBrowserNotification('Break Over!', 'Ready to focus?');
            }

            advanceToNextMode();
        }

        function advanceToNextMode() {
            if (state.mode === 'pomodoro') {
                // After pomodoro, go to break
                if (state.pomodorosInCycle >= 4) {
                    // Long break after 4 pomodoros
                    state.pomodorosInCycle = 0;
                    updateSessionCounter();
                    switchMode('longBreak', true);
                } else {
                    switchMode('shortBreak', true);
                }
            } else {
                // After break, go to pomodoro
                switchMode('pomodoro', true);
            }
        }

        // ===== BROWSER NOTIFICATIONS =====
        function requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }

        function showBrowserNotification(title, body) {
            const canNotify = settings.notifications &&
                'Notification' in window &&
                Notification.permission === 'granted';

            if (canNotify) {
                new Notification(title, { body });
            }
        }

        // ===== SESSION COUNT DISPLAY =====
        function updateSessionCount() {
            document.getElementById('streak-count').textContent = state.totalPomodoros;
        }

        // ===== GOAL FUNCTIONS =====
        function loadGoal() {
            const saved = localStorage.getItem('pomodoro-goal');
            state.sessionGoal = (saved && parseInt(saved)) || 4;
        }

        function saveGoal() {
            localStorage.setItem('pomodoro-goal', String(state.sessionGoal));
        }

        function adjustGoal(delta) {
            state.sessionGoal = Math.max(1, Math.min(20, state.sessionGoal + delta));
            saveGoal();
            updateGoalDisplay();
        }

        function updateGoalDisplay() {
            document.getElementById('goal-target').textContent = state.sessionGoal;
            document.getElementById('goal-current').textContent = state.totalPomodoros;
            const goalDisplay = document.querySelector('.goal-display');
            goalDisplay.classList.toggle('goal-reached', state.totalPomodoros >= state.sessionGoal);
        }

        // ===== AUDIO =====
        let audioContext = null;

        const soundFunctions = {
            chime: playChimeSound,
            digital: playDigitalSound,
            gong: playGongSound,
            melody: playMelodySound
        };

        function playNotification(isTest = false) {
            try {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }

                const volume = settings.volume;
                if (volume === 0) return;

                const playSound = soundFunctions[settings.sound] || playChimeSound;
                playSound(audioContext.currentTime, volume);
            } catch (e) {
                console.log('Audio not available:', e);
            }
        }

        function playChimeSound(now, volume) {
            // Sine wave chord: C5, E5, G5
            const frequencies = [523.25, 659.25, 783.99];

            frequencies.forEach((freq, i) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.type = 'sine';
                oscillator.frequency.value = freq;

                gainNode.gain.setValueAtTime(0, now + i * 0.1);
                gainNode.gain.linearRampToValueAtTime(volume * 0.3, now + i * 0.1 + 0.05);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.8);

                oscillator.start(now + i * 0.1);
                oscillator.stop(now + i * 0.1 + 0.8);
            });
        }

        function playDigitalSound(now, volume) {
            // 3 short beeps at 880Hz with square wave
            for (let i = 0; i < 3; i++) {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.type = 'square';
                oscillator.frequency.value = 880;

                const startTime = now + i * 0.2; // 0.1s on, 0.1s off
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(volume * 0.2, startTime + 0.01);
                gainNode.gain.setValueAtTime(volume * 0.2, startTime + 0.09);
                gainNode.gain.linearRampToValueAtTime(0, startTime + 0.1);

                oscillator.start(startTime);
                oscillator.stop(startTime + 0.1);
            }
        }

        function playGongSound(now, volume) {
            // Deep resonant gong: A2 (110Hz) with harmonics at 220Hz and 330Hz
            const frequencies = [110, 220, 330];
            const gains = [1, 0.5, 0.25]; // Decreasing gain for harmonics

            frequencies.forEach((freq, i) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

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

        function playMelodySound(now, volume) {
            // Ascending notes: C5, E5, G5, C6
            const frequencies = [523, 659, 784, 1047];

            frequencies.forEach((freq, i) => {
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.type = 'sine';
                oscillator.frequency.value = freq;

                const startTime = now + i * 0.12; // Slight overlap (0.15s notes, 0.12s spacing)
                gainNode.gain.setValueAtTime(0, startTime);
                gainNode.gain.linearRampToValueAtTime(volume * 0.3, startTime + 0.02);
                gainNode.gain.setValueAtTime(volume * 0.3, startTime + 0.1);
                gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.15);

                oscillator.start(startTime);
                oscillator.stop(startTime + 0.15);
            });
        }

        // ===== SETTINGS =====
        function openSettings() {
            document.getElementById('settings-modal').classList.add('active');
            generateRecentThemes();
            generateThemeGrid();
            generateCustomThemeGrid();
            loadSettingsToForm();
            // Reset grid state
            document.getElementById('theme-grid-container').classList.remove('expanded');
            document.getElementById('theme-expand-btn').classList.remove('expanded');
        }

        function closeSettings() {
            document.getElementById('settings-modal').classList.remove('active');
            saveSettingsFromForm();
        }

        function loadSettingsToForm() {
            document.getElementById('setting-timer-style').value = settings.timerStyle;
            document.getElementById('setting-font').value = settings.timerFont || 'system';
            document.getElementById('setting-color-bg').checked = settings.colorBackground;
            document.getElementById('setting-hide-bg-running').checked = settings.hideBgWhenRunning;
            document.getElementById('setting-pomodoro').value = settings.pomodoroDuration;
            document.getElementById('setting-short-break').value = settings.shortBreakDuration;
            document.getElementById('setting-long-break').value = settings.longBreakDuration;
            document.getElementById('setting-auto-breaks').checked = settings.autoStartBreaks;
            document.getElementById('setting-auto-pomodoros').checked = settings.autoStartPomodoros;
            document.getElementById('setting-sound').value = settings.sound;
            document.getElementById('setting-volume').value = settings.volume * 100;
            document.getElementById('volume-value').textContent = Math.round(settings.volume * 100) + '%';
            document.getElementById('setting-notifications').checked = settings.notifications;
        }

        function saveSettingsFromForm() {
            const oldPomodoro = settings.pomodoroDuration;
            const oldShort = settings.shortBreakDuration;
            const oldLong = settings.longBreakDuration;
            const oldTimerStyle = settings.timerStyle;
            const oldColorBackground = settings.colorBackground;

            settings.timerStyle = document.getElementById('setting-timer-style').value;
            settings.colorBackground = document.getElementById('setting-color-bg').checked;
            settings.pomodoroDuration = parseInt(document.getElementById('setting-pomodoro').value) || 25;
            settings.shortBreakDuration = parseInt(document.getElementById('setting-short-break').value) || 5;
            settings.longBreakDuration = parseInt(document.getElementById('setting-long-break').value) || 15;
            settings.autoStartBreaks = document.getElementById('setting-auto-breaks').checked;
            settings.autoStartPomodoros = document.getElementById('setting-auto-pomodoros').checked;
            settings.sound = document.getElementById('setting-sound').value;
            settings.volume = parseInt(document.getElementById('setting-volume').value) / 100;
            settings.notifications = document.getElementById('setting-notifications').checked;

            // Apply timer style if changed
            if (oldTimerStyle !== settings.timerStyle) {
                updateTimerStyle();
            }

            // Apply color background if changed
            if (oldColorBackground !== settings.colorBackground) {
                updateColorBackground();
            }

            saveSettings();

            // Reset timer if duration changed and timer is not running
            if (!state.isRunning) {
                const durationChanged =
                    (state.mode === 'pomodoro' && oldPomodoro !== settings.pomodoroDuration) ||
                    (state.mode === 'shortBreak' && oldShort !== settings.shortBreakDuration) ||
                    (state.mode === 'longBreak' && oldLong !== settings.longBreakDuration);

                if (durationChanged) {
                    state.timeRemaining = getDuration(state.mode);
                    updateDisplay();
                }
            }
        }

        // Volume slider live update
        document.getElementById('setting-volume').addEventListener('input', function() {
            document.getElementById('volume-value').textContent = this.value + '%';
        });

        // Generate theme grid
        function generateThemeGrid() {
            const grid = document.getElementById('theme-grid');
            grid.innerHTML = '';

            // Add all built-in themes as swatches
            Object.keys(themes).forEach(themeName => {
                const swatch = createThemeSwatch(themeName, themes[themeName]);
                grid.appendChild(swatch);
            });

            // Add custom themes to grid
            Object.keys(customThemes).forEach(themeId => {
                const theme = customThemes[themeId];
                if (!isValidTheme(theme)) return;
                const swatch = createThemeSwatch(themeId, theme, theme.name);
                grid.appendChild(swatch);
            });
        }

        function createThemeSwatch(themeId, theme, displayName = null) {
            const swatch = document.createElement('div');
            swatch.className = 'theme-swatch' + (settings.theme === themeId ? ' active' : '');
            swatch.dataset.theme = themeId;

            swatch.innerHTML = `
                <div class="swatch-colors">
                    <div class="swatch-color" style="background: ${theme.pomodoro}"></div>
                    <div class="swatch-color" style="background: ${theme.shortBreak}"></div>
                    <div class="swatch-color" style="background: ${theme.longBreak}"></div>
                </div>
                <div class="swatch-name">${displayName || themeId}</div>
            `;

            swatch.addEventListener('mouseenter', () => applyTheme(themeId));
            swatch.addEventListener('mouseleave', () => applyTheme(settings.theme));
            swatch.addEventListener('click', () => selectTheme(themeId));

            return swatch;
        }

        function selectTheme(themeId) {
            settings.theme = themeId;
            applyTheme(themeId);
            updateRecentThemes(themeId);
            saveSettings();
            updateThemeGridActive();
            generateRecentThemes();
            // Collapse grid after selection
            document.getElementById('theme-grid-container').classList.remove('expanded');
            document.getElementById('theme-expand-btn').classList.remove('expanded');
        }

        function generateRecentThemes() {
            const container = document.getElementById('recent-themes');
            container.innerHTML = '';

            settings.recentThemes.forEach(themeId => {
                const theme = customThemes[themeId] || themes[themeId];
                if (!theme || !isValidTheme(theme)) return;

                const swatch = document.createElement('div');
                swatch.className = 'theme-swatch' + (settings.theme === themeId ? ' active' : '');
                swatch.dataset.theme = themeId;

                const displayName = theme.name || themeId;
                swatch.innerHTML = `
                    <div class="swatch-colors">
                        <div class="swatch-color" style="background: ${theme.pomodoro}"></div>
                        <div class="swatch-color" style="background: ${theme.shortBreak}"></div>
                        <div class="swatch-color" style="background: ${theme.longBreak}"></div>
                    </div>
                    <div class="swatch-name">${displayName}</div>
                `;

                swatch.addEventListener('mouseenter', () => applyTheme(themeId));
                swatch.addEventListener('mouseleave', () => applyTheme(settings.theme));
                swatch.addEventListener('click', () => selectTheme(themeId));

                container.appendChild(swatch);
            });
        }

        function updateRecentThemes(themeId) {
            // Remove if already in list
            const index = settings.recentThemes.indexOf(themeId);
            if (index > -1) {
                settings.recentThemes.splice(index, 1);
            }
            // Add to front
            settings.recentThemes.unshift(themeId);
            // Keep only 4
            settings.recentThemes = settings.recentThemes.slice(0, 4);
        }

        function toggleThemeGrid() {
            const container = document.getElementById('theme-grid-container');
            const btn = document.getElementById('theme-expand-btn');
            container.classList.toggle('expanded');
            btn.classList.toggle('expanded');
        }

        function updateThemeGridActive() {
            document.querySelectorAll('.theme-swatch').forEach(swatch => {
                swatch.classList.toggle('active', swatch.dataset.theme === settings.theme);
            });
        }

        // Timer style live update
        document.getElementById('setting-timer-style').addEventListener('change', function() {
            settings.timerStyle = this.value;
            updateTimerStyle();
            saveSettings();
        });

        // Font live update
        document.getElementById('setting-font').addEventListener('change', function() {
            settings.timerFont = this.value;
            updateTimerFont();
            saveSettings();
        });

        // Color background live update
        document.getElementById('setting-color-bg').addEventListener('change', function() {
            settings.colorBackground = this.checked;
            updateColorBackground();
            saveSettings();
        });

        // Hide background when running toggle
        document.getElementById('setting-hide-bg-running').addEventListener('change', function() {
            settings.hideBgWhenRunning = this.checked;
            updateColorBackground();
            saveSettings();
        });

        // Sound live update (so test button uses selected sound)
        document.getElementById('setting-sound').addEventListener('change', function() {
            settings.sound = this.value;
            saveSettings();
        });

        // Theme editor color input listeners
        ['pomodoro', 'short-break', 'long-break'].forEach(mode => {
            const picker = document.getElementById(`color-${mode}`);
            const hex = document.getElementById(`color-${mode}-hex`);

            picker.addEventListener('input', () => {
                hex.value = picker.value;
                updateThemePreview();
            });

            hex.addEventListener('input', () => {
                if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) {
                    picker.value = hex.value;
                }
                updateThemePreview();
            });
        });

        // ===== SETTINGS PERSISTENCE (server-backed, localStorage cache) =====
        function saveSettings() {
            // Cache synchronously for instant reloads, then persist durably to
            // the server (fire-and-forget: api.call swallows network errors).
            localStorage.setItem('pomodoro-settings', JSON.stringify(settings));
            api.putSettings(settings);
        }

        // Normalize after loading from either source: fall back to a valid
        // theme and top recentThemes back up to 4 entries.
        function validateSettings() {
            if (!themes[settings.theme] && !customThemes[settings.theme]) {
                settings.theme = 'mono';
            }
            const defaultThemes = ['mono', 'dusk', 'ocean', 'glacier'];
            while (settings.recentThemes.length < 4) {
                const filler = defaultThemes.find(t => !settings.recentThemes.includes(t));
                if (filler) settings.recentThemes.push(filler);
                else break;
            }
        }

        async function loadSettings() {
            const cached = JSON.parse(localStorage.getItem('pomodoro-settings') || 'null');
            const res = await api.getSettings();
            const server = res.ok ? res.data : null;

            if (server && Object.keys(server).length) {
                // Server is the source of truth once it has anything.
                Object.assign(settings, server);
            } else if (cached) {
                // First run against the server: migrate the existing
                // localStorage settings up so they become durable.
                Object.assign(settings, cached);
                await api.putSettings(settings);
            }

            validateSettings();
            localStorage.setItem('pomodoro-settings', JSON.stringify(settings));
        }

        // ===== EXPORT / IMPORT / RESET =====
        function exportSettings() {
            const exportData = {
                settings: settings,
                customThemes: customThemes,
                goal: state.sessionGoal,
                exportedAt: new Date().toISOString(),
                version: '1.1'
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = 'pomodoro-settings.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        function importSettings(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);

                    if (data.settings) {
                        Object.assign(settings, data.settings);
                        saveSettings();
                    }

                    if (data.customThemes) {
                        Object.assign(customThemes, data.customThemes);
                        saveCustomThemes();
                    }

                    if (data.goal) {
                        state.sessionGoal = data.goal;
                        saveGoal();
                    }

                    applyTheme(settings.theme);
                    updateTimerStyle();
                    updateTimerFont();
                    updateColorBackground();
                    loadSettingsToForm();
                    updateGoalDisplay();
                    generateThemeGrid();
                    generateCustomThemeGrid();

                    alert('Settings imported successfully!');
                } catch (err) {
                    alert('Invalid settings file. Please check the format.');
                }
            };
            reader.readAsText(file);

            // Reset file input so same file can be imported again
            event.target.value = '';
        }

        function resetToDefaults() {
            if (!confirm('Reset all settings to defaults? This will also delete custom themes.')) {
                return;
            }

            const defaults = {
                pomodoroDuration: 25,
                shortBreakDuration: 5,
                longBreakDuration: 15,
                autoStartBreaks: true,
                autoStartPomodoros: false,
                volume: 0.5,
                sound: 'chime',
                theme: 'mono',
                timerStyle: 'flip',
                colorBackground: true,
                notifications: true
            };

            Object.assign(settings, defaults);
            state.sessionGoal = 4;
            customThemes = {};

            saveSettings();
            saveGoal();
            saveCustomThemes();

            applyTheme(settings.theme);
            updateTimerStyle();
            updateTimerFont();
            updateColorBackground();
            loadSettingsToForm();
            updateGoalDisplay();
            generateThemeGrid();
            generateCustomThemeGrid();

            if (!state.isRunning) {
                state.timeRemaining = getDuration(state.mode);
                updateDisplay();
            }
        }

        function saveState() {
            localStorage.setItem('pomodoro-state', JSON.stringify({
                pomodorosInCycle: state.pomodorosInCycle,
                totalPomodoros: state.totalPomodoros
            }));
        }

        function loadState() {
            state.pomodorosInCycle = 0;
            state.totalPomodoros = 0;
        }

        // ===== KEYBOARD SHORTCUTS =====
        const keyboardShortcuts = {
            'Space': toggleTimer,
            'KeyR': resetTimer,
            'KeyN': skipTimer
        };

        document.addEventListener('keydown', function(e) {
            const isTyping = e.target.tagName === 'INPUT';
            const isModalOpen = document.getElementById('settings-modal').classList.contains('active');
            if (isTyping || isModalOpen) return;

            const action = keyboardShortcuts[e.code];
            if (action) {
                e.preventDefault();
                action();
            }
        });

        // Close modal on overlay click
        document.getElementById('settings-modal').addEventListener('click', function(e) {
            if (e.target === this) {
                closeSettings();
            }
        });

        // Quit button: stop the server, then show a closed-state message.
        document.getElementById('quit-btn').addEventListener('click', async () => {
            await api.quit();
            document.body.innerHTML =
                "<main class='landing'><h1 class='landing-title'>Pomoflow stopped.</h1>" +
                "<p class='landing-subtitle'>You can close this window.</p></main>";
        });

        // ===== INITIALIZATION =====
        async function init() {
            loadCustomThemes();
            // Server-backed load must finish before we apply theme/style/
            // durations below, so await it (init is async).
            await loadSettings();
            loadGoal();

            applyTheme(settings.theme);

            // Apply saved timer style, font, and color background
            updateTimerStyle();
            updateTimerFont();
            updateColorBackground();

            // Fresh-start default (overridden below if a snapshot restores).
            state.timeRemaining = getDuration(state.mode);

            // Replaces the old loadState() reset: reconcile any live snapshot
            // left from before a reload/close (resume a running block, log
            // one that finished while away, or restore a paused position).
            // Must run after loadSettings() (durations depend on settings)
            // and after the fresh-start default above so a restore's
            // timeRemaining isn't clobbered by it.
            restoreFromSnapshot();

            updateDisplay();
            updateSessionCounter();
            updateGoalDisplay();
            updateSessionCount();

            // Initialize flip clock values
            prevFlipDigits = ['', '', '', ''];
            updateFlipClock();
        }

        init();

        // ===== EXPOSE FOR INLINE HTML HANDLERS =====
        // Module scripts are not global scope; the body markup (and the
        // dynamically-generated theme-swatch markup) uses inline
        // onclick/onchange/oninput attributes that need these on `window`.
        Object.assign(window, {
            switchMode,
            toggleTimer,
            resetTimer,
            skipTimer,
            openSettings,
            closeSettings,
            adjustGoal,
            toggleThemeGrid,
            closeThemeEditor,
            deleteCustomTheme,
            saveCustomTheme,
            exportSettings,
            importSettings,
            playNotification,
            resetToDefaults,
            openThemeEditor,
        });
