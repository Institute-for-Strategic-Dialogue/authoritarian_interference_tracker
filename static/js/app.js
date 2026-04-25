/* ========================================================================
   Authoritarian Interference Tracker — Frontend Application
   ======================================================================== */

// ---- Globals ----
let config = null;
let meta = null;
let lastData = null; // cache last API response for cross-filtering
let _allIncidentsCache = []; // all incidents for related-incident lookup

const CURRENT_YEAR = new Date().getFullYear();

const state = {
  page: 1,
  pageSize: 25,
  filters: {
    start: null,    // year integer
    end: null,      // year integer
    q: "",
    actors: new Set(),
    countries: new Set(),
    tools: new Set(),
    entities: new Set(),
    ttp: "",
    region: ""
  }
};

// ---- DOM helpers ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---- Incident type definitions ----
const INCIDENT_TYPES = [
  { name: "Cyber Operations",        color: "#0068B2" },  // ISD Blue
  { name: "Kinetic Operations",      color: "#C7074D" },  // ISD Red
  { name: "Information Operations",  color: "#D4A843" },  // Warm gold
  { name: "Malign Finance",          color: "#3A8A6E" },  // Muted green
  { name: "Political & Civic Subversion",color: "#4C4193" },  // ISD Purple
  { name: "Economic Coercion",       color: "#E76863" }   // ISD Coral
];
const INCIDENT_TYPE_MAP = {};
INCIDENT_TYPES.forEach(t => INCIDENT_TYPE_MAP[t.name] = t.color);

// ---- Color helpers ----
const TOOL_ACCENTS = [
  "accent_orange", "accent_yellow", "accent_green", "accent_teal",
  "accent_lightblue", "accent_blue", "accent_purple", "accent_pink"
];

const toolColorMap = {};
const actorColorMap = {};
let sortedTools = [];

function actorColor(a) {
  const base = (config && config.actor_palette) || {};
  if (base[a]) return base[a];
  if (!actorColorMap[a]) {
    const idx = Object.keys(actorColorMap).length;
    actorColorMap[a] = d3.schemeTableau10[idx % d3.schemeTableau10.length];
  }
  return actorColorMap[a];
}

function initializeToolColors(allTools) {
  sortedTools = [...allTools].sort();
  sortedTools.forEach((tool, index) => {
    if (!toolColorMap[tool]) {
      // Prefer incident type map color
      if (INCIDENT_TYPE_MAP[tool]) {
        toolColorMap[tool] = INCIDENT_TYPE_MAP[tool];
      } else if (config && config.colors) {
        const colorIndex = index % TOOL_ACCENTS.length;
        toolColorMap[tool] = config.colors[TOOL_ACCENTS[colorIndex]];
      } else {
        toolColorMap[tool] = d3.schemeTableau10[index % 10];
      }
    }
  });
}

function toolColor(t) {
  if (INCIDENT_TYPE_MAP[t]) return INCIDENT_TYPE_MAP[t];
  if (toolColorMap[t]) return toolColorMap[t];
  const currentTools = new Set([...sortedTools, t]);
  initializeToolColors(currentTools);
  return toolColorMap[t] || "#999";
}

function blendToBase(baseHex, frac) {
  const interp = d3.interpolateRgb("#ffffff", baseHex);
  return interp(Math.max(0.15, Math.min(1, frac)));
}

function blendToDark(baseHex, frac) {
  const interp = d3.interpolateRgb("#ffffff", baseHex);
  return interp(Math.max(0.15, Math.min(1, frac)));
}

// ---- Initialization ----
async function init() {
  config = await (await fetch("/api/config")).json();
  meta = await (await fetch("/api/meta")).json();

  // Restore filters from URL params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("q")) { state.filters.q = urlParams.get("q"); }
  if (urlParams.get("start")) { state.filters.start = parseInt(urlParams.get("start")); }
  if (urlParams.get("end")) { state.filters.end = parseInt(urlParams.get("end")); }
  if (urlParams.get("actors")) { urlParams.get("actors").split(",").forEach(a => state.filters.actors.add(a)); }
  if (urlParams.get("countries")) { urlParams.get("countries").split(",").forEach(c => state.filters.countries.add(c)); }
  if (urlParams.get("tools")) { urlParams.get("tools").split(",").forEach(t => state.filters.tools.add(t)); }
  if (urlParams.get("entities")) { urlParams.get("entities").split(",").forEach(e => state.filters.entities.add(e)); }
  if (urlParams.get("ttp")) { state.filters.ttp = urlParams.get("ttp"); }
  if (urlParams.get("region")) { state.filters.region = urlParams.get("region"); }

  buildFilterUI();

  // Sync UI controls with restored state
  if (state.filters.q) $("#search").value = state.filters.q;
  if (state.filters.start) $("#start-year").value = state.filters.start;
  if (state.filters.end) $("#end-year").value = state.filters.end;
  if (state.filters.region) $("#region-select").value = state.filters.region;
  if (state.filters.countries.size === 1) $("#country-select").value = Array.from(state.filters.countries)[0];

  bindEvents();
  bindResize();
  await refresh();

  // Load all incidents for related-incident lookup (unpaginated)
  try {
    const allRes = await fetch("/api/incidents?page=1&page_size=2000");
    const allData = await allRes.json();
    _allIncidentsCache = allData.incidents || [];
  } catch(e) { console.error("AllIncidents cache:", e); }

  // Auto-open modal if arriving via permalink
  if (window.prefillIncident) {
    openModal(window.prefillIncident);
  }
}

function _pillStyle(el, color, active) {
  // Inactive: light tinted bg, darker border, dark grey text
  // Active: solid fill, white text
  if (active) {
    el.style.background = color;
    el.style.borderColor = color;
    el.style.color = "#fff";
  } else {
    el.style.background = blendToBase(color, 0.12);
    el.style.borderColor = color;
    el.style.color = "#5C6771";
  }
}

function buildFilterUI() {
  // Incident type pills
  const toolPills = $("#tool-pills");
  INCIDENT_TYPES.forEach(t => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.dataset.tool = t.name;
    pill.textContent = t.name;
    _pillStyle(pill, t.color, false);
    pill.addEventListener("click", () => {
      toggleSet(state.filters.tools, t.name);
      updatePillStates();
      state.page = 1;
      refresh();
    });
    toolPills.appendChild(pill);
  });

  // Actor pills
  const actorPills = $("#actor-pills");
  const actorNames = meta.actors.map(a => a[0]);
  actorNames.forEach(name => {
    const c = actorColor(name);
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.dataset.actor = name;
    pill.textContent = name;
    _pillStyle(pill, c, false);
    pill.addEventListener("click", () => {
      toggleSet(state.filters.actors, name);
      updatePillStates();
      state.page = 1;
      refresh();
    });
    actorPills.appendChild(pill);
  });

  // Country dropdown
  const countrySel = $("#country-select");
  meta.countries.sort((a, b) => a[0].localeCompare(b[0])).forEach(([name]) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    countrySel.appendChild(opt);
  });

  // Region dropdown
  const regionSel = $("#region-select");
  (meta.regions || []).forEach(r => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    regionSel.appendChild(opt);
  });
}

function updatePillStates() {
  $$(".pill[data-tool]").forEach(p => {
    const active = state.filters.tools.has(p.dataset.tool);
    const t = INCIDENT_TYPES.find(x => x.name === p.dataset.tool);
    p.classList.toggle("active", active);
    _pillStyle(p, t ? t.color : "#999", active);
  });
  $$(".pill[data-actor]").forEach(p => {
    const active = state.filters.actors.has(p.dataset.actor);
    p.classList.toggle("active", active);
    _pillStyle(p, actorColor(p.dataset.actor), active);
  });
}

// Re-render every chart with the cached API response — used after a viewport
// resize. Each render function clears its container first so this is safe.
function redrawCharts() {
  if (!lastData) return;
  const d = lastData;
  try { renderSankey(d.country_actor || [], d.stacked || [], d.sankey_node_counts || {}); } catch(e) {}
  try { renderVolumeChart(d.volume_over_time || []); } catch(e) {}
  try { renderMap(d.country_actor || [], d.country_meta || {}); } catch(e) {}
  try { renderStacked(d.stacked || []); } catch(e) {}
  try { renderTtpTreemap(d.ttp_by_type || {}); } catch(e) {}
  try { renderEntityFiltered(); } catch(e) {}
}

// Debounced viewport resize → redraw all charts. ResizeObserver on the
// chart containers would be tighter (catches container changes from layout
// shifts) but window resize covers 99% of the case at far less complexity.
function bindResize() {
  let timer = null;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(redrawCharts, 150);
  });
}

function bindEvents() {
  // Filter toggle
  const toggleBtn = $("#filter-toggle");
  const collapsible = $("#filter-collapsible");
  if (toggleBtn && collapsible) {
    const isMobile = window.innerWidth <= 900;
    // Mobile: start collapsed. Desktop: start expanded.
    if (isMobile) {
      collapsible.classList.add("collapsed");
      toggleBtn.classList.add("collapsed");
    }
    toggleBtn.addEventListener("click", () => {
      const isCollapsed = collapsible.classList.contains("collapsed") || collapsible.classList.contains("expanded") === false && isMobile;
      if (window.innerWidth <= 900) {
        collapsible.classList.toggle("expanded");
        toggleBtn.classList.toggle("expanded");
      } else {
        collapsible.classList.toggle("collapsed");
        toggleBtn.classList.toggle("collapsed");
      }
    });
  }

  // Search (debounced)
  $("#search").addEventListener("input", (e) => {
    state.filters.q = e.target.value.trim();
    state.page = 1;
    debounceRefresh();
  });

  // Year inputs
  $("#start-year").addEventListener("change", () => {
    const v = parseInt($("#start-year").value);
    state.filters.start = isNaN(v) ? null : v;
    state.page = 1;
    refresh();
  });
  $("#end-year").addEventListener("change", () => {
    const v = parseInt($("#end-year").value);
    state.filters.end = isNaN(v) ? null : v;
    state.page = 1;
    refresh();
  });

  // Country select
  $("#country-select").addEventListener("change", () => {
    const v = $("#country-select").value;
    state.filters.countries.clear();
    if (v) state.filters.countries.add(v);
    state.page = 1;
    refresh();
  });

  // Region select
  $("#region-select").addEventListener("change", () => {
    state.filters.region = $("#region-select").value;
    state.page = 1;
    refresh();
  });

  // Clear all
  $("#clearAll").addEventListener("click", clearAll);

  // Pagination
  $("#prev").addEventListener("click", () => { if (state.page > 1) { state.page--; refresh(); } });
  $("#next").addEventListener("click", () => { state.page++; refresh(); });

  // Modal close
  $("#modal-close").addEventListener("click", closeModal);
  $("#incident-modal-overlay").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
}

