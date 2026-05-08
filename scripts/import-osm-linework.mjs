import { readFile, writeFile } from "node:fs/promises";

const dataFile = new URL("../data/culverts.geojson", import.meta.url);
const overpassUrl = "https://overpass-api.de/api/interpreter";
const joinToleranceMeters = 80;

const mappings = [
  {
    featureId: "momozono-gawa",
    kind: "ways",
    osmWayIds: [
      46766948, 58206761, 58206772, 58206785, 77014989, 95509763, 193752402,
      779203473, 779203474, 1097603138, 1098108612, 1098108613, 1098108614,
      1098108615, 1098108616, 1098108639, 1098108646, 1412121862,
    ],
    note: "桃園川緑道として登録された歩道wayを接続し、交差点の小ギャップのみ補完。",
  },
  {
    featureId: "karasuyama-gawa",
    kind: "relation",
    osmRelationId: 8718480,
    note: "烏山川緑道の徒歩ルートrelationを元に接続。",
  },
  {
    featureId: "jakuzure-gawa",
    kind: "relation",
    osmRelationId: 4756289,
    note: "蛇崩川緑道の徒歩ルートrelationを元に接続。",
  },
  {
    featureId: "nomikawa-main-culvert",
    kind: "ways",
    osmWayIds: [335852037, 32201345, 232492287, 232492031, 232491878, 107215329, 107215331],
    note: "呑川暗渠、呑川、呑川緑道周辺の水路・暗渠wayを上流から下流へ接続。",
  },
  {
    featureId: "tachiaigawa-culvert",
    kind: "ways",
    osmWayIds: [232491260, 232491207, 232490983, 232490979, 232490975, 232490977, 232490976],
    note: "立会川のtunnel=yes区間を上流から月見橋上流側まで接続。",
  },
  {
    featureId: "rokugo-yosui-promenade",
    kind: "ways",
    osmWayIds: [
      225198783, 266759693, 1268595560, 1268595562, 1268595561, 1268595563,
      266759001, 636905554,
    ],
    note: "六郷用水のstream/drain/culvert wayを散策路の主線として接続。",
  },
  {
    featureId: "uchikawa-upper-culvert",
    kind: "relation",
    osmRelationId: 15699106,
    note: "桜のプロムナードの徒歩ルートrelationを旧内川上部の歩行線形として使用。",
  },
  {
    featureId: "sakasagawa-road",
    kind: "ways",
    osmWayIds: [636915549],
    note: "逆川のculvert/drain wayを使用。",
  },
];

const osmLineworkSource = {
  title: "OpenStreetMap linework",
  url: "https://www.openstreetmap.org/copyright",
  publisher: "OpenStreetMap contributors",
  licenseNote: "ODbL 1.0。線形補正に使用",
};

const data = JSON.parse(await readFile(dataFile, "utf8"));
const osm = await fetchOsmData(mappings);
const nodeById = new Map(osm.elements.filter((element) => element.type === "node").map((node) => [node.id, node]));
const wayById = new Map(osm.elements.filter((element) => element.type === "way").map((way) => [way.id, way]));
const relationById = new Map(osm.elements.filter((element) => element.type === "relation").map((relation) => [relation.id, relation]));

let updated = 0;

for (const mapping of mappings) {
  const feature = data.features.find((item) => item.properties?.id === mapping.featureId);
  if (!feature) throw new Error(`Feature not found: ${mapping.featureId}`);

  const segments = mapping.kind === "relation"
    ? segmentsFromRelation(mapping.osmRelationId)
    : segmentsFromWays(mapping.osmWayIds);

  const lines = stitchSegments(segments, joinToleranceMeters)
    .map((line) => simplifyConsecutiveDuplicates(line))
    .filter((line) => line.length >= 2);

  if (!lines.length) throw new Error(`No linework generated for ${mapping.featureId}`);

  feature.geometry = lines.length === 1
    ? { type: "LineString", coordinates: lines[0] }
    : { type: "MultiLineString", coordinates: lines };

  feature.properties.lineworkPrecision = "osm-traced";
  feature.properties.lineworkSources = [osmLineworkSource];
  feature.properties.lineworkNote = mapping.note;
  feature.properties.osmElementIds = mapping.kind === "relation"
    ? [`relation/${mapping.osmRelationId}`]
    : mapping.osmWayIds.map((id) => `way/${id}`);

  updated += 1;
}

