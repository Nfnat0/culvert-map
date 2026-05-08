const DATA_URL = "./data/culverts.geojson";
const JAPAN_CENTER = [139.7671, 35.6812];
const DEFAULT_ZOOM = 12.2;
const ACTIVE_COLOR = "#1a3548";
const CULVERT_COLOR = "#3b5a72";

const els = {
  map: document.querySelector("#map"),
  mapFallback: document.querySelector("#mapFallback"),
  detail: document.querySelector("#detailContent"),
  nearby: document.querySelector("#nearbyList"),
  searchForm: document.querySelector("#searchForm"),
  searchInput: document.querySelector("#searchInput"),
  searchResults: document.querySelector("#searchResults"),
  locateButton: document.querySelector("#locateButton"),
  layersButton: document.querySelector("#layersButton"),
  layersPanel: document.querySelector("#layersPanel"),
  closeLayersButton: document.querySelector("#closeLayersButton"),
  terrainToggle: document.querySelector("#terrainToggle"),
  riverToggle: document.querySelector("#riverToggle"),
  culvertToggle: document.querySelector("#culvertToggle"),
  fitAllButton: document.querySelector("#fitAllButton"),
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
  initMap();
  bindUi();
  renderDetails();
  renderNearby();
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
        searchText: buildSearchText(feature),
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

  state.map.addLayer({
    id: "culverts-shadow",
    type: "line",
    source: "culverts",
    filter: ["!=", ["get", "riverReference"], true],
    paint: {
      "line-color": "#ffffff",
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 15, 10],
      "line-opacity": 0.84,
      "line-blur": 1.2,
    },
  });

  state.map.addLayer({
    id: "culverts-line",
    type: "line",
    source: "culverts",
    filter: ["!=", ["get", "riverReference"], true],
    paint: {
      "line-color": [
        "case",
        ["==", ["get", "id"], state.selectedId],
        ACTIVE_COLOR,
        CULVERT_COLOR,
      ],
      "line-width": [
        "case",
        ["==", ["get", "id"], state.selectedId],
        ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 7.5],
        ["interpolate", ["linear"], ["zoom"], 8, 2.2, 15, 5],
      ],
      "line-opacity": [
        "case",
        ["==", ["get", "id"], state.selectedId],
        1,
        0.82,
      ],
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
      "circle-color": ACTIVE_COLOR,
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
  els.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const matches = getSearchMatches();
    if (matches.length > 0) {
      selectFeature(matches[0].properties.id, { fit: true, pushUrl: true });
      hideSearchResults();
    }
  });

  els.searchInput.addEventListener("input", renderSearchResults);
  els.searchInput.addEventListener("focus", renderSearchResults);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-box") && !event.target.closest("#searchResults")) {
      hideSearchResults();
    }
  });

  els.locateButton.addEventListener("click", locateUser);
  els.layersButton.addEventListener("click", toggleLayersPanel);
  els.closeLayersButton.addEventListener("click", () => setLayersPanel(false));
  document.querySelectorAll("input[name='baseLayer']").forEach((input) => {
    input.addEventListener("change", () => setBaseLayer(input.value));
  });
  els.terrainToggle.addEventListener("change", () => setLayerVisibility("terrain-overlay", els.terrainToggle.checked));
  els.riverToggle.addEventListener("change", () => setLayerVisibility("river-reference", els.riverToggle.checked));
  els.culvertToggle.addEventListener("change", () => {
    ["culverts-shadow", "culverts-line", "culverts-hit", "selected-point-halo", "selected-point"].forEach((id) => {
      setLayerVisibility(id, els.culvertToggle.checked);
    });
  });
  els.fitAllButton.addEventListener("click", fitAllCulverts);
  els.favoriteButton.addEventListener("click", toggleFavorite);
  els.shareButton.addEventListener("click", shareSelected);
}