let debounceTimer = null;
function debounceRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refresh, 300);
}

// ---- URL params builder ----
function currentParams() {
  const p = new URLSearchParams();
  if (state.filters.start) p.set("start", state.filters.start);
  if (state.filters.end) p.set("end", state.filters.end);
  if (state.filters.q) p.set("q", state.filters.q);
  if (state.filters.actors.size) p.set("actors", Array.from(state.filters.actors).join(","));
  if (state.filters.countries.size) p.set("countries", Array.from(state.filters.countries).join(","));
  if (state.filters.tools.size) p.set("tools", Array.from(state.filters.tools).join(","));
  if (state.filters.entities.size) p.set("entities", Array.from(state.filters.entities).join(","));
  if (state.filters.ttp) p.set("ttp", state.filters.ttp);
  if (state.filters.region) p.set("region", state.filters.region);
  p.set("page", state.page);
  p.set("page_size", state.pageSize);
  return p.toString();
}

// ---- Main refresh ----
async function refresh() {
  const res = await fetch(`/api/incidents?${currentParams()}`);
  const data = await res.json();
  lastData = data;

  $("#total-count").textContent = data.total;

  // Footer: surface the most-recently-updated incident's timestamp so
  // analysts can tell at a glance how fresh the catalog is.
  const updated = data.data_last_updated;
  const fEl = document.getElementById("footer-updated");
  if (fEl && updated) {
    const d = new Date(updated);
    if (!isNaN(d)) {
      fEl.textContent = `Data last updated ${d.toISOString().slice(0, 10)}`;
    }
  }

  // Update export links with current filters
  const exportParams = currentParams().replace(/&?page=\d+/, "").replace(/&?page_size=\d+/, "");
  const qs = exportParams ? `?${exportParams}` : "";
  if ($("#export-csv")) $("#export-csv").href = `/export/incidents.csv${qs}`;
  if ($("#export-xlsx")) $("#export-xlsx").href = `/export/incidents.xlsx${qs}`;

  const maxPage = Math.ceil(data.total / data.page_size) || 1;
  $("#pageinfo").textContent = `Page ${data.page} of ${maxPage} (${data.total} results)`;
  $("#prev").disabled = data.page <= 1;
  $("#next").disabled = data.page >= maxPage;

  renderApplied();
  updatePillStates();
  try { renderSankey(data.country_actor || [], data.stacked || [], data.sankey_node_counts || {}); } catch(e) { console.error("Sankey:", e); }
  try { renderVolumeChart(data.volume_over_time || []); } catch(e) { console.error("VolumeChart:", e); }
  try { renderMap(data.country_actor || [], data.country_meta || {}); } catch(e) { console.error("Map:", e); }
  try { renderStacked(data.stacked || []); } catch(e) { console.error("Stacked:", e); }
  try { renderTtpTreemap(data.ttp_by_type || {}); } catch(e) { console.error("TtpTreemap:", e); }
  try { renderList(data.incidents || []); } catch(e) { console.error("List:", e); }
  if (entityClickRefresh) {
    entityClickRefresh = false;
    // Don't re-fetch network — just update node selection visuals
    renderEntityFiltered();
  } else {
    try { refreshEntityNetwork(); } catch(e) { console.error("EntityNetwork:", e); }
  }

  // Update URL with current filter state (without triggering navigation)
  if (!window.prefillIncident) {
    const filterUrl = buildFilterURL();
    history.replaceState({}, "", filterUrl);
  }
}

// ---- Applied filters chips ----
function renderApplied() {
  const wrap = $("#applied");
  wrap.innerHTML = "";
  let hasAny = false;

  function chip(label, val, removeFn) {
    hasAny = true;
    const d = document.createElement("div");
    d.className = "chip";
    d.innerHTML = `<span>${label}: <strong>${val}</strong></span> <span class="x">&#10005;</span>`;
    d.querySelector(".x").addEventListener("click", () => { removeFn(); state.page = 1; refresh(); });
    wrap.appendChild(d);
  }

  if (state.filters.q) chip("Search", state.filters.q, () => { state.filters.q = ""; $("#search").value = ""; });
  state.filters.tools.forEach(v => chip("Type", v, () => state.filters.tools.delete(v)));
  state.filters.actors.forEach(v => chip("Actor", v, () => state.filters.actors.delete(v)));
  state.filters.countries.forEach(v => chip("Country", v, () => { state.filters.countries.delete(v); $("#country-select").value = ""; }));
  state.filters.entities.forEach(v => chip("Entity", v, () => { state.filters.entities.delete(v); selectedEntities.delete(v); }));
  if (state.filters.ttp) chip("TTP", state.filters.ttp, () => { state.filters.ttp = ""; });
  if (state.filters.region) chip("Region", state.filters.region, () => { state.filters.region = ""; $("#region-select").value = ""; });
  if (state.filters.start) chip("From", state.filters.start, () => { state.filters.start = null; $("#start-year").value = ""; });
  if (state.filters.end) chip("To", state.filters.end, () => { state.filters.end = null; $("#end-year").value = ""; });

  $("#clearAll").style.display = hasAny ? "" : "none";
}

function clearAll() {
  state.filters.q = ""; $("#search").value = "";
  state.filters.actors.clear();
  state.filters.countries.clear();
  state.filters.tools.clear();
  state.filters.entities.clear();
  selectedEntities.clear();
  state.filters.ttp = "";
  state.filters.region = ""; $("#region-select").value = "";
  state.filters.start = null; $("#start-year").value = "";
  state.filters.end = null; $("#end-year").value = "";
  $("#country-select").value = "";
  state.page = 1;
  refresh();
}

// ========================================================================
// VOLUME OVER TIME CHART (stacked filled area by actor)
// Incidents aren't discrete by calendar year — campaigns roll between years.
// A stacked area reads that continuity better than discrete bars.
// ========================================================================
function renderVolumeChart(rows) {
  const el = d3.select("#volume-chart");
  el.selectAll("*").remove();

  if (!rows.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No data available.");
    return;
  }

  const container = document.querySelector(".viz-volume");
  const width = Math.max(300, container.clientWidth - 32);
  const height = Math.max(300, container.clientHeight - 40);
  const margin = { top: 20, right: 16, bottom: 35, left: 40 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = el.append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Aggregate per-actor counts per year, dropping anything past CURRENT_YEAR
  // (those tend to be future-dated artifacts) and bucketing pre-2010 into a
  // single "Pre" lump that hangs off the left edge.
  const rawYears = Array.from(new Set(rows.map(d => d.year))).filter(y => y <= CURRENT_YEAR).sort((a, b) => a - b);
  const actors = Array.from(new Set(rows.map(d => d.actor))).sort();
  const lookup = {};
  rows.forEach(r => {
    const key = r.year < 2010 ? `pre_${r.actor}` : `${r.year}_${r.actor}`;
    lookup[key] = (lookup[key] || 0) + r.count;
  });

  const hasPre = rawYears.some(y => y < 2010);
  const postYears = rawYears.filter(y => y >= 2010);
  // For an area chart x must be a continuous numeric scale; collapse Pre into
  // a synthetic year value just left of the lowest real year.
  const minYear = postYears.length ? postYears[0] : CURRENT_YEAR;
  const preYearVal = minYear - 1;
  const yearsForData = hasPre ? [preYearVal, ...postYears] : [...postYears];

  const stackData = yearsForData.map(yr => {
    const obj = { year: yr };
    actors.forEach(a => {
      obj[a] = yr === preYearVal && hasPre
        ? (lookup[`pre_${a}`] || 0)
        : (lookup[`${yr}_${a}`] || 0);
    });
    return obj;
  });

  const stack = d3.stack().keys(actors);
  const series = stack(stackData);

  const x = d3.scaleLinear()
    .domain([yearsForData[0], yearsForData[yearsForData.length - 1]])
    .range([0, innerW]);
  const yMax = d3.max(series, s => d3.max(s, d => d[1])) || 1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

  // X axis — show every other real year, "Pre" label for the synthetic point
  const tickYears = yearsForData.filter(yr =>
    (yr === preYearVal && hasPre) || (yr >= 2010 && yr % 2 === 1)
  );
  const xAxis = g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickValues(tickYears).tickFormat(yr => (yr === preYearVal && hasPre) ? "Pre" : yr).tickSize(0));
  xAxis.selectAll("text").style("fill", "#5C6771").style("font-size", "12px");
  xAxis.select(".domain").style("stroke", "rgba(0,0,0,0.1)");

  // Y axis with subtle gridlines
  const yAxis = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerW));
  yAxis.selectAll("text").style("fill", "#5C6771").style("font-size", "12px");
  yAxis.select(".domain").remove();
  yAxis.selectAll("line").style("stroke", "rgba(0,0,0,0.05)");

  // Stacked filled area generator — monotone interpolation reads as smooth
  // continuity without overshooting.
  const area = d3.area()
    .x(d => x(d.data.year))
    .y0(d => y(d[0]))
    .y1(d => y(d[1]))
    .curve(d3.curveMonotoneX);

  series.forEach(s => {
    const actorName = s.key;
    const color = actorColor(actorName);
    g.append("path")
      .datum(s)
      .attr("class", "vol-area")
      .attr("d", area)
      .attr("fill", color)
      .attr("fill-opacity", 0.78)
      .attr("stroke", color)
      .attr("stroke-width", 1)
      .attr("stroke-opacity", 0.9)
      .style("cursor", "pointer")
      .on("click", () => {
        toggleSet(state.filters.actors, actorName);
        state.page = 1;
        refresh();
      })
      .append("title").text(`${actorName}: ${s.reduce((acc, d) => acc + (d.data[actorName] || 0), 0)} incident-years`);
  });

  // Per-year hover with stacked tooltip values. We capture the closest year
  // by clientX and render a vertical guide + per-actor count list.
  const tooltip = el.append("div")
    .style("position", "absolute").style("pointer-events", "none").style("display", "none")
    .style("background", "rgba(255,255,255,0.96)").style("border", "1px solid #ccc")
    .style("border-radius", "4px").style("padding", "6px 10px").style("font-size", "12px")
    .style("font-family", "'IBM Plex Sans', sans-serif").style("box-shadow", "0 2px 8px rgba(0,0,0,.12)")
    .style("z-index", "100000").style("white-space", "nowrap");
  el.style("position", "relative");

  const guide = g.append("line")
    .attr("y1", 0).attr("y2", innerH)
    .attr("stroke", "#37474F").attr("stroke-dasharray", "3,3").attr("stroke-width", 1)
    .style("display", "none");

  const overlay = g.append("rect")
    .attr("width", innerW).attr("height", innerH).attr("fill", "transparent")
    .style("cursor", "crosshair");

  overlay.on("mousemove", function(event) {
    const [mx] = d3.pointer(event, this);
    const yr = Math.round(x.invert(mx));
    const point = stackData.find(d => d.year === yr);
    if (!point) { tooltip.style("display", "none"); guide.style("display", "none"); return; }
    guide.attr("x1", x(yr)).attr("x2", x(yr)).style("display", "");
    const yearLabel = (yr === preYearVal && hasPre) ? "Pre-2010" : yr;
    const lines = actors
      .map(a => ({ a, c: point[a] || 0 }))
      .filter(d => d.c > 0)
      .sort((a, b) => b.c - a.c)
      .map(d => `<div style="display:flex;align-items:center;gap:6px;"><span style="width:8px;height:8px;background:${actorColor(d.a)};border-radius:50%;"></span>${d.a}: <strong>${d.c}</strong></div>`)
      .join("");
    tooltip.html(`<div style="font-weight:600;margin-bottom:3px;">${yearLabel}</div>${lines || '<div style="color:#999;">no activity</div>'}`)
      .style("display", "block")
      .style("left", (margin.left + x(yr) + 10) + "px")
      .style("top", (margin.top + 10) + "px");
  }).on("mouseleave", () => {
    tooltip.style("display", "none");
    guide.style("display", "none");
  });

  // Visual break between Pre and 2010+
  if (hasPre && postYears.length) {
    const breakX = (x(preYearVal) + x(postYears[0])) / 2;
    g.append("line")
      .attr("x1", breakX).attr("x2", breakX)
      .attr("y1", -4).attr("y2", innerH + 4)
      .attr("stroke", "#bbb").attr("stroke-width", 1)
      .attr("stroke-dasharray", "3,3");
  }

  // Legend — pill style
  const legend = svg.append("g").attr("transform", `translate(${margin.left + 8}, 4)`);
  let lx = 0;
  actors.forEach((a) => {
    const ac = actorColor(a);
    const lg = legend.append("g").attr("transform", `translate(${lx}, 0)`);
    const txt = lg.append("text").attr("y", 11).text(a)
      .style("font-size", "11px").style("fill", "#5C6771").style("font-weight", "600")
      .style("font-family", "'IBM Plex Sans', sans-serif");
    const tw = txt.node().getComputedTextLength();
    lg.insert("rect", "text").attr("x", -6).attr("y", -1).attr("width", tw + 12)
      .attr("height", 15).attr("rx", 4)
      .attr("fill", blendToBase(ac, 0.12))
      .attr("stroke", ac).attr("stroke-width", 1.5);
    lx += tw + 20;
  });
}

