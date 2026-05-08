const DATA_URL = "./data/culverts.geojson";
const JAPAN_CENTER = [139.7671, 35.6812];
const DEFAULT_ZOOM = 12.2;
const ACCENT_COLOR = "#ff8a00";
const COLOR_MODES = {
  dark: { line: "#243648", shadow: "#ffffff" },
  light: { line: "#ffffff", shadow: "#0b1a26" },
};
const STORED_COLOR_MODE = localStorage.getItem("culvert.colorMode");
const INITIAL_COLOR_MODE = COLOR_MODES[STORED_COLOR_MODE] ? STORED_COLOR_MODE : "dark";

const els = {
  map: document.querySelector("#map"),
  mapFallback: document.querySelector("#mapFallback"),
  detailSheet: document.querySelector("#detailSheet"),
  detail: document.querySelector("#detailContent"),
  wardSelect: document.querySelector("#wardSelect"),
  locateButton: document.querySelector("#locateButton"),
  layersButton: document.querySelector("#layersButton"),
  layersPanel: document.querySelector("#layersPanel"),
  closeLayersButton: document.querySelector("#closeLayersButton"),
  terrainToggle: document.querySelector("#terrainToggle"),
  riverToggle: document.querySelector("#riverToggle"),
  culvertToggle: document.querySelector("#culvertToggle"),
  closeDetailButton: document.querySelector("#closeDetailButton"),
  favoriteButton: document.querySelector("#favoriteButton"),
  shareButton: document.querySelector("#shareButton"),
  toast: document.querySelector("#toast"),
};

const state = {
  map: null,
  data: null,
  selectedId: null,
  userLocation: null,
  favorites: new Set(JSON.parse(localStorage.getItem("culvert.favorites") || "[]")),
  mapLoaded: false,
  colorMode: INITIAL_COLOR_MODE,
};

