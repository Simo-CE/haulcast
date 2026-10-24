import type { Heatmap } from "../types/api";
import { LEVEL_STYLES, type LevelKey } from "./risk";

export type Scheme = "light" | "dark";

/** The server grid as flat arrays. `scores` holds 0-4 risk per cell and hour, -1 where the forecast is unknown. */
export interface HeatGrid {
  step: number;
  hours: number;
  count: number;
  lonIdx: Int32Array;
  latIdx: Int32Array;
  scores: Float32Array;
}

/**
 * A fixed pixel grid laid over the cells. Each pixel keeps the 4 lattice cells around it and their kernel
 * weights, so painting a frame is one pass over the pixels with no lookups.
 */
export interface Raster {
  width: number;
  height: number;
  /** [west, south, east, north] in degrees; pixel rows are even in Mercator y, as MapLibre draws an image source */
  bounds: [number, number, number, number];
  taps: Int32Array;
  weights: Float32Array;
  /** 0..1 per pixel: 1 on a route, fading to 0 at the corridor half-width, so the heat hugs the routes */
  mask: Float32Array;
}

export interface Lut {
  /** RGBA for risk 0..4 in 1/64 steps */
  colors: Uint8ClampedArray;
  unknown: [number, number, number, number];
}

const RAMP: LevelKey[] = ["Low", "Moderate", "High", "Severe", "No Travel"];
const LUT_STEPS = 64;
const FEATHER = 0.6; // coverage at which the overlay is fully opaque; below it fades out at the corridor edge

const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];

/** Risk 0-4 (fractional) to colour: blend between the neighbouring level colours of the app's ramp. */
export function rampColor(
  score: number,
  scheme: Scheme,
): [number, number, number] {
  const s = Math.min(4, Math.max(0, score));
  const i = Math.min(3, Math.floor(s));
  const a = rgb(LEVEL_STYLES[RAMP[i]][scheme]);
  const b = rgb(LEVEL_STYLES[RAMP[i + 1]][scheme]);
  return a.map((v, k) => Math.round(v + (b[k] - v) * (s - i))) as [
    number,
    number,
    number,
  ];
}

/** Calm weather stays faint so danger stands out: Low is a light wash, No Travel nearly solid. */
export const rampAlpha = (score: number): number => 0.22 + 0.16 * score;

export function makeLut(scheme: Scheme): Lut {
  const colors = new Uint8ClampedArray((4 * LUT_STEPS + 1) * 4);
  for (let i = 0; i <= 4 * LUT_STEPS; i++) {
    const score = i / LUT_STEPS;
    colors.set(
      [...rampColor(score, scheme), Math.round(rampAlpha(score) * 255)],
      i * 4,
    );
  }
  // grey and mid-weight: visibly "no data", never one of the risk colours
  return { colors, unknown: [...rgb(LEVEL_STYLES.Unknown[scheme]), 140] };
}

export function buildGrid(heatmap: Heatmap): HeatGrid {
  const { points, hours, stepDeg, scoreScale, unknownScore } = heatmap;
  const scores = new Float32Array(points.length * hours);
  points.forEach((p, c) =>
    p.scores.forEach((s, h) => {
      scores[c * hours + h] = s === unknownScore || s < 0 ? -1 : s / scoreScale;
    }),
  );
  return {
    step: stepDeg,
    hours,
    count: points.length,
    lonIdx: Int32Array.from(points, (p) => Math.round(p.lon / stepDeg)),
    latIdx: Int32Array.from(points, (p) => Math.round(p.lat / stepDeg)),
    scores,
  };
}

/** True when any cell has no forecast at any hour, so the legend only mentions "No data" when it can appear. */
export const hasUnknown = (grid: HeatGrid): boolean =>
  grid.scores.some((s) => s < 0);

/**
 * Risk of every cell at a fractional hour, blended between the two surrounding hourly values.
 * A cell unknown at either neighbour takes the nearer hour's value, so unknown is never averaged into a level.
 */