// ========================================================================
// SANKEY CHART (incident type -> actor -> country)
// ========================================================================
function renderSankey(countryRows, stackedRows, nodeCounts = {}) {
  const el = d3.select("#sankey-chart");
  el.selectAll("*").remove();

  if (!countryRows.length && !stackedRows.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No data available.");
    return;
  }

  const container = document.querySelector(".viz-sankey");
  const width = Math.max(400, container.clientWidth - 32);
  const height = 380;
  const margin = { top: 10, right: 16, bottom: 10, left: 16 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // --- Aggregate data ---
  // Left side: tool -> actor counts (from stacked)
  const toolActorAgg = {};
  stackedRows.forEach(r => {
    const key = `${r.tool}|||${r.actor}`;
    toolActorAgg[key] = (toolActorAgg[key] || 0) + r.count;
  });

  // Right side: actor -> country counts (group beyond top 15 into "Others")
  const countryTotals = {};
  countryRows.forEach(r => { countryTotals[r.country] = (countryTotals[r.country] || 0) + r.count; });
  const sortedCountries = Object.entries(countryTotals).sort((a, b) => b[1] - a[1]);
  const topCountries = sortedCountries.slice(0, 10).map(([n]) => n);
  const topSet = new Set(topCountries);
  const hasOthers = sortedCountries.length > 15;

  const actorCountryAgg = {};
  countryRows.forEach(r => {
    const country = topSet.has(r.country) ? r.country : (hasOthers ? "Others" : r.country);
    const key = `${r.actor}|||${country}`;
    actorCountryAgg[key] = (actorCountryAgg[key] || 0) + r.count;
  });

  const countryNodes = [...topCountries];
  if (hasOthers) countryNodes.push("Others");

  // Collect unique names per column, sorted by total value (descending)
  const toolTotals = {};
  stackedRows.forEach(r => { toolTotals[r.tool] = (toolTotals[r.tool] || 0) + r.count; });
  const toolsInData = Object.entries(toolTotals).sort((a, b) => b[1] - a[1]).map(([n]) => n);

  const actorTotals = {};
  [...stackedRows, ...countryRows].forEach(r => { actorTotals[r.actor] = (actorTotals[r.actor] || 0) + r.count; });
  const actorsInData = Object.entries(actorTotals).sort((a, b) => b[1] - a[1]).map(([n]) => n);

  // Build node list: [tools..., actors..., countries...]
  const nodes = [];
  const nodeMap = {};
  let idx = 0;
  const countryNodeTotals = {};
  countryRows.forEach(r => {
    const country = topSet.has(r.country) ? r.country : (hasOthers ? "Others" : r.country);
    countryNodeTotals[country] = (countryNodeTotals[country] || 0) + r.count;
  });
  // Prefer the unique-incident counts from the API (sum lines up with the
  // headline filter total). Fall back to the multiplicative band totals if
  // the API didn't ship the new field for some reason.
  const uniqTool = nodeCounts.tool || {};
  const uniqActor = nodeCounts.actor || {};
  const uniqCountry = nodeCounts.country || {};
  toolsInData.forEach(t => {
    nodeMap[`tool:${t}`] = idx;
    nodes.push({ name: t, column: "tool", realCount: uniqTool[t] != null ? uniqTool[t] : toolTotals[t] });
    idx++;
  });
  actorsInData.forEach(a => {
    nodeMap[`actor:${a}`] = idx;
    nodes.push({ name: a, column: "actor", realCount: uniqActor[a] != null ? uniqActor[a] : actorTotals[a] });
    idx++;
  });
  countryNodes.forEach(c => {
    nodeMap[`country:${c}`] = idx;
    // "Others" bucket has no single API key — sum the unique counts of the
    // countries it absorbs. Top countries use their direct unique count.
    let unique;
    if (c === "Others") {
      unique = sortedCountries
        .slice(10)
        .reduce((acc, [name]) => acc + (uniqCountry[name] || 0), 0);
    } else {
      unique = uniqCountry[c] != null ? uniqCountry[c] : (countryNodeTotals[c] || 0);
    }
    nodes.push({ name: c, column: "country", realCount: unique });
    idx++;
  });

  // Build links
  // Build raw links and then normalize so both sides of each actor balance
  const rawToolActor = [];
  for (const [key, value] of Object.entries(toolActorAgg)) {
    const [tool, actor] = key.split("|||");
    const s = nodeMap[`tool:${tool}`];
    const t = nodeMap[`actor:${actor}`];
    if (s !== undefined && t !== undefined) rawToolActor.push({ source: s, target: t, value, actor });
  }

  const rawActorCountry = [];
  for (const [key, value] of Object.entries(actorCountryAgg)) {
    const [actor, country] = key.split("|||");
    const s = nodeMap[`actor:${actor}`];
    const t = nodeMap[`country:${country}`];
    if (s !== undefined && t !== undefined) rawActorCountry.push({ source: s, target: t, value, actor });
  }

  // For each actor, compute totals from both sides and scale the larger side down
  const leftTotals = {};
  const rightTotals = {};
  rawToolActor.forEach(l => { leftTotals[l.actor] = (leftTotals[l.actor] || 0) + l.value; });
  rawActorCountry.forEach(l => { rightTotals[l.actor] = (rightTotals[l.actor] || 0) + l.value; });

  const links = [];
  rawToolActor.forEach(l => {
    const lt = leftTotals[l.actor] || 1;
    const rt = rightTotals[l.actor] || 1;
    const scale = rt / lt; // scale left to match right
    links.push({ source: l.source, target: l.target, value: l.value * scale });
  });
  rawActorCountry.forEach(l => {
    links.push({ source: l.source, target: l.target, value: l.value });
  });

  if (!links.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No flow data.");
    return;
  }

  const svg = el.append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const sankey = d3.sankey()
    .nodeId(d => d.index)
    .nodeWidth(130)
    .nodePadding(3)
    .nodeAlign(d3.sankeyCenter)
    .iterations(64)
    .extent([[0, 0], [innerW, innerH]]);

  const graph = sankey({ nodes: nodes.map(d => ({...d})), links: links.map(d => ({...d})) });

  // Enforce minimum height on country nodes so labels always fit
  const minNodeH = 16;
  graph.nodes.forEach(n => {
    if (n.column === "country" && (n.y1 - n.y0) < minNodeH) {
      const mid = (n.y0 + n.y1) / 2;
      n.y0 = mid - minNodeH / 2;
      n.y1 = mid + minNodeH / 2;
    }
  });

  // Links
  g.append("g")
    .selectAll("path")
    .data(graph.links)
    .enter()
    .append("path")
    .attr("class", "sankey-link")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", d => {
      // Color by actor (the middle column)
      const src = d.source;
      const tgt = d.target;
      if (src.column === "actor") return actorColor(src.name);
      if (tgt.column === "actor") return actorColor(tgt.name);
      return "#999";
    })
    .attr("stroke-width", d => Math.max(1, d.width))
    .on("click", (_, d) => {
      const src = d.source;
      const tgt = d.target;
      if (src.column === "tool" && tgt.column === "actor") {
        toggleSet(state.filters.tools, src.name);
        toggleSet(state.filters.actors, tgt.name);
      } else if (src.column === "actor" && tgt.column === "country") {
        toggleSet(state.filters.actors, src.name);
        state.filters.countries.clear();
        state.filters.countries.add(tgt.name);
        $("#country-select").value = tgt.name;
      }
      state.page = 1;
      refresh();
    })
    .append("title")
    .text(d => `${d.source.name} \u2192 ${d.target.name}: ${Math.round(d.value)}`);

  // Nodes
  const node = g.append("g")
    .selectAll("g")
    .data(graph.nodes)
    .enter()
    .append("g")
    .attr("class", "sankey-node");

  function isSankeySelected(d) {
    if (d.column === "actor") return state.filters.actors.has(d.name);
    if (d.column === "tool") return state.filters.tools.has(d.name);
    if (d.column === "country") return state.filters.countries.has(d.name);
    return false;
  }

  node.append("rect")
    .attr("x", d => d.x0)
    .attr("y", d => d.y0)
    .attr("width", d => Math.max(0, d.x1 - d.x0))
    .attr("height", d => Math.max(1, d.y1 - d.y0))
    .attr("fill", d => {
      const c = d.column === "actor" ? actorColor(d.name)
              : d.column === "tool" ? toolColor(d.name)
              : "#5c6771";
      return blendToBase(c, isSankeySelected(d) ? 0.35 : 0.15);
    })
    .attr("stroke", d => {
      if (isSankeySelected(d)) return "#333";
      if (d.column === "actor") return actorColor(d.name);
      if (d.column === "tool") return toolColor(d.name);
      return "#999";
    })
    .attr("stroke-width", d => isSankeySelected(d) ? 2.5 : 1.5)
    .attr("rx", 4)
    .on("click", (_, d) => {
      if (d.column === "actor") toggleSet(state.filters.actors, d.name);
      else if (d.column === "tool") toggleSet(state.filters.tools, d.name);
      else if (d.column === "country") {
        state.filters.countries.clear();
        state.filters.countries.add(d.name);
        $("#country-select").value = d.name;
      }
      state.page = 1;
      refresh();
    });

  // Hover tooltip
  const tooltip = el.append("div")
    .style("position", "absolute").style("pointer-events", "none").style("display", "none")
    .style("background", "rgba(255,255,255,0.95)").style("border", "1px solid #ccc")
    .style("border-radius", "4px").style("padding", "4px 8px").style("font-size", "12px")
    .style("font-family", "'IBM Plex Sans', sans-serif").style("box-shadow", "0 2px 8px rgba(0,0,0,.1)")
    .style("z-index", "100000").style("white-space", "nowrap");

  // Make container relative for tooltip positioning
  el.style("position", "relative");

  node.on("mouseenter", function(e, d) {
    const count = d.realCount || Math.round(d.value);
    tooltip.html(`<strong>${d.name}</strong> <span style="color:#999;margin-left:4px;">${count}</span>`)
      .style("display", "block")
      .style("left", ((d.x0 + d.x1) / 2 + margin.left) + "px")
      .style("top", (d.y0 + margin.top - 28) + "px")
      .style("transform", "translateX(-50%)");
  }).on("mouseleave", function() {
    tooltip.style("display", "none");
  });

  // Labels — inside the node rects
  const nodeW = 130;
  node.each(function(d) {
    const nodeH = d.y1 - d.y0;
    if (nodeH < minNodeH * 0.8) return;

    const grp = d3.select(this);
    const cx = (d.x0 + d.x1) / 2;
    const cy = (d.y0 + d.y1) / 2;

    let fontSize = 11;
    let fill = "#444";
    let fontWeight = "600";

    if (d.column === "actor") {
      fontSize = 13;
      fontWeight = "700";
      fill = "#333";
    }

    // For tools (left column): allow text to wrap to two lines if needed
    if (d.column === "tool" && d.name.length > 16 && nodeH >= 28) {
      // Split into two lines
      const words = d.name.split(" ");
      let line1 = "", line2 = "";
      for (const w of words) {
        if ((line1 + " " + w).trim().length <= 16 && !line2) {
          line1 = (line1 + " " + w).trim();
        } else {
          line2 = (line2 + " " + w).trim();
        }
      }
      const textEl = grp.append("text")
        .attr("x", cx).attr("text-anchor", "middle")
        .style("font-size", fontSize + "px").style("fill", fill)
        .style("font-weight", fontWeight)
        .style("font-family", "'IBM Plex Sans', sans-serif")
        .style("pointer-events", "none");
      textEl.append("tspan").attr("x", cx).attr("dy", "-0.6em").text(line1);
      textEl.append("tspan").attr("x", cx).attr("dy", "1.1em").text(line2);
      textEl.attr("y", cy);
      if (nodeH >= 36) {
        grp.append("text").attr("x", cx).attr("y", d.y1 - 4)
          .attr("text-anchor", "middle")
          .text(d.realCount || Math.round(d.value)).style("font-size", "9px").style("fill", "#999")
          .style("font-family", "'Space Mono', monospace").style("pointer-events", "none");
      }
    } else {
      // Single line, truncate if needed
      const maxChars = d.column === "actor" ? 14 : 16;
      const label = d.name.length > maxChars ? d.name.substring(0, maxChars - 1) + "…" : d.name;
      const hasRoom = nodeH >= 28;
      grp.append("text")
        .attr("x", cx).attr("y", hasRoom ? cy - 3 : cy).attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .text(label)
        .style("font-size", fontSize + "px").style("fill", fill)
        .style("font-weight", fontWeight)
        .style("font-family", "'IBM Plex Sans', sans-serif")
        .style("pointer-events", "none");
      if (hasRoom) {
        grp.append("text").attr("x", cx).attr("y", cy + 10).attr("dy", "0.35em")
          .attr("text-anchor", "middle")
          .text(d.realCount || Math.round(d.value)).style("font-size", "9px").style("fill", "#999")
          .style("font-family", "'Space Mono', monospace").style("pointer-events", "none");
      }
    }
  });
}

