/* ========================================================================
   Authoritarian Interference Tracker — Frontend Application
   ======================================================================== */

// ---- Globals ----
let config = null;
let meta = null;
let lastData = null; // cache last API response for cross-filtering

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
  { name: "Civil Society Subversion",color: "#4C4193" },  // ISD Purple
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
  if (urlParams.get("region")) { state.filters.region = urlParams.get("region"); }

  buildFilterUI();

  // Sync UI controls with restored state
  if (state.filters.q) $("#search").value = state.filters.q;
  if (state.filters.start) $("#start-year").value = state.filters.start;
  if (state.filters.end) $("#end-year").value = state.filters.end;
  if (state.filters.region) $("#region-select").value = state.filters.region;
  if (state.filters.countries.size === 1) $("#country-select").value = Array.from(state.filters.countries)[0];

  bindEvents();
  await refresh();

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

function bindEvents() {
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
  try { renderVolumeChart(data.volume_over_time || []); } catch(e) { console.error("VolumeChart:", e); }
  try { renderSankey(data.country_actor || [], data.stacked || []); } catch(e) { console.error("Sankey:", e); }
  try { renderMap(data.country_actor || [], data.country_meta || {}); } catch(e) { console.error("Map:", e); }
  try { renderStacked(data.stacked || []); } catch(e) { console.error("Stacked:", e); }
  try { renderList(data.incidents || []); } catch(e) { console.error("List:", e); }

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
  state.filters.region = ""; $("#region-select").value = "";
  state.filters.start = null; $("#start-year").value = "";
  state.filters.end = null; $("#end-year").value = "";
  $("#country-select").value = "";
  state.page = 1;
  refresh();
}