const mapStyle = {
  version: 8,
  sources: {
    "gsi-std": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
    "gsi-pale": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
    "gsi-photo": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
      tileSize: 256,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
    "gsi-hillshade": {
      type: "raster",
      tiles: ["https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
    },
  },
  layers: [
    { id: "base-std", type: "raster", source: "gsi-std", minzoom: 0, maxzoom: 19 },
    { id: "base-pale", type: "raster", source: "gsi-pale", minzoom: 0, maxzoom: 19, layout: { visibility: "none" } },
    { id: "base-photo", type: "raster", source: "gsi-photo", minzoom: 0, maxzoom: 19, layout: { visibility: "none" } },
    {
      id: "terrain-overlay",
      type: "raster",
      source: "gsi-hillshade",
      minzoom: 0,
      maxzoom: 17,
      layout: { visibility: "none" },
      paint: { "raster-opacity": 0.42 },
    },
  ],
};

init().catch((error) => {
  console.error(error);
  showFallback("初期化に失敗しました。");
});

async function init() {
  const [data] = await Promise.all([fetchGeoJson(), waitForMapLibre()]);
  state.data = normalizeData(data);
  state.selectedId = getInitialFeature().properties.id;
  populateWardSelector();
  syncWardSelect();
  initMap();
  bindUi();
  renderDetails();
}

async function waitForMapLibre() {
  for (let i = 0; i < 80; i += 1) {
    if (window.maplibregl) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("MapLibre GL JS was not loaded.");
}

async function fetchGeoJson() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${DATA_URL}: ${response.status}`);
  }
  return response.json();
}

function normalizeData(data) {
  return {
    ...data,
    features: data.features.map((feature) => ({
      ...feature,
      properties: {
        ...feature.properties,
        center: getFeatureCenter(feature),
      },
    })),
  };
}

function getInitialFeature() {
  const idFromUrl = new URLSearchParams(location.search).get("id");
  return state.data.features.find((feature) => feature.properties.id === idFromUrl) || state.data.features[0];
}

function initMap() {
  const selected = getSelectedFeature();
  const lastView = JSON.parse(localStorage.getItem("culvert.lastView") || "null");
  const center = lastView?.center || selected.properties.center || JAPAN_CENTER;
  const zoom = lastView?.zoom || DEFAULT_ZOOM;

  state.map = new maplibregl.Map({
    container: "map",
    style: mapStyle,
    center,
    zoom,
    maxZoom: 18.5,
    minZoom: 4.2,
    attributionControl: false,
    maplibreLogo: false,
  });

  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-left");
  state.map.on("load", () => {
    state.mapLoaded = true;
    addDataLayers();
    selectFeature(state.selectedId, { fit: true, pushUrl: false });
  });
  state.map.on("moveend", saveLastView);
  state.map.on("click", "culverts-hit", (event) => {
    const feature = event.features?.[0];
    if (feature?.properties?.id) {
      selectFeature(feature.properties.id, { fit: false, pushUrl: true });
    }
  });
  state.map.on("mouseenter", "culverts-hit", () => {
    state.map.getCanvas().style.cursor = "pointer";
  });
  state.map.on("mouseleave", "culverts-hit", () => {
    state.map.getCanvas().style.cursor = "";
  });
  state.map.on("error", (event) => {
    console.warn("Map error", event?.error || event);
  });
}

function addDataLayers() {
  state.map.addSource("culverts", {
    type: "geojson",
    data: state.data,
  });

  state.map.addSource("selected-point", {
    type: "geojson",
    data: makeSelectedPoint(),
  });

  state.map.addSource("user-location", {
    type: "geojson",
    data: emptyFeatureCollection(),
  });

  state.map.addLayer({
    id: "river-reference",
    type: "line",
    source: "culverts",
    filter: ["==", ["get", "riverReference"], true],
    paint: {
      "line-color": "#2d8fd6",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.4, 15, 3.2],
      "line-opacity": 0.38,
    },
  });

  const colors = COLOR_MODES[state.colorMode];
  state.map.addLayer({
    id: "culverts-shadow",
    type: "line",
    source: "culverts",
    filter: ["!=", ["get", "riverReference"], true],
    paint: {
      "line-color": colors.shadow,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 15, 10],
      "line-opacity": 0.78,
      "line-blur": 1.2,
    },
  });

  state.map.addLayer({
    id: "culverts-line",
    type: "line",
    source: "culverts",
    filter: ["!=", ["get", "riverReference"], true],
    paint: {
      "line-color": colors.line,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2.2, 15, 5],
      "line-opacity": 0.7,
    },
  });

  state.map.addLayer({
    id: "culverts-active-glow",
    type: "line",
    source: "culverts",
    filter: getActiveFilter(),
    paint: {
      "line-color": ACCENT_COLOR,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 9, 15, 18],
      "line-opacity": 0.32,
      "line-blur": 3,
    },
  });

  state.map.addLayer({
    id: "culverts-active",
    type: "line",
    source: "culverts",
    filter: getActiveFilter(),
    paint: {
      "line-color": ACCENT_COLOR,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.8, 15, 8],
      "line-opacity": 1,
    },
  });

  state.map.addLayer({
    id: "culverts-hit",
    type: "line",
    source: "culverts",
    filter: ["!=", ["get", "riverReference"], true],
    paint: {
      "line-color": "#000000",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 18, 15, 28],
      "line-opacity": 0,
    },
  });

  state.map.addLayer({
    id: "selected-point-halo",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-radius": 15,
      "circle-color": "#ffffff",
      "circle-opacity": 0.9,
    },
  });

  state.map.addLayer({
    id: "selected-point",
    type: "circle",
    source: "selected-point",
    paint: {
      "circle-radius": 9,
      "circle-color": ACCENT_COLOR,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });

  state.map.addLayer({
    id: "user-location",
    type: "circle",
    source: "user-location",
    paint: {
      "circle-radius": 7,
      "circle-color": "#1f67d2",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 3,
    },
  });
}

function bindUi() {
  els.wardSelect.addEventListener("change", () => selectWard(els.wardSelect.value));
  els.locateButton.addEventListener("click", locateUser);
  els.layersButton.addEventListener("click", toggleLayersPanel);
  els.closeLayersButton.addEventListener("click", () => setLayersPanel(false));
  document.querySelectorAll("input[name='baseLayer']").forEach((input) => {
    input.addEventListener("change", () => setBaseLayer(input.value));
  });
  els.terrainToggle.addEventListener("change", () => setLayerVisibility("terrain-overlay", els.terrainToggle.checked));
  els.riverToggle.addEventListener("change", () => setLayerVisibility("river-reference", els.riverToggle.checked));
  els.culvertToggle.addEventListener("change", () => {
    ["culverts-shadow", "culverts-line", "culverts-active-glow", "culverts-active", "culverts-hit", "selected-point-halo", "selected-point"].forEach((id) => {
      setLayerVisibility(id, els.culvertToggle.checked);
    });
  });
  document.querySelectorAll("input[name='culvertColor']").forEach((input) => {
    input.checked = input.value === state.colorMode;
    input.addEventListener("change", () => setCulvertColorMode(input.value));
  });
  els.closeDetailButton.addEventListener("click", closeDetails);
  els.favoriteButton.addEventListener("click", toggleFavorite);
  els.shareButton.addEventListener("click", shareSelected);
}

function setCulvertColorMode(mode) {
  if (!COLOR_MODES[mode]) return;
  state.colorMode = mode;
  localStorage.setItem("culvert.colorMode", mode);
  if (!state.mapLoaded) return;
  const colors = COLOR_MODES[mode];
  state.map.setPaintProperty("culverts-shadow", "line-color", colors.shadow);
  state.map.setPaintProperty("culverts-line", "line-color", colors.line);
}

function getActiveFilter() {
  return ["all", ["!=", ["get", "riverReference"], true], ["==", ["get", "id"], state.selectedId || ""]];
}

function populateWardSelector() {
  const wards = new Set();
  for (const feature of state.data.features) {
    if (feature.properties.riverReference) continue;
    extractWards(feature.properties.areaName).forEach((ward) => wards.add(ward));
  }
  const sorted = [...wards].sort((a, b) => a.localeCompare(b, "ja"));
  els.wardSelect.innerHTML = `<option value="">地域を選択</option>` + sorted.map((ward) => `<option value="${escapeAttr(ward)}">${escapeHtml(ward)}</option>`).join("");
}

function extractWards(areaName) {
  return String(areaName || "")
    .replace(/^東京都/, "")
    .split(/[・、,/]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function selectWard(ward) {
  if (!ward) return;
  const matches = state.data.features.filter((feature) => !feature.properties.riverReference && extractWards(feature.properties.areaName).includes(ward));
  if (matches.length === 0) return;
  if (state.mapLoaded) {
    const bounds = matches.reduce((result, feature) => extendBounds(result, flattenCoordinates(feature.geometry.coordinates)), null);
    if (bounds) state.map.fitBounds(bounds, { padding: getFitPadding(), maxZoom: 14, duration: 700 });
  }
  selectFeature(matches[0].properties.id, { fit: false, pushUrl: true });
}

function syncWardSelect() {
  const feature = getSelectedFeature();
  const wards = extractWards(feature.properties.areaName);
  els.wardSelect.value = wards[0] || "";
}

function selectFeature(id, options = {}) {
  const feature = state.data.features.find((item) => item.properties.id === id && !item.properties.riverReference);
  if (!feature) return;

  state.selectedId = id;
  if (state.mapLoaded) {
    const filter = getActiveFilter();
    state.map.setFilter("culverts-active-glow", filter);
    state.map.setFilter("culverts-active", filter);
    state.map.getSource("selected-point").setData(makeSelectedPoint());
    if (options.fit) fitFeature(feature);
  }

  renderDetails();
  openDetails();
  updateFavoriteButton();
  syncWardSelect();

  if (options.pushUrl) {
    const url = new URL(location.href);
    url.searchParams.set("id", id);
    history.replaceState(null, "", url);
  }
}

function renderDetails() {
  const feature = getSelectedFeature();
  const props = feature.properties;
  const sourceItems = (props.sources || []).map((source) => `
    <li>
      <a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
      <small>${escapeHtml(source.publisher)} / ${escapeHtml(source.licenseNote)}</small>
    </li>
  `).join("");
  const lineworkSourceItems = (props.lineworkSources || []).map((source) => `
    <li>
      <a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
      <small>${escapeHtml(source.publisher)} / ${escapeHtml(source.licenseNote)}</small>
    </li>
  `).join("");
  const lineworkBlock = lineworkSourceItems ? `
    <section class="source-section" aria-label="線形出典">
      <h2>線形出典</h2>
      <p>${escapeHtml(props.lineworkNote || "道路・緑道の線形補正に使用。")}</p>
      <ul class="source-list">${lineworkSourceItems}</ul>
    </section>
  ` : "";
  const descriptionBlock = props.description ? `<p class="description">${escapeHtml(props.description)}</p>` : "";
  const verifiedBlock = props.lastVerifiedAt
    ? `<div class="meta-row"><span>最終確認 ${escapeHtml(props.lastVerifiedAt)}</span></div>`
    : "";

  els.detail.innerHTML = `
    <h1>${escapeHtml(props.name)}</h1>
    <div class="area-line">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
      <span>${escapeHtml(props.areaName)}</span>
    </div>
    ${verifiedBlock}
    ${descriptionBlock}
    <ul class="source-list">${sourceItems}</ul>
    ${lineworkBlock}
  `;
}

function openDetails() {
  els.detailSheet.hidden = false;
}

function closeDetails() {
  els.detailSheet.hidden = true;
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("このブラウザは現在地取得に対応していません。");
    return;
  }

  els.locateButton.classList.add("is-active");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const center = [position.coords.longitude, position.coords.latitude];
      state.userLocation = center;
      if (state.mapLoaded) {
        state.map.getSource("user-location").setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: { type: "Point", coordinates: center }, properties: {} }],
        });
        state.map.flyTo({ center, zoom: Math.max(state.map.getZoom(), 14), essential: true });
      }
      showToast("現在地を表示しました。位置情報は端末内だけで使います。");
      els.locateButton.classList.remove("is-active");
    },
    () => {
      showToast("現在地を取得できませんでした。地域選択または地図移動で探してください。");
      els.locateButton.classList.remove("is-active");
    },
    { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 },
  );
}

function toggleLayersPanel() {
  setLayersPanel(els.layersPanel.hidden);
}

function setLayersPanel(open) {
  els.layersPanel.hidden = !open;
  els.layersButton.setAttribute("aria-expanded", String(open));
}

function setBaseLayer(active) {
  if (!state.mapLoaded) return;
  ["std", "pale", "photo"].forEach((name) => {
    state.map.setLayoutProperty(`base-${name}`, "visibility", name === active ? "visible" : "none");
  });
}

function setLayerVisibility(id, visible) {
  if (!state.mapLoaded || !state.map.getLayer(id)) return;
  state.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

function toggleFavorite() {
  const id = state.selectedId;
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  localStorage.setItem("culvert.favorites", JSON.stringify([...state.favorites]));
  updateFavoriteButton();
}

function updateFavoriteButton() {
  els.favoriteButton.classList.toggle("is-active", state.favorites.has(state.selectedId));
}

async function shareSelected() {
  const feature = getSelectedFeature();
  const url = new URL(location.href);
  url.searchParams.set("id", feature.properties.id);
  const shareData = {
    title: `${feature.properties.name} - 暗渠マップ`,
    text: feature.properties.areaName,
    url: url.toString(),
  };

  if (navigator.share) {
    await navigator.share(shareData).catch(() => {});
    return;
  }

  await navigator.clipboard?.writeText(url.toString()).catch(() => null);
  showToast("共有URLをコピーしました。");
}

function fitFeature(feature) {
  const bounds = getFeatureBounds(feature);
  state.map.fitBounds(bounds, {
    padding: getFitPadding(),
    maxZoom: 15,
    duration: 700,
  });
}

function getFitPadding() {
  const isDesktop = matchMedia("(min-width: 760px)").matches;
  return isDesktop
    ? { top: 130, right: 480, bottom: 60, left: 70 }
    : { top: 96, right: 40, bottom: Math.min(window.innerHeight * 0.54, 450), left: 40 };
}

function getSelectedFeature() {
  return state.data.features.find((feature) => feature.properties.id === state.selectedId) || state.data.features[0];
}

function makeSelectedPoint() {
  const feature = getSelectedFeature();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: feature.properties.center },
        properties: { id: feature.properties.id },
      },
    ],
  };
}

function emptyFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function getFeatureBounds(feature) {
  return extendBounds(null, flattenCoordinates(feature.geometry.coordinates));
}

function extendBounds(bounds, coordinates) {
  let nextBounds = bounds;
  coordinates.forEach((coordinate) => {
    if (!nextBounds) {
      nextBounds = new maplibregl.LngLatBounds(coordinate, coordinate);
    } else {
      nextBounds.extend(coordinate);
    }
  });
  return nextBounds;
}

function getFeatureCenter(feature) {
  const coords = flattenCoordinates(feature.geometry.coordinates);
  const middle = coords[Math.floor(coords.length / 2)];
  return middle || JAPAN_CENTER;
}

function flattenCoordinates(coordinates) {
  if (typeof coordinates[0][0] === "number") return coordinates;
  return coordinates.flat();
}

function saveLastView() {
  if (!state.mapLoaded) return;
  const center = state.map.getCenter();
  localStorage.setItem("culvert.lastView", JSON.stringify({
    center: [Number(center.lng.toFixed(6)), Number(center.lat.toFixed(6))],
    zoom: Number(state.map.getZoom().toFixed(2)),
  }));
}

function showFallback(message) {
  els.mapFallback.hidden = false;
  els.mapFallback.querySelector("span").textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 3600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