// ========================================================================
// MAP (Leaflet with donut markers + zoom clustering)
// ========================================================================
let map, clusterLayer;

// Country centroid overrides
const CENTROID_OVERRIDES = {
  "Malta":    { lat: 35.9, lon: 14.5 },
  "Iceland":  { lat: 64.96, lon: -19.02 },
  "Portugal": { lat: 39.4, lon: -8.2 }
};

// Region clustering definitions
const MEGA_REGIONS = {
  "Europe": { lat: 50, lon: 15, countries: new Set() },
  "North America": { lat: 45, lon: -100, countries: new Set() }
};

const SUB_REGIONS = {
  "Western Europe":    { lat: 48.5, lon: 2, countries: ["France","Germany","Belgium","Netherlands","Luxembourg","Austria","Switzerland","Liechtenstein"] },
  "Eastern Europe":    { lat: 50, lon: 25, countries: ["Poland","Czech Republic","Slovakia","Hungary","Romania","Bulgaria","Moldova","Ukraine","Belarus"] },
  "Nordic":            { lat: 62, lon: 15, countries: ["Sweden","Norway","Finland","Denmark","Iceland"] },
  "Baltic":            { lat: 57, lon: 24, countries: ["Estonia","Latvia","Lithuania"] },
  "Southern Europe":   { lat: 41, lon: 14, countries: ["Italy","Spain","Portugal","Greece","Malta","Cyprus","Croatia","Slovenia","Montenegro","Albania","North Macedonia","Serbia","Bosnia and Herzegovina","Kosovo"] },
  "Caucasus/EaP":      { lat: 42, lon: 44, countries: ["Georgia","Armenia","Azerbaijan"] },
  "British Isles":     { lat: 54, lon: -2, countries: ["United Kingdom","Ireland"] },
  "North America":     { lat: 45, lon: -100, countries: ["United States","Canada"] }
};

function getSubRegion(country) {
  for (const [region, def] of Object.entries(SUB_REGIONS)) {
    if (def.countries.includes(country)) return region;
  }
  return null;
}

function getMegaRegion(country) {
  for (const [, def] of Object.entries(SUB_REGIONS)) {
    if (def.countries.includes(country)) {
      if (def.countries.includes("United States")) return "North America";
      return "Europe";
    }
  }
  return null;
}

