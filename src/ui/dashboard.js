import {
    barGeometry, heatmapCells, computeStats, denseDays, formatDuration,
} from "../core/charts.js";

// Minutes east of UTC — the same offset computeStats buckets by, so the local
// calendar dates we build below line up with its day keys.
const tz = -new Date().getTimezoneOffset();

const MODE_LABELS = {
    pomodoro: "Focus",
    shortBreak: "Short break",
    longBreak: "Long break",
};

// The densify + duration-format helpers moved into core/charts.js when the popup
// grew its own stats sheet: both surfaces read the same rollup, so a day boundary
// or a rounding rule that differed between them would be a bug either way.
const lastNDays = (daily, n) => denseDays(daily, n, { tzOffsetMinutes: tz });

function renderTiles(totals) {
    document.getElementById("t-today").textContent = formatDuration(totals.today_seconds);
    document.getElementById("t-week").textContent = formatDuration(totals.week_seconds);
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
            `<title>${days[i].date}: ${formatDuration(days[i].focus_seconds)}</title></rect>`
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
            `<title>${c.date}: ${formatDuration(c.focusSeconds)}</title></rect>`
        ).join("") +
        `</svg>`;
}

function renderLog(sessions) {
    const table = document.getElementById("log");
    table.innerHTML = "";

    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>When</th><th>Mode</th><th>Length</th></tr>";

    const tbody = document.createElement("tbody");
    const list = sessions.slice(0, 30);
    if (!list.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 3;
        td.className = "log-empty";
        td.textContent = "No sessions logged yet.";
        tr.appendChild(td);
        tbody.appendChild(tr);
    } else {
        // Build cells with textContent, never innerHTML: s.mode is stored
        // verbatim (and an imported backup is user-supplied), so it could
        // otherwise carry injected markup.
        for (const s of list) {
            const tr = document.createElement("tr");
            const cells = [
                new Date(s.started_at).toLocaleString(),
                MODE_LABELS[s.mode] || s.mode,
                formatDuration(s.actual_seconds),
            ];
            for (const text of cells) {
                const td = document.createElement("td");
                td.textContent = text;
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
    }

    table.append(thead, tbody);
}

// One read of the session log now feeds everything: the rollup that used to be
// a server round-trip (/api/stats) is computed locally by computeStats, so the
// dashboard costs a single chrome.storage read.
export async function renderDashboard(db) {
    const { data } = await db.getSessions();
    const sessions = data.sessions;
    const stats = computeStats(sessions, tz);

    renderTiles(stats.totals);
    renderTrends(stats.daily);
    renderHeatmap(stats.daily);
    renderLog(sessions);
}