export function valuesAt(
  grid: HeatGrid,
  hour: number,
  out: Float32Array = new Float32Array(grid.count),
): Float32Array {
  const h = Math.min(grid.hours - 1, Math.max(0, hour));
  const lo = Math.floor(h);
  const hi = Math.min(grid.hours - 1, lo + 1);
  const t = h - lo;
  for (let c = 0; c < grid.count; c++) {
    const a = grid.scores[c * grid.hours + lo];
    const b = grid.scores[c * grid.hours + hi];
    out[c] = a < 0 || b < 0 ? (t < 0.5 ? a : b) : a + (b - a) * t;
  }
  return out;
}

const merc = (lat: number): number =>
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const unmerc = (y: number): number =>
  ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;

const MI_PER_DEG = 69.17;

/** Pixel distance (in miles) to the nearest route: the routes are stamped onto the grid, then a two-pass chamfer sweep. */
function routeDistanceMi(
  routes: [number, number][][],
  raster: Pick<Raster, "width" | "height" | "bounds">,
  pxMi: number,
): Float32Array {
  const {
    width,
    height,
    bounds: [west, south, east, north],
  } = raster;
  const yTop = merc(north);
  const yBottom = merc(south);
  const dist = new Float32Array(width * height).fill(1e9);
  const toPx = ([lon, lat]: [number, number]): [number, number] => [
    ((lon - west) / (east - west)) * width,
    ((yTop - merc(lat)) / (yTop - yBottom)) * height,
  ];
  const stamp = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height)
      dist[Math.floor(y) * width + Math.floor(x)] = 0;
  };
  for (const route of routes) {
    let prev = toPx(route[0]);
    stamp(...prev);
    for (let i = 1; i < route.length; i++) {
      const cur = toPx(route[i]);
      const n = Math.max(
        1,
        Math.ceil(Math.hypot(cur[0] - prev[0], cur[1] - prev[1])),
      );
      for (let k = 1; k <= n; k++)
        stamp(
          prev[0] + ((cur[0] - prev[0]) * k) / n,
          prev[1] + ((cur[1] - prev[1]) * k) / n,
        );
      prev = cur;
    }
  }
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 1e9 : dist[y * width + x];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      dist[y * width + x] = Math.min(
        dist[y * width + x],
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1.414,
        at(x + 1, y - 1) + 1.414,
      );
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--)
      dist[y * width + x] = Math.min(
        dist[y * width + x],
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1.414,
        at(x - 1, y + 1) + 1.414,
      );
  for (let i = 0; i < dist.length; i++) dist[i] *= pxMi;
  return dist;
}

/** Half-width of the heat ribbon: 6% of the trip, so a 1.5 h hop gets a thin band and a coast-to-coast trip a wide one. */
export const ribbonHalfWidthMi = (tripMi: number): number =>
  Math.min(28, Math.max(6, 0.06 * tripMi));

/**
 * `routes` are [lon, lat] polylines. The raster has about one pixel per mile (at least 4 per cell, at most `maxPx`
 * across), so a short trip is sharp instead of a few huge blobs.
 */