function initMap() {
  if (map) return map;
  map = L.map("map", { scrollWheelZoom: true, worldCopyJump: true }).setView([48, 10], 4);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { maxZoom: 18, attribution: '&copy; OpenStreetMap &copy; CARTO' }
  ).addTo(map);

  clusterLayer = L.markerClusterGroup({
    maxClusterRadius: (zoom) => {
      if (zoom <= 3) return 120;
      if (zoom <= 5) return 60;
      return 30;
    },
    iconCreateFunction: (cluster) => {
      const counts = {};
      cluster.getAllChildMarkers().forEach(m => {
        const parts = m.options.actorCounts || {};
        for (const [a, c] of Object.entries(parts)) counts[a] = (counts[a] || 0) + c;
      });
      const tot = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
      const donutData = donutSVG(counts, tot);
      const size = donutData.containerSize;
      const anchor = size / 2;
      return L.divIcon({
        html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${donutData.svg}<div class="lmc-label">${tot}</div></div>`,
        className: "",
        iconSize: [size, size],
        iconAnchor: [anchor, anchor]
      });
    }
  });
  map.addLayer(clusterLayer);
  return map;
}

function renderMap(countryRows, countryMeta) {
  initMap();
  clusterLayer.clearLayers();

  // Apply centroid overrides
  for (const [country, coords] of Object.entries(CENTROID_OVERRIDES)) {
    if (!countryMeta[country]) countryMeta[country] = coords;
    else { countryMeta[country].lat = coords.lat; countryMeta[country].lon = coords.lon; }
  }

  // Group by country
  const byCountry = {};
  countryRows.forEach(r => {
    if (!byCountry[r.country]) byCountry[r.country] = {};
    byCountry[r.country][r.actor] = (byCountry[r.country][r.actor] || 0) + r.count;
  });

  for (const [country, counts] of Object.entries(byCountry)) {
    const m = countryMeta[country];
    if (!m) continue;
    const tot = Object.values(counts).reduce((a, b) => a + b, 0);
    const donutData = donutSVG(counts, tot);
    const size = donutData.containerSize;
    const anchor = size / 2;
    const icon = L.divIcon({
      html: `<div style="position:relative;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${donutData.svg}<div class="lmc-label">${tot}</div></div>`,
      className: "",
      iconSize: [size, size],
      iconAnchor: [anchor, anchor]
    });
    const marker = L.marker([m.lat, m.lon], {
      icon,
      title: `${country}: ${tot} incidents`,
      actorCounts: counts
    }).on("click", () => {
      state.filters.countries.clear();
      state.filters.countries.add(country);
      $("#country-select").value = country;
      state.page = 1;
      refresh();
    });
    marker.bindTooltip(`<strong>${country}</strong><br>${tot} incidents`, { direction: "top", offset: [0, -anchor] });
    clusterLayer.addLayer(marker);
  }
}

function calculateDonutRadius(total) {
  const minR = 16, maxR = 34;
  const scale = Math.log(total + 1) / Math.log(101);
  return minR + (maxR - minR) * Math.min(scale, 1);
}

function donutSVG(counts, total) {
  const actors = Object.keys(counts);
  total = total || actors.reduce((s, a) => s + counts[a], 0) || 1;
  const r = calculateDonutRadius(total);
  const containerSize = Math.max(40, r * 2 + 8);
  const arc = d3.arc().innerRadius(r * 0.55).outerRadius(r);
  let start = 0;

  const paths = actors.map(a => {
    const val = counts[a];
    const angle = (val / total) * 2 * Math.PI;
    const d = arc({ startAngle: start, endAngle: start + angle });
    const fill = actorColor(a);
    start += angle;
    return `<path d="${d}" fill="${fill}"></path>`;
  }).join("");

  return {
    svg: `<svg viewBox="${-r} ${-r} ${r*2} ${r*2}" width="${r*2}" height="${r*2}">${paths}</svg>`,
    radius: r,
    containerSize
  };
}

// ========================================================================
// STACKED BAR CHART (incident types by actor)
// ========================================================================
function renderStacked(rows) {
  const el = d3.select("#stackedbar");
  el.selectAll("*").remove();

  if (!rows.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No data.");
    return;
  }

  const tools = Array.from(new Set(rows.map(d => d.tool))).sort();
  const actors = Array.from(new Set(rows.map(d => d.actor))).sort();
  initializeToolColors(tools);

  const nested = d3.rollup(rows, v => {
    const byActor = d3.rollup(v, vv => d3.sum(vv, d => d.count), d => d.actor);
    return Object.fromEntries(byActor);
  }, d => d.tool);
  const seriesData = tools.map(t => ({ tool: t, ...nested.get(t) }));

  const container = document.querySelector(".stacked-section");
  const width = Math.max(400, container.clientWidth - 32);
  const height = Math.max(200, tools.length * 32 + 60);

  const svg = el.append("svg").attr("width", width).attr("height", height);
  const labelW = 180;

  const x = d3.scaleLinear()
    .domain([0, d3.max(seriesData, d => d3.sum(actors, a => d[a] || 0)) || 1])
    .range([labelW, width - 20]);

  const y = d3.scaleBand().domain(tools).range([16, height - 16]).paddingInner(0.25);

  // Tool labels
  tools.forEach(tool => {
    const tc = toolColor(tool);
    const grp = svg.append("g").attr("class", "axis-click").style("cursor", "pointer")
      .on("click", () => { toggleSet(state.filters.tools, tool); state.page = 1; refresh(); });

    grp.append("rect")
      .attr("x", 8).attr("y", y(tool) + 1)
      .attr("width", labelW - 16).attr("height", y.bandwidth() - 2)
      .attr("rx", 4)
      .attr("fill", blendToBase(tc, 0.12))
      .attr("stroke", tc)
      .attr("stroke-width", 1.5);

    grp.append("text")
      .attr("x", labelW / 2).attr("y", y(tool) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "middle")
      .style("font-size", "11px").style("fill", "#5C6771").style("font-weight", "600")
      .style("font-family", "'IBM Plex Sans', sans-serif")
      .text(tool);
  });

  // Stacked segments
  tools.forEach(tool => {
    let x0 = labelW;
    actors.forEach(actor => {
      const value = (seriesData.find(s => s.tool === tool)?.[actor]) || 0;
      if (!value) return;
      const barW = Math.max(0, x(value) - x(0));
      svg.append("rect")
        .attr("class", "sb-seg")
        .attr("x", x0).attr("y", y(tool))
        .attr("width", barW).attr("height", y.bandwidth())
        .attr("fill", actorColor(actor))
        .attr("rx", 1)
        .on("click", () => {
          toggleSet(state.filters.tools, tool);
          toggleSet(state.filters.actors, actor);
          state.page = 1; refresh();
        })
        .append("title").text(`${tool} \u2022 ${actor}: ${value}`);
      x0 += barW;
    });
  });

  // Actor legend — pill style matching filter bar
  const legend = svg.append("g").attr("transform", `translate(${labelW + 8}, ${height - 14})`);
  let legendX = 0;
  actors.forEach((a) => {
    const ac = actorColor(a);
    const lg = legend.append("g").attr("transform", `translate(${legendX}, 0)`);
    const txt = lg.append("text").attr("y", 11).text(a)
      .style("font-size", "11px").style("fill", "#5C6771").style("font-weight", "600")
      .style("font-family", "'IBM Plex Sans', sans-serif");
    const tw = txt.node().getComputedTextLength();
    lg.insert("rect", "text").attr("x", -6).attr("y", -1).attr("width", tw + 12)
      .attr("height", 15).attr("rx", 4)
      .attr("fill", blendToBase(ac, 0.12))
      .attr("stroke", ac).attr("stroke-width", 1.5);
    legendX += tw + 20;
  });
}

// ========================================================================
// TTP TREEMAP (nested: incident type > TTP, sized by count)
// ========================================================================
function renderTtpTreemap(ttpByType) {
  const el = d3.select("#ttp-treemap");
  if (!el.node()) return;
  el.selectAll("*").remove();

  // Build hierarchy: root > incident_type > ttp
  const children = [];
  for (const [type, rows] of Object.entries(ttpByType)) {
    if (!rows || !rows.length) continue;
    const ttpCounts = {};
    rows.forEach(r => { ttpCounts[r.ttp] = (ttpCounts[r.ttp] || 0) + r.count; });
    const typeChildren = Object.entries(ttpCounts).map(([ttp, count]) => ({ name: ttp, value: count, type }));
    if (typeChildren.length) children.push({ name: type, children: typeChildren });
  }

  if (!children.length) {
    el.append("div").style("padding", "1rem").style("color", "#999").style("text-align", "center").style("font-size", "13px").text("No TTPs yet.");
    return;
  }

  const container = el.node();
  const width = container.clientWidth || 800;
  const height = 160;

  const root = d3.hierarchy({ name: "root", children })
    .sum(d => d.value || 0)
    .sort((a, b) => b.value - a.value);

  d3.treemap().size([width, height]).padding(2).paddingTop(16).round(true)(root);

  const svg = el.append("svg").attr("width", width).attr("height", height);

  // Type groups
  const typeGroups = svg.selectAll("g.type-group")
    .data(root.children || [])
    .join("g").attr("class", "type-group");

  // Type header background
  typeGroups.append("rect")
    .attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("width", d => d.x1 - d.x0).attr("height", d => d.y1 - d.y0)
    .attr("fill", d => {
      const tc = toolColor(d.data.name);
      return tc ? blendToBase(tc, 0.06) : "rgba(0,0,0,.02)";
    })
    .attr("stroke", "rgba(0,0,0,.08)").attr("rx", 3);

  // Type label
  typeGroups.append("text")
    .attr("x", d => d.x0 + 4).attr("y", d => d.y0 + 11)
    .style("font-size", "9px").style("fill", "#999").style("font-weight", "600")
    .style("font-family", "'Space Mono', monospace").style("text-transform", "uppercase")
    .text(d => d.data.name.replace(/_/g, " "));

  // TTP leaves
  const leaves = svg.selectAll("g.leaf")
    .data(root.leaves())
    .join("g").attr("class", "leaf").style("cursor", "pointer");

  const activeTtp = state.filters.ttp;

  leaves.append("rect")
    .attr("x", d => d.x0).attr("y", d => d.y0)
    .attr("width", d => Math.max(0, d.x1 - d.x0)).attr("height", d => Math.max(0, d.y1 - d.y0))
    .attr("fill", d => {
      const tc = toolColor(d.parent.data.name);
      return tc ? blendToBase(tc, d.data.name === activeTtp ? 0.5 : 0.25) : "rgba(0,0,0,.06)";
    })
    .attr("stroke", d => d.data.name === activeTtp ? "#333" : null)
    .attr("stroke-width", d => d.data.name === activeTtp ? 2 : 0)
    .attr("rx", 2);

  leaves.append("text")
    .attr("x", d => d.x0 + 4).attr("y", d => d.y0 + (d.y1 - d.y0) / 2 + 4)
    .style("font-size", d => (d.x1 - d.x0) < 60 ? "0" : "11px")
    .style("fill", d => d.data.name === activeTtp ? "#222" : "#5C6771")
    .style("font-weight", d => d.data.name === activeTtp ? "700" : "500")
    .style("font-family", "'IBM Plex Sans', sans-serif")
    .text(d => {
      const w = d.x1 - d.x0;
      if (w < 60) return "";
      const label = `${d.data.name} (${d.data.value})`;
      return w < 100 ? d.data.name : label;
    });

  leaves.append("title").text(d => `${d.parent.data.name} \u203a ${d.data.name}: ${d.data.value}`);

  // Click: filter incidents by TTP
  leaves.on("click", (e, d) => {
    state.filters.ttp = state.filters.ttp === d.data.name ? "" : d.data.name;
    state.page = 1;
    refresh();
  });

  // Hover
  leaves.on("mouseenter", function(e, d) {
    d3.select(this).select("rect").attr("stroke", "#333").attr("stroke-width", 1.5);
  }).on("mouseleave", function() {
    d3.select(this).select("rect").attr("stroke", null).attr("stroke-width", null);
  });
}

// ========================================================================
// INCIDENT LIST (reverse chronological)
// ========================================================================
function renderList(incidents) {
  const el = $("#list");
  el.innerHTML = "";

  if (!incidents.length) {
    el.innerHTML = '<div style="padding:2rem;color:#666;text-align:center;">No incidents match the current filters.</div>';
    return;
  }

  incidents.forEach(inc => {
    const d = document.createElement("div");
    d.className = "incident";

    // Year range display
    const startYr = inc.start_year || "?";
    // end_year null = open-ended; a concrete year means we know when it ended.
    const endYr = inc.end_year || "ongoing";
    const yearRange = startYr === endYr ? `${startYr}` : `${startYr} \u2014 ${endYr}`;

    // Actor pills
    const actorPills = (inc.actors || []).map(a =>
      `<span class="tag tag-actor pill-tag" data-v="${a}" style="background:${blendToBase(actorColor(a), 0.12)};border-color:${actorColor(a)};color:#5C6771">${a}</span>`
    ).join("");

    // Country pills
    const countryPills = (inc.countries || []).map(c =>
      `<span class="tag tag-country" data-v="${c}">${c}</span>`
    ).join("");

    // Tool/type pills — filled with type color
    const toolPills = (inc.tools || []).map(t =>
      `<span class="tag tag-tool pill-tag" data-v="${t}" style="background:${blendToBase(toolColor(t), 0.12)};border-color:${toolColor(t)};color:#5C6771">${t}</span>`
    ).join("");

    // Type / TTP combined
    const ttpSuffix = (inc.ttps || []).length
      ? ' <span class="tag-sep">/</span> ' + (inc.ttps || []).map(t => `<span class="tag tag-ttp">${t}</span>`).join("")
      : "";

    const adminEditLink = window.isAdmin
      ? `<a href="/ait_admin" class="admin-edit-link" title="Edit in Admin" onclick="event.stopPropagation()">&#9998;</a>` : "";

    const summarySnippet = (inc.summary || "").substring(0, 200);

    // Separator
    const sep = '<span class="tag-sep">&gt;</span>';
    const typeSep = '<span class="tag-sep">//</span>';

    d.innerHTML = `
      ${adminEditLink}
      <div class="title" data-id="${inc.id}">
        ${inc.title || "(untitled)"}
      </div>
      <div class="meta">
        <span>${yearRange}</span>
        ${inc.campaign_name ? `<span>Campaign: ${inc.campaign_name}</span>` : ""}
      </div>
      ${summarySnippet ? `<div class="summary-text">${summarySnippet}${(inc.summary||"").length > 200 ? "..." : ""}</div>` : ""}
      <div class="tags-row">
        <div class="tags tags-left">
          ${actorPills}${actorPills && countryPills ? sep : ""}${countryPills}
        </div>
        <div class="tags tags-right">
          ${toolPills}${ttpSuffix}
        </div>
      </div>
    `;
    el.appendChild(d);
  });

  // Bind tag clicks
  $$(".tag-actor").forEach(t => t.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSet(state.filters.actors, e.currentTarget.dataset.v);
    state.page = 1; refresh();
  }));
  $$(".tag-country").forEach(t => t.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSet(state.filters.countries, e.currentTarget.dataset.v);
    $("#country-select").value = state.filters.countries.size === 1 ? Array.from(state.filters.countries)[0] : "";
    state.page = 1; refresh();
  }));
  $$(".tag-tool").forEach(t => t.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSet(state.filters.tools, e.currentTarget.dataset.v);
    state.page = 1; refresh();
  }));

  // Highlight active tags
  $$(".tag-actor").forEach(t => { if (state.filters.actors.has(t.dataset.v)) t.classList.add("selected"); });
  $$(".tag-country").forEach(t => { if (state.filters.countries.has(t.dataset.v)) t.classList.add("selected"); });
  $$(".tag-tool").forEach(t => { if (state.filters.tools.has(t.dataset.v)) t.classList.add("selected"); });

  // Bind entire card click -> modal (except links/tags)
  $$(".incident").forEach(card => {
    card.style.cursor = "pointer";
    card.addEventListener("click", (e) => {
      // Don't open modal if clicking a tag or link
      if (e.target.closest(".tag") || e.target.closest("a")) return;
      const id = card.querySelector(".title")?.dataset.id;
      const inc = incidents.find(i => String(i.id) === String(id));
      if (inc) openModal(inc);
    });
  });
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

