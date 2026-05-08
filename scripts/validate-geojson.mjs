import { readFile } from "node:fs/promises";

const file = new URL("../data/culverts.geojson", import.meta.url);
const data = JSON.parse(await readFile(file, "utf8"));

const allowedGeometryTypes = new Set(["LineString", "MultiLineString"]);
const allowedRanks = new Set(["A", "B", "C"]);
const requiredProperties = [
  "id",
  "name",
  "areaName",
  "sources",
  "lastVerifiedAt",
];

const errors = [];
const ids = new Set();

if (data.type !== "FeatureCollection") {
  errors.push("Root type must be FeatureCollection.");
}

if (!Array.isArray(data.features)) {
  errors.push("Root features must be an array.");
}

for (const [index, feature] of (data.features || []).entries()) {
  const label = `features[${index}]`;
  if (feature.type !== "Feature") {
    errors.push(`${label}.type must be Feature.`);
    continue;
  }

  if (!feature.geometry || !allowedGeometryTypes.has(feature.geometry.type)) {
    errors.push(`${label}.geometry.type must be LineString or MultiLineString.`);
  } else {
    validateCoordinates(feature.geometry.coordinates, `${label}.geometry.coordinates`);
  }

  const props = feature.properties || {};
  for (const key of requiredProperties) {
    if (!(key in props)) errors.push(`${label}.properties.${key} is required.`);
  }

  if (typeof props.id === "string") {
    if (ids.has(props.id)) errors.push(`${label}.properties.id duplicates "${props.id}".`);
    ids.add(props.id);
  } else {
    errors.push(`${label}.properties.id must be a string.`);
  }

  if (props.evidenceRank !== undefined && !allowedRanks.has(props.evidenceRank)) {
    errors.push(`${label}.properties.evidenceRank must be A, B, or C when present.`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(props.lastVerifiedAt || "")) {
    errors.push(`${label}.properties.lastVerifiedAt must be YYYY-MM-DD.`);
  }

  if (!Array.isArray(props.sources)) {
    errors.push(`${label}.properties.sources must be an array.`);
  } else if (!props.riverReference && props.sources.length === 0) {
    errors.push(`${label}.properties.sources must not be empty for public culvert features.`);
  } else {
    props.sources.forEach((source, sourceIndex) => validateSource(source, `${label}.properties.sources[${sourceIndex}]`));
  }

  if (props.lineworkSources !== undefined) {
    if (!Array.isArray(props.lineworkSources)) {
      errors.push(`${label}.properties.lineworkSources must be an array when present.`);
    } else {
      props.lineworkSources.forEach((source, sourceIndex) => validateSource(source, `${label}.properties.lineworkSources[${sourceIndex}]`));
    }
  }

  if (props.lineworkPrecision !== undefined && !["manual", "osm-traced"].includes(props.lineworkPrecision)) {
    errors.push(`${label}.properties.lineworkPrecision must be manual or osm-traced when present.`);
  }

  if (props.osmElementIds !== undefined) {
    const validElementId = /^(way|relation)\/\d+$/;
    if (!Array.isArray(props.osmElementIds)) {
      errors.push(`${label}.properties.osmElementIds must be an array when present.`);
    } else {
      props.osmElementIds.forEach((elementId, elementIndex) => {
        if (typeof elementId !== "string" || !validElementId.test(elementId)) {
          errors.push(`${label}.properties.osmElementIds[${elementIndex}] must look like way/123 or relation/123.`);
        }
      });
    }
  }

  for (const key of ["name", "areaName"]) {
    if (typeof props[key] !== "string" || props[key].trim().length === 0) {
      errors.push(`${label}.properties.${key} must be a non-empty string.`);
    }
  }
}

if (errors.length) {
  console.error(`GeoJSON validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`GeoJSON validation passed: ${data.features.length} feature(s), ${ids.size} unique id(s).`);

function validateSource(source, label) {
  for (const key of ["title", "url", "publisher", "licenseNote"]) {
    if (typeof source[key] !== "string" || source[key].trim().length === 0) {
      errors.push(`${label}.${key} must be a non-empty string.`);
    }
  }

  try {
    const url = new URL(source.url);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push(`${label}.url must be http or https.`);
    }
  } catch {
    errors.push(`${label}.url must be a valid URL.`);
  }
}

function validateCoordinates(coordinates, label) {
  const flat = flattenCoordinates(coordinates);
  if (flat.length < 2) {
    errors.push(`${label} must contain at least two positions.`);
  }

  for (const [index, point] of flat.entries()) {
    if (!Array.isArray(point) || point.length < 2) {
      errors.push(`${label}[${index}] must be a coordinate pair.`);
      continue;
    }
    const [lng, lat] = point;
    if (typeof lng !== "number" || typeof lat !== "number") {
      errors.push(`${label}[${index}] must contain numeric lng/lat.`);
    }
    if (lng < 122 || lng > 154 || lat < 20 || lat > 46) {
      errors.push(`${label}[${index}] is outside the expected Japan extent.`);
    }
  }
}

function flattenCoordinates(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  if (typeof coordinates[0]?.[0] === "number") return coordinates;
  return coordinates.flat();
}