await writeFile(dataFile, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Imported OSM linework for ${updated} feature(s).`);

async function fetchOsmData(items) {
  const wayIds = new Set();
  const relationIds = new Set();

  for (const item of items) {
    if (item.kind === "relation") relationIds.add(item.osmRelationId);
    if (item.kind === "ways") item.osmWayIds.forEach((id) => wayIds.add(id));
  }

  const statements = [];
  if (wayIds.size) statements.push(`way(id:${[...wayIds].join(",")});`);
  if (relationIds.size) statements.push(`relation(id:${[...relationIds].join(",")});`);

  const query = `[out:json][timeout:30];(${statements.join("")});out body;>;out skel qt;`;
  const response = await fetch(`${overpassUrl}?${new URLSearchParams({ data: query })}`, {
    headers: {
      "user-agent": "culvert-map-mvp/1.0 (local development)",
    },
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function segmentsFromRelation(relationId) {
  const relation = relationById.get(relationId);
  if (!relation) throw new Error(`OSM relation not found: ${relationId}`);
  return relation.members
    .filter((member) => member.type === "way")
    .map((member) => segmentFromWay(member.ref))
    .filter(Boolean);
}

function segmentsFromWays(wayIds) {
  return wayIds.map((wayId) => segmentFromWay(wayId)).filter(Boolean);
}

function segmentFromWay(wayId) {
  const way = wayById.get(wayId);
  if (!way) throw new Error(`OSM way not found: ${wayId}`);
  const coordinates = way.nodes
    .map((nodeId) => nodeById.get(nodeId))
    .filter(Boolean)
    .map((node) => [roundCoord(node.lon), roundCoord(node.lat)]);

  return coordinates.length >= 2 ? coordinates : null;
}

function stitchSegments(inputSegments, toleranceMeters) {
  const remaining = inputSegments.map((coordinates) => [...coordinates]);
  const lines = [];

  while (remaining.length) {
    let line = remaining.shift();
    let changed = true;

    while (changed) {
      changed = false;
      const endpoints = {
        start: line[0],
        end: line.at(-1),
      };

      let best = null;

      for (const [index, segment] of remaining.entries()) {
        const segmentStart = segment[0];
        const segmentEnd = segment.at(-1);
        const candidates = [
          { index, distance: distanceMeters(endpoints.end, segmentStart), action: "append" },
          { index, distance: distanceMeters(endpoints.end, segmentEnd), action: "append-reverse" },
          { index, distance: distanceMeters(endpoints.start, segmentEnd), action: "prepend" },
          { index, distance: distanceMeters(endpoints.start, segmentStart), action: "prepend-reverse" },
        ];

        for (const candidate of candidates) {
          if (candidate.distance <= toleranceMeters && (!best || candidate.distance < best.distance)) {
            best = candidate;
          }
        }
      }

      if (!best) continue;

      const [segment] = remaining.splice(best.index, 1);
      if (best.action === "append") line = connect(line, segment);
      if (best.action === "append-reverse") line = connect(line, [...segment].reverse());
      if (best.action === "prepend") line = connect(segment, line);
      if (best.action === "prepend-reverse") line = connect([...segment].reverse(), line);
      changed = true;
    }

    lines.push(line);
  }

  return lines.sort((a, b) => b.length - a.length);
}

function connect(first, second) {
  if (samePoint(first.at(-1), second[0])) return [...first, ...second.slice(1)];
  return [...first, ...second];
}

function simplifyConsecutiveDuplicates(line) {
  const result = [];
  for (const point of line) {
    if (!result.length || !samePoint(result.at(-1), point)) result.push(point);
  }
  return result;
}

function samePoint(a, b) {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1];
}

function roundCoord(value) {
  return Number(value.toFixed(7));
}

function distanceMeters(a, b) {
  const radius = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}