// ========================================================================
// INCIDENT DETAIL MODAL (top-secret classified file style)
// ========================================================================
function openModal(inc) {
  const body = $("#modal-body");

  const startYr = inc.start_year || "?";
  // end_year null = open-ended; a concrete year means we know when it ended.
    const endYr = inc.end_year || "ongoing";
  const yearRange = startYr === endYr ? `${startYr}` : `${startYr} \u2014 ${endYr}`;

  const actorTags = (inc.actors || []).map(a =>
    `<span class="modal-tag" style="background:${blendToBase(actorColor(a), 0.12)};border-color:${actorColor(a)};color:#5C6771">${a}</span>`
  ).join("");

  const countryTags = (inc.countries || []).map(c =>
    `<span class="modal-tag">${c}</span>`
  ).join("");

  const toolTags = (inc.tools || []).map(t =>
    `<span class="modal-tag" style="background:${blendToBase(toolColor(t), 0.12)};border-color:${toolColor(t)};color:#5C6771">${t}</span>`
  ).join("");

  const sourceLinks = (inc.source_urls || []).map(s =>
    `<div class="modal-source"><a href="${s}" target="_blank" rel="noopener">${s}</a></div>`
  ).join("");

  const entityTags = (inc.entities || []).map(e => {
    const cls = e.role === 'perpetrator' || e.role === 'attributed_group' ? 'ent-perp'
      : e.role === 'target' ? 'ent-tgt' : e.role === 'tool' ? 'ent-tool' : 'ent-src';
    return `<span class="modal-tag modal-tag--${cls}" title="${e.entity_type} — ${e.role}">${e.name}</span>`;
  }).join("");

  const ttpTags = (inc.ttps || []).map(t =>
    `<span class="modal-tag modal-tag--ttp">${t}</span>`
  ).join("");

  // Find related incidents (shared entities, excluding self)
  const incEntityIds = new Set((inc.entities || []).map(e => (e.normalized_name || e.name).toLowerCase()));
  let related = [];
  if (lastData && lastData.incidents && incEntityIds.size) {
    const allIncs = _allIncidentsCache || [];
    related = allIncs
      .filter(other => other.id !== inc.id)
      .map(other => {
        const otherIds = new Set((other.entities || []).map(e => (e.normalized_name || e.name).toLowerCase()));
        const overlap = [...incEntityIds].filter(id => otherIds.has(id)).length;
        return { ...other, overlap };
      })
      .filter(o => o.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3);
  }

  const confPct = inc.confidence_score != null ? Math.round(inc.confidence_score * 100) : null;
  const confidence = confPct != null
    ? `${confPct}%
       <span class="confidence-bar"><span class="confidence-fill" style="width:${confPct}%"></span></span>`
    : "N/A";

  const adminLink = window.isAdmin
    ? `<a href="/review/incident/${inc.id}" title="Edit">&#9998; Edit in Review UI</a>` : "";

  // Build type/TTP combined line: "Cyber Operations / data theft, network intrusion"
  const typeTtpLine = (inc.tools || []).map(t => {
    const tc = toolColor(t);
    const tag = `<span class="modal-tag" style="background:${blendToBase(tc, 0.12)};border-color:${tc};color:#5C6771">${t}</span>`;
    // Find TTPs belonging to this type
    const matchingTtps = (inc.ttps || []).filter(ttp => {
      // Check if this TTP's parent type matches (use display name mapping)
      return true; // show all TTPs alongside — they're already per-type from extraction
    });
    return tag;
  }).join("") + (inc.ttps && inc.ttps.length ? ' <span style="color:#bbb;margin:0 4px;">/</span> ' +
    inc.ttps.map(t => `<span class="modal-tag modal-tag--ttp">${t}</span>`).join("") : "");

  body.innerHTML = `
    <div class="file-header">
      <h2>${inc.title || "(untitled)"}</h2>
      <div class="date-range">${yearRange}${inc.campaign_name ? ` &middot; ${inc.campaign_name}` : ''}</div>
    </div>

    <div class="field-value">${inc.summary || "No summary available."}</div>

    <div class="modal-row">
      <div><div class="field-label">Threat Actors</div><div class="modal-tags">${actorTags || "—"}</div></div>
      <div style="text-align:right;"><div class="field-label" style="text-align:right;">Target Countries</div><div class="modal-tags" style="justify-content:flex-end;">${countryTags || "—"}</div></div>
    </div>

    <div class="modal-row">
      <div><div class="field-label">Type / TTPs</div><div class="modal-tags">${typeTtpLine || "—"}</div></div>
    </div>

    ${entityTags ? `
    <div class="field-label">Entities</div>
    <div class="field-value"><div class="modal-tags">${entityTags}</div></div>
    ` : ""}

    ${inc.attribution_basis ? `
    <div class="field-label">Attribution</div>
    <div class="field-value" style="font-size:13px;color:#666;">${inc.attribution_basis}</div>
    ` : ""}

    ${sourceLinks ? `
    <div class="field-label">Sources</div>
    <div class="field-value">${sourceLinks}</div>
    ` : ""}

    ${related.length ? `
    <div class="field-label">Related Incidents <span style="font-weight:400;color:#999;">(shared entities)</span></div>
    <div class="field-value">
      ${related.map(r => `<div class="modal-related" data-id="${r.id}" style="cursor:pointer;padding:4px 0;border-bottom:1px solid rgba(0,0,0,.05);">
        <strong>${r.title}</strong>
        <span style="color:#999;font-size:12px;margin-left:6px;">${r.overlap} shared</span>
      </div>`).join("")}
    </div>
    ` : ""}

    <div class="modal-footer">
      <a href="/incident/${inc.slug || inc.id}" title="Permalink">/incident/${inc.slug || inc.id}</a>
      <button class="btn-copy" onclick="navigator.clipboard.writeText(window.location.origin+'/incident/${inc.slug || inc.id}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy link',1500);})">Copy link</button>
      ${adminLink}
    </div>
  `;

  // Bind related incident clicks
  body.querySelectorAll(".modal-related").forEach(el => {
    el.addEventListener("click", () => {
      const rid = el.dataset.id;
      const related = _allIncidentsCache.find(i => i.id === rid);
      if (related) openModal(related);
    });
  });

  $("#incident-modal-overlay").style.display = "flex";
  document.body.style.overflow = "hidden";

  // Push incident permalink to URL
  const slug = inc.slug || inc.id;
  history.pushState({ modal: slug }, "", `/incident/${slug}`);
}

function closeModal() {
  $("#incident-modal-overlay").style.display = "none";
  document.body.style.overflow = "";

  // Restore the filter URL (or just root)
  const filterUrl = buildFilterURL();
  history.pushState({}, "", filterUrl || "/");
}