export function buildRaster(
  grid: HeatGrid,
  routes: [number, number][][],
  maxPx = 512,
): Raster {
  const key = (lon: number, lat: number): number =>
    (lon + 4096) * 8192 + (lat + 4096);
  const cellOf = new Map<number, number>();
  for (let c = 0; c < grid.count; c++)
    cellOf.set(key(grid.lonIdx[c], grid.latIdx[c]), c);

  // one empty cell of margin, where the overlay has faded to nothing
  const minLon = Math.min(...grid.lonIdx) - 1;
  const maxLon = Math.max(...grid.lonIdx) + 1;
  const minLat = Math.min(...grid.latIdx) - 1;
  const maxLat = Math.max(...grid.latIdx) + 1;
  const [west, east, south, north] = [
    minLon * grid.step,
    maxLon * grid.step,
    minLat * grid.step,
    maxLat * grid.step,
  ];
  const yTop = merc(north);
  const yBottom = merc(south);
  const widthMi =
    (east - west) *
    MI_PER_DEG *
    Math.cos((((north + south) / 2) * Math.PI) / 180);
  const heightMi = (north - south) * MI_PER_DEG;
  const width = Math.min(
    maxPx,
    Math.max((maxLon - minLon) * 4, Math.round(widthMi)),
  );
  const height = Math.min(
    maxPx,
    Math.max(
      1,
      Math.round(
        (width * (yTop - yBottom)) / (((east - west) * Math.PI) / 180),
      ),
    ),
  );

  const taps = new Int32Array(width * height * 4).fill(-1);
  const weights = new Float32Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    const fy =
      unmerc(yTop - ((row + 0.5) / height) * (yTop - yBottom)) / grid.step;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let col = 0; col < width; col++) {
      const fx = (west + ((col + 0.5) / width) * (east - west)) / grid.step;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const base = (row * width + col) * 4;
      for (let k = 0; k < 4; k++) {
        const dx = k & 1;
        const dy = k >> 1;
        taps[base + k] = cellOf.get(key(x0 + dx, y0 + dy)) ?? -1;
        // round biweight kernel of radius one cell: neighbouring cells merge smoothly, not as square tiles
        const d2 = (tx - dx) ** 2 + (ty - dy) ** 2;
        weights[base + k] = d2 < 1 ? (1 - d2) ** 2 : 0;
      }
    }
  }

  const bounds: Raster["bounds"] = [west, south, east, north];
  const tripMi = Math.hypot(widthMi, heightMi);
  const half = ribbonHalfWidthMi(tripMi);
  const dist = routeDistanceMi(
    routes,
    { width, height, bounds },
    Math.max(widthMi / width, heightMi / height),
  );
  const mask = dist.map((d) => {
    const f = Math.min(1, Math.max(0, (half - d) / (half * 0.6))); // solid near the route, soft toward the edge
    return f * f * (3 - 2 * f);
  });
  return { width, height, bounds, taps, weights, mask };
}

/**
 * Colour every pixel from the cell values. Value and colour come from the cells that have data
 * (a weighted mean), so the colour is the real risk level and never a blend with "empty";
 * only the opacity fades toward the corridor edge. Unknown cells pull the pixel toward grey.
 */
export function paintField(
  raster: Raster,
  values: Float32Array,
  lut: Lut,
  out: Uint8ClampedArray,
): void {
  const { taps, weights } = raster;
  const pixels = raster.width * raster.height;
  for (let p = 0; p < pixels; p++) {
    let known = 0;
    let unknown = 0;
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const cell = taps[p * 4 + k];
      if (cell < 0) continue;
      const w = weights[p * 4 + k];
      if (values[cell] < 0) unknown += w;
      else {
        known += w;
        sum += w * values[cell];
      }
    }
    const coverage = known + unknown;
    const o = p * 4;
    if (coverage < 1e-3) {
      out[o + 3] = 0;
      continue;
    }
    let [r, g, b, a] = lut.unknown;
    if (known > 0) {
      const i = Math.round((sum / known) * LUT_STEPS) * 4;
      const mix = unknown / coverage;
      r = lut.colors[i] + (r - lut.colors[i]) * mix;
      g = lut.colors[i + 1] + (g - lut.colors[i + 1]) * mix;
      b = lut.colors[i + 2] + (b - lut.colors[i + 2]) * mix;
      a = lut.colors[i + 3] + (a - lut.colors[i + 3]) * mix;
    }
    const f = Math.min(1, coverage / FEATHER);
    out[o] = r;
    out[o + 1] = g;
    out[o + 2] = b;
    out[o + 3] = a * f * f * (3 - 2 * f) * raster.mask[p];
  }
}

/** Corner coordinates in MapLibre's image-source order: top-left, top-right, bottom-right, bottom-left. */
export function corners([west, south, east, north]: Raster["bounds"]): [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
] {
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}