// ========================================================================
// VOLUME OVER TIME CHART (stacked bar by actor)
// ========================================================================
function renderVolumeChart(rows) {
  const el = d3.select("#volume-chart");
  el.selectAll("*").remove();

  if (!rows.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No data available.");
    return;
  }

  const container = document.querySelector(".viz-volume");
  const width = Math.min(620, container.clientWidth - 32);
  const height = 280;
  const margin = { top: 20, right: 20, bottom: 35, left: 45 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = el.append("svg").attr("width", width).attr("height", height);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  // Pivot data: year -> actor -> count (exclude future years)
  const years = Array.from(new Set(rows.map(d => d.year))).filter(y => y <= CURRENT_YEAR).sort((a, b) => a - b);
  const actors = Array.from(new Set(rows.map(d => d.actor))).sort();
  const lookup = {};
  rows.forEach(r => { lookup[`${r.year}_${r.actor}`] = r.count; });

  // Build stack data
  const stackData = years.map(yr => {
    const obj = { year: yr };
    actors.forEach(a => { obj[a] = lookup[`${yr}_${a}`] || 0; });
    return obj;
  });

  const stack = d3.stack().keys(actors);
  const series = stack(stackData);

  const x = d3.scaleBand().domain(years).range([0, innerW]).paddingInner(0.15);
  const yMax = d3.max(series, s => d3.max(s, d => d[1])) || 1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerH, 0]);

  // X axis
  const xAxis = g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(x).tickValues(years.filter((_, i) => i % Math.max(1, Math.floor(years.length / 10)) === 0)).tickSize(0));
  xAxis.selectAll("text").style("fill", "#5C6771").style("font-size", "12px");
  xAxis.select(".domain").style("stroke", "rgba(255,255,255,0.1)");

  // Y axis
  const yAxis = g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickSize(-innerW));
  yAxis.selectAll("text").style("fill", "#5C6771").style("font-size", "12px");
  yAxis.select(".domain").remove();
  yAxis.selectAll("line").style("stroke", "rgba(255,255,255,0.06)");

  // Bars
  series.forEach(s => {
    const actorName = s.key;
    const color = actorColor(actorName);
    g.selectAll(`.vol-bar-${actorName.replace(/\s/g, "_")}`)
      .data(s)
      .enter()
      .append("rect")
      .attr("class", "vol-bar")
      .attr("x", d => x(d.data.year))
      .attr("y", d => y(d[1]))
      .attr("width", x.bandwidth())
      .attr("height", d => Math.max(0, y(d[0]) - y(d[1])))
      .attr("fill", color)
      .attr("rx", 1)
      .on("click", (_, d) => {
        toggleSet(state.filters.actors, actorName);
        state.filters.start = d.data.year;
        state.filters.end = d.data.year;
        $("#start-year").value = d.data.year;
        $("#end-year").value = d.data.year;
        state.page = 1;
        refresh();
      })
      .append("title").text(d => `${actorName} ${d.data.year}: ${d.data[actorName]}`);
  });

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
function renderSankey(countryRows, stackedRows) {
  const el = d3.select("#sankey-chart");
  el.selectAll("*").remove();

  if (!countryRows.length && !stackedRows.length) {
    el.append("div").style("padding", "2rem").style("color", "#666").text("No data available.");
    return;
  }

  const container = document.querySelector(".viz-sankey");
  const width = Math.min(1200, container.clientWidth - 32);
  const height = 580;
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
  const topCountries = sortedCountries.slice(0, 15).map(([n]) => n);
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
  toolsInData.forEach(t => { nodeMap[`tool:${t}`] = idx; nodes.push({ name: t, column: "tool" }); idx++; });
  actorsInData.forEach(a => { nodeMap[`actor:${a}`] = idx; nodes.push({ name: a, column: "actor" }); idx++; });
  countryNodes.forEach(c => { nodeMap[`country:${c}`] = idx; nodes.push({ name: c, column: "country" }); idx++; });

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
    .text(d => `${d.source.name} \u2192 ${d.target.name}: ${d.value}`);

  // Nodes
  const node = g.append("g")
    .selectAll("g")
    .data(graph.nodes)
    .enter()
    .append("g")
    .attr("class", "sankey-node");

  node.append("rect")
    .attr("x", d => d.x0)
    .attr("y", d => d.y0)
    .attr("width", d => d.x1 - d.x0)
    .attr("height", d => Math.max(1, d.y1 - d.y0))
    .attr("fill", d => {
      const c = d.column === "actor" ? actorColor(d.name)
              : d.column === "tool" ? toolColor(d.name)
              : "#5c6771";
      return blendToBase(c, 0.15);
    })
    .attr("stroke", d => {
      if (d.column === "actor") return actorColor(d.name);
      if (d.column === "tool") return toolColor(d.name);
      return "#999";
    })
    .attr("stroke-width", 1.5)
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
      textEl.append("tspan").attr("x", cx).attr("dy", "-0.4em").text(line1);
      textEl.append("tspan").attr("x", cx).attr("dy", "1.2em").text(line2);
      textEl.attr("y", cy);
    } else {
      // Single line, truncate if needed
      const maxChars = d.column === "actor" ? 14 : 16;
      const label = d.name.length > maxChars ? d.name.substring(0, maxChars - 1) + "…" : d.name;
      grp.append("text")
        .attr("x", cx).attr("y", cy).attr("dy", "0.35em")
        .attr("text-anchor", "middle")
        .text(label)
        .style("font-size", fontSize + "px").style("fill", fill)
        .style("font-weight", fontWeight)
        .style("font-family", "'IBM Plex Sans', sans-serif")
        .style("pointer-events", "none");
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
  const width = Math.min(1200, container.clientWidth - 32);
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
      const barW = x(value) - x(0);
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
    const endYr = inc.end_year ? (inc.end_year >= CURRENT_YEAR ? "ongoing" : inc.end_year) : "ongoing";
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

    // Source links — float right
    const sourceTags = (inc.source_urls || []).slice(0, 3).map(s => {
      const domain = extractDomain(s);
      return `<a href="${s}" target="_blank" rel="noopener" class="tag tag-source" title="${s}">${domain}</a>`;
    }).join("");
    const moreSourcesLabel = (inc.source_count || (inc.source_urls||[]).length) > 3
      ? `<span class="tag" style="opacity:0.5">+${(inc.source_count || (inc.source_urls||[]).length) - 3} more</span>` : "";

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
          ${actorPills}${actorPills && countryPills ? sep : ""}${countryPills}${(actorPills || countryPills) && toolPills ? typeSep : ""}${toolPills}
        </div>
        <div class="tags tags-right">
          ${sourceTags}${moreSourcesLabel}
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
  const endYr = inc.end_year ? (inc.end_year >= CURRENT_YEAR ? "ongoing" : inc.end_year) : "ongoing";
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

  const confPct = inc.confidence_score != null ? Math.round(inc.confidence_score * 100) : null;
  const confidence = confPct != null
    ? `${confPct}%
       <span class="confidence-bar"><span class="confidence-fill" style="width:${confPct}%"></span></span>`
    : "N/A";

  const adminLink = window.isAdmin
    ? `<a href="/review/incident/${inc.id}" title="Edit">&#9998; Edit in Review UI</a>` : "";

  body.innerHTML = `
    <div class="file-header">
      <h2>${inc.title || "(untitled)"}</h2>
      <div class="date-range">${yearRange}</div>
    </div>

    <div class="field-label">Summary</div>
    <div class="field-value">${inc.summary || "No summary available."}</div>

    <div class="field-label">Threat Actors</div>
    <div class="field-value"><div class="modal-tags">${actorTags || "None listed"}</div></div>

    <div class="field-label">Target Countries</div>
    <div class="field-value"><div class="modal-tags">${countryTags || "None listed"}</div></div>

    <div class="field-label">Incident Types</div>
    <div class="field-value"><div class="modal-tags">${toolTags || "None listed"}</div></div>

    ${inc.attribution_basis ? `
    <div class="field-label">Attribution Basis</div>
    <div class="field-value">${inc.attribution_basis}</div>
    ` : ""}

    ${inc.campaign_name ? `
    <div class="field-label">Campaign</div>
    <div class="field-value">${inc.campaign_name}</div>
    ` : ""}

    <div class="field-label">Confidence</div>
    <div class="field-value">${confidence}</div>

    ${sourceLinks ? `
    <div class="field-label">Sources</div>
    <div class="field-value">${sourceLinks}</div>
    ` : ""}

    <div class="modal-footer">
      <a href="/incident/${inc.slug || inc.id}" title="Permalink">Permalink: /incident/${inc.slug || inc.id}</a>
      ${adminLink}
    </div>
  `;

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

// ---- Boot ----
document.addEventListener("DOMContentLoaded", init);