function buildFilterURL() {
  const p = new URLSearchParams();
  if (state.filters.start) p.set("start", state.filters.start);
  if (state.filters.end) p.set("end", state.filters.end);
  if (state.filters.q) p.set("q", state.filters.q);
  if (state.filters.actors.size) p.set("actors", Array.from(state.filters.actors).join(","));
  if (state.filters.countries.size) p.set("countries", Array.from(state.filters.countries).join(","));
  if (state.filters.tools.size) p.set("tools", Array.from(state.filters.tools).join(","));
  if (state.filters.entities.size) p.set("entities", Array.from(state.filters.entities).join(","));
  if (state.filters.ttp) p.set("ttp", state.filters.ttp);
  if (state.filters.region) p.set("region", state.filters.region);
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

// ---- Utility ----
function toggleSet(set, val) {
  if (set.has(val)) set.delete(val); else set.add(val);
}

// ---- Browser back button closes modal ----
window.addEventListener("popstate", () => {
  if ($("#incident-modal-overlay").style.display === "flex") {
    $("#incident-modal-overlay").style.display = "none";
    document.body.style.overflow = "";
  }
});

// ========================================================================
// ENTITY NETWORK GRAPH + TABLE
// ========================================================================

const ENT_TYPE_COLORS = {
  military: '#C7074D', government: '#0068B2', organization: '#3A8A6E',
  person: '#D4A843', infrastructure: '#5B9FCC', media: '#D4587A', malware: '#9B59B6',
};
const ENT_ROLE_STROKES = {
  perpetrator: '#C7074D', target: '#0068B2', attributed_group: '#D4587A',
  source: '#999', tool: '#9B59B6',
};

let entitySimulation = null;
let entityRawData = { nodes: [], edges: [] };
const selectedEntities = new Set();  // clicked entity names for incident filtering
let entityClickRefresh = false;  // true when refresh was triggered by entity click

async function refreshEntityNetwork() {
  // Force-directed network still pulls from /api/entities/network because
  // it needs the {nodes, edges} shape. The chord + table read from the
  // /api/incidents response (lastData) so they don't require this fetch.
  const params = currentParams();
  try {
    const res = await fetch(`/api/entities/network?${params}`);
    entityRawData = await res.json();
    renderEntityFiltered();
  } catch(e) {
    console.error("EntityNetwork:", e);
    renderEntityFiltered();  // still render chord + table from lastData
  }
}

// Active entity view ('chord' | 'network'). Drives whether the
// min-incidents slider applies — chord view ignores it and shows the
// top-25 by frequency regardless.
let entityView = 'chord';

function _entityFilters() {
  const sliderVal = parseInt((document.getElementById('ent-min-slider') || {}).value) || 3;
  return {
    // Only the network view filters by min-incidents; the chord always
    // shows the top entities regardless so users don't have to fiddle
    // with the slider to see anything.
    minInc: entityView === 'network' ? sliderVal : 1,
    role:   (document.getElementById('ent-role-filter') || {}).value || 'all',
    type:   (document.getElementById('ent-type-filter') || {}).value || 'all',
    showSources: (document.getElementById('ent-show-sources') || {}).checked || false,
  };
}

function _passesEntityFilters(rec, f) {
  // rec can be a network node (incident_count, role, entity_type) or a
  // chord/table row (total, roles[], type). Normalize the access.
  const total = rec.incident_count != null ? rec.incident_count : rec.total;
  if (total < f.minInc) return false;
  const roles = rec.roles ? rec.roles : (rec.role ? [rec.role] : []);
  if (!f.showSources && roles.includes('source') && !roles.some(r => r !== 'source')) return false;
  if (f.role !== 'all' && !roles.includes(f.role)) return false;
  const t = rec.entity_type || rec.type;
  if (f.type !== 'all' && t !== f.type) return false;
  return true;
}

function renderEntityFiltered() {
  const f = _entityFilters();

  // --- Force-directed network (alternate view) ---
  const allNodes = (entityRawData && entityRawData.nodes) || [];
  let graphNodes = allNodes.filter(n => _passesEntityFilters(n, f));
  let nodeIds = new Set(graphNodes.map(n => n.id));
  let graphEdges = (entityRawData.edges || []).filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  if (selectedEntities.size) {
    const neighbors = new Set(selectedEntities);
    graphEdges.forEach(e => {
      if (selectedEntities.has(e.source)) neighbors.add(e.target);
      if (selectedEntities.has(e.target)) neighbors.add(e.source);
    });
    graphNodes = graphNodes.filter(n => neighbors.has(n.id));
    nodeIds = new Set(graphNodes.map(n => n.id));
    graphEdges = graphEdges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
  // --- Chord + richer table (default view) ---
  const tableData = (lastData && lastData.entity_table) || [];
  const chordPairs = (lastData && lastData.entity_chord) || [];
  const filteredEntities = tableData.filter(r => _passesEntityFilters(r, f));

  // Defer chart + table render to the next frame so the grid cell has its
  // computed height before the chord measures container.clientHeight.
  // Without this, on first load the chord can read clientHeight=0 and
  // self-size to a fallback while the wrap is correctly 620px, making
  // the two panes look misaligned.
  requestAnimationFrame(() => {
    renderEntityGraph({ nodes: graphNodes, edges: graphEdges });
    renderEntityChord(filteredEntities, chordPairs);
    renderEntityTable(filteredEntities);
    bindInfoTips();
  });
}

// Cap chord at this many entities so the ring stays readable. Anything
// beyond is still in the table; chord shows the heavy hitters.
const CHORD_TOP_N = 25;

function renderEntityChord(entities, allPairs) {
  const container = document.getElementById('entity-chord');
  if (!container) return;
  container.innerHTML = '';
  if (!entities.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">No entities match the current filters.</div>';
    return;
  }

  // Pick the top-N entities by total. Anything beyond is summarized as a
  // single "Others" arc carrying the leftover ribbons collapsed into it.
  const top = entities.slice(0, CHORD_TOP_N);
  const topNorms = new Set(top.map(e => e.normalized_name));
  const topIdx = new Map(top.map((e, i) => [e.normalized_name, i]));

  // Build symmetric matrix
  const n = top.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  let maxPair = 0;
  (allPairs || []).forEach(p => {
    const i = topIdx.get(p.a), j = topIdx.get(p.b);
    if (i == null || j == null) return;
    matrix[i][j] += p.count;
    matrix[j][i] += p.count;
    maxPair = Math.max(maxPair, p.count);
  });

  // Many entities have no co-occurrers in the top set — give them a tiny
  // self-weight so they still show up as a sliver of arc rather than vanish.
  for (let i = 0; i < n; i++) {
    const rowSum = matrix[i].reduce((a, b) => a + b, 0);
    if (rowSum === 0) matrix[i][i] = 1;
  }

  const width = container.clientWidth || 600;
  // Use the container's actual height so the chord fills the layout cell;
  // fall back to a square if clientHeight is 0 (rare, pre-layout edge case).
  const height = container.clientHeight || Math.max(420, Math.min(640, width));
  const outerR = Math.min(width, height) / 2 - 110;
  const innerR = outerR - 14;

  const svg = d3.select(container).append('svg')
    .attr('width', width).attr('height', height)
    .attr('viewBox', [-width / 2, -height / 2, width, height]);

  const chord = d3.chord().padAngle(0.012).sortSubgroups(d3.descending)(matrix);
  const arc = d3.arc().innerRadius(innerR).outerRadius(outerR);
  const ribbon = d3.ribbon().radius(innerR);

  const colorOf = e => ENT_TYPE_COLORS[e.type] || '#888';

  // Ribbons (drawn under arcs)
  const ribbonG = svg.append('g').attr('fill-opacity', 0.5);
  ribbonG.selectAll('path')
    .data(chord)
    .enter()
    .append('path')
    .attr('d', ribbon)
    .attr('fill', d => {
      // Color the ribbon by the larger end's type — the more central role
      const sIdx = d.source.value > d.target.value ? d.source.index : d.target.index;
      return colorOf(top[sIdx]);
    })
    .attr('stroke', d => {
      const sIdx = d.source.value > d.target.value ? d.source.index : d.target.index;
      return d3.color(colorOf(top[sIdx])).darker(0.5).formatHex();
    })
    .attr('stroke-width', 0.5)
    .style('cursor', 'pointer')
    .on('mouseenter', function(_, d) {
      d3.select(this).attr('fill-opacity', 0.85);
      const a = top[d.source.index], b = top[d.target.index];
      // Look up actual count (matrix may have self-padding)
      const c = matrix[d.source.index][d.target.index];
      showFloatingTip(this, `<strong>${a.name}</strong> ↔ <strong>${b.name}</strong><br><span style="color:#aab;">${c} co-incident${c === 1 ? '' : 's'}</span>`);
    })
    .on('mouseleave', function() {
      d3.select(this).attr('fill-opacity', 0.5);
      hideFloatingTip();
    })
    .on('click', (_, d) => {
      // Filter to both entities
      const a = top[d.source.index], b = top[d.target.index];
      selectedEntities.clear();
      selectedEntities.add(a.normalized_name);
      selectedEntities.add(b.normalized_name);
      state.filters.entities = new Set(selectedEntities);
      state.page = 1;
      entityClickRefresh = true;
      refresh();
    });

  // Arc groups
  const groupG = svg.append('g');
  const group = groupG.selectAll('g')
    .data(chord.groups)
    .enter()
    .append('g')
    .style('cursor', 'pointer');

  group.append('path')
    .attr('d', arc)
    .attr('fill', d => colorOf(top[d.index]))
    .attr('stroke', d => d3.color(colorOf(top[d.index])).darker(0.5).formatHex())
    .attr('stroke-width', 1)
    .on('mouseenter', function(_, d) {
      const e = top[d.index];
      showFloatingTip(this, `<strong>${e.name}</strong> <span style="color:#aab;">(${e.type || '—'})</span><br>${e.total} incident${e.total === 1 ? '' : 's'}`);
      // Dim non-connected ribbons
      ribbonG.selectAll('path').attr('fill-opacity', r =>
        (r.source.index === d.index || r.target.index === d.index) ? 0.85 : 0.08
      );
    })
    .on('mouseleave', function() {
      hideFloatingTip();
      ribbonG.selectAll('path').attr('fill-opacity', 0.5);
    })
    .on('click', (_, d) => {
      const e = top[d.index];
      if (selectedEntities.has(e.normalized_name)) selectedEntities.delete(e.normalized_name);
      else { selectedEntities.clear(); selectedEntities.add(e.normalized_name); }
      state.filters.entities = new Set(selectedEntities);
      state.page = 1;
      entityClickRefresh = true;
      refresh();
    });

  // Arc labels — position outside the arc at its midpoint
  group.append('text')
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('dy', '.35em')
    .attr('transform', d =>
      `rotate(${(d.angle * 180 / Math.PI - 90)})` +
      `translate(${outerR + 8})` +
      (d.angle > Math.PI ? 'rotate(180)' : '')
    )
    .attr('text-anchor', d => d.angle > Math.PI ? 'end' : null)
    .style('font-size', '11px')
    .style('font-family', "'IBM Plex Sans', sans-serif")
    .style('fill', '#37474F')
    .text(d => {
      const e = top[d.index];
      const lbl = e.name.length > 22 ? e.name.slice(0, 21) + '…' : e.name;
      return `${lbl} (${e.total})`;
    });

  // Caption — what view this is + how many entities are in the chord
  svg.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', height / 2 - 8)
    .style('font-size', '11px')
    .style('font-family', "'Space Mono', monospace")
    .style('fill', '#8a9aa3')
    .style('letter-spacing', '.04em')
    .text(`top ${top.length} of ${entities.length} entities`);
}

// Build a small inline sparkline of activity per year. Uses a fixed year
// span (min -> max across the data) so sparklines from different rows are
// visually aligned by horizontal position.
function _buildSparkline(activity, yearMin, yearMax) {
  // Internal coordinate space; SVG width is 100% so the sparkline scales
  // with whatever cell width the colgroup gives it.
  const w = 100, h = 22, pad = 1;
  if (!activity || !activity.length) return '<span style="color:#bbb;font-size:10px;">—</span>';
  const span = Math.max(1, yearMax - yearMin);
  const map = new Map(activity.map(d => [d.year, d.count]));
  const yMax = Math.max(1, ...activity.map(d => d.count));
  const points = [];
  for (let y = yearMin; y <= yearMax; y++) {
    const c = map.get(y) || 0;
    const x = pad + ((y - yearMin) / span) * (w - 2 * pad);
    const yy = (h - pad) - (c / yMax) * (h - 2 * pad);
    points.push(`${x.toFixed(1)},${yy.toFixed(1)}`);
  }
  const areaPath = `M${pad},${h - pad} L${points.join(' L')} L${w - pad},${h - pad} Z`;
  const linePath = `M${points.join(' L')}`;
  return `<svg class="ent-spark" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="vertical-align:middle;display:block;">
    <path d="${areaPath}" fill="#5C6771" fill-opacity="0.18"/>
    <path d="${linePath}" fill="none" stroke="#37474F" stroke-width="1.2"/>
  </svg>`;
}

function renderEntityTable(entities) {
  const tbody = document.querySelector('#entity-tbl tbody');
  if (!tbody) return;
  if (!entities.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:1rem;">No entities match the current filters.</td></tr>';
    return;
  }
  // Common year span across all visible entities so sparklines align
  let yMin = Infinity, yMax = -Infinity;
  entities.forEach(e => {
    (e.activity || []).forEach(a => {
      if (a.year < yMin) yMin = a.year;
      if (a.year > yMax) yMax = a.year;
    });
  });
  if (!isFinite(yMin)) { yMin = new Date().getFullYear(); yMax = yMin; }

  tbody.innerHTML = entities.map(n => {
    const sel = selectedEntities.has(n.normalized_name) ? 'ent-row--selected' : '';
    const roleBadges = (n.roles || [])
      .map(r => `<span class="ent-role ent-role--${r}">${r.replace('_', ' ')}</span>`)
      .join(' ');
    const typeBadge = n.type
      ? `<span class="ent-type">${n.type}</span>`
      : '';
    const co = (n.top_co || []).map(c =>
      `<span class="ent-co-pill" title="${c.type || ''}">${c.name} <strong>${c.count}</strong></span>`
    ).join('');
    return `<tr class="ent-row ${sel}" style="cursor:pointer;" data-eid="${n.normalized_name}">
      <td style="min-width:180px;"><strong>${n.name}</strong><br>${typeBadge} ${roleBadges}</td>
      <td>${n.total}</td>
      <td><div class="ent-co-list">${co || '<span style="color:#bbb;font-size:11px;">—</span>'}</div></td>
      <td>${_buildSparkline(n.activity, yMin, yMax)}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.ent-row').forEach(row => {
    row.addEventListener('click', (e) => {
      const eid = row.dataset.eid;
      if (e.ctrlKey || e.metaKey) {
        if (selectedEntities.has(eid)) selectedEntities.delete(eid);
        else selectedEntities.add(eid);
      } else {
        if (selectedEntities.size === 1 && selectedEntities.has(eid)) {
          selectedEntities.clear();
        } else {
          selectedEntities.clear();
          selectedEntities.add(eid);
        }
      }
      state.filters.entities = new Set(selectedEntities);
      state.page = 1;
      entityClickRefresh = true;
      refresh();
    });
  });
}

// ---- Body-level floating tooltip (escapes any stacking context) ----
let _floatingTipEl;
function _ensureFloatingTip() {
  if (_floatingTipEl) return _floatingTipEl;
  _floatingTipEl = document.createElement('div');
  _floatingTipEl.className = 'floating-tip';
  _floatingTipEl.style.cssText =
    'position:fixed;display:none;background:#2c3e50;color:#fff;font-family:"IBM Plex Sans",sans-serif;' +
    'font-size:12px;line-height:1.4;padding:8px 12px;border-radius:4px;max-width:320px;z-index:999999;' +
    'pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.18);text-align:left;letter-spacing:0;';
  document.body.appendChild(_floatingTipEl);
  return _floatingTipEl;
}
function showFloatingTip(refEl, html) {
  const tip = _ensureFloatingTip();
  tip.innerHTML = html;
  tip.style.display = 'block';
  const r = refEl.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, left));
  let top = r.top - tr.height - 10;
  if (top < 8) top = r.bottom + 10;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideFloatingTip() {
  if (_floatingTipEl) _floatingTipEl.style.display = 'none';
}
function bindInfoTips() {
  document.querySelectorAll('.info-tip[data-tip]').forEach(el => {
    if (el._tipBound) return;
    el._tipBound = true;
    const text = el.getAttribute('data-tip');
    el.addEventListener('mouseenter', () => showFloatingTip(el, text));
    el.addEventListener('mouseleave', hideFloatingTip);
    el.addEventListener('focus', () => showFloatingTip(el, text));
    el.addEventListener('blur', hideFloatingTip);
  });
}

function renderEntityGraph(data) {
  const container = document.getElementById('entity-graph');
  if (!container) return;
  container.innerHTML = '';
  const { nodes, edges } = data;
  if (!nodes || !nodes.length) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:#999;font-size:13px;">No entities yet. Run entity extraction to populate.</div>';
    return;
  }

  const width = container.clientWidth || 500;
  const height = container.clientHeight || 400;
  const svg = d3.select(container).append('svg').attr('viewBox', [0, 0, width, height]);
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.3, 5]).on('zoom', (e) => g.attr('transform', e.transform)));

  const maxCount = d3.max(nodes, d => d.incident_count) || 1;
  const rScale = d3.scaleSqrt().domain([1, maxCount]).range([4, 24]);

  const simNodes = nodes.map(d => ({...d}));
  const simEdges = (edges || []).map(d => ({source: d.source, target: d.target, weight: d.weight}));

  if (entitySimulation) entitySimulation.stop();
  entitySimulation = d3.forceSimulation(simNodes)
    .force('link', d3.forceLink(simEdges).id(d => d.id).distance(120).strength(d => Math.min(d.weight * 0.15, 0.5)))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(d => rScale(d.incident_count) + 12));

  const link = g.append('g').selectAll('line').data(simEdges).join('line')
    .attr('stroke', 'rgba(0,0,0,.06)').attr('stroke-width', d => Math.min(d.weight * 0.7, 3));

  const nodeG = g.append('g').selectAll('g').data(simNodes).join('g')
    .style('cursor', 'pointer')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) entitySimulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) entitySimulation.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  nodeG.append('circle')
    .attr('r', d => rScale(d.incident_count))
    .attr('fill', d => ENT_TYPE_COLORS[d.entity_type] || '#888')
    .attr('fill-opacity', d => selectedEntities.has(d.id) ? 1.0 : 0.8)
    .attr('stroke', d => selectedEntities.has(d.id) ? '#333' : (ENT_ROLE_STROKES[d.role] || '#ccc'))
    .attr('stroke-width', d => selectedEntities.has(d.id) ? 3 : Math.max(1.5, rScale(d.incident_count) * 0.2))
    .attr('stroke-opacity', 0.7);

  nodeG.append('text').attr('class', 'node-label')
    .attr('dy', d => rScale(d.incident_count) + 11)
    .attr('text-anchor', 'middle')
    .style('font-weight', d => selectedEntities.has(d.id) ? '700' : null)
    .text(d => d.incident_count >= 2 ? d.name : '');

  // Click: filter incidents by entity (ctrl/cmd+click for multi-select)
  nodeG.on('click', function(e, d) {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      if (selectedEntities.has(d.id)) selectedEntities.delete(d.id);
      else selectedEntities.add(d.id);
    } else {
      if (selectedEntities.size === 1 && selectedEntities.has(d.id)) {
        selectedEntities.clear();
      } else {
        selectedEntities.clear();
        selectedEntities.add(d.id);
      }
    }
    state.filters.entities = new Set(selectedEntities);
    state.page = 1;
    entityClickRefresh = true;
    refresh();
  });

  // Click on SVG background to clear entity selection
  svg.on('click', function() {
    if (selectedEntities.size) {
      selectedEntities.clear();
      state.filters.entities.clear();
      state.page = 1;
      entityClickRefresh = true;
      refresh();
    }
  });

  nodeG.on('mouseenter', function(e, d) {
    d3.select(this).select('text').text(d.name).style('fill', 'var(--text-strong)').style('font-weight', '600');
    d3.select(this).select('circle').attr('stroke', '#333').attr('stroke-width', 2.5);
    const connected = new Set();
    simEdges.forEach(l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid === d.id) connected.add(tid);
      if (tid === d.id) connected.add(sid);
    });
    link.attr('stroke', l => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      return (sid === d.id || tid === d.id) ? 'rgba(0,0,0,.25)' : 'rgba(0,0,0,.03)';
    });
    nodeG.select('circle').attr('fill-opacity', n => (n.id === d.id || connected.has(n.id)) ? 0.9 : 0.15);
  }).on('mouseleave', function() {
    nodeG.select('text').each(function(d) {
      d3.select(this).text(d.incident_count >= 2 ? d.name : '').style('fill', null)
        .style('font-weight', selectedEntities.has(d.id) ? '700' : null);
    });
    nodeG.select('circle')
      .attr('stroke', d => selectedEntities.has(d.id) ? '#333' : (ENT_ROLE_STROKES[d.role] || '#ccc'))
      .attr('stroke-width', d => selectedEntities.has(d.id) ? 3 : Math.max(1.5, rScale(d.incident_count) * 0.2))
      .attr('fill-opacity', d => selectedEntities.has(d.id) ? 1.0 : 0.8);
    link.attr('stroke', 'rgba(0,0,0,.06)');
  });

  nodeG.append('title').text(d => `${d.name}\n${d.entity_type} (${d.role})\n${d.incident_count} incident(s)\nClick to filter incidents`);

  entitySimulation.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });
}

// ---- Entity controls ----
document.addEventListener("DOMContentLoaded", () => {
  const slider = document.getElementById("ent-min-slider");
  const valLabel = document.getElementById("ent-min-val");
  const roleSelect = document.getElementById("ent-role-filter");
  const typeSelect = document.getElementById("ent-type-filter");
  const srcCheck = document.getElementById("ent-show-sources");

  // View toggle: Chord / Network. Chord is the default; network is the
  // alternate. Min-incidents slider is shown only for the network view.
  function applyEntityView(view) {
    entityView = view;
    document.querySelectorAll('.ent-view-btn').forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle('ent-view-btn--active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const chord = document.getElementById('entity-chord');
    const graph = document.getElementById('entity-graph');
    if (chord) chord.style.display = view === 'chord' ? '' : 'none';
    if (graph) graph.style.display = view === 'network' ? '' : 'none';
    const minGroup = document.querySelector('.ent-min-group');
    if (minGroup) minGroup.style.display = view === 'network' ? '' : 'none';
    renderEntityFiltered();
  }
  document.querySelectorAll('.ent-view-btn').forEach(btn => {
    btn.addEventListener('click', () => applyEntityView(btn.dataset.view));
  });
  // Initial slider visibility (chord is default → hidden)
  const initMinGroup = document.querySelector('.ent-min-group');
  if (initMinGroup) initMinGroup.style.display = 'none';

  if (slider) slider.addEventListener("input", () => { valLabel.textContent = slider.value; renderEntityFiltered(); });
  if (roleSelect) roleSelect.addEventListener("change", () => renderEntityFiltered());
  if (typeSelect) typeSelect.addEventListener("change", () => renderEntityFiltered());
  if (srcCheck) srcCheck.addEventListener("change", () => renderEntityFiltered());
});

// ---- Boot ----
document.addEventListener("DOMContentLoaded", init);
