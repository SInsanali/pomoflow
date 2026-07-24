import { api } from "/js/api.js";
import { barGeometry, heatmapCells } from "/js/charts.js";

// Minutes east of UTC — matches how the server buckets daily stats, so the
// local calendar dates we build below line up with the server's day keys.
const tz = -new Date().getTimezoneOffset();

function fmtDuration(seconds) {
    const s = Math.round(seconds || 0);
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const MODE_LABELS = {
    pomodoro: "Focus",
    shortBreak: "Short break",
    longBreak: "Long break",
};

// Local YYYY-MM-DD for a Date, using its local components (the browser's tz
// equals the tz we sent the server, so these keys match stats.daily dates).
function localDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// The server's stats.daily is sparse (only days with sessions). Densify it
// into a contiguous run of the last `n` calendar days ending today, filling
// gaps with zero, so bars/heatmap read as a real timeline rather than a
// packed list of active days.
function lastNDays(daily, n) {
    const byDate = new Map(daily.map(d => [d.date, d]));
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const date = localDateStr(d);
        const rec = byDate.get(date);
        out.push({
            date,
            focus_seconds: rec ? rec.focus_seconds : 0,
            focusSeconds: rec ? rec.focus_seconds : 0,
            blocks: rec ? rec.blocks : 0,
        });
    }
    return out;
}

function renderTiles(totals) {
    document.getElementById("t-today").textContent = fmtDuration(totals.today_seconds);
    document.getElementById("t-week").textContent = fmtDuration(totals.week_seconds);
    document.getElementById("t-blocks").textContent = totals.all_time_blocks || 0;
}

function renderTrends(daily) {
    const days = lastNDays(daily, 14);
    const barW = 22, gap = 8, height = 160, pad = 20;
    const bars = barGeometry(days.map(d => d.focus_seconds), { width: barW, height, gap });
    const vbW = days.length * (barW + gap);
    document.getElementById("trends").innerHTML =
        `<svg viewBox="0 0 ${vbW} ${height + pad}" class="bars" preserveAspectRatio="xMidYMax meet">` +
        bars.map((b, i) =>
            `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3">` +
            `<title>${days[i].date}: ${fmtDuration(days[i].focus_seconds)}</title></rect>`
        ).join("") +
        `</svg>`;
}

function renderHeatmap(daily) {
    const weeks = 17, cell = 13, gap = 3;
    const days = lastNDays(daily, weeks * 7);
    const cells = heatmapCells(days, { weeks, cell, gap });
    const vbW = weeks * (cell + gap);
    const vbH = 7 * (cell + gap);
    document.getElementById("heatmap").innerHTML =
        `<svg viewBox="0 0 ${vbW} ${vbH}" class="heat" preserveAspectRatio="xMinYMin meet">` +
        cells.map(c =>
            `<rect x="${c.x}" y="${c.y}" width="${cell}" height="${cell}" rx="2" class="lvl-${c.level}">` +
            `<title>${c.date}: ${fmtDuration(c.focusSeconds)}</title></rect>`
        ).join("") +
        `</svg>`;
}

function renderLog(sessions) {
    const rows = sessions.slice(0, 30).map(s => {
        const when = new Date(s.started_at).toLocaleString();
        const mode = MODE_LABELS[s.mode] || s.mode;
        return `<tr><td>${when}</td><td>${mode}</td><td>${fmtDuration(s.actual_seconds)}</td></tr>`;
    }).join("");
    document.getElementById("log").innerHTML =
        "<thead><tr><th>When</th><th>Mode</th><th>Length</th></tr></thead>" +
        "<tbody>" + (rows || `<tr><td colspan="3" class="log-empty">No sessions logged yet.</td></tr>`) + "</tbody>";
}

async function render() {
    const statsRes = await api.getStats(tz);
    const stats = (statsRes.ok && statsRes.data) ? statsRes.data : { daily: [], totals: {} };
    const daily = stats.daily || [];
    renderTiles(stats.totals || {});
    renderTrends(daily);
    renderHeatmap(daily);

    const sessRes = await api.getSessions();
    const sessions = (sessRes.ok && sessRes.data && sessRes.data.sessions) ? sessRes.data.sessions : [];
    renderLog(sessions);
}

// Quit button (shared header) — stop the server, then show a closed message.
const quitBtn = document.getElementById("quit-btn");
if (quitBtn) {
    quitBtn.addEventListener("click", async () => {
        await api.quit();
        document.body.innerHTML =
            "<main class='landing'><h1 class='landing-title'>Pomoflow stopped.</h1>" +
            "<p class='landing-subtitle'>You can close this window.</p></main>";
    });
}

render();