function renderSearchResults() {
  const matches = getSearchMatches();
  if (!els.searchInput.value.trim()) {
    hideSearchResults();
    return;
  }

  els.searchResults.innerHTML = matches.length
    ? matches.map((feature) => {
        const props = feature.properties;
        const sub = props.riverName ? `${escapeHtml(props.areaName)} / ${escapeHtml(props.riverName)}` : escapeHtml(props.areaName);
        return `
          <button class="search-result" type="button" data-id="${escapeHtml(props.id)}">
            <span>
              <strong>${escapeHtml(props.name)}</strong>
              <span>${sub}</span>
            </span>
          </button>
        `;
      }).join("")
    : '<div class="search-result"><span><strong>該当する暗渠がありません</strong><span>別名や地域名でも検索できます。</span></span></div>';

  els.searchResults.hidden = false;
  els.searchResults.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectFeature(button.dataset.id, { fit: true, pushUrl: true });
      hideSearchResults();
      els.searchInput.blur();
    });
  });
}

function getSearchMatches() {
  const query = normalizeText(els.searchInput.value);
  if (!query) return [];
  return state.data.features
    .filter((feature) => !feature.properties.riverReference)
    .filter((feature) => feature.properties.searchText.includes(query))
    .slice(0, 8);
}

function hideSearchResults() {
  els.searchResults.hidden = true;
}

function selectFeature(id, options = {}) {
  const feature = state.data.features.find((item) => item.properties.id === id && !item.properties.riverReference);
  if (!feature) return;

  state.selectedId = id;
  if (state.mapLoaded) {
    state.map.setPaintProperty("culverts-line", "line-color", [
      "case",
      ["==", ["get", "id"], state.selectedId],
      ACTIVE_COLOR,
      CULVERT_COLOR,
    ]);
    state.map.setPaintProperty("culverts-line", "line-width", [
      "case",
      ["==", ["get", "id"], state.selectedId],
      ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 7.5],
      ["interpolate", ["linear"], ["zoom"], 8, 2.2, 15, 5],
    ]);
    state.map.getSource("selected-point").setData(makeSelectedPoint());
    if (options.fit) fitFeature(feature);
  }

  renderDetails();
  renderNearby();
  updateFavoriteButton();

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
    ? `<span class="meta-separator" aria-hidden="true"></span><span>最終確認 ${escapeHtml(props.lastVerifiedAt)}</span>`
    : "";

  els.detail.innerHTML = `
    <h1>${escapeHtml(props.name)}</h1>
    <div class="area-line">
      <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>
      <span>${escapeHtml(props.areaName)}</span>
    </div>
    <div class="meta-row">
      <span>情報源数 <b>${props.sources?.length || 0}</b> 件</span>
      ${verifiedBlock}
    </div>
    ${descriptionBlock}
    <ul class="source-list">${sourceItems}</ul>
    ${lineworkBlock}
  `;
}

function renderNearby() {
  const selected = getSelectedFeature();
  const selectedCenter = selected.properties.center;
  const features = state.data.features
    .filter((feature) => !feature.properties.riverReference)
    .map((feature) => ({
      feature,
      distance: distanceMeters(selectedCenter, feature.properties.center),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);

  els.nearby.innerHTML = features.map(({ feature, distance }) => {
    const props = feature.properties;
    const selectedClass = props.id === state.selectedId ? " is-selected" : "";
    return `
      <button class="nearby-item${selectedClass}" type="button" data-id="${escapeHtml(props.id)}">
        <span class="line-swatch"></span>
        <span class="nearby-name">${escapeHtml(props.name)}</span>
        <span class="distance">${formatDistance(distance)}</span>
        <span class="chevron" aria-hidden="true"></span>
      </button>
    `;
  }).join("");

  els.nearby.querySelectorAll("button[data-id]").forEach((button) => {
    button.addEventListener("click", () => selectFeature(button.dataset.id, { fit: true, pushUrl: true }));
  });
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
      showToast("現在地を取得できませんでした。検索または地図移動で探してください。");
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

function fitAllCulverts() {
  const features = state.data.features.filter((feature) => !feature.properties.riverReference);
  const bounds = features.reduce((result, feature) => extendBounds(result, flattenCoordinates(feature.geometry.coordinates)), null);
  if (bounds && state.mapLoaded) {
    state.map.fitBounds(bounds, { padding: getFitPadding(), maxZoom: 12.2, duration: 700 });
  }
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

function buildSearchText(feature) {
  const props = feature.properties;
  return normalizeText([
    props.name,
    props.areaName,
    props.riverName,
  ].filter(Boolean).join(" "));
}

function normalizeText(text) {
  return String(text || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function distanceMeters(a, b) {
  const toRad = (deg) => deg * Math.PI / 180;
  const radius = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
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
