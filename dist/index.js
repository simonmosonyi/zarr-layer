// src/zarr-utils.ts
import * as zarr from "zarrita";

// src/constants.ts
var DEFAULT_TILE_SIZE = 128;
var MAX_CACHED_TILES = 64;
var TILE_SUBDIVISIONS = 32;
var MERCATOR_LAT_LIMIT = 85.05112878;
var DEFAULT_MESH_MAX_ERROR = 0.125;
var DEFAULT_QUERY_DENSIFY_MAX_ERROR = DEFAULT_MESH_MAX_ERROR;
var MIN_SUBDIVISIONS = 2;
var MAX_SUBDIVISIONS = 128;
var MERCATOR_SUBDIVISIONS = 1;
var WEB_MERCATOR_EXTENT = 20037508342789244e-9;
var SPATIAL_DIMENSION_ALIASES = {
  lat: ["lat", "latitude", "y"],
  lon: ["lon", "longitude", "x", "lng"]
};
var SPATIAL_DIM_NAMES = /* @__PURE__ */ new Set([
  ...SPATIAL_DIMENSION_ALIASES.lat,
  ...SPATIAL_DIMENSION_ALIASES.lon
]);
var EQUI7GRID_PROJ4 = {
  "EPSG:27701": "+proj=aeqd +lat_0=8.5 +lon_0=21.5 +x_0=5621452.01998 +y_0=5990638.42298 +datum=WGS84 +units=m +no_defs",
  // Africa
  "EPSG:27702": "+proj=aeqd +lat_0=-90 +lon_0=0 +x_0=3714266.97719 +y_0=3402016.50625 +datum=WGS84 +units=m +no_defs",
  // Antarctica
  "EPSG:27703": "+proj=aeqd +lat_0=47 +lon_0=94 +x_0=4340913.84808 +y_0=4812712.92347 +datum=WGS84 +units=m +no_defs",
  // Asia
  "EPSG:27704": "+proj=aeqd +lat_0=53 +lon_0=24 +x_0=5837287.81977 +y_0=2121415.69617 +datum=WGS84 +units=m +no_defs",
  // Europe
  "EPSG:27705": "+proj=aeqd +lat_0=52 +lon_0=-97.5 +x_0=8264722.17686 +y_0=4867518.35323 +datum=WGS84 +units=m +no_defs",
  // North America
  "EPSG:27706": "+proj=aeqd +lat_0=-19.5 +lon_0=131.5 +x_0=6988408.5356 +y_0=7654884.53733 +datum=WGS84 +units=m +no_defs",
  // Oceania
  "EPSG:27707": "+proj=aeqd +lat_0=-14 +lon_0=-60.5 +x_0=7257179.23559 +y_0=5592024.44605 +datum=WGS84 +units=m +no_defs"
  // South America
};

// src/zarr-utils.ts
var resolveOpenFunc = (zarrVersion) => {
  if (zarrVersion === 2) return zarr.open.v2;
  if (zarrVersion === 3) return zarr.open.v3;
  return zarr.open;
};
function sanitizeGlslName(name) {
  let sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^[0-9]/.test(sanitized)) {
    sanitized = "_" + sanitized;
  }
  return sanitized;
}
function identifyDimensionIndices(dimNames, spatialDimensions, coordinates) {
  const aliases = {
    lat: [...SPATIAL_DIMENSION_ALIASES.lat],
    lon: [...SPATIAL_DIMENSION_ALIASES.lon]
  };
  if (spatialDimensions?.lat) {
    aliases.lat = [spatialDimensions.lat];
  }
  if (spatialDimensions?.lon) {
    aliases.lon = [spatialDimensions.lon];
  }
  const indices = {};
  for (const [key, aliasList] of Object.entries(aliases)) {
    for (let i = 0; i < dimNames.length; i++) {
      const name = dimNames[i].toLowerCase();
      if (aliasList.map((a) => a.toLowerCase()).includes(name)) {
        indices[key] = {
          name: dimNames[i],
          index: i,
          array: coordinates ? coordinates[dimNames[i]] : null
        };
        break;
      }
    }
  }
  return indices;
}
async function loadDimensionValues(dimensionValues, levelInfo, dimIndices, root2, zarrVersion, slice3) {
  if (dimensionValues[dimIndices.name]) return dimensionValues[dimIndices.name];
  const targetRoot = levelInfo ? root2.resolve(levelInfo) : root2;
  let coordArr;
  if (dimIndices.array) {
    coordArr = dimIndices.array;
  } else {
    const coordVar = targetRoot.resolve(dimIndices.name);
    const localFunc = resolveOpenFunc(zarrVersion);
    coordArr = await localFunc(coordVar, { kind: "array" });
  }
  const coordData = await zarr.get(coordArr);
  const data = coordData.data;
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "string") {
    const stringArray = data;
    if (slice3) {
      return stringArray.slice(slice3[0], slice3[1]);
    }
    return stringArray;
  }
  const coordArray = Array.from(
    data,
    (v) => typeof v === "bigint" ? Number(v) : v
  );
  if (slice3) {
    return coordArray.slice(slice3[0], slice3[1]);
  }
  return coordArray;
}
function getBandInformation(selector) {
  const result = {};
  for (const [key, value] of Object.entries(selector)) {
    const selected = value?.selected;
    const normalized = Array.isArray(selected) ? selected : null;
    if (normalized && Array.isArray(normalized)) {
      normalized.forEach((v, idx) => {
        const bandValue = v;
        const rawName = typeof bandValue === "string" ? bandValue : `${key}_${bandValue}`;
        const bandName = sanitizeGlslName(rawName);
        result[bandName] = { band: bandValue, index: idx };
      });
    }
  }
  return result;
}
function getBands(variable, selector) {
  if (Array.isArray(variable)) {
    return variable.map(sanitizeGlslName);
  }
  const bandInfo = getBandInformation(selector);
  const bandNames = Object.keys(bandInfo);
  if (bandNames.length === 0) {
    return [variable];
  }
  return bandNames;
}
function toSelectorProps(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && "selected" in value) {
    const normalized = value;
    return {
      selected: normalized.selected,
      type: normalized.type ?? "value"
    };
  }
  return { selected: value, type: "value" };
}
function normalizeSelector(selector) {
  return Object.entries(selector).reduce((acc, [dimName, value]) => {
    acc[dimName] = toSelectorProps(value);
    return acc;
  }, {});
}
function hashSelector(selector) {
  const sortKeys = (value) => {
    if (Array.isArray(value) || value === null) return value;
    if (typeof value !== "object") return value;
    const obj = value;
    const sorted = {};
    for (const k of Object.keys(obj).sort()) {
      sorted[k] = sortKeys(obj[k]);
    }
    return sorted;
  };
  return JSON.stringify(sortKeys(selector));
}
function resolveSelectorValue(selector, dimKey, dimName, dimIndices) {
  if (selector[dimKey] !== void 0) {
    return selector[dimKey];
  }
  if (dimName && selector[dimName] !== void 0) {
    return selector[dimName];
  }
  if (dimIndices && dimIndices[dimKey]?.name) {
    const indexedName = dimIndices[dimKey].name;
    if (selector[indexedName] !== void 0) {
      return selector[indexedName];
    }
  }
  return void 0;
}

// src/zarr-store.ts
import * as zarr3 from "zarrita";

// src/decoded-chunk-cache.ts
import * as zarr2 from "zarrita";
var createLRU = (maxEntries) => {
  const store = /* @__PURE__ */ new Map();
  return {
    get(key) {
      if (!store.has(key)) return void 0;
      const hit = store.get(key);
      store.delete(key);
      store.set(key, hit);
      return hit;
    },
    set(key, value) {
      if (store.has(key)) store.delete(key);
      store.set(key, value);
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === void 0) break;
        store.delete(oldest);
      }
    }
  };
};
var chunkCacheKey = (path, coords) => `${path}\0${coords.join(",")}`;
var createAbortError = () => new DOMException("The operation was aborted.", "AbortError");
var decodedChunkExtension = zarr2.defineArrayExtension(
  (array, opts) => ({
    async getChunk(coords, options) {
      const callerSignal = options?.signal;
      if (callerSignal?.aborted) {
        throw createAbortError();
      }
      const key = chunkCacheKey(array.path, coords);
      const hit = opts.cache.get(key);
      if (hit) return hit;
      let entry = opts.pending.get(key);
      if (!entry) {
        const ac = new AbortController();
        const fresh = {
          promise: void 0,
          ac,
          refCount: 0
        };
        fresh.promise = array.getChunk(coords, { ...options ?? {}, signal: ac.signal }).then((chunk) => {
          opts.cache.set(key, chunk);
          return chunk;
        }).finally(() => {
          if (opts.pending.get(key) === fresh) {
            opts.pending.delete(key);
          }
        });
        opts.pending.set(key, fresh);
        entry = fresh;
      }
      const ownedEntry = entry;
      ownedEntry.refCount++;
      const releaseRef = () => {
        ownedEntry.refCount--;
      };
      const abandonRef = () => {
        ownedEntry.refCount--;
        if (ownedEntry.refCount <= 0) {
          if (opts.pending.get(key) === ownedEntry) {
            opts.pending.delete(key);
          }
          ownedEntry.ac.abort();
        }
      };
      if (!callerSignal) {
        try {
          const chunk = await ownedEntry.promise;
          releaseRef();
          return chunk;
        } catch (err) {
          releaseRef();
          throw err;
        }
      }
      return new Promise((resolve, reject) => {
        let settled = false;
        const onAbort = () => {
          if (settled) return;
          settled = true;
          callerSignal.removeEventListener("abort", onAbort);
          abandonRef();
          reject(createAbortError());
        };
        callerSignal.addEventListener("abort", onAbort, { once: true });
        ownedEntry.promise.then(
          (chunk) => {
            if (settled) return;
            settled = true;
            callerSignal.removeEventListener("abort", onAbort);
            releaseRef();
            resolve(chunk);
          },
          (err) => {
            if (settled) return;
            settled = true;
            callerSignal.removeEventListener("abort", onAbort);
            releaseRef();
            reject(err);
          }
        );
      });
    }
  })
);
var withDecodedChunkCaching = zarr2.defineStoreExtension(
  (_inner, opts = {}) => {
    const cache = createLRU(opts.maxEntries ?? 512);
    const pending = /* @__PURE__ */ new Map();
    return {
      arrayExtensions: [
        (array) => decodedChunkExtension(array, { cache, pending })
      ]
    };
  }
);

// src/projection-utils.ts
import proj4 from "proj4";
function resolveEqui7GridProj4(crs) {
  if (!crs || !crs.startsWith("EPSG:")) {
    return crs;
  }
  return EQUI7GRID_PROJ4[crs] ?? crs;
}
function formatProj4Error(proj4def, err) {
  const msg = err instanceof Error ? err.message : String(err);
  return `[zarr-layer] Invalid proj4 string: "${proj4def.slice(0, 50)}${proj4def.length > 50 ? "..." : ""}". Error: ${msg}. Check your dataset metadata or find CRS definitions at https://epsg.io/`;
}
function createTransformer(proj4def, bounds) {
  let converter;
  try {
    converter = proj4(proj4def, "EPSG:3857");
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err));
  }
  return {
    forward: (x, y) => converter.forward([x, y]),
    inverse: (x, y) => converter.inverse([x, y]),
    bounds
  };
}
function createTransformerTo4326(proj4def, bounds) {
  let converter;
  try {
    converter = proj4(proj4def, "EPSG:4326");
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err));
  }
  return {
    forward: (x, y) => converter.forward([x, y]),
    inverse: (lon, lat) => converter.inverse([lon, lat]),
    bounds
  };
}
function validateBounds(bounds, fnName) {
  const [xMin, yMin, xMax, yMax] = bounds;
  if (xMax <= xMin || yMax <= yMin) {
    console.warn(
      `[zarr-layer] Invalid bounds in ${fnName}: max must be greater than min`
    );
    return false;
  }
  return true;
}
function sourceCRSToPixel(x, y, bounds, width, height, latIsAscending = true) {
  if (!validateBounds(bounds, "sourceCRSToPixel")) {
    return [width / 2, height / 2];
  }
  const [xMin, yMin, xMax, yMax] = bounds;
  const xNorm = (x - xMin) / (xMax - xMin);
  const yNorm = (y - yMin) / (yMax - yMin);
  const xPixel = xNorm * width;
  const yPixel = latIsAscending ? yNorm * height : (1 - yNorm) * height;
  return [xPixel, yPixel];
}
function pixelToSourceCRS(xPixel, yPixel, bounds, width, height, latIsAscending = true) {
  const [xMin, yMin, xMax, yMax] = bounds;
  if (!validateBounds(bounds, "pixelToSourceCRS")) {
    return [(xMin + xMax) / 2, (yMin + yMax) / 2];
  }
  const xNorm = width <= 1 ? 0.5 : xPixel / width;
  const yNorm = height <= 1 ? 0.5 : yPixel / height;
  const x = xMin + xNorm * (xMax - xMin);
  const y = latIsAscending ? yMin + yNorm * (yMax - yMin) : yMax - yNorm * (yMax - yMin);
  return [x, y];
}
function createWGS84ToSourceTransformer(proj4def) {
  let wgsToMerc;
  let srcToMerc;
  try {
    wgsToMerc = proj4("EPSG:4326", "EPSG:3857");
    srcToMerc = proj4(proj4def, "EPSG:3857");
  } catch (err) {
    throw new Error(formatProj4Error(proj4def, err));
  }
  const isAeqd = proj4def.includes("+proj=aeqd");
  const x0 = isAeqd ? parseFloat(proj4def.match(/\+x_0=(-?[\d.]+)/)?.[1] ?? "0") || 0 : 0;
  const y0 = isAeqd ? parseFloat(proj4def.match(/\+y_0=(-?[\d.]+)/)?.[1] ?? "0") || 0 : 0;
  return {
    // WGS84 → Mercator → source CRS (AEQD: manually add false easting that proj4js omits)
    forward: (lon, lat) => {
      const merc = wgsToMerc.forward([lon, lat]);
      if (!isFinite(merc[0]) || !isFinite(merc[1])) return [NaN, NaN];
      try {
        const [nx, ny] = srcToMerc.inverse(merc);
        return [nx + x0, ny + y0];
      } catch {
        return [NaN, NaN];
      }
    },
    // source CRS → Mercator → WGS84 (forward direction correctly handles false easting)
    inverse: (x, y) => {
      const merc = srcToMerc.forward([x, y]);
      return wgsToMerc.inverse(merc);
    }
  };
}
function sampleEdgesToMercatorBounds(bounds, transformer, numSamples) {
  const { xMin, yMin, xMax, yMax } = bounds;
  let minMercX = Infinity;
  let maxMercX = -Infinity;
  let minMercY = Infinity;
  let maxMercY = -Infinity;
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const edgePoints = [
      [xMin + t * (xMax - xMin), yMin],
      // Bottom
      [xMin + t * (xMax - xMin), yMax],
      // Top
      [xMin, yMin + t * (yMax - yMin)],
      // Left
      [xMax, yMin + t * (yMax - yMin)]
      // Right
    ];
    for (const [srcX, srcY] of edgePoints) {
      const [mercX, mercY] = transformer.forward(srcX, srcY);
      if (!isFinite(mercX) || !isFinite(mercY)) continue;
      const normX = (mercX + WEB_MERCATOR_EXTENT) / (2 * WEB_MERCATOR_EXTENT);
      const normY = (WEB_MERCATOR_EXTENT - mercY) / (2 * WEB_MERCATOR_EXTENT);
      minMercX = Math.min(minMercX, normX);
      maxMercX = Math.max(maxMercX, normX);
      minMercY = Math.min(minMercY, normY);
      maxMercY = Math.max(maxMercY, normY);
    }
  }
  if (!isFinite(minMercX)) return null;
  return { x0: minMercX, y0: minMercY, x1: maxMercX, y1: maxMercY };
}

// src/zarr-store.ts
var createFetchStore = (url, transformRequest) => {
  if (!transformRequest) {
    return new zarr3.FetchStore(url);
  }
  return new zarr3.FetchStore(url, {
    async fetch(request) {
      const { url: transformedUrl, ...overrides } = await transformRequest(
        request.url,
        { method: request.method }
      );
      const mergedHeaders = new Headers(request.headers);
      if (overrides.headers) {
        for (const [k, v] of Object.entries(
          overrides.headers
        )) {
          mergedHeaders.set(k, v);
        }
      }
      const response = await fetch(
        new Request(new Request(transformedUrl, request), {
          ...overrides,
          headers: mergedHeaders
        })
      );
      if (response.status === 403) {
        return new Response(null, { status: 404 });
      }
      return response;
    }
  });
};
var ZarrStore = class {
  constructor({
    source,
    version = null,
    variable,
    spatialDimensions = {},
    bounds,
    crs,
    coordinateKeys = [],
    latIsAscending = null,
    proj4: proj42,
    transformRequest,
    customStore
  }) {
    this.dimensions = [];
    this.shape = [];
    this.chunks = [];
    this.fill_value = null;
    this.dtype = null;
    this.levels = [];
    this.maxLevelIndex = 0;
    this.tileSize = DEFAULT_TILE_SIZE;
    this.crs = "EPSG:4326";
    this.multiscaleType = "none";
    this.untiledLevels = [];
    this.dimIndices = {};
    this.xyLimits = null;
    this.scaleFactor = 1;
    this.addOffset = 0;
    this.coordinates = {};
    this.latIsAscending = true;
    // Default: row 0 = south; overridden by detection
    this._latIsAscendingUserSet = false;
    this.proj4 = null;
    this._crsFromMetadata = false;
    // Track if CRS was explicitly set from metadata
    this._crsOverride = false;
    this.store = null;
    this.root = null;
    this._arrayHandles = /* @__PURE__ */ new Map();
    if (!source && !customStore) {
      throw new Error("source is required when customStore is not provided");
    }
    if (!variable) {
      throw new Error("variable is a required parameter");
    }
    this.source = source ?? "custom-store";
    this.version = version;
    this.variable = variable;
    this.spatialDimensions = spatialDimensions;
    this.explicitBounds = bounds ?? null;
    this.coordinateKeys = coordinateKeys;
    if (latIsAscending !== null) {
      this.latIsAscending = latIsAscending;
      this._latIsAscendingUserSet = true;
    }
    if (crs) {
      const normalized = crs.toUpperCase();
      const isEqui7Grid = /^EPSG:277(0[1-7])$/.test(normalized);
      if (normalized === "EPSG:4326" || normalized === "EPSG:3857") {
        this.crs = normalized;
        this._crsOverride = true;
      } else if (isEqui7Grid) {
        this.crs = normalized;
        this._crsOverride = true;
        if (!proj42) {
          this.proj4 = resolveEqui7GridProj4(normalized) ?? null;
        } else {
          this.proj4 = proj42;
        }
      } else if (!proj42) {
        console.warn(
          `[zarr-layer] CRS "${crs}" requires 'proj4' to render correctly. Falling back to inferred CRS.`
        );
      }
    }
    if (!this.proj4) {
      this.proj4 = proj42 ?? null;
    }
    this.transformRequest = transformRequest;
    this.customStore = customStore;
    this.initialized = this._initialize();
  }
  // Track if CRS was explicitly set by user
  /**
   * Returns the coarsest (lowest resolution) level path.
   * - Tiled pyramids: level 0 is coarsest
   * - Untiled multiscale: last level (maxLevelIndex) is coarsest
   */
  get coarsestLevel() {
    if (this.levels.length === 0) return void 0;
    return this.multiscaleType === "untiled" ? this.levels[this.maxLevelIndex] : this.levels[0];
  }
  async _initialize() {
    if (this.customStore) {
      if (typeof this.customStore.get !== "function") {
        throw new Error(
          "customStore must implement Readable interface with get() method"
        );
      }
      const hasGetRange = typeof this.customStore.getRange === "function";
      this.store = hasGetRange ? await zarr3.extendStore(
        this.customStore,
        (store) => zarr3.withRangeCoalescing(store),
        (store) => withDecodedChunkCaching(store)
      ) : await zarr3.extendStore(
        this.customStore,
        (store) => withDecodedChunkCaching(store)
      );
    } else {
      const consolidatedOpts = this.version === 2 ? { format: "v2" } : this.version === 3 ? { format: "v3" } : void 0;
      this.store = await zarr3.extendStore(
        createFetchStore(this.source, this.transformRequest),
        (store) => zarr3.withMaybeConsolidatedMetadata(store, consolidatedOpts).catch(() => store),
        (store) => zarr3.withRangeCoalescing(store),
        (store) => withDecodedChunkCaching(store)
      );
    }
    this.root = zarr3.root(this.store);
    await this._loadMetadata();
    await this._loadSpatialMetadata();
    await this._loadCoordinates();
    return this;
  }
  async _loadCoordinates() {
    if (!this.coordinateKeys.length || !this.levels.length) return;
    await Promise.all(
      this.coordinateKeys.map(async (key) => {
        try {
          const coordPath = `${this.levels[0]}/${key}`;
          const coordArray = await this._getArray(coordPath);
          const chunk = await coordArray.getChunk([0]);
          this.coordinates[key] = Array.from(
            chunk.data
          );
        } catch (err) {
          console.warn(`Failed to load coordinate array for '${key}':`, err);
        }
      })
    );
  }
  cleanup() {
    this._arrayHandles.clear();
    this.store = null;
    this.root = null;
  }
  describe() {
    return {
      dimensions: this.dimensions,
      shape: this.shape,
      chunks: this.chunks,
      fill_value: this.fill_value,
      dtype: this.dtype,
      levels: this.levels,
      maxLevelIndex: this.maxLevelIndex,
      tileSize: this.tileSize,
      crs: this.crs,
      multiscaleType: this.multiscaleType,
      untiledLevels: this.untiledLevels,
      dimIndices: this.dimIndices,
      xyLimits: this.xyLimits,
      scaleFactor: this.scaleFactor,
      addOffset: this.addOffset,
      coordinates: this.coordinates,
      latIsAscending: this.latIsAscending,
      proj4: this.proj4
    };
  }
  async getChunk(level, chunkIndices, options) {
    const key = `${level}/${this.variable}`;
    const array = await this._getArray(key);
    return array.getChunk(chunkIndices, options);
  }
  async getLevelArray(level) {
    const key = `${level}/${this.variable}`;
    return this._getArray(key);
  }
  async getLevelArrays(level, variables) {
    return Promise.all(variables.map((v) => this._getArray(`${level}/${v}`)));
  }
  async getArray() {
    return this._getArray(this.variable);
  }
  async openArray(key) {
    return this._getArray(key);
  }
  /**
   * Get metadata (shape, chunks, scale/offset/fill) for a specific untiled level.
   * Uses zarrita's array properties — no manual JSON fetching needed.
   * On consolidated stores, metadata is served from cache (no network).
   */
  async getUntiledLevelMetadata(levelAsset) {
    const array = await this.getLevelArray(levelAsset);
    const attrs = array.attrs;
    const dtype = array.dtype || null;
    const fillValue = this.normalizeFillValue(array.fillValue);
    const isFloatData = !!dtype?.includes("float");
    let scaleFactor = void 0;
    let addOffset = void 0;
    if (isFloatData) {
      scaleFactor = 1;
      addOffset = 0;
    } else {
      if (attrs?.scale_factor !== void 0) {
        scaleFactor = attrs.scale_factor;
      }
      if (attrs?.add_offset !== void 0) {
        addOffset = attrs.add_offset;
      }
    }
    return {
      shape: array.shape,
      chunks: array.chunks,
      scaleFactor,
      addOffset,
      fillValue,
      dtype
    };
  }
  async _getArray(key) {
    if (!this.root) {
      throw new Error("Zarr store accessed before initialization completed");
    }
    let handle = this._arrayHandles.get(key);
    if (!handle) {
      const location = this.root.resolve(key);
      const openFunc = resolveOpenFunc(this.version);
      handle = openFunc(location, { kind: "array" }).catch((err) => {
        this._arrayHandles.delete(key);
        throw err;
      });
      this._arrayHandles.set(key, handle);
    }
    return handle;
  }
  isConsolidatedStore(store) {
    return store !== null && typeof store.contents === "function";
  }
  /**
   * Unified metadata loading using zarrita's built-in APIs.
   * zarrita auto-detects Zarr v2/v3 format and provides parsed metadata
   * via group.attrs and array.shape/chunks/dtype/fillValue/dimensionNames/attrs.
   */
  async _loadMetadata() {
    if (!this.root) throw new Error("Zarr store not initialized");
    const openFunc = resolveOpenFunc(this.version);
    const group = await openFunc(this.root, { kind: "group" });
    const rootAttrs = group.attrs;
    if (rootAttrs?.multiscales) {
      const pyramid = this._getPyramidMetadata(
        rootAttrs.multiscales
      );
      this.levels = pyramid.levels;
      this.maxLevelIndex = pyramid.maxLevelIndex;
      this.tileSize = pyramid.tileSize;
      if (!this._crsOverride) {
        this.crs = pyramid.crs;
      }
    }
    const basePath = this.levels.length > 0 ? `${this.levels[0]}/${this.variable}` : this.variable;
    const array = await this._getArray(basePath);
    const arrayAttrs = array.attrs;
    this.dimensions = array.dimensionNames ?? [];
    this.shape = array.shape;
    this.chunks = array.chunks;
    this.fill_value = this.normalizeFillValue(array.fillValue);
    this.dtype = array.dtype || null;
    this.scaleFactor = typeof arrayAttrs?.scale_factor === "number" ? arrayAttrs.scale_factor : 1;
    this.addOffset = typeof arrayAttrs?.add_offset === "number" ? arrayAttrs.add_offset : 0;
    await this._computeDimIndices();
  }
  async _computeDimIndices() {
    if (this.dimensions.length === 0) return;
    this.dimIndices = identifyDimensionIndices(
      this.dimensions,
      this.spatialDimensions
    );
    const spatialDimNames = new Set(
      ["lat", "lon"].filter((key) => this.dimIndices[key]).map((key) => this.dimIndices[key].name.toLowerCase())
    );
    for (let i = 0; i < this.dimensions.length; i++) {
      const dimName = this.dimensions[i];
      if (this.dimIndices[dimName] || this.dimIndices[dimName.toLowerCase()]) {
        continue;
      }
      if (spatialDimNames.has(dimName.toLowerCase())) {
        continue;
      }
      this.dimIndices[dimName] = {
        name: dimName,
        index: i,
        array: null
      };
    }
  }
  normalizeFillValue(value) {
    if (value === void 0 || value === null) return null;
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (lower === "nan") return Number.NaN;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof value === "number") {
      return value;
    }
    return null;
  }
  /**
   * Find the highest resolution level by comparing array shapes.
   * On consolidated stores, zarr.open serves metadata from cache (no network).
   * Users can provide explicit `bounds` to skip this detection entirely.
   */
  async _findBoundsLevel() {
    if (this.levels.length === 0 || !this.root) return void 0;
    if (this.levels.length === 1) return this.levels[0];
    const firstLevel = this.levels[0];
    const lastLevel = this.levels[this.levels.length - 1];
    try {
      const [firstArray, lastArray] = await Promise.all([
        this._getArray(`${firstLevel}/${this.variable}`),
        this._getArray(`${lastLevel}/${this.variable}`)
      ]);
      const firstSize = firstArray.shape.reduce((a, b) => a * b, 1);
      const lastSize = lastArray.shape.reduce((a, b) => a * b, 1);
      return firstSize >= lastSize ? firstLevel : lastLevel;
    } catch {
      return firstLevel;
    }
  }
  async _loadSpatialMetadata() {
    if (this.explicitBounds) {
      const [west, south, east, north] = this.explicitBounds;
      this.xyLimits = { xMin: west, xMax: east, yMin: south, yMax: north };
    }
    if (this.multiscaleType === "tiled") {
      if (!this.xyLimits) {
        this.xyLimits = { xMin: -180, xMax: 180, yMin: -90, yMax: 90 };
      }
      if (!this._latIsAscendingUserSet) {
        this.latIsAscending = false;
      }
      return;
    }
    const needsBounds = !this.xyLimits;
    const needsLatAscending = !this._latIsAscendingUserSet;
    if (!needsBounds && !needsLatAscending) {
      return;
    }
    if (!this.dimIndices.lon || !this.dimIndices.lat || !this.root) {
      return;
    }
    try {
      const boundsLevel = await this._findBoundsLevel();
      const lonName = this.spatialDimensions.lon ?? this.dimIndices.lon.name;
      const latName = this.spatialDimensions.lat ?? this.dimIndices.lat.name;
      const findCoordPath = async (dimName) => {
        const store = this.store;
        if (!this.isConsolidatedStore(store)) return null;
        const entries = store.contents();
        const matchingPaths = entries.filter(
          (e) => e.kind === "array" && (e.path === `/${dimName}` || e.path.endsWith(`/${dimName}`))
        ).map((e) => e.path.slice(1));
        if (matchingPaths.length === 0) return null;
        if (matchingPaths.length === 1) return matchingPaths[0];
        const withSizes = await Promise.all(
          matchingPaths.map(async (path) => {
            try {
              const arr = await this._getArray(path);
              return { path, size: arr.shape[0] };
            } catch {
              return { path, size: 0 };
            }
          })
        );
        const largest = (predicate) => withSizes.reduce(
          (best, c) => predicate(c) && (!best || c.size > best.size) ? c : best,
          void 0
        );
        if (boundsLevel) {
          const levelPrefix = `${boundsLevel}/`;
          const levelPick = largest((c) => c.path.startsWith(levelPrefix));
          if (levelPick) return levelPick.path;
          const rootPick = largest((c) => !c.path.includes("/"));
          if (rootPick) return rootPick.path;
        } else if (this.variable) {
          const varPick = largest((c) => c.path.startsWith(`${this.variable}/`));
          if (varPick) return varPick.path;
        }
        return largest(() => true)?.path ?? null;
      };
      const [xPath, yPath] = await Promise.all([
        findCoordPath(lonName),
        findCoordPath(latName)
      ]);
      const defaultPrefix = boundsLevel ? `${boundsLevel}/` : "";
      const xarr = await this._getArray(xPath ?? `${defaultPrefix}${lonName}`);
      const yarr = await this._getArray(yPath ?? `${defaultPrefix}${latName}`);
      const xLen = xarr.shape[0];
      const yLen = yarr.shape[0];
      const [xFirstTwo, xLast, yFirstTwo, yLast] = await Promise.all([
        zarr3.get(xarr, [zarr3.slice(0, 2)]),
        zarr3.get(xarr, [zarr3.slice(xLen - 1, xLen)]),
        zarr3.get(yarr, [zarr3.slice(0, 2)]),
        zarr3.get(yarr, [zarr3.slice(yLen - 1, yLen)])
      ]);
      const x0 = xFirstTwo.data[0];
      const x1 = xFirstTwo.data[1] ?? x0;
      const xN = xLast.data[0];
      const y0 = yFirstTwo.data[0];
      const y1 = yFirstTwo.data[1];
      const yN = yLast.data[0];
      const detectedLatAscending = y1 > y0;
      if (needsLatAscending) {
        this.latIsAscending = detectedLatAscending;
      }
      const coordXMin = Math.min(x0, xN);
      const coordXMax = Math.max(x0, xN);
      const coordYMin = Math.min(y0, yN);
      const coordYMax = Math.max(y0, yN);
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      let xMin = coordXMin - (Number.isFinite(dx) ? dx / 2 : 0);
      let xMax = coordXMax + (Number.isFinite(dx) ? dx / 2 : 0);
      const yMin = coordYMin - (Number.isFinite(dy) ? dy / 2 : 0);
      const yMax = coordYMax + (Number.isFinite(dy) ? dy / 2 : 0);
      if (xMin > 180 && xMax > 180 && xMax <= 360 && !this.proj4 && this.crs !== "EPSG:3857") {
        xMin -= 360;
        xMax -= 360;
      }
      const lonExtent = xMax - xMin;
      if (Number.isFinite(dx) && Math.abs(lonExtent - 360) < dx / 2) {
        if (Math.abs(xMin + 180) < dx) xMin = -180;
        if (Math.abs(xMax - 180) < dx) xMax = 180;
      }
      if (needsBounds) {
        this.xyLimits = { xMin, xMax, yMin, yMax };
      }
      if (this.multiscaleType === "untiled") {
        const hints = [];
        if (needsBounds)
          hints.push(`bounds: [${xMin}, ${yMin}, ${xMax}, ${yMax}]`);
        if (needsLatAscending && !detectedLatAscending)
          hints.push("latIsAscending: false");
        if (hints.length > 0) {
          console.warn(
            `[zarr-layer] Detected from coordinate arrays. Set explicitly to skip this fetch: ${hints.join(", ")}`
          );
        }
      }
    } catch (err) {
      if (needsBounds) {
        throw new Error(
          `Failed to load bounds from coordinate arrays. Provide explicit bounds via the 'bounds' option. Error: ${err instanceof Error ? err.message : err}`
        );
      }
      if (needsLatAscending) {
        console.warn(
          `[zarr-layer] Could not detect latIsAscending from coordinates. Defaulting to true (row 0 = south). Set explicitly if data appears flipped.`
        );
      }
    }
    if ((this.multiscaleType === "untiled" || this.multiscaleType === "none") && !this._crsFromMetadata && !this._crsOverride && this.xyLimits) {
      const maxAbsX = Math.max(
        Math.abs(this.xyLimits.xMin),
        Math.abs(this.xyLimits.xMax)
      );
      if (maxAbsX > 360) {
        this.crs = "EPSG:3857";
      }
    }
  }
  /**
   * Parse multiscale metadata to determine pyramid structure.
   *
   * Supports three multiscale formats:
   *
   * 1. **zarr-conventions/multiscales** (layout format):
   *    Uses `layout` array with transform info. Parsed by `_parseUntiledMultiscale()`.
   *    Example: `{ layout: [{ asset: "0", transform: { scale: [...] } }, ...] }`
   *
   * 2. **OME-NGFF style** (datasets format):
   *    Uses `datasets` array. If `pixels_per_tile` is present, treated as tiled pyramid.
   *    Otherwise treated as untiled multi-level.
   *    Example: `[{ datasets: [{ path: "0", crs: "EPSG:4326" }, ...] }]`
   *
   * 3. **Single level**: No multiscale metadata, treated as single untiled image.
   *
   * For untiled formats, shapes are extracted from consolidated metadata when available
   * to avoid per-level network requests.
   */
  _getPyramidMetadata(multiscales) {
    const singleLevelUntiled = () => {
      this.multiscaleType = "untiled";
      return {
        levels: [],
        maxLevelIndex: 0,
        tileSize: DEFAULT_TILE_SIZE,
        crs: this.crs
      };
    };
    if (!multiscales) return singleLevelUntiled();
    if ("layout" in multiscales && Array.isArray(multiscales.layout)) {
      return this._parseUntiledMultiscale(multiscales, singleLevelUntiled);
    }
    if (Array.isArray(multiscales) && multiscales[0]?.datasets?.length) {
      const datasets = multiscales[0].datasets;
      const levels = datasets.map((dataset) => String(dataset.path));
      const maxLevelIndex = levels.length - 1;
      const tileSize = datasets[0].pixels_per_tile;
      const crs = datasets[0].crs === "EPSG:4326" ? "EPSG:4326" : "EPSG:3857";
      if (tileSize) {
        this.multiscaleType = "tiled";
        return { levels, maxLevelIndex, tileSize, crs };
      }
      this.untiledLevels = levels.map((level) => ({
        asset: level,
        scale: [1, 1],
        translation: [0, 0]
      }));
      this.multiscaleType = "untiled";
      return { levels, maxLevelIndex, tileSize: DEFAULT_TILE_SIZE, crs };
    }
    return singleLevelUntiled();
  }
  /**
   * Parse zarr-conventions/multiscales format (layout-based).
   *
   * This format uses a `layout` array where each entry specifies:
   * - `asset`: path to the level (e.g., "0", "1", ...)
   * - `transform`: optional scale/translation for georeferencing
   *
   * Example metadata:
   * ```json
   * {
   *   "layout": [
   *     { "asset": "0", "transform": { "scale": [1.0, 1.0], "translation": [0, 0] } },
   *     { "asset": "1", "transform": { "scale": [2.0, 2.0], "translation": [0, 0] } }
   *   ],
   *   "crs": "EPSG:4326"
   * }
   * ```
   *
   * @see https://github.com/zarr-conventions/multiscales
   */
  _parseUntiledMultiscale(metadata, singleLevelUntiled) {
    const layout = metadata.layout;
    if (!layout || layout.length === 0) return singleLevelUntiled();
    const levels = layout.map((entry) => entry.asset);
    const maxLevelIndex = levels.length - 1;
    this.untiledLevels = layout.map((entry) => ({
      asset: entry.asset,
      scale: entry.transform?.scale ?? [1, 1],
      translation: entry.transform?.translation ?? [0, 0]
    }));
    this.multiscaleType = "untiled";
    const crs = metadata.crs ?? this.crs;
    if (metadata.crs && !this._crsOverride) {
      this._crsFromMetadata = true;
    }
    return {
      levels,
      maxLevelIndex,
      tileSize: DEFAULT_TILE_SIZE,
      // Will be overridden by chunk shape
      crs
    };
  }
};

// src/shaders.ts
var MAPBOX_ECEF_DEPTH_BIAS = 5e-4;
var UNIFORMS_COMMON = `
uniform float scale;
uniform float scale_x;
uniform float scale_y;
uniform float shift_x;
uniform float shift_y;
uniform float u_worldXOffset;`;
var UNIFORMS_MAPBOX_GLOBE = `
uniform mat4 matrix;
uniform mat4 u_globe_to_merc;
uniform float u_globe_transition;
uniform int u_tile_render;`;
var INPUTS_OUTPUTS = `
in vec2 pix_coord_in;
in vec2 vertex;

out vec2 pix_coord;
out vec2 v_mercatorPos;
out vec2 v_wgs84Pos;`;
var SCALE_HANDLING = `
  float sx = scale_x > 0.0 ? scale_x : scale;
  float sy = scale_y > 0.0 ? scale_y : scale;`;
var VERTEX_TO_MERCATOR = `
  vec2 merc = vec2(vertex.x * sx + shift_x + u_worldXOffset, -vertex.y * sy + shift_y);`;
var VERTEX_TO_WGS84_TO_MERCATOR = `
  // vertex.xy are in local [-1, 1] space for this region
  // scale/shift transform to absolute normalized 4326 [0,1] on world
  float normLon = vertex.x * sx + shift_x + u_worldXOffset;
  float normLat = vertex.y * sy + shift_y;

  // Convert normalized [0,1] to degrees
  float lon = normLon * 360.0 - 180.0;
  float lat = normLat * 180.0 - 90.0;

  // Clamp latitude to Mercator limits to avoid infinity at poles
  lat = clamp(lat, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT);

  // Mercator projection
  float lambda = radians(lon);
  float phi = radians(lat);
  float mercY_raw = log(tan((PI / 2.0 + phi) / 2.0));

  // Normalize mercator output to [0,1]
  float mercX = (lambda / PI + 1.0) / 2.0;
  float mercY = (1.0 - mercY_raw / PI) / 2.0;
  vec2 merc = vec2(mercX, mercY);`;
var CONST_PI = `const float PI = 3.14159265358979323846;`;
var CONST_MERCATOR_LAT_LIMIT = `const float MERCATOR_LAT_LIMIT = 85.05112878;`;
var CONST_GLOBE_RADIUS = `const float GLOBE_RADIUS = 1303.7972938088067;`;
var FUNC_MERCATOR_Y_TO_LAT = `
float mercatorYToLatRad(float y) {
  float t = PI * (1.0 - 2.0 * y);
  return atan(sinh(t));
}`;
var PROJECT_MAPLIBRE_GLOBE = `
  gl_Position = projectTile(merc);`;
var PROJECT_MAPBOX_GLOBE = `
  if (u_tile_render == 1) {
    gl_Position = matrix * vec4(merc, 0.0, 1.0);
  } else {
    vec4 mercClip = matrix * vec4(merc, 0.0, 1.0);
    mercClip /= mercClip.w;

    float lonRad = (merc.x - 0.5) * 2.0 * PI;
    float latRad = mercatorYToLatRad(merc.y);
    float cosLat = cos(latRad);
    vec3 ecef = vec3(
      GLOBE_RADIUS * cosLat * sin(lonRad),
      -GLOBE_RADIUS * sin(latRad),
      GLOBE_RADIUS * cosLat * cos(lonRad)
    );

    vec4 globeClip = matrix * (u_globe_to_merc * vec4(ecef, 1.0));
    globeClip /= globeClip.w;

    gl_Position = mix(globeClip, mercClip, clamp(u_globe_transition, 0.0, 1.0));
  }`;
var VERTEX_WGS84_TO_ECEF = `
  float normLon = vertex.x * sx + shift_x + u_worldXOffset;
  float normLat = vertex.y * sy + shift_y;

  // WGS84 normalized [0,1] to radians
  float lonRad = (normLon - 0.5) * 2.0 * PI;
  float latDeg = normLat * 180.0 - 90.0;
  float latRad = latDeg * PI / 180.0;

  // ECEF unit sphere (MapLibre Y-UP convention)
  float cosLat = cos(latRad);
  vec3 ecef = vec3(sin(lonRad) * cosLat, sin(latRad), cos(lonRad) * cosLat);

  // Clamped Mercator fallback for flat-map transition
  float clampedLatDeg = clamp(latDeg, -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT);
  float clampedLatRad = clampedLatDeg * PI / 180.0;
  float mercY_raw = log(tan((PI / 2.0 + clampedLatRad) / 2.0));
  vec2 merc = vec2(normLon, (1.0 - mercY_raw / PI) / 2.0);`;
var VERTEX_WGS84_TO_ECEF_MAPBOX = `
  float normLon = vertex.x * sx + shift_x + u_worldXOffset;
  float normLat = vertex.y * sy + shift_y;

  // WGS84 normalized [0,1] to radians
  float lonRad = (normLon - 0.5) * 2.0 * PI;
  float latDeg = normLat * 180.0 - 90.0;
  float latRad = latDeg * PI / 180.0;

  // Mapbox ECEF: Y-DOWN with explicit radius
  float cosLat = cos(latRad);
  vec3 ecef = vec3(
    GLOBE_RADIUS * cosLat * sin(lonRad),
    -GLOBE_RADIUS * sin(latRad),
    GLOBE_RADIUS * cosLat * cos(lonRad)
  );`;
var PROJECT_MAPBOX_ECEF = `
  // This path is only used at the fully-globe endpoint. During Mapbox's
  // globe->mercator zoom morph, the layer switches back to the draped path so
  // Mapbox can handle the transition with its internal globe/mercator matrices.
  gl_Position = matrix * (u_globe_to_merc * vec4(ecef, 1.0));
  gl_Position.z -= ${MAPBOX_ECEF_DEPTH_BIAS.toExponential(6)} * gl_Position.w;`;
var PROJECT_MAPLIBRE_ECEF = `
  vec4 globePos = u_projection_matrix * vec4(ecef, 1.0);

  // Backface clipping
  float clipZ = 1.0 - (dot(ecef, u_projection_clipping_plane.xyz) + u_projection_clipping_plane.w);
  globePos.z = clipZ * globePos.w;

  // Mercator fallback for flat-map transition
  vec4 flatPos = u_projection_fallback_matrix * vec4(merc, 0.0, 1.0);

  // Transition blend (matches MapLibre's interpolateProjection)
  float t = u_projection_transition;
  vec4 result;
  result.xyw = mix(flatPos.xyw, globePos.xyw, t);
  result.z = mix(0.0, globePos.z, clamp((t - 0.2) / 0.8, 0.0, 1.0));
  gl_Position = result;`;
function createVertexShader(options) {
  const { inputSpace, projection, shaderData } = options;
  const isDirectEcef = inputSpace === "wgs84-direct";
  const isMapboxDirectEcef = isDirectEcef && projection === "mapbox";
  let uniforms;
  let prelude = "";
  let define = "";
  if (isDirectEcef && projection === "mapbox") {
    uniforms = UNIFORMS_COMMON + UNIFORMS_MAPBOX_GLOBE;
  } else if (isDirectEcef || projection === "maplibre") {
    if (!shaderData) {
      throw new Error("shaderData required for MapLibre projection modes");
    }
    prelude = shaderData.vertexShaderPrelude;
    define = shaderData.define;
    uniforms = UNIFORMS_COMMON;
  } else {
    uniforms = UNIFORMS_COMMON + UNIFORMS_MAPBOX_GLOBE;
  }
  const constants = [
    !shaderData ? CONST_PI : "",
    inputSpace === "wgs84" || isDirectEcef && projection !== "mapbox" ? CONST_MERCATOR_LAT_LIMIT : "",
    projection === "mapbox" ? CONST_GLOBE_RADIUS : ""
  ].filter(Boolean).join("\n");
  let helpers = "";
  if (projection === "mapbox" && !isDirectEcef) {
    helpers = FUNC_MERCATOR_Y_TO_LAT;
  }
  let coordTransform;
  if (isMapboxDirectEcef) {
    coordTransform = VERTEX_WGS84_TO_ECEF_MAPBOX;
  } else if (isDirectEcef) {
    coordTransform = VERTEX_WGS84_TO_ECEF;
  } else if (inputSpace === "wgs84") {
    coordTransform = VERTEX_TO_WGS84_TO_MERCATOR;
  } else {
    coordTransform = VERTEX_TO_MERCATOR;
  }
  let projectionOutput;
  if (isMapboxDirectEcef) {
    projectionOutput = PROJECT_MAPBOX_ECEF;
  } else if (isDirectEcef) {
    projectionOutput = PROJECT_MAPLIBRE_ECEF;
  } else if (projection === "maplibre") {
    projectionOutput = PROJECT_MAPLIBRE_GLOBE;
  } else {
    projectionOutput = PROJECT_MAPBOX_GLOBE;
  }
  const wgs84PosAssignment = isDirectEcef ? "  v_wgs84Pos = vec2(normLon, normLat);" : "  v_wgs84Pos = vec2(0.0);";
  const mercatorPosAssignment = isMapboxDirectEcef ? "  v_mercatorPos = vec2(0.0);" : "  v_mercatorPos = merc;";
  return `#version 300 es
${prelude}
${define}
${uniforms}
${INPUTS_OUTPUTS}
${constants}
${helpers}

void main() {
${SCALE_HANDLING}
${coordTransform}
${projectionOutput}
  pix_coord = pix_coord_in;
${mercatorPosAssignment}
${wgs84PosAssignment}
}
`;
}
var FRAG_CONST_PI = `const float PI = 3.14159265358979323846;`;
var FUNC_MERCATOR_INVERT = `
vec2 mercatorInvert(float x, float y) {
  float lambda = x;
  float phi = 2.0 * atan(exp(y)) - PI / 2.0;
  return vec2(degrees(lambda), degrees(phi));
}
`;
var FRAGMENT_SHADER_REPROJECT = `
  vec2 sample_coord;

  if (u_reproject == 1) {
    // EPSG:4326 reprojection: invert Mercator to lat/lon for texture lookup
    // v_mercatorPos is normalized [0,1] where y=0 is north, y=1 is south
    // Convert to Mercator radians: y=0 -> PI (north), y=1 -> -PI (south)
    float mercY = PI * (1.0 - 2.0 * v_mercatorPos.y);
    vec2 lonLat = mercatorInvert(0.0, mercY);
    float lat = lonLat.y;

    // Map latitude to texture V coordinate based on data orientation
    float latRange = u_latBounds.y - u_latBounds.x;
    float texV;
    if (u_latIsAscending == 1) {
      // Row 0 = south (latMin), row N = north (latMax)
      texV = (lat - u_latBounds.x) / latRange;
    } else {
      // Row 0 = north (latMax), row N = south (latMin)
      texV = (u_latBounds.y - lat) / latRange;
    }

    // X coordinate is linear (longitude)
    sample_coord = vec2(pix_coord.x, texV) * u_texScale + u_texOffset;
  } else if (u_reproject == 2) {
    // WGS84 direct lookup: v_wgs84Pos carries normalized WGS84 coords from ECEF vertex shader
    float lat = v_wgs84Pos.y * 180.0 - 90.0;
    float latRange = u_latBounds.y - u_latBounds.x;
    float texV;
    if (u_latIsAscending == 1) {
      texV = (lat - u_latBounds.x) / latRange;
    } else {
      texV = (u_latBounds.y - lat) / latRange;
    }
    sample_coord = vec2(pix_coord.x, texV) * u_texScale + u_texOffset;
  } else {
    // Standard linear texture lookup
    sample_coord = pix_coord * u_texScale + u_texOffset;
  }
`;
var maplibreFragmentShaderSource = `#version 300 es
precision highp float;

uniform vec2 clim;
uniform float opacity;
uniform float fillValue;
uniform float u_scaleFactor;
uniform float u_addOffset;
uniform float u_dataScale;
uniform vec2 u_texScale;
uniform vec2 u_texOffset;

// EPSG:4326 reprojection uniforms
uniform int u_reproject;      // 0 = no reprojection, 1 = Mercator inversion, 2 = WGS84 direct lookup
uniform vec2 u_latBounds;     // (latMin, latMax) in degrees
uniform int u_latIsAscending; // 1 = row 0 is south, 0 = row 0 is north

uniform sampler2D tex;
uniform sampler2D cmap;

in vec2 pix_coord;
in vec2 v_mercatorPos;
in vec2 v_wgs84Pos;
out vec4 color;

${FRAG_CONST_PI}
${FUNC_MERCATOR_INVERT}

void main() {
${FRAGMENT_SHADER_REPROJECT}
  float texVal = texture(tex, sample_coord).r;

  // NaN check (fill values converted to NaN during normalization)
  if (isnan(texVal)) {
    discard;
  }

  float raw = texVal * u_dataScale;
  float value = raw * u_scaleFactor + u_addOffset;

  if (isnan(value)) {
    discard;
  }

  float rescaled = (value - clim.x) / (clim.y - clim.x);
  vec4 c = texture(cmap, vec2(rescaled, 0.5));
  color = vec4(c.rgb, opacity);
  color.rgb *= color.a;
}
`;
var UNIFORM_REGEX = /uniform\s+\w+\s+(\w+)\s*;/g;
function createFragmentShaderSource(options) {
  const { bands, customUniforms = [], customFrag } = options;
  const hasBands = bands.length > 0;
  const bandSamplers = bands.map((name) => `uniform sampler2D ${name};`).join("\n");
  const customUniformDecls = customUniforms.map((name) => `uniform float ${name};`).join("\n");
  let processedFragBody = customFrag || "";
  UNIFORM_REGEX.lastIndex = 0;
  let match;
  const extractedUniforms = [];
  while ((match = UNIFORM_REGEX.exec(processedFragBody)) !== null) {
    if (!customUniforms.includes(match[1])) {
      extractedUniforms.push(match[0]);
    }
  }
  processedFragBody = processedFragBody.replace(UNIFORM_REGEX, "");
  const extraUniformsDecl = extractedUniforms.join("\n");
  const bandReads = bands.map(
    (name) => `  float ${name}_tex = texture(${name}, sample_coord).r;
  float ${name}_raw = ${name}_tex * u_dataScale;
  float ${name}_val = ${name}_raw * u_scaleFactor + u_addOffset;`
  ).join("\n");
  const bandAliases = bands.map((name) => `  float ${name} = ${name}_val;`).join("\n");
  const fillValueChecks = bands.map((name) => `(isnan(${name}_tex) || isnan(${name}_val))`).join(" || ");
  const commonDiscardChecks = hasBands ? `
  if (${fillValueChecks}) {
    discard;
  }
` : "";
  return `#version 300 es
precision highp float;

uniform float opacity;
uniform vec2 clim;
uniform float fillValue;
uniform float u_scaleFactor;
uniform float u_addOffset;
uniform float u_dataScale;
uniform vec2 u_texScale;
uniform vec2 u_texOffset;

// EPSG:4326 reprojection uniforms
uniform int u_reproject;      // 0 = no reprojection, 1 = Mercator inversion, 2 = WGS84 direct lookup
uniform vec2 u_latBounds;     // (latMin, latMax) in degrees
uniform int u_latIsAscending; // 1 = row 0 is south, 0 = row 0 is north

uniform sampler2D colormap;

${bandSamplers}
${customUniformDecls}
${extraUniformsDecl}

in vec2 pix_coord;
in vec2 v_mercatorPos;
in vec2 v_wgs84Pos;
out vec4 fragColor;

${FRAG_CONST_PI}
${FUNC_MERCATOR_INVERT}

void main() {
${FRAGMENT_SHADER_REPROJECT}
${bandReads}
${bandAliases}
${processedFragBody ? `
${commonDiscardChecks}
${processedFragBody.replace(/gl_FragColor/g, "fragColor")}` : bands.length === 1 ? `
  if (isnan(${bands[0]}_tex) || isnan(${bands[0]})) {
    discard;
  }

  float rescaled = (${bands[0]} - clim.x) / (clim.y - clim.x);
  vec4 c = texture(colormap, vec2(rescaled, 0.5));
  fragColor = vec4(c.rgb, opacity);
  fragColor.rgb *= fragColor.a;
` : `
  if (${fillValueChecks}) {
    discard;
  }

  float rescaled = (${bands[0]} - clim.x) / (clim.y - clim.x);
  vec4 c = texture(colormap, vec2(rescaled, 0.5));
  fragColor = vec4(c.rgb, opacity);
  fragColor.rgb *= fragColor.a;
`}
}
`;
}

// src/webgl-utils.ts
function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
function createProgram(gl, vertexShader, fragmentShader) {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}
function mustGetUniformLocation(gl, program, name) {
  const loc = gl.getUniformLocation(program, name);
  if (!loc) {
    throw new Error(`Failed to get uniform location for ${name}`);
  }
  return loc;
}
function mustCreateTexture(gl) {
  const tex = gl.createTexture();
  if (!tex) {
    throw new Error("Failed to create texture");
  }
  return tex;
}
function mustCreateBuffer(gl) {
  const buf = gl.createBuffer();
  if (!buf) {
    throw new Error("Failed to create buffer");
  }
  return buf;
}
function getTextureFormats(gl, channels) {
  const format = channels === 2 ? gl.RG : channels === 3 ? gl.RGB : channels >= 4 ? gl.RGBA : gl.RED;
  const internalFormat = channels === 2 ? gl.RG32F : channels === 3 ? gl.RGB32F : channels >= 4 ? gl.RGBA32F : gl.R32F;
  return { format, internalFormat };
}
function configureDataTexture(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
function normalizeDataForTexture(data, fillValue, fixedScale) {
  const normalized = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (fillValue !== null && v === fillValue || v !== v) {
      normalized[i] = NaN;
    } else {
      normalized[i] = v / fixedScale;
    }
  }
  return { normalized, scale: fixedScale };
}
function interleaveBands(bands, channels) {
  if (channels === 1 && bands.length === 1) {
    return bands[0];
  }
  const pixelCount = bands[0].length;
  const result = new Float32Array(pixelCount * channels);
  for (let i = 0; i < pixelCount; i++) {
    for (let c = 0; c < channels; c++) {
      result[i * channels + c] = bands[c][i];
    }
  }
  return result;
}
function createSubdividedQuad(subdivisions) {
  const vertices = [];
  const texCoords = [];
  const step = 2 / subdivisions;
  const texStep = 1 / subdivisions;
  const pushVertex = (col, row) => {
    const x = -1 + col * step;
    const y = 1 - row * step;
    const u = col * texStep;
    const v = row * texStep;
    vertices.push(x, y);
    texCoords.push(u, v);
  };
  for (let row = 0; row < subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      pushVertex(col, row);
      pushVertex(col, row + 1);
    }
    if (row < subdivisions - 1) {
      pushVertex(subdivisions, row + 1);
      pushVertex(0, row + 1);
    }
  }
  return {
    vertexArr: new Float32Array(vertices),
    texCoordArr: new Float32Array(texCoords)
  };
}

// src/colormap.ts
function hexToRgb(hex) {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const num = parseInt(cleaned, 16);
  return [num >> 16 & 255, num >> 8 & 255, num & 255];
}
var ColormapState = class {
  constructor(colormap) {
    this.texture = null;
    this.dirty = true;
    const { colors, floatData, length } = this.build(colormap);
    this.colors = colors;
    this.floatData = floatData;
    this.length = length;
    this.dirty = true;
  }
  apply(colormap) {
    const { colors, floatData, length } = this.build(colormap);
    this.colors = colors;
    this.floatData = floatData;
    this.length = length;
    this.dirty = true;
  }
  ensureTexture(gl) {
    if (!this.texture || this.dirty) {
      this.upload(gl);
    }
    return this.texture;
  }
  upload(gl) {
    if (!this.texture) {
      this.texture = mustCreateTexture(gl);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB16F,
      this.length,
      1,
      0,
      gl.RGB,
      gl.FLOAT,
      this.floatData
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.dirty = false;
  }
  dispose(gl) {
    if (this.texture) {
      gl.deleteTexture(this.texture);
      this.texture = null;
    }
  }
  build(colormap) {
    if (!Array.isArray(colormap) || colormap.length === 0) {
      throw new Error(
        "colormap must be a non-empty array of [r, g, b] values or hex strings"
      );
    }
    const normalized = [];
    for (const entry of colormap) {
      if (typeof entry === "string") {
        normalized.push(hexToRgb(entry));
      } else if (Array.isArray(entry) && entry.length >= 3) {
        normalized.push([entry[0], entry[1], entry[2]]);
      } else {
        throw new Error(
          "colormap entries must be arrays shaped like [r, g, b] or hex strings"
        );
      }
    }
    const flattened = normalized.flat();
    const needsScaling = flattened.some((value) => value > 1);
    const floatData = new Float32Array(
      flattened.map((value) => needsScaling ? value / 255 : value)
    );
    return { colors: normalized, floatData, length: normalized.length };
  }
};

// src/shader-program.ts
function resolveProjectionMode(useMapbox = false, useWgs84 = false, useDirectEcef = false) {
  if (useMapbox && useDirectEcef) return "mapbox-ecef";
  if (useMapbox && useWgs84) return "mapbox-proj4";
  if (useMapbox) return "mapbox";
  if (useDirectEcef) return "maplibre-ecef";
  if (useWgs84) return "maplibre-proj4";
  return "maplibre";
}
function makeShaderVariantKey(options) {
  const { projectionMode, shaderData, customShaderConfig } = options;
  const useCustomShader = customShaderConfig && customShaderConfig.bands.length > 0;
  const shaderVariant = shaderData?.variantName ?? "base";
  const baseVariant = useCustomShader && customShaderConfig ? ["custom", customShaderConfig.bands.join("_"), shaderVariant].join("_") : shaderVariant;
  return [baseVariant, projectionMode].join("_");
}
var toFloat32Array = (arr) => {
  if (arr instanceof Float32Array) return arr;
  return new Float32Array(arr);
};
var isMapboxMode = (mode) => mode === "mapbox" || mode === "mapbox-proj4" || mode === "mapbox-ecef";
var isMaplibreMode = (mode) => mode === "maplibre" || mode === "maplibre-proj4" || mode === "maplibre-ecef";
function getVertexShaderOptions(projectionMode) {
  const inputSpace = projectionMode === "maplibre-ecef" || projectionMode === "mapbox-ecef" ? "wgs84-direct" : projectionMode.includes("proj4") ? "wgs84" : "mercator";
  const projection = isMapboxMode(projectionMode) ? "mapbox" : "maplibre";
  return { inputSpace, projection };
}
function createShaderProgram(gl, options) {
  const {
    fragmentShaderSource,
    shaderData,
    customShaderConfig,
    projectionMode
  } = options;
  const config = customShaderConfig || void 0;
  const useCustomShader = config && config.bands.length > 0;
  const variantName = options.variantName || makeShaderVariantKey({ projectionMode, shaderData, customShaderConfig });
  const { inputSpace, projection } = getVertexShaderOptions(projectionMode);
  const vertexSource = createVertexShader({
    inputSpace,
    projection,
    shaderData
  });
  const fragmentSource = useCustomShader && config ? createFragmentShaderSource({
    bands: config.bands,
    customUniforms: config.customUniforms ? Object.keys(config.customUniforms) : [],
    customFrag: config.customFrag
  }) : fragmentShaderSource;
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    throw new Error(`Failed to create shaders for variant: ${variantName}`);
  }
  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    throw new Error(`Failed to create program for variant: ${variantName}`);
  }
  const bandTexLocs = /* @__PURE__ */ new Map();
  const customUniformLocs = /* @__PURE__ */ new Map();
  if (useCustomShader && config) {
    for (const bandName of config.bands) {
      const loc = gl.getUniformLocation(program, bandName);
      if (loc) {
        bandTexLocs.set(bandName, loc);
      }
    }
    if (config.customUniforms) {
      for (const uniformName of Object.keys(config.customUniforms)) {
        const loc = gl.getUniformLocation(program, uniformName);
        if (loc) {
          customUniformLocs.set(uniformName, loc);
        }
      }
    }
  }
  const needsMaplibre = isMaplibreMode(projectionMode);
  const needsMapbox = isMapboxMode(projectionMode);
  const maplibreUniform = (name) => needsMaplibre ? gl.getUniformLocation(program, name) : null;
  const mapboxUniform = (name) => needsMapbox ? gl.getUniformLocation(program, name) : null;
  const shaderProgram = {
    program,
    scaleLoc: mustGetUniformLocation(gl, program, "scale"),
    scaleXLoc: mustGetUniformLocation(gl, program, "scale_x"),
    scaleYLoc: mustGetUniformLocation(gl, program, "scale_y"),
    shiftXLoc: mustGetUniformLocation(gl, program, "shift_x"),
    shiftYLoc: mustGetUniformLocation(gl, program, "shift_y"),
    worldXOffsetLoc: mustGetUniformLocation(gl, program, "u_worldXOffset"),
    // MapLibre modes use projectTile instead of matrix
    matrixLoc: needsMaplibre ? null : mustGetUniformLocation(gl, program, "matrix"),
    projMatrixLoc: maplibreUniform("u_projection_matrix"),
    fallbackMatrixLoc: maplibreUniform("u_projection_fallback_matrix"),
    tileMercatorCoordsLoc: maplibreUniform("u_projection_tile_mercator_coords"),
    clippingPlaneLoc: maplibreUniform("u_projection_clipping_plane"),
    projectionTransitionLoc: maplibreUniform("u_projection_transition"),
    opacityLoc: mustGetUniformLocation(gl, program, "opacity"),
    texScaleLoc: mustGetUniformLocation(gl, program, "u_texScale"),
    texOffsetLoc: mustGetUniformLocation(gl, program, "u_texOffset"),
    vertexLoc: gl.getAttribLocation(program, "vertex"),
    pixCoordLoc: gl.getAttribLocation(program, "pix_coord_in"),
    climLoc: gl.getUniformLocation(program, "clim"),
    fillValueLoc: gl.getUniformLocation(program, "fillValue"),
    scaleFactorLoc: gl.getUniformLocation(program, "u_scaleFactor"),
    addOffsetLoc: gl.getUniformLocation(program, "u_addOffset"),
    cmapLoc: useCustomShader ? null : gl.getUniformLocation(program, "cmap"),
    colormapLoc: gl.getUniformLocation(program, "colormap"),
    texLoc: useCustomShader ? null : gl.getUniformLocation(program, "tex"),
    projectionMode,
    useCustomShader: !!useCustomShader,
    bandTexLocs,
    customUniformLocs,
    globeToMercMatrixLoc: mapboxUniform("u_globe_to_merc"),
    globeTransitionLoc: mapboxUniform("u_globe_transition"),
    tileRenderLoc: mapboxUniform("u_tile_render"),
    dataScaleLoc: gl.getUniformLocation(program, "u_dataScale"),
    // EPSG:4326 reprojection uniforms
    reprojectLoc: gl.getUniformLocation(program, "u_reproject"),
    latBoundsLoc: gl.getUniformLocation(program, "u_latBounds"),
    latIsAscendingLoc: gl.getUniformLocation(program, "u_latIsAscending")
  };
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return { shaderProgram, variantName };
}
function applyProjectionUniforms(gl, shaderProgram, matrix, projectionData, mapbox, isGlobeTileRender) {
  const setMatrix4 = (loc, value) => {
    if (loc && value) {
      gl.uniformMatrix4fv(loc, false, toFloat32Array(value));
    }
  };
  const setVec4 = (loc, value) => {
    if (loc && value) {
      gl.uniform4f(loc, ...value);
    }
  };
  const setFloat = (loc, value) => {
    if (loc && value !== void 0) {
      gl.uniform1f(loc, value);
    }
  };
  switch (shaderProgram.projectionMode) {
    case "maplibre":
    case "maplibre-proj4":
    case "maplibre-ecef": {
      if (!projectionData) return;
      setMatrix4(shaderProgram.projMatrixLoc, projectionData.mainMatrix);
      setMatrix4(shaderProgram.fallbackMatrixLoc, projectionData.fallbackMatrix);
      setVec4(
        shaderProgram.tileMercatorCoordsLoc,
        projectionData.tileMercatorCoords
      );
      setVec4(shaderProgram.clippingPlaneLoc, projectionData.clippingPlane);
      setFloat(
        shaderProgram.projectionTransitionLoc,
        projectionData.projectionTransition
      );
      break;
    }
    case "mapbox":
    case "mapbox-proj4":
    case "mapbox-ecef": {
      const mapboxMatrix = shaderProgram.projectionMode === "mapbox-ecef" && !isGlobeTileRender && mapbox?.expandedFarZMercatorMatrix ? mapbox.expandedFarZMercatorMatrix : matrix;
      setMatrix4(shaderProgram.matrixLoc, mapboxMatrix);
      setMatrix4(
        shaderProgram.globeToMercMatrixLoc,
        mapbox?.globeToMercatorMatrix
      );
      setFloat(shaderProgram.globeTransitionLoc, mapbox?.transition ?? 1);
      if (shaderProgram.tileRenderLoc) {
        gl.uniform1i(shaderProgram.tileRenderLoc, isGlobeTileRender ? 1 : 0);
      }
      break;
    }
    default: {
      setMatrix4(shaderProgram.matrixLoc, matrix);
      break;
    }
  }
}

// src/mapbox-utils.ts
var MAPBOX_IDENTITY_MATRIX = new Float32Array([
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1
]);
function createMapboxTileMatrix(tileX0, tileY0, tileX1, tileY1) {
  const x0 = Math.max(0, tileX0);
  const x1 = Math.min(1, tileX1);
  const y0 = Math.max(0, tileY0);
  const y1 = Math.min(1, tileY1);
  const width = x1 - x0;
  const height = y1 - y0;
  return new Float32Array([
    2 / width,
    0,
    0,
    0,
    0,
    2 / height,
    0,
    0,
    0,
    0,
    1,
    0,
    -(x0 + x1) / width,
    -(y0 + y1) / height,
    0,
    1
  ]);
}
function getMapboxTileBounds(tileId) {
  const tilesPerSide = 2 ** tileId.z;
  return {
    x0: tileId.x / tilesPerSide,
    x1: (tileId.x + 1) / tilesPerSide,
    y0: tileId.y / tilesPerSide,
    y1: (tileId.y + 1) / tilesPerSide
  };
}
function boundsIntersect(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

// src/map-utils.ts
function normalizeGlobalExtent(xyLimits) {
  if (!xyLimits) {
    return { xMin: -180, xMax: 180, yMin: -90, yMax: 90 };
  }
  const extentX = xyLimits.xMax - xyLimits.xMin;
  const extentY = xyLimits.yMax - xyLimits.yMin;
  const isGlobal = extentX >= 350 && extentY >= 170;
  return {
    xMin: isGlobal ? -180 : xyLimits.xMin,
    xMax: isGlobal ? 180 : xyLimits.xMax,
    yMin: isGlobal ? -90 : xyLimits.yMin,
    yMax: isGlobal ? 90 : xyLimits.yMax
  };
}
function lonToTile(lon, zoom) {
  return Math.floor(lonToMercatorNorm(lon) * Math.pow(2, zoom));
}
function latToTileMercator(lat, zoom) {
  const clamped = Math.max(
    -MERCATOR_LAT_LIMIT,
    Math.min(MERCATOR_LAT_LIMIT, lat)
  );
  const z2 = Math.pow(2, zoom);
  return Math.floor(
    (1 - Math.log(
      Math.tan(clamped * Math.PI / 180) + 1 / Math.cos(clamped * Math.PI / 180)
    ) / Math.PI) / 2 * z2
  );
}
function getTilesAtZoom(zoom, bounds) {
  const [[west, south], [east, north]] = bounds;
  const clampedSouth = Math.max(-MERCATOR_LAT_LIMIT, south);
  const clampedNorth = Math.min(MERCATOR_LAT_LIMIT, north);
  let nwX = lonToTile(west, zoom);
  let seX = lonToTile(east, zoom);
  const nwY = latToTileMercator(clampedNorth, zoom);
  const seY = latToTileMercator(clampedSouth, zoom);
  const maxTiles = Math.pow(2, zoom);
  const tiles = [];
  const seenTiles = /* @__PURE__ */ new Set();
  if (nwX > seX) {
    seX += maxTiles;
  }
  for (let x = nwX; x <= seX; x++) {
    const wrappedX = (x % maxTiles + maxTiles) % maxTiles;
    for (let y = nwY; y <= seY; y++) {
      const clampedY = Math.max(0, Math.min(maxTiles - 1, y));
      const key = `${zoom},${wrappedX},${clampedY}`;
      if (!seenTiles.has(key)) {
        seenTiles.add(key);
        tiles.push([zoom, wrappedX, clampedY]);
      }
    }
  }
  return tiles;
}
function getTilesAtZoomEquirect(zoom, bounds, xyLimits) {
  const [[west, south], [east, north]] = bounds;
  const { xMin, xMax, yMin, yMax } = normalizeGlobalExtent(xyLimits);
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const maxTiles = Math.pow(2, zoom);
  const lonToTile2 = (lon) => Math.floor((lon - xMin) / xSpan * maxTiles);
  const latToTile = (lat) => {
    const clamped = Math.max(Math.min(lat, yMax), yMin);
    const norm = (yMax - clamped) / ySpan;
    return Math.floor(norm * maxTiles);
  };
  let nwX = lonToTile2(west);
  let seX = lonToTile2(east);
  const nwY = latToTile(north);
  const seY = latToTile(south);
  const tiles = [];
  const seenTiles = /* @__PURE__ */ new Set();
  if (nwX > seX) {
    seX += maxTiles;
  }
  for (let x = nwX; x <= seX; x++) {
    const wrappedX = (x % maxTiles + maxTiles) % maxTiles;
    for (let y = nwY; y <= seY; y++) {
      const clampedY = Math.max(0, Math.min(maxTiles - 1, y));
      const key = `${zoom},${wrappedX},${clampedY}`;
      if (!seenTiles.has(key)) {
        seenTiles.add(key);
        tiles.push([zoom, wrappedX, clampedY]);
      }
    }
  }
  return tiles;
}
function tileToKey(tile) {
  return tile.join(",");
}
function tileToScale(tile) {
  const [z, x, y] = tile;
  const scale = 1 / 2 ** (z + 1);
  const shiftX = (2 * x + 1) * scale;
  const shiftY = (2 * y + 1) * scale;
  return [scale, shiftX, shiftY];
}
function zoomToLevel(zoom, maxLevelIndex) {
  if (maxLevelIndex)
    return Math.min(Math.max(0, Math.floor(zoom)), maxLevelIndex);
  return Math.max(0, Math.floor(zoom));
}
function parseLevelZoom(levelPath, fallback = 0) {
  const parsed = parseInt(levelPath, 10);
  if (!isNaN(parsed)) return parsed;
  const match = levelPath.match(/(\d+)$/);
  if (match) return parseInt(match[1], 10);
  return fallback;
}
function lonToMercatorNorm(lon) {
  const clamped = Math.max(-180, Math.min(180, lon));
  return (clamped + 180) / 360;
}
function latToMercatorNorm(lat) {
  const clamped = Math.max(
    -MERCATOR_LAT_LIMIT,
    Math.min(MERCATOR_LAT_LIMIT, lat)
  );
  return (1 - Math.log(
    Math.tan(clamped * Math.PI / 180) + 1 / Math.cos(clamped * Math.PI / 180)
  ) / Math.PI) / 2;
}
function mercatorNormToLat(mercY) {
  const t = Math.PI * (1 - 2 * mercY);
  return 180 / Math.PI * Math.atan(Math.sinh(t));
}
function latToWgs84Norm(lat) {
  return (lat + 90) / 180;
}
function mercatorNormToLon(mercX) {
  return mercX * 360 - 180;
}
function get4326TileGeoBounds(z, x, y, xyLimits) {
  const tilesPerSide = Math.pow(2, z);
  const { xMin, xMax, yMin, yMax } = normalizeGlobalExtent(xyLimits);
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  const west = xMin + x / tilesPerSide * xSpan;
  const east = xMin + (x + 1) / tilesPerSide * xSpan;
  const north = yMax - y / tilesPerSide * ySpan;
  const south = yMax - (y + 1) / tilesPerSide * ySpan;
  return { west, east, south, north };
}
function findBestParentTile(tileCache, z, x, y) {
  let ancestorZ = z - 1;
  let ancestorX = Math.floor(x / 2);
  let ancestorY = Math.floor(y / 2);
  while (ancestorZ >= 0) {
    const parentKey = tileToKey([ancestorZ, ancestorX, ancestorY]);
    const parentTile = tileCache.get(parentKey);
    if (parentTile && parentTile.data) {
      return { tile: parentTile, ancestorZ, ancestorX, ancestorY };
    }
    ancestorZ--;
    ancestorX = Math.floor(ancestorX / 2);
    ancestorY = Math.floor(ancestorY / 2);
  }
  return null;
}
function findBestChildTiles(tileCache, z, x, y, datasetMaxZoom, maxDepth = 2) {
  let bestCoverage = 0;
  let bestChildren = [];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const childZ = z + depth;
    if (childZ > datasetMaxZoom) break;
    const scale = Math.pow(2, depth);
    const baseX = x * scale;
    const baseY = y * scale;
    const totalChildren = scale * scale;
    const foundChildren = [];
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const childX = baseX + dx;
        const childY = baseY + dy;
        const childKey = tileToKey([childZ, childX, childY]);
        const childTile = tileCache.get(childKey);
        if (childTile && childTile.data) {
          foundChildren.push({
            tile: childTile,
            childZ,
            childX,
            childY
          });
        }
      }
    }
    const coverage = foundChildren.length / totalChildren;
    if (coverage === 1) {
      return foundChildren;
    }
    if (coverage > bestCoverage) {
      bestCoverage = coverage;
      bestChildren = foundChildren;
    }
  }
  return bestChildren.length > 0 ? bestChildren : null;
}
function boundsToMercatorNorm(xyLimits, crs) {
  if (crs === "EPSG:3857") {
    return {
      x0: (xyLimits.xMin + WEB_MERCATOR_EXTENT) / (2 * WEB_MERCATOR_EXTENT),
      y0: (WEB_MERCATOR_EXTENT - xyLimits.yMax) / (2 * WEB_MERCATOR_EXTENT),
      x1: (xyLimits.xMax + WEB_MERCATOR_EXTENT) / (2 * WEB_MERCATOR_EXTENT),
      y1: (WEB_MERCATOR_EXTENT - xyLimits.yMin) / (2 * WEB_MERCATOR_EXTENT)
    };
  }
  let yMin = xyLimits.yMin;
  let yMax = xyLimits.yMax;
  if (yMin > yMax) {
    ;
    [yMin, yMax] = [yMax, yMin];
  }
  const bounds = {
    x0: lonToMercatorNorm(xyLimits.xMin),
    y0: latToMercatorNorm(yMax),
    x1: lonToMercatorNorm(xyLimits.xMax),
    y1: latToMercatorNorm(yMin)
  };
  if (crs === "EPSG:4326") {
    bounds.latMin = yMin;
    bounds.latMax = yMax;
  }
  return bounds;
}
function geoToArrayIndex(geo, geoMin, geoMax, arraySize) {
  const normalized = (geo - geoMin) / (geoMax - geoMin);
  return Math.floor(
    Math.max(0, Math.min(arraySize - 1, normalized * arraySize))
  );
}
function flipTexCoordV(texCoords) {
  const flipped = new Float32Array(texCoords.length);
  for (let i = 0; i < texCoords.length; i += 2) {
    flipped[i] = texCoords[i];
    flipped[i + 1] = 1 - texCoords[i + 1];
  }
  return flipped;
}
function isGlobeProjection(projection) {
  return projection?.type === "globe" || projection?.name === "globe";
}
function resolveProjectionParams(params, projection, projectionToMercatorMatrix, projectionToMercatorTransition) {
  const paramsObj = params && typeof params === "object" && !Array.isArray(params) && !ArrayBuffer.isView(params) ? params : null;
  const shaderData = paramsObj?.shaderData;
  let projectionData;
  const defaultProj = paramsObj?.defaultProjectionData;
  if (defaultProj && defaultProj.mainMatrix && defaultProj.fallbackMatrix && defaultProj.tileMercatorCoords && defaultProj.clippingPlane && typeof defaultProj.projectionTransition === "number") {
    projectionData = {
      mainMatrix: defaultProj.mainMatrix,
      fallbackMatrix: defaultProj.fallbackMatrix,
      tileMercatorCoords: defaultProj.tileMercatorCoords,
      clippingPlane: defaultProj.clippingPlane,
      projectionTransition: defaultProj.projectionTransition
    };
  }
  let matrix = null;
  if (projectionData?.mainMatrix && projectionData.mainMatrix.length) {
    matrix = projectionData.mainMatrix;
  } else if (Array.isArray(params) || params instanceof Float32Array || params instanceof Float64Array) {
    matrix = params;
  } else if (paramsObj?.modelViewProjectionMatrix) {
    matrix = paramsObj.modelViewProjectionMatrix;
  } else if (paramsObj?.projectionMatrix) {
    matrix = paramsObj.projectionMatrix;
  }
  const paramsIsMatrix = Array.isArray(params) || params instanceof Float32Array || params instanceof Float64Array;
  const isMapbox = !!projection || paramsIsMatrix;
  const mapbox = isMapbox ? {
    projection: projection ?? { name: "mercator" },
    globeToMercatorMatrix: projectionToMercatorMatrix ?? MAPBOX_IDENTITY_MATRIX,
    transition: typeof projectionToMercatorTransition === "number" ? projectionToMercatorTransition : 1
    // Default to mercator (transition=1) when not in globe mode
  } : void 0;
  return { matrix, shaderData, projectionData, mapbox };
}
function computeWorldOffsets(map, isGlobe) {
  if (!map) return [0];
  const bounds = map.getBounds ? map.getBounds() : null;
  if (!bounds) return [0];
  const renderWorldCopies = typeof map.getRenderWorldCopies === "function" ? map.getRenderWorldCopies() : true;
  if (isGlobe || !renderWorldCopies) return [0];
  const west = bounds.getWest();
  const east = bounds.getEast();
  let effectiveEast = east;
  if (west > east) {
    effectiveEast = east + 360;
  }
  const minWorld = Math.floor((west + 180) / 360);
  const maxWorld = Math.floor((effectiveEast + 180) / 360);
  const worldOffsets = [];
  for (let i = minWorld; i <= maxWorld; i++) {
    worldOffsets.push(i);
  }
  return worldOffsets.length > 0 ? worldOffsets : [0];
}

// src/render-helpers.ts
function setupBandTextureUniforms(gl, shaderProgram, customShaderConfig) {
  if (!shaderProgram.useCustomShader || !customShaderConfig) return;
  let textureUnit = 2;
  for (const bandName of customShaderConfig.bands) {
    const loc = shaderProgram.bandTexLocs.get(bandName);
    if (loc) {
      gl.uniform1i(loc, textureUnit);
    }
    textureUnit++;
  }
}
function bindBandTextures(gl, options) {
  const {
    bandData,
    bandTextures,
    bandTexturesUploaded,
    bandTexturesConfigured,
    customShaderConfig,
    width,
    height,
    ensureTexture
  } = options;
  let textureUnit = 2;
  for (const bandName of customShaderConfig.bands) {
    const data = bandData.get(bandName);
    if (!data) {
      return false;
    }
    let bandTex = bandTextures.get(bandName);
    if (!bandTex) {
      if (ensureTexture) {
        const newTex = ensureTexture(bandName);
        if (newTex) {
          bandTex = newTex;
          bandTextures.set(bandName, bandTex);
        }
      } else {
        bandTex = gl.createTexture();
        if (bandTex) {
          bandTextures.set(bandName, bandTex);
        }
      }
    }
    if (!bandTex) {
      return false;
    }
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, bandTex);
    if (!bandTexturesConfigured.has(bandName)) {
      configureDataTexture(gl);
      bandTexturesConfigured.add(bandName);
    }
    if (!bandTexturesUploaded.has(bandName)) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        width,
        height,
        0,
        gl.RED,
        gl.FLOAT,
        data
      );
      bandTexturesUploaded.add(bandName);
    }
    textureUnit++;
  }
  return true;
}
function bindGeometryBuffers(gl, shaderProgram, vertexBuffer, pixCoordBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.enableVertexAttribArray(shaderProgram.vertexLoc);
  gl.vertexAttribPointer(shaderProgram.vertexLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, pixCoordBuffer);
  gl.enableVertexAttribArray(shaderProgram.pixCoordLoc);
  gl.vertexAttribPointer(shaderProgram.pixCoordLoc, 2, gl.FLOAT, false, 0, 0);
}
function uploadDataTexture(gl, options) {
  const { texture, data, width, height, channels, configured } = options;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (!configured) {
    configureDataTexture(gl);
  }
  const { format, internalFormat } = getTextureFormats(gl, channels);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    internalFormat,
    width,
    height,
    0,
    format,
    gl.FLOAT,
    data
  );
  return { configured: true, uploaded: true };
}

// src/renderable-region.ts
function renderRegion(gl, shaderProgram, region, worldOffsets, customShaderConfig) {
  const wgs84Bounds = region.wgs84Bounds ?? null;
  const posSpace = region.positionSpace ?? (wgs84Bounds ? "wgs84" : "mercator");
  const hasLatBounds = region.mercatorBounds.latMin !== void 0 && region.mercatorBounds.latMax !== void 0;
  const sampMode = region.sampleMode ?? (hasLatBounds && !wgs84Bounds ? "mercator-invert" : "linear");
  let scaleX, scaleY, shiftX, shiftY;
  if (posSpace === "mercator") {
    scaleX = (region.mercatorBounds.x1 - region.mercatorBounds.x0) / 2;
    scaleY = (region.mercatorBounds.y1 - region.mercatorBounds.y0) / 2;
    shiftX = (region.mercatorBounds.x0 + region.mercatorBounds.x1) / 2;
    shiftY = (region.mercatorBounds.y0 + region.mercatorBounds.y1) / 2;
  } else {
    if (!wgs84Bounds) return false;
    scaleX = (wgs84Bounds.lon1 - wgs84Bounds.lon0) / 2;
    scaleY = (wgs84Bounds.lat1 - wgs84Bounds.lat0) / 2;
    shiftX = (wgs84Bounds.lon0 + wgs84Bounds.lon1) / 2;
    shiftY = (wgs84Bounds.lat0 + wgs84Bounds.lat1) / 2;
  }
  gl.uniform1f(shaderProgram.scaleLoc, 0);
  gl.uniform1f(shaderProgram.scaleXLoc, scaleX);
  gl.uniform1f(shaderProgram.scaleYLoc, scaleY);
  gl.uniform1f(shaderProgram.shiftXLoc, shiftX);
  gl.uniform1f(shaderProgram.shiftYLoc, shiftY);
  const texScale = region.texScale ?? [1, 1];
  const texOffset = region.texOffset ?? [0, 0];
  gl.uniform2f(shaderProgram.texScaleLoc, texScale[0], texScale[1]);
  gl.uniform2f(shaderProgram.texOffsetLoc, texOffset[0], texOffset[1]);
  const needsLatLookup = sampMode === "mercator-invert" || sampMode === "wgs84-lookup";
  if (shaderProgram.reprojectLoc !== null) {
    switch (sampMode) {
      case "linear":
        gl.uniform1i(shaderProgram.reprojectLoc, 0);
        break;
      case "mercator-invert":
        gl.uniform1i(shaderProgram.reprojectLoc, 1);
        break;
      case "wgs84-lookup":
        gl.uniform1i(shaderProgram.reprojectLoc, 2);
        break;
    }
  }
  if (needsLatLookup && shaderProgram.latBoundsLoc !== null && hasLatBounds) {
    gl.uniform2f(
      shaderProgram.latBoundsLoc,
      region.mercatorBounds.latMin,
      region.mercatorBounds.latMax
    );
  }
  if (needsLatLookup && shaderProgram.latIsAscendingLoc !== null) {
    gl.uniform1i(shaderProgram.latIsAscendingLoc, region.latIsAscending ? 1 : 0);
  }
  bindGeometryBuffers(
    gl,
    shaderProgram,
    region.vertexBuffer,
    region.pixCoordBuffer
  );
  if (region.useIndexedMesh && region.indexBuffer) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, region.indexBuffer);
  }
  if (shaderProgram.useCustomShader && customShaderConfig) {
    const bandsBound = bindBandTextures(gl, {
      bandData: region.bandData,
      bandTextures: region.bandTextures,
      bandTexturesUploaded: region.bandTexturesUploaded,
      bandTexturesConfigured: region.bandTexturesConfigured,
      customShaderConfig,
      width: region.width,
      height: region.height,
      ensureTexture: region.ensureBandTexture
    });
    if (!bandsBound) {
      return false;
    }
  } else {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, region.texture);
    if (shaderProgram.texLoc !== null) {
      gl.uniform1i(shaderProgram.texLoc, 0);
    }
  }
  for (const worldOffset of worldOffsets) {
    gl.uniform1f(shaderProgram.worldXOffsetLoc, worldOffset);
    if (region.useIndexedMesh && region.indexBuffer) {
      gl.drawElements(gl.TRIANGLES, region.vertexCount, gl.UNSIGNED_INT, 0);
    } else {
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, region.vertexCount);
    }
  }
  return true;
}

// src/tile-renderer.ts
function prepareTileGeometry(gl, tile, vertexArr, pixCoordArr) {
  gl.bindBuffer(gl.ARRAY_BUFFER, tile.vertexBuffer);
  if (!tile.geometryUploaded) {
    gl.bufferData(gl.ARRAY_BUFFER, vertexArr, gl.STATIC_DRAW);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, tile.pixCoordBuffer);
  if (!tile.geometryUploaded) {
    gl.bufferData(gl.ARRAY_BUFFER, pixCoordArr, gl.STATIC_DRAW);
    tile.geometryUploaded = true;
  }
  return tile.pixCoordBuffer;
}
function tileToRenderable(tile, bounds, pixCoordBuffer, vertexCount, tileSize, texScale, texOffset, tileCache, renderTileKey, latIsAscending) {
  return {
    mercatorBounds: bounds,
    vertexBuffer: tile.vertexBuffer,
    pixCoordBuffer,
    vertexCount,
    texture: tile.tileTexture,
    bandData: tile.bandData,
    bandTextures: tile.bandTextures,
    bandTexturesUploaded: tile.bandTexturesUploaded,
    bandTexturesConfigured: tile.bandTexturesConfigured,
    width: tileSize,
    height: tileSize,
    texScale,
    texOffset,
    ensureBandTexture: (bandName) => tileCache.ensureBandTexture(renderTileKey, bandName),
    latIsAscending
  };
}
function renderTiles(gl, shaderProgram, visibleTiles, worldOffsets, tileCache, tileSize, vertexArr, pixCoordArr, tileBounds, customShaderConfig, isGlobeTileRender = false, datasetMaxZoom, tileTexOverrides, latIsAscending = true) {
  setupBandTextureUniforms(gl, shaderProgram, customShaderConfig);
  const vertexCount = vertexArr.length / 2;
  for (const tileTuple of visibleTiles) {
    const [z, x, y] = tileTuple;
    const tileKey = tileToKey(tileTuple);
    const tile = tileCache.get(tileKey);
    const bounds = tileBounds?.[tileKey];
    let tileToRender = null;
    let renderTileKey = tileKey;
    let texScale = [1, 1];
    let texOffset = [0, 0];
    if (tile && tile.data) {
      tileToRender = tile;
    } else {
      const parent = findBestParentTile(tileCache, z, x, y);
      if (parent) {
        tileToRender = parent.tile;
        renderTileKey = tileToKey([
          parent.ancestorZ,
          parent.ancestorX,
          parent.ancestorY
        ]);
        const levelDiff = z - parent.ancestorZ;
        const divisor = Math.pow(2, levelDiff);
        const localX = x % divisor;
        const localY = y % divisor;
        texScale = [1 / divisor, 1 / divisor];
        texOffset = [localX / divisor, localY / divisor];
      } else if (datasetMaxZoom !== void 0) {
        const children = findBestChildTiles(tileCache, z, x, y, datasetMaxZoom);
        if (children && children.length > 0) {
          let targetBounds;
          if (bounds) {
            targetBounds = bounds;
          } else {
            const [scale, shiftX, shiftY] = tileToScale(tileTuple);
            targetBounds = {
              x0: shiftX - scale,
              x1: shiftX + scale,
              y0: shiftY - scale,
              y1: shiftY + scale
            };
          }
          for (const child of children) {
            if (!child.tile.data || !child.tile.vertexBuffer || !child.tile.pixCoordBuffer || !child.tile.tileTexture) {
              continue;
            }
            const levelDiff = child.childZ - z;
            const divisor = Math.pow(2, levelDiff);
            const localX = child.childX % divisor;
            const localY = child.childY % divisor;
            const xSpan = targetBounds.x1 - targetBounds.x0;
            const ySpan = targetBounds.y1 - targetBounds.y0;
            const childBounds = {
              x0: targetBounds.x0 + localX / divisor * xSpan,
              x1: targetBounds.x0 + (localX + 1) / divisor * xSpan,
              y0: targetBounds.y0 + localY / divisor * ySpan,
              y1: targetBounds.y0 + (localY + 1) / divisor * ySpan
            };
            if (bounds?.latMin !== void 0 && bounds?.latMax !== void 0) {
              const latSpan = bounds.latMax - bounds.latMin;
              childBounds.latMin = bounds.latMin + localY / divisor * latSpan;
              childBounds.latMax = bounds.latMin + (localY + 1) / divisor * latSpan;
            }
            if (bounds?.lonMin !== void 0 && bounds?.lonMax !== void 0) {
              const lonSpan = bounds.lonMax - bounds.lonMin;
              childBounds.lonMin = bounds.lonMin + localX / divisor * lonSpan;
              childBounds.lonMax = bounds.lonMin + (localX + 1) / divisor * lonSpan;
            }
            const childPixCoordBuffer = prepareTileGeometry(
              gl,
              child.tile,
              vertexArr,
              pixCoordArr
            );
            const childTileKey = tileToKey([
              child.childZ,
              child.childX,
              child.childY
            ]);
            const childRenderable = tileToRenderable(
              child.tile,
              childBounds,
              childPixCoordBuffer,
              vertexCount,
              tileSize,
              [1, 1],
              [0, 0],
              tileCache,
              childTileKey,
              latIsAscending
            );
            renderRegion(
              gl,
              shaderProgram,
              childRenderable,
              isGlobeTileRender ? [0] : worldOffsets,
              customShaderConfig
            );
          }
          continue;
        }
      }
    }
    if (!tileToRender || !tileToRender.data || !tileToRender.vertexBuffer || !tileToRender.pixCoordBuffer || !tileToRender.tileTexture) {
      continue;
    }
    if (isGlobeTileRender && tileTexOverrides?.[tileKey]) {
      const override = tileTexOverrides[tileKey];
      texScale = override.texScale;
      texOffset = override.texOffset;
    }
    const pixCoordBuffer = prepareTileGeometry(
      gl,
      tileToRender,
      vertexArr,
      pixCoordArr
    );
    let mercatorBounds;
    if (bounds) {
      mercatorBounds = bounds;
    } else {
      const [scale, shiftX, shiftY] = tileToScale(tileTuple);
      mercatorBounds = {
        x0: shiftX - scale,
        x1: shiftX + scale,
        y0: shiftY - scale,
        y1: shiftY + scale
      };
    }
    const renderable = tileToRenderable(
      tileToRender,
      mercatorBounds,
      pixCoordBuffer,
      vertexCount,
      tileSize,
      texScale,
      texOffset,
      tileCache,
      renderTileKey,
      latIsAscending
    );
    renderRegion(
      gl,
      shaderProgram,
      renderable,
      isGlobeTileRender ? [0] : worldOffsets,
      customShaderConfig
    );
  }
}

// src/zarr-renderer.ts
var ZarrRenderer = class _ZarrRenderer {
  constructor(gl, fragmentShaderSource, customShaderConfig) {
    this.shaderCache = /* @__PURE__ */ new Map();
    this.customShaderConfig = null;
    this.gl = _ZarrRenderer.resolveGl(gl);
    this.fragmentShaderSource = fragmentShaderSource;
    this.customShaderConfig = customShaderConfig || null;
  }
  updateMultiBandConfig(config) {
    if (config && this.customShaderConfig) {
      const bandsChanged = JSON.stringify(config.bands) !== JSON.stringify(this.customShaderConfig.bands);
      const fragChanged = config.customFrag !== this.customShaderConfig.customFrag;
      if (bandsChanged || fragChanged) {
        this.shaderCache.clear();
      }
    } else if (config !== this.customShaderConfig) {
      this.shaderCache.clear();
    }
    this.customShaderConfig = config;
  }
  static resolveGl(gl) {
    const hasWebGL2Methods = gl && typeof gl.getUniformLocation === "function" && typeof gl.drawBuffers === "function";
    if (hasWebGL2Methods) {
      gl.getExtension("EXT_color_buffer_float");
      gl.getExtension("OES_texture_float_linear");
      return gl;
    }
    throw new Error("Invalid WebGL2 context: missing required WebGL2 methods");
  }
  getProgram(shaderData, customShaderConfig, useMapbox = false, useWgs84 = false, useDirectEcef = false) {
    const projectionMode = resolveProjectionMode(
      useMapbox,
      useWgs84,
      useDirectEcef
    );
    const config = customShaderConfig || this.customShaderConfig;
    const variantName = makeShaderVariantKey({
      projectionMode,
      shaderData,
      customShaderConfig: config
    });
    const cached = this.shaderCache.get(variantName);
    if (cached) {
      return cached;
    }
    const { shaderProgram } = createShaderProgram(this.gl, {
      fragmentShaderSource: this.fragmentShaderSource,
      shaderData,
      customShaderConfig: config,
      projectionMode,
      variantName
    });
    this.shaderCache.set(variantName, shaderProgram);
    return shaderProgram;
  }
  applyCommonUniforms(shaderProgram, colormapTexture, uniforms, customShaderConfig, projectionData, mapbox, matrix, isGlobeTileRender = false) {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, colormapTexture);
    if (shaderProgram.cmapLoc) {
      gl.uniform1i(shaderProgram.cmapLoc, 1);
    }
    if (shaderProgram.colormapLoc) {
      gl.uniform1i(shaderProgram.colormapLoc, 1);
    }
    if (shaderProgram.climLoc) {
      gl.uniform2f(shaderProgram.climLoc, uniforms.clim[0], uniforms.clim[1]);
    }
    gl.uniform1f(shaderProgram.opacityLoc, uniforms.opacity);
    if (shaderProgram.fillValueLoc) {
      gl.uniform1f(shaderProgram.fillValueLoc, uniforms.fillValue ?? NaN);
    }
    if (shaderProgram.scaleFactorLoc) {
      gl.uniform1f(shaderProgram.scaleFactorLoc, uniforms.scaleFactor);
    }
    if (shaderProgram.addOffsetLoc) {
      gl.uniform1f(shaderProgram.addOffsetLoc, uniforms.offset);
    }
    if (shaderProgram.dataScaleLoc) {
      gl.uniform1f(shaderProgram.dataScaleLoc, uniforms.fixedDataScale);
    }
    gl.uniform2f(shaderProgram.texScaleLoc, 1, 1);
    gl.uniform2f(shaderProgram.texOffsetLoc, 0, 0);
    if (customShaderConfig?.customUniforms) {
      for (const [name, value] of Object.entries(
        customShaderConfig.customUniforms
      )) {
        const loc = shaderProgram.customUniformLocs.get(name);
        if (loc) {
          gl.uniform1f(loc, value);
        }
      }
    }
    if (matrix) {
      applyProjectionUniforms(
        gl,
        shaderProgram,
        matrix,
        projectionData,
        mapbox,
        isGlobeTileRender
      );
    }
  }
  renderTiles(shaderProgram, visibleTiles, worldOffsets, tileCache, tileSize, vertexArr, pixCoordArr, tileBounds, customShaderConfig, isGlobeTileRender = false, datasetMaxZoom, tileTexOverrides, latIsAscending = true) {
    renderTiles(
      this.gl,
      shaderProgram,
      visibleTiles,
      worldOffsets,
      tileCache,
      tileSize,
      vertexArr,
      pixCoordArr,
      tileBounds,
      customShaderConfig,
      isGlobeTileRender,
      datasetMaxZoom,
      tileTexOverrides,
      latIsAscending
    );
  }
  dispose() {
    const gl = this.gl;
    for (const [, shader] of this.shaderCache) {
      gl.deleteProgram(shader.program);
    }
    this.shaderCache.clear();
  }
};

// src/query/query-utils.ts
function rasterExtentCrossesAntimeridian(crs, xyLimits) {
  if (crs !== "EPSG:4326" || !xyLimits) return false;
  return xyLimits.xMin > xyLimits.xMax || xyLimits.xMax > 180 || xyLimits.xMin < -180;
}
function pixelToLatLon(x, y, bounds, width, height, crs, latIsAscending, proj4def, sourceBounds, cachedTransformer, centerPixel = true) {
  if (proj4def && sourceBounds) {
    const transformer = cachedTransformer ?? createWGS84ToSourceTransformer(proj4def);
    const px = centerPixel ? x + 0.5 : x;
    const py = centerPixel ? y + 0.5 : y;
    const [srcX, srcY] = pixelToSourceCRS(
      px,
      py,
      sourceBounds,
      width,
      height,
      latIsAscending
    );
    const [lon2, lat2] = transformer.inverse(srcX, srcY);
    return { lat: lat2, lon: lon2 };
  }
  const xFrac = width <= 1 ? 0.5 : centerPixel ? (x + 0.5) / width : x / width;
  const yFrac = height <= 1 ? 0.5 : centerPixel ? (y + 0.5) / height : y / height;
  const mercX = bounds.x0 + xFrac * (bounds.x1 - bounds.x0);
  const mercY = bounds.y0 + yFrac * (bounds.y1 - bounds.y0);
  const lon = mercatorNormToLon(mercX);
  const yRange = bounds.y1 - bounds.y0;
  const yNorm = yRange === 0 ? 0.5 : (mercY - bounds.y0) / yRange;
  const lat = crs === "EPSG:4326" && bounds.latMin !== void 0 && bounds.latMax !== void 0 ? latIsAscending ? bounds.latMin + yNorm * (bounds.latMax - bounds.latMin) : bounds.latMax - yNorm * (bounds.latMax - bounds.latMin) : mercatorNormToLat(mercY);
  return { lat, lon };
}
function geoToTileFraction(lng, lat, tile, crs, xyLimits) {
  const [z, x, y] = tile;
  const z2 = Math.pow(2, z);
  if (crs === "EPSG:4326") {
    const { xMin, xMax, yMin, yMax } = xyLimits;
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;
    const globalFracX2 = (lng - xMin) / xSpan;
    const globalFracY2 = (yMax - lat) / ySpan;
    const fracX2 = globalFracX2 * z2 - x;
    const fracY2 = globalFracY2 * z2 - y;
    return { fracX: fracX2, fracY: fracY2 };
  }
  const globalFracX = lonToMercatorNorm(lng);
  const sin = Math.sin(lat * Math.PI / 180);
  const globalFracY = 0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI;
  const fracX = globalFracX * z2 - x;
  const fracY = globalFracY * z2 - y;
  return { fracX, fracY };
}
function tilePixelToLatLon(tile, pixelX, pixelY, tileSize, crs, xyLimits) {
  const [z, x, y] = tile;
  const z2 = Math.pow(2, z);
  const fracX = (x + pixelX / tileSize) / z2;
  const fracY = (y + pixelY / tileSize) / z2;
  if (crs === "EPSG:4326") {
    const { xMin, xMax, yMin, yMax } = xyLimits;
    const lon2 = xMin + fracX * (xMax - xMin);
    const lat2 = yMax - fracY * (yMax - yMin);
    return { lat: lat2, lon: lon2 };
  }
  const lon = fracX * 360 - 180;
  const y2 = 180 - fracY * 360;
  const lat = 360 / Math.PI * Math.atan(Math.exp(y2 * Math.PI / 180)) - 90;
  return { lat, lon };
}
function computeBoundingBox(geometry) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return { west: lon, east: lon, south: lat, north: lat };
  }
  const processRing = (ring) => {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  };
  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(processRing);
  } else {
    geometry.coordinates.forEach((polygon) => polygon.forEach(processRing));
  }
  return { west, east, south, north };
}
function computeYPixelRange(south, north, bounds, height, crs, latIsAscending) {
  if (crs === "EPSG:4326" && bounds.latMin !== void 0 && bounds.latMax !== void 0) {
    const latRange = bounds.latMax - bounds.latMin;
    if (latRange === 0) return null;
    const clampedNorth = Math.min(Math.max(north, bounds.latMin), bounds.latMax);
    const clampedSouth = Math.min(Math.max(south, bounds.latMin), bounds.latMax);
    const toFrac = (lat) => latIsAscending ? (lat - bounds.latMin) / latRange : (bounds.latMax - lat) / latRange;
    const yFracMin = Math.min(toFrac(clampedNorth), toFrac(clampedSouth));
    const yFracMax = Math.max(toFrac(clampedNorth), toFrac(clampedSouth));
    const yStart2 = Math.min(
      Math.max(0, Math.floor(yFracMin * height)),
      height - 1
    );
    const yEnd2 = Math.min(
      height,
      Math.max(Math.ceil(yFracMax * height), yStart2 + 1)
    );
    if (yEnd2 <= yStart2) return null;
    return { yStart: yStart2, yEnd: yEnd2 };
  }
  const normNorth = latToMercatorNorm(north);
  const normSouth = latToMercatorNorm(south);
  const overlapY0 = Math.max(bounds.y0, Math.min(normNorth, normSouth));
  const overlapY1 = Math.min(bounds.y1, Math.max(normNorth, normSouth));
  if (overlapY1 < overlapY0) return null;
  const rawMinY = Math.floor(
    (overlapY0 - bounds.y0) / (bounds.y1 - bounds.y0) * height
  );
  const rawMaxY = Math.ceil(
    (overlapY1 - bounds.y0) / (bounds.y1 - bounds.y0) * height
  );
  if (rawMaxY <= 0 || rawMinY >= height) return null;
  const yStart = Math.min(Math.max(0, rawMinY), height - 1);
  const yEnd = Math.min(height, Math.max(rawMaxY, yStart + 1));
  if (yEnd <= yStart) return null;
  return { yStart, yEnd };
}
function computePixelBoundsFromGeometry(geometry, bounds, width, height, crs, latIsAscending, proj4def, sourceBounds, cachedTransformer) {
  const bbox = computeBoundingBox(geometry);
  if (proj4def && sourceBounds) {
    const transformer = cachedTransformer ?? createWGS84ToSourceTransformer(proj4def);
    const numSamples = 5;
    const samplePoints = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const lon = bbox.west + t * (bbox.east - bbox.west);
      const lat = bbox.south + t * (bbox.north - bbox.south);
      samplePoints.push([lon, bbox.south]);
      samplePoints.push([lon, bbox.north]);
      samplePoints.push([bbox.west, lat]);
      samplePoints.push([bbox.east, lat]);
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const dbgSamples = [];
    for (const [lon, lat] of samplePoints) {
      const [srcX, srcY] = transformer.forward(lon, lat);
      if (!isFinite(srcX) || !isFinite(srcY)) {
        dbgSamples.push({ lon, lat, srcX, srcY, skip: "non-finite" });
        continue;
      }
      const [xPixel, yPixel] = sourceCRSToPixel(
        srcX,
        srcY,
        sourceBounds,
        width,
        height,
        latIsAscending
      );
      dbgSamples.push({
        lon: lon.toFixed(2),
        lat: lat.toFixed(2),
        srcX: Math.round(srcX),
        srcY: Math.round(srcY),
        xPixel: xPixel.toFixed(1),
        yPixel: yPixel.toFixed(1)
      });
      minX = Math.min(minX, xPixel);
      maxX = Math.max(maxX, xPixel);
      minY = Math.min(minY, yPixel);
      maxY = Math.max(maxY, yPixel);
    }
    console.log(
      "[query-debug] computePixelBoundsFromGeometry bbox=%o sourceBounds=%o width=%d height=%d latIsAscending=%s samples=%o minX=%s maxX=%s",
      bbox,
      sourceBounds,
      width,
      height,
      latIsAscending,
      dbgSamples,
      minX.toFixed(1),
      maxX.toFixed(1)
    );
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      return null;
    }
    const xStart2 = Math.min(Math.max(0, Math.floor(minX)), width - 1);
    const xEnd2 = Math.min(width, Math.max(Math.floor(maxX) + 1, xStart2 + 1));
    const yStart = Math.min(Math.max(0, Math.floor(minY)), height - 1);
    const yEnd = Math.min(height, Math.max(Math.floor(maxY) + 1, yStart + 1));
    if (xEnd2 <= xStart2 || yEnd <= yStart) return null;
    return { minX: xStart2, maxX: xEnd2, minY: yStart, maxY: yEnd };
  }
  const yRange = computeYPixelRange(
    bbox.south,
    bbox.north,
    bounds,
    height,
    crs,
    latIsAscending
  );
  if (!yRange) return null;
  const polyX0 = lonToMercatorNorm(bbox.west);
  const polyX1 = lonToMercatorNorm(bbox.east);
  const overlapX0 = Math.max(bounds.x0, Math.min(polyX0, polyX1));
  const overlapX1 = Math.min(bounds.x1, Math.max(polyX0, polyX1));
  if (overlapX1 < overlapX0) return null;
  const rawMinX = (overlapX0 - bounds.x0) / (bounds.x1 - bounds.x0) * width;
  const rawMaxX = (overlapX1 - bounds.x0) / (bounds.x1 - bounds.x0) * width;
  const xStart = Math.min(Math.max(0, Math.floor(rawMinX)), width - 1);
  const xEnd = Math.min(width, Math.max(Math.ceil(rawMaxX), xStart + 1));
  if (xEnd <= xStart) return null;
  return { minX: xStart, maxX: xEnd, minY: yRange.yStart, maxY: yRange.yEnd };
}
var DENSIFY_MAX_DEPTH = 10;
function densifyAndTransformRing(ring, transformVertex) {
  const result = [];
  function subdivide(lon0, lat0, px0, lon1, lat1, px1, depth) {
    if (depth >= DENSIFY_MAX_DEPTH) return;
    const lonM = (lon0 + lon1) * 0.5;
    const latM = (lat0 + lat1) * 0.5;
    const pxM = transformVertex(lonM, latM);
    if (!isFinite(pxM[0]) || !isFinite(pxM[1])) return;
    const expectedX = (px0[0] + px1[0]) * 0.5;
    const expectedY = (px0[1] + px1[1]) * 0.5;
    const dx = pxM[0] - expectedX;
    const dy = pxM[1] - expectedY;
    const error = dx * dx + dy * dy;
    if (error > DEFAULT_QUERY_DENSIFY_MAX_ERROR * DEFAULT_QUERY_DENSIFY_MAX_ERROR) {
      subdivide(lon0, lat0, px0, lonM, latM, pxM, depth + 1);
      result.push(pxM);
      subdivide(lonM, latM, pxM, lon1, lat1, px1, depth + 1);
    }
  }
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon0, lat0] = ring[i];
    const [lon1, lat1] = ring[i + 1];
    const px0 = transformVertex(lon0, lat0);
    const px1 = transformVertex(lon1, lat1);
    if (isFinite(px0[0]) && isFinite(px0[1])) {
      result.push(px0);
    }
    if (isFinite(px0[0]) && isFinite(px0[1]) && isFinite(px1[0]) && isFinite(px1[1])) {
      subdivide(lon0, lat0, px0, lon1, lat1, px1, 0);
    }
  }
  if (result.length > 0 && isFinite(result[0][0]) && isFinite(result[0][1])) {
    result.push([result[0][0], result[0][1]]);
  }
  return result;
}
function transformGeometryToPixelSpace(geometry, bounds, width, height, crs, latIsAscending, proj4def, sourceBounds, cachedTransformer) {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    const px = lonLatToPixel(
      lon,
      lat,
      bounds,
      width,
      height,
      crs,
      latIsAscending,
      proj4def,
      sourceBounds,
      cachedTransformer
    );
    if (!px) return null;
    return { type: "Point", coordinates: [px[0], px[1]] };
  }
  const transformVertex = (lon, lat) => {
    const px = lonLatToPixel(
      lon,
      lat,
      bounds,
      width,
      height,
      crs,
      latIsAscending,
      proj4def,
      sourceBounds,
      cachedTransformer
    );
    return px ?? [NaN, NaN];
  };
  const isLinear4326 = crs === "EPSG:4326" && bounds.latMin !== void 0 && bounds.latMax !== void 0;
  const needsDensification = !!proj4def || !isLinear4326 && crs !== "EPSG:4326";
  const transformRing = (ring) => {
    if (needsDensification) {
      return densifyAndTransformRing(ring, transformVertex);
    }
    const result = [];
    for (const [lon, lat] of ring) {
      const pt = transformVertex(lon, lat);
      if (isFinite(pt[0]) && isFinite(pt[1])) {
        result.push(pt);
      }
    }
    if (result.length > 1 && (result[0][0] !== result[result.length - 1][0] || result[0][1] !== result[result.length - 1][1])) {
      result.push([result[0][0], result[0][1]]);
    }
    return result;
  };
  if (geometry.type === "Polygon") {
    const coords2 = geometry.coordinates.map(transformRing);
    if (coords2[0].length < 4) return null;
    return { type: "Polygon", coordinates: coords2 };
  }
  const coords = geometry.coordinates.map(
    (polygon) => polygon.map(transformRing)
  );
  const valid = coords.filter((poly) => poly[0].length >= 4);
  if (valid.length === 0) return null;
  return { type: "MultiPolygon", coordinates: valid };
}
function transformGeometryToTilePixelSpace(geometry, tile, tileSize, crs, xyLimits) {
  const transformVertex = (lon, lat) => {
    const clampedLat = crs !== "EPSG:4326" ? Math.max(-MERCATOR_LAT_LIMIT, Math.min(MERCATOR_LAT_LIMIT, lat)) : lat;
    const { fracX, fracY } = geoToTileFraction(
      lon,
      clampedLat,
      tile,
      crs,
      xyLimits
    );
    return [fracX * tileSize, fracY * tileSize];
  };
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    const pt = transformVertex(lon, lat);
    if (!isFinite(pt[0]) || !isFinite(pt[1])) return null;
    return { type: "Point", coordinates: [pt[0], pt[1]] };
  }
  const needsDensification = crs !== "EPSG:4326";
  const transformRing = (ring) => {
    if (needsDensification) {
      return densifyAndTransformRing(ring, transformVertex);
    }
    const result = [];
    for (const [lon, lat] of ring) {
      const pt = transformVertex(lon, lat);
      if (isFinite(pt[0]) && isFinite(pt[1])) {
        result.push(pt);
      }
    }
    if (result.length > 1 && (result[0][0] !== result[result.length - 1][0] || result[0][1] !== result[result.length - 1][1])) {
      result.push([result[0][0], result[0][1]]);
    }
    return result;
  };
  if (geometry.type === "Polygon") {
    const coords2 = geometry.coordinates.map(transformRing);
    if (coords2[0].length < 4) return null;
    return { type: "Polygon", coordinates: coords2 };
  }
  const coords = geometry.coordinates.map(
    (polygon) => polygon.map(transformRing)
  );
  const valid = coords.filter((poly) => poly[0].length >= 4);
  if (valid.length === 0) return null;
  return { type: "MultiPolygon", coordinates: valid };
}
function lonLatToPixel(lon, lat, bounds, width, height, crs, latIsAscending, proj4def, sourceBounds, cachedTransformer) {
  if (proj4def && sourceBounds) {
    const transformer = cachedTransformer ?? createWGS84ToSourceTransformer(proj4def);
    const [srcX, srcY] = transformer.forward(lon, lat);
    if (!isFinite(srcX) || !isFinite(srcY)) return null;
    return sourceCRSToPixel(
      srcX,
      srcY,
      sourceBounds,
      width,
      height,
      latIsAscending
    );
  }
  const normX = lonToMercatorNorm(lon);
  const xFrac = (normX - bounds.x0) / (bounds.x1 - bounds.x0);
  let yFrac;
  if (crs === "EPSG:4326" && bounds.latMin !== void 0 && bounds.latMax !== void 0) {
    const latRange = bounds.latMax - bounds.latMin;
    if (latRange === 0) return null;
    yFrac = latIsAscending ? (lat - bounds.latMin) / latRange : (bounds.latMax - lat) / latRange;
  } else {
    const normY = latToMercatorNorm(lat);
    yFrac = (normY - bounds.y0) / (bounds.y1 - bounds.y0);
  }
  return [xFrac * width, yFrac * height];
}
function buildScanlineTableForRings(rings, yStart, yEnd) {
  const table = /* @__PURE__ */ new Map();
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const x0 = ring[i][0];
      const y0 = ring[i][1];
      const x1 = ring[i + 1][0];
      const y1 = ring[i + 1][1];
      if (y0 === y1) continue;
      const edgeYMin = Math.min(y0, y1);
      const edgeYMax = Math.max(y0, y1);
      const scanYMin = Math.max(yStart, Math.floor(edgeYMin + 0.5));
      const scanYMax = Math.min(yEnd - 1, Math.ceil(edgeYMax - 0.5) - 1);
      const slope = (x1 - x0) / (y1 - y0);
      for (let row = scanYMin; row <= scanYMax; row++) {
        const scanY = row + 0.5;
        const xIntersect = x0 + (scanY - y0) * slope;
        let arr = table.get(row);
        if (!arr) {
          arr = [];
          table.set(row, arr);
        }
        arr.push(xIntersect);
      }
    }
  }
  for (const [, arr] of table) {
    arr.sort((a, b) => a - b);
  }
  return table;
}
function unionScanlineIntervals(a, b) {
  const intervals = [];
  for (let i = 0; i < a.length - 1; i += 2) intervals.push([a[i], a[i + 1]]);
  for (let i = 0; i < b.length - 1; i += 2) intervals.push([b[i], b[i + 1]]);
  intervals.sort((x, y) => x[0] - y[0]);
  const result = [];
  let [curStart, curEnd] = intervals[0];
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i][0] <= curEnd) {
      curEnd = Math.max(curEnd, intervals[i][1]);
    } else {
      result.push(curStart, curEnd);
      curStart = intervals[i][0];
      curEnd = intervals[i][1];
    }
  }
  result.push(curStart, curEnd);
  return result;
}
function buildScanlineTable(geometry, yStart, yEnd) {
  if (geometry.type === "Polygon") {
    return buildScanlineTableForRings(geometry.coordinates, yStart, yEnd);
  }
  if (geometry.type === "Point") {
    return /* @__PURE__ */ new Map();
  }
  const perPolygon = geometry.coordinates.map(
    (polygon) => buildScanlineTableForRings(polygon, yStart, yEnd)
  );
  if (perPolygon.length === 1) return perPolygon[0];
  const merged = /* @__PURE__ */ new Map();
  for (const table of perPolygon) {
    for (const [row, crossings] of table) {
      const existing = merged.get(row);
      if (!existing) {
        merged.set(row, crossings);
      } else {
        merged.set(row, unionScanlineIntervals(existing, crossings));
      }
    }
  }
  return merged;
}
function getTilesForBoundingBox(bbox, zoom, crs, xyLimits) {
  const bounds = [
    [bbox.west, bbox.south],
    [bbox.east, bbox.north]
  ];
  if (crs === "EPSG:4326") {
    return getTilesAtZoomEquirect(zoom, bounds, xyLimits);
  }
  return getTilesAtZoom(zoom, bounds);
}
function getTilesForPolygon(geometry, zoom, crs, xyLimits) {
  const bbox = computeBoundingBox(geometry);
  return getTilesForBoundingBox(bbox, zoom, crs, xyLimits);
}
function wrapLon(lon) {
  let w = (lon + 180) % 360;
  if (w < 0) w += 360;
  w -= 180;
  if (w === -180 && lon > 0) w = 180;
  return w;
}
function closeRing(ring) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...ring, [first[0], first[1]]];
  }
  return ring;
}
function ringCentroidLon(ring) {
  const count = Math.max(1, ring.length - 1);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += ring[i][0];
  }
  return sum / count;
}
function nearestLonShift(centroidLon, targetCenter) {
  return Math.round((targetCenter - centroidLon) / 360) * 360;
}
function shiftRingsLon(rings, shift) {
  return rings.map((ring) => ring.map(([lon, lat]) => [lon + shift, lat]));
}
function lonRangeOfRings(rings) {
  let min = Infinity;
  let allAbove180 = true;
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const lon = ring[i][0];
      if (lon < min) min = lon;
      if (lon <= 180) allAbove180 = false;
    }
  }
  return { min, allAbove180 };
}
function canonicalLonShift(rings) {
  const { min, allAbove180 } = lonRangeOfRings(rings);
  if (min < -180) return 360;
  if (allAbove180) return -360;
  return 0;
}
function canonicalizeLonRange(rings) {
  const shift = canonicalLonShift(rings);
  return shift !== 0 ? shiftRingsLon(rings, shift) : rings;
}
function normalizePolygonRings(rings) {
  if (rings.length === 0) return rings;
  let hasExplicit = false;
  for (const ring of rings) {
    for (const [lon] of ring) {
      if (lon > 180 || lon < -180) {
        hasExplicit = true;
        break;
      }
    }
    if (hasExplicit) break;
  }
  if (!hasExplicit) {
    return rings.map((ring) => closeRing(ring.map(([lon, lat]) => [lon, lat])));
  }
  const outer = normalizeRingLongitudes(rings[0]);
  const outerCenter = ringCentroidLon(outer);
  const result = [outer];
  for (let r = 1; r < rings.length; r++) {
    const hole = normalizeRingLongitudes(rings[r]);
    const shift = nearestLonShift(ringCentroidLon(hole), outerCenter);
    result.push(
      shift !== 0 ? hole.map(([lon, lat]) => [lon + shift, lat]) : hole
    );
  }
  return canonicalizeLonRange(result);
}
function normalizeRingLongitudes(ring) {
  if (ring.length < 2) return ring.map(([lon, lat]) => [lon, lat]);
  const result = [[ring[0][0], ring[0][1]]];
  let prevLon = ring[0][0];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const lat = ring[i][1];
    const delta = lon - prevLon;
    if (delta > 180) {
      lon -= 360;
    } else if (delta < -180) {
      lon += 360;
    }
    result.push([lon, lat]);
    prevLon = lon;
  }
  return closeRing(result);
}
function computeWrappedBboxFromNormalized(normalizedRings) {
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const ring of normalizedRings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      if (lon < rawMin) rawMin = lon;
      if (lon > rawMax) rawMax = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  if (rawMin >= -180 && rawMax <= 180) {
    return {
      west: rawMin,
      east: rawMax,
      south,
      north,
      crossesAntimeridian: false
    };
  }
  const west = wrapLon(rawMin);
  const east = wrapLon(rawMax);
  if (west <= east) {
    return { west, east, south, north, crossesAntimeridian: false };
  }
  return { west, east, south, north, crossesAntimeridian: true };
}
function clipRingToHalfPlane(ring, clipLon, keepBelow) {
  if (ring.length < 4) return [];
  const output = [];
  const isInside = keepBelow ? (lon) => lon <= clipLon : (lon) => lon > clipLon;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon0, lat0] = ring[i];
    const [lon1, lat1] = ring[i + 1];
    const in0 = isInside(lon0);
    const in1 = isInside(lon1);
    if (in0 && in1) {
      output.push([lon1, lat1]);
    } else if (in0 && !in1) {
      const t = (clipLon - lon0) / (lon1 - lon0);
      const latI = lat0 + t * (lat1 - lat0);
      output.push([clipLon, latI]);
    } else if (!in0 && in1) {
      const t = (clipLon - lon0) / (lon1 - lon0);
      const latI = lat0 + t * (lat1 - lat0);
      output.push([clipLon, latI]);
      output.push([lon1, lat1]);
    }
  }
  if (output.length < 3) return [];
  const shifted = !keepBelow ? output.map(([lon, lat]) => [lon - 360, lat]) : output;
  return closeRing(shifted);
}
function clipNormalizedPolygonAtAntimeridian(normalizedRings) {
  let crosses = false;
  for (const ring of normalizedRings) {
    for (let i = 0; i < ring.length - 1; i++) {
      if (ring[i][0] > 180) {
        crosses = true;
        break;
      }
    }
    if (crosses) break;
  }
  if (!crosses) {
    return { west: normalizedRings, east: [] };
  }
  const west = [];
  const east = [];
  for (const ring of normalizedRings) {
    const w = clipRingToHalfPlane(ring, 180, true);
    const e = clipRingToHalfPlane(ring, 180, false);
    if (w.length >= 4) west.push(w);
    if (e.length >= 4) east.push(e);
  }
  return { west, east };
}
function alignMultiPolygonMembers(members) {
  if (members.length <= 1) return members;
  const wrappedLons = [];
  for (const member of members) {
    const outer = member[0];
    for (let i = 0; i < outer.length - 1; i++) {
      wrappedLons.push(wrapLon(outer[i][0]));
    }
  }
  wrappedLons.sort((a, b) => a - b);
  let maxGap = 0;
  let gapEndIndex = 0;
  for (let i = 1; i < wrappedLons.length; i++) {
    const gap = wrappedLons[i] - wrappedLons[i - 1];
    if (gap > maxGap) {
      maxGap = gap;
      gapEndIndex = i;
    }
  }
  const wrapGap = wrappedLons[0] + 360 - wrappedLons[wrappedLons.length - 1];
  if (wrapGap > maxGap) {
    maxGap = wrapGap;
    gapEndIndex = 0;
  }
  const gapStart = gapEndIndex === 0 ? wrappedLons[wrappedLons.length - 1] : wrappedLons[gapEndIndex - 1];
  const gapEnd = wrappedLons[gapEndIndex];
  const gapMidpoint = gapEndIndex === 0 ? (gapStart + gapEnd + 360) / 2 : (gapStart + gapEnd) / 2;
  const center = wrapLon(gapMidpoint + 180);
  const aligned = members.map((member) => {
    const shift2 = nearestLonShift(ringCentroidLon(member[0]), center);
    return shift2 !== 0 ? member.map((ring) => ring.map(([lon, lat]) => [lon + shift2, lat])) : member;
  });
  const shift = canonicalLonShift(aligned.flatMap((m) => m));
  if (shift !== 0) {
    return aligned.map((member) => shiftRingsLon(member, shift));
  }
  return aligned;
}
function preprocessQueryGeometry(geometry) {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return {
      geometry,
      bbox: {
        west: lon,
        east: lon,
        south: lat,
        north: lat,
        crossesAntimeridian: false
      }
    };
  }
  if (geometry.type === "Polygon") {
    const normalized = normalizePolygonRings(geometry.coordinates);
    const bbox2 = computeWrappedBboxFromNormalized(normalized);
    if (!bbox2.crossesAntimeridian) {
      return { geometry: { type: "Polygon", coordinates: normalized }, bbox: bbox2 };
    }
    const { west, east } = clipNormalizedPolygonAtAntimeridian(normalized);
    const polygons = [];
    if (west.length > 0) polygons.push(west);
    if (east.length > 0) polygons.push(east);
    if (polygons.length === 0) {
      return { geometry: { type: "Polygon", coordinates: normalized }, bbox: bbox2 };
    }
    return {
      geometry: {
        type: "MultiPolygon",
        coordinates: polygons
      },
      bbox: bbox2
    };
  }
  const normalizedMembers = geometry.coordinates.map(
    (memberRings) => normalizePolygonRings(memberRings)
  );
  const aligned = alignMultiPolygonMembers(normalizedMembers);
  const allRings = [];
  for (const member of aligned) {
    for (const ring of member) {
      allRings.push(ring);
    }
  }
  const bbox = computeWrappedBboxFromNormalized(allRings);
  if (!bbox.crossesAntimeridian) {
    return {
      geometry: {
        type: "MultiPolygon",
        coordinates: aligned
      },
      bbox
    };
  }
  const resultPolygons = [];
  for (const member of aligned) {
    const { west, east } = clipNormalizedPolygonAtAntimeridian(member);
    if (west.length > 0) resultPolygons.push(west);
    if (east.length > 0) resultPolygons.push(east);
  }
  if (resultPolygons.length === 0) {
    return {
      geometry: {
        type: "MultiPolygon",
        coordinates: aligned
      },
      bbox
    };
  }
  return {
    geometry: {
      type: "MultiPolygon",
      coordinates: resultPolygons
    },
    bbox
  };
}
function wrappedBboxToPixelSpans(bbox, bounds, width, height, crs, latIsAscending) {
  const yRange = computeYPixelRange(
    bbox.south,
    bbox.north,
    bounds,
    height,
    crs,
    latIsAscending
  );
  if (!yRange) return {};
  const { yStart, yEnd } = yRange;
  const xRange = bounds.x1 - bounds.x0;
  const computeStrip = (normMin, normMax) => {
    const xFracMin = (normMin - bounds.x0) / xRange;
    const xFracMax = (normMax - bounds.x0) / xRange;
    const rawMinX = Math.floor(xFracMin * width);
    const rawMaxX = Math.ceil(xFracMax * width);
    if (rawMaxX <= 0 || rawMinX >= width) return void 0;
    const minX = Math.max(0, rawMinX);
    const maxX = Math.min(width, rawMaxX);
    if (maxX <= minX) return void 0;
    return { minX, maxX, minY: yStart, maxY: yEnd };
  };
  const westNormMin = lonToMercatorNorm(bbox.west);
  const westNormMax = lonToMercatorNorm(180);
  const eastNormMin = lonToMercatorNorm(-180);
  const eastNormMax = lonToMercatorNorm(bbox.east);
  const result = {};
  const westStrip = computeStrip(westNormMin, westNormMax);
  if (westStrip) result.west = westStrip;
  const eastStrip = computeStrip(eastNormMin, eastNormMax);
  if (eastStrip) result.east = eastStrip;
  return result;
}

// src/query/selector-utils.ts
function getPointValues(data, pixelX, pixelY, selector, dimensions, coordinates, shape, chunks, chunkIndices) {
  const result = [];
  let combinedIndices = [[]];
  const keys = [[]];
  for (let i = 0; i < dimensions.length; i++) {
    const dimension = dimensions[i];
    const dimLower = dimension.toLowerCase();
    const chunkOffset = chunkIndices[i] * chunks[i];
    const coords = coordinates[dimension];
    if (["x", "lon", "longitude"].includes(dimLower)) {
      combinedIndices = combinedIndices.map((prev) => [...prev, pixelX]);
    } else if (["y", "lat", "latitude"].includes(dimLower)) {
      combinedIndices = combinedIndices.map((prev) => [...prev, pixelY]);
    } else {
      const selectorValue = selector[dimension];
      let selectorIndices;
      let selectorKeys;
      if (selectorValue === void 0) {
        selectorIndices = [];
        selectorKeys = [];
        for (let j = 0; j < chunks[i]; j++) {
          const globalIndex = chunkOffset + j;
          if (globalIndex < shape[i]) {
            selectorIndices.push(globalIndex);
            if (coords) {
              selectorKeys.push(coords[globalIndex]);
            }
          }
        }
      } else if (Array.isArray(selectorValue)) {
        selectorIndices = [];
        selectorKeys = [];
        for (const v of selectorValue) {
          let idx;
          if (coords) {
            idx = coords.indexOf(v);
            if (idx < 0) idx = typeof v === "number" ? v : 0;
          } else {
            idx = typeof v === "number" ? v : 0;
          }
          if (idx >= chunkOffset && idx < chunkOffset + chunks[i]) {
            selectorIndices.push(idx);
            selectorKeys.push(v);
          }
        }
      } else if (typeof selectorValue === "object" && "selected" in selectorValue) {
        const selected = selectorValue.selected;
        const type = selectorValue.type;
        const values = Array.isArray(selected) ? selected : [selected];
        selectorIndices = [];
        selectorKeys = [];
        for (const v of values) {
          let idx;
          if (type === "index") {
            idx = typeof v === "number" ? v : 0;
          } else if (coords) {
            idx = coords.indexOf(v);
            if (idx < 0) idx = typeof v === "number" ? v : 0;
          } else {
            idx = typeof v === "number" ? v : 0;
          }
          if (idx >= chunkOffset && idx < chunkOffset + chunks[i]) {
            selectorIndices.push(idx);
            if (Array.isArray(selected)) {
              selectorKeys.push(v);
            }
          }
        }
      } else {
        let idx;
        if (coords) {
          idx = coords.indexOf(selectorValue);
          if (idx < 0)
            idx = typeof selectorValue === "number" ? selectorValue : 0;
        } else {
          idx = typeof selectorValue === "number" ? selectorValue : 0;
        }
        selectorIndices = [idx];
        selectorKeys = [];
      }
      const newCombined = [];
      const newKeys = [];
      for (let j = 0; j < selectorIndices.length; j++) {
        for (let k = 0; k < combinedIndices.length; k++) {
          newCombined.push([...combinedIndices[k], selectorIndices[j]]);
          if (selectorKeys.length > 0) {
            newKeys.push([...keys[k], selectorKeys[j]]);
          } else {
            newKeys.push([...keys[k]]);
          }
        }
      }
      combinedIndices = newCombined.length > 0 ? newCombined : combinedIndices.map((prev) => [...prev, 0]);
      keys.length = 0;
      keys.push(...newKeys.length > 0 ? newKeys : keys.map(() => []));
    }
  }
  for (let i = 0; i < combinedIndices.length; i++) {
    const indices = combinedIndices[i];
    const entryKeys = keys[i] || [];
    const localIndices = indices.map((idx, j) => {
      const dimLower = dimensions[j].toLowerCase();
      if (["x", "lon", "longitude", "y", "lat", "latitude"].includes(dimLower)) {
        return idx;
      }
      return idx - chunkIndices[j] * chunks[j];
    });
    const strides = new Array(dimensions.length);
    strides[dimensions.length - 1] = 1;
    for (let j = dimensions.length - 2; j >= 0; j--) {
      strides[j] = strides[j + 1] * chunks[j + 1];
    }
    let dataIndex = 0;
    for (let j = 0; j < dimensions.length; j++) {
      dataIndex += localIndices[j] * strides[j];
    }
    const value = data[dataIndex];
    result.push({ keys: entryKeys, value });
  }
  return result;
}
function setObjectValues(obj, keys, value) {
  if (keys.length === 0) {
    if (Array.isArray(obj)) {
      obj.push(value);
    }
    return obj;
  }
  let ref = obj;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (i === keys.length - 1) {
      if (!ref[key]) {
        ref[key] = [];
      }
      const arr = ref[key];
      if (Array.isArray(arr)) {
        arr.push(value);
      }
    } else {
      if (!ref[key]) {
        ref[key] = {};
      }
      ref = ref[key];
    }
  }
  return obj;
}
function getChunks(selector, dimensions, coordinates, shape, chunks, x, y) {
  const chunkIndicesToUse = dimensions.map((dimension, i) => {
    const dimLower = dimension.toLowerCase();
    if (["x", "lon", "longitude"].includes(dimLower)) {
      return [x];
    } else if (["y", "lat", "latitude"].includes(dimLower)) {
      return [y];
    }
    const selectorValue = selector[dimension];
    const coords = coordinates[dimension];
    const chunkSize = chunks[i];
    let indices;
    if (selectorValue === void 0) {
      indices = Array(shape[i]).fill(null).map((_, j) => j);
    } else if (Array.isArray(selectorValue)) {
      indices = selectorValue.map((v) => {
        const idx = coords ? coords.indexOf(v) : typeof v === "number" ? v : 0;
        return idx >= 0 ? idx : typeof v === "number" ? v : 0;
      });
    } else if (typeof selectorValue === "object" && "selected" in selectorValue) {
      const selected = selectorValue.selected;
      const type = selectorValue.type;
      const values = Array.isArray(selected) ? selected : [selected];
      indices = values.map((v) => {
        if (type === "index") {
          return typeof v === "number" ? v : 0;
        }
        if (coords) {
          const idx = coords.indexOf(v);
          return idx >= 0 ? idx : typeof v === "number" ? v : 0;
        }
        return typeof v === "number" ? v : 0;
      });
    } else {
      if (coords) {
        const idx = coords.indexOf(selectorValue);
        indices = [
          idx >= 0 ? idx : typeof selectorValue === "number" ? selectorValue : 0
        ];
      } else {
        indices = [typeof selectorValue === "number" ? selectorValue : 0];
      }
    }
    const chunkIndices = indices.map((index) => Math.floor(index / chunkSize)).filter((v, i2, a) => a.indexOf(v) === i2);
    return chunkIndices;
  });
  let result = [[]];
  chunkIndicesToUse.forEach((chunkIndices) => {
    const updatedResult = [];
    chunkIndices.forEach((chunkIndex) => {
      result.forEach((prev) => {
        updatedResult.push([...prev, chunkIndex]);
      });
    });
    result = updatedResult;
  });
  return result;
}

// src/query/region-query.ts
function findSpatialDimNames(dimensions, isProj4, dimIndices) {
  const yStoreDim = dimIndices?.lat?.name ?? findByAlias(dimensions, "lat");
  const xStoreDim = dimIndices?.lon?.name ?? findByAlias(dimensions, "lon");
  if (!isProj4) {
    return { yDim: "lat", xDim: "lon", yStoreDim, xStoreDim };
  }
  return { yDim: yStoreDim, xDim: xStoreDim, yStoreDim, xStoreDim };
}
function findByAlias(dimensions, axis) {
  const aliases = SPATIAL_DIMENSION_ALIASES[axis];
  return dimensions.find((d) => aliases.includes(d.toLowerCase())) ?? axis;
}
function isMultiValSelector(value) {
  if (Array.isArray(value)) return true;
  if (value && typeof value === "object" && "selected" in value) {
    return Array.isArray(value.selected);
  }
  return false;
}
function checkAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}
function transformValue(value, transforms) {
  if (!Number.isFinite(value)) return null;
  if (Math.abs(value) > 1e30) return null;
  if (transforms?.fillValue !== void 0 && transforms.fillValue !== null) {
    const fv = transforms.fillValue;
    if (value === fv) return null;
    if (Math.abs(value - fv) / (Math.abs(fv) || 1) < 1e-4) return null;
  }
  let result = value;
  if (transforms?.scaleFactor !== void 0 && transforms.scaleFactor !== 1) {
    result *= transforms.scaleFactor;
  }
  if (transforms?.addOffset !== void 0 && transforms.addOffset !== 0) {
    result += transforms.addOffset;
  }
  return result;
}
async function queryRegionTiled(variable, geometry, selector, zarrStore, crs, xyLimits, levelIndex, tileSize, transforms, options, wrappedBbox) {
  const { signal, includeSpatialCoordinates = true } = options ?? {};
  const desc = zarrStore.describe();
  const dimensions = desc.dimensions;
  const coordinates = desc.coordinates;
  const shape = desc.shape || [];
  const chunks = desc.chunks || [];
  const singleValuedDims = Object.keys(selector).filter(
    (k) => !isMultiValSelector(selector[k])
  ).length;
  const resultDim = dimensions.length - singleValuedDims;
  const useNestedResults = resultDim > 2;
  let results = useNestedResults ? {} : [];
  const { yDim, xDim, yStoreDim, xStoreDim } = findSpatialDimNames(
    dimensions,
    false,
    desc.dimIndices
  );
  const yCoords = [];
  const xCoords = [];
  const resultDimensions = useNestedResults ? dimensions.map(
    (d) => d === yStoreDim ? yDim : d === xStoreDim ? xDim : d
  ) : [yDim, xDim];
  const buildResultCoordinates = () => {
    const coords = {
      [yDim]: yCoords,
      [xDim]: xCoords
    };
    if (useNestedResults) {
      for (const dim of dimensions) {
        if (dim === yStoreDim || dim === xStoreDim) continue;
        const sel = selector[dim];
        let values;
        if (Array.isArray(sel)) {
          values = sel;
        } else if (sel && typeof sel === "object" && "selected" in sel) {
          const selected = sel.selected;
          values = Array.isArray(selected) ? selected : [selected];
        } else if (sel !== void 0 && typeof sel !== "object") {
          values = [sel];
        } else if (coordinates[dim]) {
          values = coordinates[dim];
        }
        if (values) {
          coords[dim] = values;
        }
      }
    }
    return coords;
  };
  const buildResult = () => ({
    [variable]: results,
    dimensions: resultDimensions,
    coordinates: buildResultCoordinates()
  });
  const levelPath = zarrStore.levels[levelIndex];
  if (!levelPath) {
    throw new Error(`No level path found for level index ${levelIndex}`);
  }
  const actualZoom = parseLevelZoom(levelPath, levelIndex);
  const tiles = wrappedBbox ? getTilesForBoundingBox(wrappedBbox, actualZoom, crs, xyLimits) : getTilesForPolygon(geometry, actualZoom, crs, xyLimits);
  if (tiles.length === 0) return buildResult();
  checkAborted(signal);
  const tileChunkData = /* @__PURE__ */ new Map();
  await Promise.all(
    tiles.map(async (tileTuple) => {
      const [, x, y] = tileTuple;
      const chunksToFetch = getChunks(
        selector,
        dimensions,
        coordinates,
        shape,
        chunks,
        x,
        y
      );
      const tileKey = tileToKey(tileTuple);
      const chunkDataMap = /* @__PURE__ */ new Map();
      await Promise.all(
        chunksToFetch.map(async (chunkIndices) => {
          try {
            const chunk = await zarrStore.getChunk(
              levelPath,
              chunkIndices,
              signal ? { signal } : void 0
            );
            const chunkData = new Float32Array(chunk.data);
            const chunkKey = chunkIndices.join(",");
            chunkDataMap.set(chunkKey, chunkData);
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              throw err;
            }
            console.warn(
              `Failed to fetch chunk ${chunkIndices} for tile ${tileKey}:`,
              err
            );
          }
        })
      );
      tileChunkData.set(tileKey, chunkDataMap);
    })
  );
  for (const tileTuple of tiles) {
    const tileKey = tileToKey(tileTuple);
    const chunkDataMap = tileChunkData.get(tileKey);
    if (!chunkDataMap || chunkDataMap.size === 0) continue;
    const tileGeometry = transformGeometryToTilePixelSpace(
      geometry,
      tileTuple,
      tileSize,
      crs,
      xyLimits
    );
    if (!tileGeometry) continue;
    const [, x, y] = tileTuple;
    const chunksForTile = getChunks(
      selector,
      dimensions,
      coordinates,
      shape,
      chunks,
      x,
      y
    );
    const processPixel = (pixelX, pixelY) => {
      const pixelValues = [];
      for (const chunkIndices of chunksForTile) {
        const chunkKey = chunkIndices.join(",");
        const chunkData = chunkDataMap.get(chunkKey);
        if (!chunkData) continue;
        const valuesToSet = getPointValues(
          chunkData,
          pixelX,
          pixelY,
          selector,
          dimensions,
          coordinates,
          shape,
          chunks,
          chunkIndices
        );
        for (const { keys, value } of valuesToSet) {
          const transformed = transformValue(value, transforms);
          if (transformed !== null) {
            pixelValues.push({ keys, value: transformed });
          }
        }
      }
      if (pixelValues.length === 0) return;
      if (includeSpatialCoordinates) {
        const geo = tilePixelToLatLon(
          tileTuple,
          pixelX + 0.5,
          pixelY + 0.5,
          tileSize,
          crs,
          xyLimits
        );
        yCoords.push(geo.lat);
        xCoords.push(geo.lon);
      }
      for (const { keys, value } of pixelValues) {
        if (keys.length > 0) {
          setObjectValues(results, keys, value);
        } else if (Array.isArray(results)) {
          results.push(value);
        }
      }
    };
    if (tileGeometry.type === "Point") {
      const px = Math.min(Math.floor(tileGeometry.coordinates[0]), tileSize - 1);
      const py = Math.min(Math.floor(tileGeometry.coordinates[1]), tileSize - 1);
      if (px >= 0 && py >= 0) {
        processPixel(px, py);
      }
      continue;
    }
    const scanlines = buildScanlineTable(tileGeometry, 0, tileSize);
    for (let pixelY = 0; pixelY < tileSize; pixelY++) {
      checkAborted(signal);
      const crossings = scanlines.get(pixelY);
      if (!crossings || crossings.length < 2) continue;
      for (let i = 0; i < crossings.length - 1; i += 2) {
        const xFrom = Math.max(0, Math.ceil(crossings[i] - 0.5));
        const xTo = Math.min(tileSize, Math.floor(crossings[i + 1] - 0.5) + 1);
        for (let pixelX = xFrom; pixelX < xTo; pixelX++) {
          processPixel(pixelX, pixelY);
        }
      }
    }
  }
  return buildResult();
}
function queryRegionUntiled(variable, geometry, selector, data, width, height, bounds, _crs, dimensions, coordinates, channels = 1, channelLabels, multiValueDimNames, latIsAscending, transforms, proj4def, sourceBounds, options, dimIndices) {
  const { signal, includeSpatialCoordinates = true } = options ?? {};
  const singleValuedDims = Object.keys(selector).filter(
    (k) => !isMultiValSelector(selector[k])
  ).length;
  const resultDim = dimensions.length - singleValuedDims;
  const useNestedResults = resultDim > 2;
  let results = useNestedResults ? {} : [];
  const { yDim, xDim, yStoreDim, xStoreDim } = findSpatialDimNames(
    dimensions,
    !!proj4def,
    dimIndices
  );
  const yCoords = [];
  const xCoords = [];
  const resultDimensions = useNestedResults ? dimensions.map(
    (d) => d === yStoreDim ? yDim : d === xStoreDim ? xDim : d
  ) : [yDim, xDim];
  const buildResultCoordinates = () => {
    const coords = {
      [yDim]: yCoords,
      [xDim]: xCoords
    };
    if (useNestedResults) {
      for (const dim of dimensions) {
        if (dim === yStoreDim || dim === xStoreDim) continue;
        const sel = selector[dim];
        let values;
        if (Array.isArray(sel)) {
          values = sel;
        } else if (sel && typeof sel === "object" && "selected" in sel) {
          const selected = sel.selected;
          values = Array.isArray(selected) ? selected : [selected];
        } else if (sel !== void 0 && typeof sel !== "object") {
          values = [sel];
        } else if (coordinates[dim]) {
          values = coordinates[dim];
        }
        if (values) {
          coords[dim] = values;
        }
      }
    }
    return coords;
  };
  const buildResult = () => ({
    [variable]: results,
    dimensions: resultDimensions,
    coordinates: buildResultCoordinates()
  });
  if (!data) return buildResult();
  checkAborted(signal);
  const cachedTransformer = proj4def ? createWGS84ToSourceTransformer(proj4def) : void 0;
  const pixelGeometry = transformGeometryToPixelSpace(
    geometry,
    bounds,
    width,
    height,
    _crs,
    latIsAscending,
    proj4def,
    sourceBounds,
    cachedTransformer
  );
  console.log(
    "[query-debug] queryRegionUntiled: width=%d height=%d proj4=%s sourceBounds=%o pixelGeometry=%o",
    width,
    height,
    !!proj4def,
    sourceBounds,
    pixelGeometry
  );
  if (!pixelGeometry) return buildResult();
  const emitCoords = proj4def && sourceBounds ? (x, y) => {
    const [srcX, srcY] = pixelToSourceCRS(
      x + 0.5,
      y + 0.5,
      sourceBounds,
      width,
      height,
      latIsAscending
    );
    yCoords.push(srcY);
    xCoords.push(srcX);
  } : (x, y) => {
    const { lat, lon } = pixelToLatLon(
      x,
      y,
      bounds,
      width,
      height,
      _crs,
      latIsAscending
    );
    yCoords.push(lat);
    xCoords.push(lon);
  };
  const processPixel = (x, y) => {
    const baseIndex = (y * width + x) * channels;
    if (channels === 1 && !useNestedResults) {
      const rawValue = data[baseIndex];
      const transformed = transformValue(rawValue, transforms);
      if (transformed === null) return;
      if (includeSpatialCoordinates) emitCoords(x, y);
      results.push(transformed);
      return;
    }
    let hasValid = false;
    for (let c = 0; c < channels; c++) {
      const rawValue = data[baseIndex + c];
      const transformed = transformValue(rawValue, transforms);
      if (transformed === null) continue;
      if (!hasValid) {
        if (includeSpatialCoordinates) emitCoords(x, y);
        hasValid = true;
      }
      if (useNestedResults && multiValueDimNames) {
        const labels = channelLabels?.[c];
        const keys = labels && labels.length === multiValueDimNames.length ? labels : [c];
        setObjectValues(results, keys, transformed);
      } else if (Array.isArray(results)) {
        results.push(transformed);
      }
    }
  };
  if (pixelGeometry.type === "Point") {
    const px = Math.min(Math.floor(pixelGeometry.coordinates[0]), width - 1);
    const py = Math.min(Math.floor(pixelGeometry.coordinates[1]), height - 1);
    if (px >= 0 && py >= 0) {
      processPixel(px, py);
    }
    return buildResult();
  }
  let pxMinX = Infinity;
  let pxMaxX = -Infinity;
  let pxMinY = Infinity;
  let pxMaxY = -Infinity;
  const scanRings = (rings) => {
    for (const ring of rings) {
      for (const [px, py] of ring) {
        if (px < pxMinX) pxMinX = px;
        if (px > pxMaxX) pxMaxX = px;
        if (py < pxMinY) pxMinY = py;
        if (py > pxMaxY) pxMaxY = py;
      }
    }
  };
  if (pixelGeometry.type === "Polygon") {
    scanRings(pixelGeometry.coordinates);
  } else {
    for (const poly of pixelGeometry.coordinates) scanRings(poly);
  }
  const xStart = Math.max(0, Math.floor(pxMinX));
  const xEnd = Math.min(width, Math.ceil(pxMaxX));
  const yStart = Math.max(0, Math.floor(pxMinY));
  const yEnd = Math.min(height, Math.ceil(pxMaxY));
  if (xEnd <= xStart || yEnd <= yStart) return buildResult();
  const scanlines = buildScanlineTable(pixelGeometry, yStart, yEnd);
  for (let y = yStart; y < yEnd; y++) {
    checkAborted(signal);
    const crossings = scanlines.get(y);
    if (!crossings || crossings.length < 2) continue;
    for (let i = 0; i < crossings.length - 1; i += 2) {
      const xFrom = Math.max(xStart, Math.ceil(crossings[i] - 0.5));
      const xTo = Math.min(xEnd, Math.floor(crossings[i + 1] - 0.5) + 1);
      for (let x = xFrom; x < xTo; x++) {
        processPixel(x, y);
      }
    }
  }
  return buildResult();
}

// src/mode-utils.ts
function createRequestCanceller() {
  return {
    controllers: /* @__PURE__ */ new Map(),
    currentVersion: 0
  };
}
function cancelOlderRequests(canceller, completedVersion) {
  for (const [version, controller] of canceller.controllers) {
    if (version < completedVersion) {
      controller.abort();
      canceller.controllers.delete(version);
    }
  }
}
function cancelAllRequests(canceller) {
  for (const controller of canceller.controllers.values()) {
    controller.abort();
  }
  canceller.controllers.clear();
}
function hasActiveRequests(canceller) {
  for (const controller of canceller.controllers.values()) {
    if (!controller.signal.aborted) {
      return true;
    }
  }
  return false;
}
function createLoadingManager() {
  return {
    callback: void 0,
    metadataLoading: false,
    chunksLoading: false
  };
}
function setLoadingCallback(manager, callback) {
  manager.callback = callback;
}
function emitLoadingState(manager) {
  if (!manager.callback) return;
  const state = {
    loading: manager.metadataLoading || manager.chunksLoading,
    metadata: manager.metadataLoading,
    chunks: manager.chunksLoading,
    error: null
  };
  manager.callback(state);
}
function createChunkLoadingDebouncer(manager, showDelayMs = 80) {
  let showTimer = null;
  return {
    show() {
      if (manager.chunksLoading) return;
      if (showTimer) return;
      showTimer = setTimeout(() => {
        showTimer = null;
        if (!manager.chunksLoading) {
          manager.chunksLoading = true;
          emitLoadingState(manager);
        }
      }, showDelayMs);
    },
    hide() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      if (manager.chunksLoading) {
        manager.chunksLoading = false;
        emitLoadingState(manager);
      }
    }
  };
}

// src/tiles.ts
var Tiles = class {
  constructor({
    store,
    selector,
    fillValue,
    dimIndices,
    coordinates,
    maxCachedTiles = 64,
    bandNames = [],
    fixedDataScale = 1
  }) {
    this.tiles = /* @__PURE__ */ new Map();
    this.gl = null;
    this.store = store;
    this.selector = selector;
    this.fillValue = fillValue;
    this.dimIndices = dimIndices;
    this.coordinates = coordinates;
    this.maxCachedTiles = maxCachedTiles;
    this.bandNames = bandNames;
    this.fixedDataScale = fixedDataScale;
  }
  /**
   * Initialize WebGL resources. Must be called before rendering.
   */
  setGL(gl) {
    this.gl = gl;
  }
  updateBandNames(bandNames) {
    this.bandNames = bandNames;
  }
  updateSelector(selector) {
    this.selector = selector;
  }
  getDimKeyForName(dimName) {
    const lower = dimName.toLowerCase();
    if (["lat", "latitude", "y"].includes(lower)) return "lat";
    if (["lon", "longitude", "x", "lng"].includes(lower)) return "lon";
    if (["time", "t", "time_counter"].includes(lower)) return "time";
    if (["depth", "z", "level", "lev", "elevation"].includes(lower))
      return "elevation";
    return dimName;
  }
  normalizeSelection(dimSelection, dimName) {
    if (dimSelection === void 0) return [0];
    const coords = dimName ? this.coordinates[dimName] : void 0;
    const toIndices = (value) => {
      const isSpec = typeof value === "object" && value !== null && !Array.isArray(value) && "selected" in value;
      const selected = isSpec ? value.selected : value;
      const mode = isSpec && value.type ? value.type : "value";
      if (mode !== "index" && coords && (typeof selected === "number" || typeof selected === "string")) {
        const idx = coords.indexOf(selected);
        if (idx >= 0) return idx;
      }
      return typeof selected === "number" ? selected : 0;
    };
    if (typeof dimSelection === "object" && dimSelection !== null && !Array.isArray(dimSelection) && "selected" in dimSelection) {
      const values = Array.isArray(dimSelection.selected) ? dimSelection.selected : [dimSelection.selected];
      return values.map(
        (v) => toIndices({ selected: v, type: dimSelection.type })
      );
    }
    if (Array.isArray(dimSelection)) {
      return dimSelection.map((v) => toIndices(v));
    }
    return [toIndices(dimSelection)];
  }
  /**
   * Compute which chunk indices to fetch for a given tile.
   */
  computeChunkIndices(levelArray, tileTuple) {
    const [_, x, y] = tileTuple;
    const dimensions = this.store.dimensions || [];
    const chunks = levelArray.chunks;
    const chunkIndices = new Array(dimensions.length).fill(0);
    for (let i = 0; i < dimensions.length; i++) {
      const dimName = dimensions[i];
      const dimKey = this.getDimKeyForName(dimName);
      if (dimKey === "lon") {
        chunkIndices[i] = x;
      } else if (dimKey === "lat") {
        chunkIndices[i] = y;
      } else {
        const dimSelection = resolveSelectorValue(
          this.selector,
          dimKey,
          dimName,
          this.dimIndices
        );
        const selectionValues = this.normalizeSelection(dimSelection, dimName);
        const normalized = selectionValues.map(
          (v) => Math.max(0, Math.min(v, levelArray.shape[i] - 1))
        );
        const chunkIdx = Math.floor(normalized[0] / chunks[i]);
        const spansMultipleChunks = normalized.some(
          (v) => Math.floor(v / chunks[i]) !== chunkIdx
        );
        if (spansMultipleChunks) {
          console.warn(
            `Selector for dimension '${dimName}' spans multiple chunks \u2013 using chunk index ${chunkIdx} for tile ${tileTuple.join(
              ","
            )}`
          );
        }
        const maxChunkIdx = Math.max(
          0,
          Math.ceil(levelArray.shape[i] / chunks[i]) - 1
        );
        chunkIndices[i] = Math.min(chunkIdx, maxChunkIdx);
      }
    }
    return chunkIndices;
  }
  /**
   * Extract a 2D slice (+ optional extra channels) from a loaded chunk.
   * Returns band-separate format only; interleaving is done later if needed.
   */
  extractSliceFromChunk(chunkData, chunkShape, levelArray, chunkIndices) {
    const tileWidth = this.store.tileSize;
    const tileHeight = this.store.tileSize;
    let channels = 1;
    const dimensions = this.store.dimensions || [];
    const chunkSizes = levelArray.chunks;
    const selectorIndices = [];
    let latDimIdx = -1;
    let lonDimIdx = -1;
    let latSize = tileHeight;
    let lonSize = tileWidth;
    const selectionSets = [];
    const varyingDims = [];
    for (let i = 0; i < dimensions.length; i++) {
      const dimName = dimensions[i];
      const dimKey = this.getDimKeyForName(dimName);
      if (dimKey === "lat") {
        latDimIdx = i;
        latSize = Math.min(chunkShape[i], tileHeight);
        selectorIndices.push(-1);
      } else if (dimKey === "lon") {
        lonDimIdx = i;
        lonSize = Math.min(chunkShape[i], tileWidth);
        selectorIndices.push(-1);
      } else {
        const dimSelection = resolveSelectorValue(
          this.selector,
          dimKey,
          dimName,
          this.dimIndices
        );
        const selectedValues = this.normalizeSelection(dimSelection, dimName);
        const chunkOffset = chunkIndices[i] * chunkSizes[i];
        const withinChunk = selectedValues.map((v) => {
          const adjusted = Math.max(
            0,
            Math.min(v - chunkOffset, chunkShape[i] - 1)
          );
          return adjusted;
        });
        selectionSets[i] = withinChunk;
        selectorIndices.push(withinChunk[0]);
        if (withinChunk.length > 1) {
          varyingDims.push(i);
        }
      }
    }
    const getChunkIndex = (indices) => {
      let idx = 0;
      let stride = 1;
      for (let i = indices.length - 1; i >= 0; i--) {
        idx += indices[i] * stride;
        stride *= chunkShape[i];
      }
      return idx;
    };
    let channelSelections = [[]];
    varyingDims.forEach((dimIdx) => {
      const choices = selectionSets[dimIdx];
      const next = [];
      channelSelections.forEach((combo) => {
        choices.forEach((choice) => {
          next.push([...combo, choice]);
        });
      });
      channelSelections = next;
    });
    channels = channelSelections.length || 1;
    const bandData = /* @__PURE__ */ new Map();
    const bandArrays = [];
    for (let c = 0; c < channels; c++) {
      const arr = new Float32Array(tileWidth * tileHeight);
      arr.fill(this.fillValue);
      bandArrays.push(arr);
    }
    for (let latIdx = 0; latIdx < latSize; latIdx++) {
      for (let lonIdx = 0; lonIdx < lonSize; lonIdx++) {
        if (latDimIdx >= 0) selectorIndices[latDimIdx] = latIdx;
        if (lonDimIdx >= 0) selectorIndices[lonDimIdx] = lonIdx;
        channelSelections.forEach((selectionCombo, channelIdx) => {
          const indices = [...selectorIndices];
          let comboIdx = 0;
          for (let i = 0; i < varyingDims.length; i++) {
            indices[varyingDims[i]] = selectionCombo[comboIdx++];
          }
          const srcIdx = getChunkIndex(indices);
          const dstIdx = latIdx * tileWidth + lonIdx;
          if (srcIdx < chunkData.length) {
            bandArrays[channelIdx][dstIdx] = chunkData[srcIdx];
          }
        });
      }
    }
    for (let c = 0; c < channels; c++) {
      const bandName = this.bandNames[c] || `band_${c}`;
      bandData.set(bandName, bandArrays[c]);
    }
    return { channels, bandData };
  }
  /**
   * Apply normalization to tile data and upload texture.
   */
  applyNormalization(tile, sliced) {
    const bandDataToProcess = sliced.bandData;
    tile.bandData = /* @__PURE__ */ new Map();
    tile.bandTexturesUploaded.clear();
    const normalizedBands = [];
    for (const [bandName, bandData] of bandDataToProcess) {
      const { normalized } = normalizeDataForTexture(
        bandData,
        this.fillValue,
        this.fixedDataScale
      );
      tile.bandData.set(bandName, normalized);
      normalizedBands.push(normalized);
    }
    tile.data = interleaveBands(normalizedBands, sliced.channels);
    tile.channels = sliced.channels;
    if (this.gl && tile.tileTexture) {
      this.uploadTileTexture(tile);
    }
  }
  /**
   * Upload tile data to its texture.
   */
  uploadTileTexture(tile) {
    if (!this.gl || !tile.tileTexture || !tile.data) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tile.tileTexture);
    if (!tile.textureConfigured) {
      configureDataTexture(gl);
      tile.textureConfigured = true;
    }
    const { format, internalFormat } = getTextureFormats(gl, tile.channels);
    const tileSize = this.store.tileSize;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      tileSize,
      tileSize,
      0,
      format,
      gl.FLOAT,
      tile.data
    );
    tile.textureUploaded = true;
  }
  /**
   * Get or create a tile entry, using Map's insertion order for LRU tracking.
   * O(1) for both access and eviction.
   */
  getOrCreateTile(tileKey) {
    let tile = this.tiles.get(tileKey);
    if (tile) {
      this.tiles.delete(tileKey);
      this.tiles.set(tileKey, tile);
      return tile;
    }
    tile = {
      data: null,
      bandData: /* @__PURE__ */ new Map(),
      channels: 1,
      selectorHash: null,
      selectorVersion: 0,
      loading: false,
      latBounds: null,
      geoBounds: null,
      mercatorBounds: null,
      tileTexture: this.gl ? mustCreateTexture(this.gl) : null,
      bandTextures: /* @__PURE__ */ new Map(),
      bandTexturesUploaded: /* @__PURE__ */ new Set(),
      bandTexturesConfigured: /* @__PURE__ */ new Set(),
      textureUploaded: false,
      textureConfigured: false,
      vertexBuffer: this.gl ? mustCreateBuffer(this.gl) : null,
      pixCoordBuffer: this.gl ? mustCreateBuffer(this.gl) : null,
      geometryUploaded: false
    };
    this.tiles.set(tileKey, tile);
    this.evictOldTiles();
    return tile;
  }
  /**
   * Evict oldest tiles when cache exceeds limit.
   * Uses Map iteration order (oldest first).
   */
  evictOldTiles() {
    while (this.tiles.size > this.maxCachedTiles) {
      const oldestKey = this.tiles.keys().next().value;
      if (!oldestKey) break;
      const tile = this.tiles.get(oldestKey);
      if (tile && this.gl) {
        if (tile.tileTexture) this.gl.deleteTexture(tile.tileTexture);
        for (const tex of tile.bandTextures.values()) {
          this.gl.deleteTexture(tex);
        }
        if (tile.vertexBuffer) this.gl.deleteBuffer(tile.vertexBuffer);
        if (tile.pixCoordBuffer) this.gl.deleteBuffer(tile.pixCoordBuffer);
      }
      this.tiles.delete(oldestKey);
    }
  }
  /**
   * Get a tile from the cache. Returns undefined if not found.
   */
  get(tileKey) {
    const tile = this.tiles.get(tileKey);
    if (tile) {
      this.tiles.delete(tileKey);
      this.tiles.set(tileKey, tile);
    }
    return tile;
  }
  /**
   * Get or create a tile entry. Creates WebGL resources if not present.
   */
  upsert(tileKey) {
    return this.getOrCreateTile(tileKey);
  }
  /**
   * Ensure a band texture exists for a tile.
   */
  ensureBandTexture(tileKey, bandName) {
    const tile = this.tiles.get(tileKey);
    if (!tile || !this.gl) return null;
    let tex = tile.bandTextures.get(bandName);
    if (!tex) {
      tex = mustCreateTexture(this.gl);
      tile.bandTextures.set(bandName, tex);
    }
    return tex;
  }
  getTile(tileTuple) {
    return this.tiles.get(tileToKey(tileTuple));
  }
  /**
   * Set bounds for a tile (used for fragment shader reprojection in EPSG:4326 mode).
   */
  setTileBounds(tileKey, bounds) {
    const tile = this.tiles.get(tileKey);
    if (!tile) return;
    const latBounds = { min: bounds.latMin, max: bounds.latMax };
    const geoBounds = {
      west: bounds.lonMin,
      south: bounds.latMin,
      east: bounds.lonMax,
      north: bounds.latMax
    };
    const mercatorBounds = {
      x0: bounds.x0,
      y0: bounds.y0,
      x1: bounds.x1,
      y1: bounds.y1
    };
    const boundsChanged = tile.latBounds?.min !== latBounds.min || tile.latBounds?.max !== latBounds.max || tile.geoBounds?.west !== geoBounds.west || tile.geoBounds?.east !== geoBounds.east || tile.mercatorBounds?.x0 !== mercatorBounds.x0 || tile.mercatorBounds?.x1 !== mercatorBounds.x1 || tile.mercatorBounds?.y0 !== mercatorBounds.y0 || tile.mercatorBounds?.y1 !== mercatorBounds.y1;
    if (boundsChanged) {
      tile.latBounds = latBounds;
      tile.geoBounds = geoBounds;
      tile.mercatorBounds = mercatorBounds;
    }
  }
  /**
   * Mark visible tiles stale after a selector change. `updateTiles` picks
   * them up and refetches via `store.getChunk` — the decoded-chunk cache
   * makes same-chunk scrubs effectively free; the caller's loading-state
   * debounce keeps the spinner from flashing on those quick refetches.
   */
  invalidateSelector(visibleTiles, version) {
    for (const tileTuple of visibleTiles) {
      const tile = this.tiles.get(tileToKey(tileTuple));
      if (!tile) continue;
      tile.selectorHash = null;
      tile.selectorVersion = version;
    }
  }
  async fetchTile(tileTuple, selectorHash, version, signal, bounds) {
    const [z] = tileTuple;
    const levelPath = this.store.levels[z];
    if (!levelPath) return null;
    const levelArray = await this.store.getLevelArray(levelPath);
    const tileKey = tileToKey(tileTuple);
    const tile = this.getOrCreateTile(tileKey);
    if (bounds) {
      tile.latBounds = { min: bounds.latMin, max: bounds.latMax };
      tile.geoBounds = {
        west: bounds.lonMin,
        south: bounds.latMin,
        east: bounds.lonMax,
        north: bounds.latMax
      };
      tile.mercatorBounds = {
        x0: bounds.x0,
        y0: bounds.y0,
        x1: bounds.x1,
        y1: bounds.y1
      };
    }
    if (tile.data && tile.selectorHash === selectorHash) {
      return tile;
    }
    if (tile.loading) return null;
    tile.loading = true;
    try {
      const chunkIndices = this.computeChunkIndices(levelArray, tileTuple);
      const chunk = await this.store.getChunk(levelPath, chunkIndices, {
        signal
      });
      const chunkShape = chunk.shape.map((n) => Number(n));
      const chunkData = chunk.data instanceof Float32Array ? chunk.data : Float32Array.from(chunk.data);
      if (version < tile.selectorVersion) {
        tile.loading = false;
        return null;
      }
      const sliced = this.extractSliceFromChunk(
        chunkData,
        chunkShape,
        levelArray,
        chunkIndices
      );
      this.applyNormalization(tile, sliced);
      tile.selectorHash = selectorHash;
      tile.selectorVersion = version;
      tile.loading = false;
      return tile;
    } catch (err) {
      tile.loading = false;
      if (err instanceof DOMException && err.name === "AbortError") {
        return null;
      }
      throw err;
    }
  }
  /**
   * Mark all tile geometry as needing re-upload (e.g., after subdivision change).
   */
  markGeometryDirty() {
    for (const tile of this.tiles.values()) {
      tile.geometryUploaded = false;
    }
  }
  /**
   * Clear all tiles and release WebGL resources.
   */
  clear() {
    if (this.gl) {
      for (const tile of this.tiles.values()) {
        if (tile.tileTexture) this.gl.deleteTexture(tile.tileTexture);
        for (const tex of tile.bandTextures.values()) {
          this.gl.deleteTexture(tex);
        }
        if (tile.vertexBuffer) this.gl.deleteBuffer(tile.vertexBuffer);
        if (tile.pixCoordBuffer) this.gl.deleteBuffer(tile.pixCoordBuffer);
      }
    }
    this.tiles.clear();
  }
};

// src/mapbox-tile-renderer.ts
function getTileMercatorBounds(z, x, y, tileBoundsMap, xyLimits) {
  const tileKey = tileToKey([z, x, y]);
  const precomputed = tileBoundsMap?.[tileKey];
  if (precomputed) return precomputed;
  const geoBounds = get4326TileGeoBounds(z, x, y, xyLimits);
  return {
    x0: lonToMercatorNorm(geoBounds.west),
    x1: lonToMercatorNorm(geoBounds.east),
    y0: latToMercatorNorm(geoBounds.north),
    y1: latToMercatorNorm(geoBounds.south),
    latMin: geoBounds.south,
    latMax: geoBounds.north,
    lonMin: geoBounds.west,
    lonMax: geoBounds.east
  };
}
function computeTileBoundsAndTexCoords(zarrBounds, mapboxTileBounds) {
  const overlapX0 = Math.max(zarrBounds.x0, mapboxTileBounds.x0);
  const overlapX1 = Math.min(zarrBounds.x1, mapboxTileBounds.x1);
  const overlapY0 = Math.max(zarrBounds.y0, mapboxTileBounds.y0);
  const overlapY1 = Math.min(zarrBounds.y1, mapboxTileBounds.y1);
  if (overlapX1 <= overlapX0 || overlapY1 <= overlapY0) {
    return null;
  }
  const lonMin = zarrBounds.lonMin ?? mercatorNormToLon(zarrBounds.x0);
  const lonMax = zarrBounds.lonMax ?? mercatorNormToLon(zarrBounds.x1);
  const latMin = zarrBounds.latMin ?? mercatorNormToLat(zarrBounds.y1);
  const latMax = zarrBounds.latMax ?? mercatorNormToLat(zarrBounds.y0);
  const lonWidth = lonMax - lonMin;
  const overlapWest = mercatorNormToLon(overlapX0);
  const overlapEast = mercatorNormToLon(overlapX1);
  const texScaleX = lonWidth > 0 ? (overlapEast - overlapWest) / lonWidth : 1;
  const texOffsetX = lonWidth > 0 ? (overlapWest - lonMin) / lonWidth : 0;
  const texScaleY = 1;
  const texOffsetY = 0;
  return {
    overlap: { x0: overlapX0, y0: overlapY0, x1: overlapX1, y1: overlapY1 },
    latBounds: { min: latMin, max: latMax },
    texScale: [texScaleX, texScaleY],
    texOffset: [texOffsetX, texOffsetY]
  };
}
function renderMapboxTile({
  renderer,
  mode,
  tileId,
  context,
  regions
}) {
  if (regions) {
    return renderRegionsToTile(renderer, tileId, context, regions);
  }
  return renderTiledToTile(renderer, mode, tileId, context);
}
function renderRegionsToTile(renderer, tileId, context, regions) {
  if (regions.length === 0) return true;
  const tileBounds = getMapboxTileBounds(tileId);
  const tileMatrix = createMapboxTileMatrix(
    tileBounds.x0,
    tileBounds.y0,
    tileBounds.x1,
    tileBounds.y1
  );
  const { colormapTexture, uniforms, customShaderConfig } = context;
  const isGlobe = context.isGlobe ?? true;
  const useWgs84 = regions.some((r) => !!r.wgs84Bounds);
  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true,
    // useMapbox - always true for Mapbox tile rendering
    useWgs84
  );
  renderer.gl.useProgram(shaderProgram.program);
  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: isGlobe ? "globe" : "mercator" },
      globeToMercatorMatrix: MAPBOX_IDENTITY_MATRIX,
      transition: isGlobe ? 0 : 1
      // 0 = globe, 1 = mercator (blended)
    },
    tileMatrix,
    true
    // useMapbox
  );
  setupBandTextureUniforms(renderer.gl, shaderProgram, customShaderConfig);
  let needsMoreData = false;
  for (const region of regions) {
    if (!boundsIntersect(region.mercatorBounds, tileBounds)) continue;
    const useIndexedMesh = !!region.useIndexedMesh && !!region.indexBuffer;
    const renderable = {
      mercatorBounds: region.mercatorBounds,
      vertexBuffer: region.vertexBuffer,
      pixCoordBuffer: region.pixCoordBuffer,
      vertexCount: useIndexedMesh ? region.vertexCount ?? region.vertexArr.length / 2 : region.vertexArr.length / 2,
      texture: region.texture,
      bandData: region.bandData ?? /* @__PURE__ */ new Map(),
      bandTextures: region.bandTextures ?? /* @__PURE__ */ new Map(),
      bandTexturesUploaded: region.bandTexturesUploaded ?? /* @__PURE__ */ new Set(),
      bandTexturesConfigured: region.bandTexturesConfigured ?? /* @__PURE__ */ new Set(),
      width: region.width,
      height: region.height,
      // Include indexed mesh fields for proj4 datasets
      indexBuffer: useIndexedMesh ? region.indexBuffer : void 0,
      useIndexedMesh,
      // Include wgs84Bounds for both proj4 and EPSG:4326 datasets
      wgs84Bounds: region.wgs84Bounds,
      latIsAscending: region.latIsAscending
    };
    const rendered = renderRegion(
      renderer.gl,
      shaderProgram,
      renderable,
      [0],
      // Globe tiles don't need world wrapping
      customShaderConfig
    );
    if (!rendered) {
      needsMoreData = true;
    }
  }
  return needsMoreData;
}
function renderTiledToTile(renderer, mode, tileId, context) {
  const tiledState = mode.getTiledState?.();
  if (!tiledState?.tileCache) {
    return true;
  }
  const crs = mode.getCRS();
  if (crs === "EPSG:4326") {
    return render4326TiledToTile(renderer, mode, tileId, context, tiledState);
  }
  return render3857TiledToTile(renderer, mode, tileId, context, tiledState);
}
function render4326TiledToTile(renderer, mode, tileId, context, tiledState) {
  const { customShaderConfig } = context;
  const { visibleTiles, tileBounds: zarrTileBounds } = tiledState;
  const xyLimits = mode.getXYLimits();
  const maxLevelIndex = mode.getMaxLevelIndex();
  const levels = mode.getLevels();
  if (!xyLimits || visibleTiles.length === 0) return true;
  const mapboxTileBounds = getMapboxTileBounds(tileId);
  const tileMatrix = createMapboxTileMatrix(
    mapboxTileBounds.x0,
    mapboxTileBounds.y0,
    mapboxTileBounds.x1,
    mapboxTileBounds.y1
  );
  const overlappingZarrTiles = [];
  for (const zarrTile of visibleTiles) {
    const zarrKey = tileToKey(zarrTile);
    const zarrBounds = zarrTileBounds?.[zarrKey];
    if (!zarrBounds) continue;
    if (zarrBounds.x0 < mapboxTileBounds.x1 && zarrBounds.x1 > mapboxTileBounds.x0 && zarrBounds.y0 < mapboxTileBounds.y1 && zarrBounds.y1 > mapboxTileBounds.y0) {
      overlappingZarrTiles.push(zarrTile);
    }
  }
  if (overlappingZarrTiles.length === 0) {
    return false;
  }
  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true,
    // useMapbox
    false
    // useWgs84 - fragment shader reprojection for EPSG:4326
  );
  renderer.gl.useProgram(shaderProgram.program);
  const maxZoomLevelPath = levels[maxLevelIndex] ?? "";
  const datasetMaxZoom = parseLevelZoom(maxZoomLevelPath, maxLevelIndex);
  let anyTileRendered = false;
  let anyMissing = false;
  for (const zarrTile of overlappingZarrTiles) {
    const result = renderSingle4326Tile(
      renderer,
      shaderProgram,
      zarrTile,
      mapboxTileBounds,
      tileMatrix,
      tiledState,
      context,
      xyLimits,
      datasetMaxZoom
    );
    if (result.rendered) anyTileRendered = true;
    if (result.missing) anyMissing = true;
  }
  return anyMissing || !anyTileRendered;
}
function renderSingle4326Tile(renderer, shaderProgram, zarrTile, mapboxTileBounds, tileMatrix, tiledState, context, xyLimits, datasetMaxZoom) {
  const {
    tileCache,
    vertexArr,
    pixCoordArr,
    tileSize,
    tileBounds: zarrTileBoundsMap
  } = tiledState;
  const { colormapTexture, uniforms, customShaderConfig } = context;
  const zarrTileKey = tileToKey(zarrTile);
  let tileData = tileCache.get(zarrTileKey);
  let renderTileTuple = zarrTile;
  let missing = false;
  if (!tileData?.data) {
    missing = true;
    const parent = findBestParentTile(
      tileCache,
      zarrTile[0],
      zarrTile[1],
      zarrTile[2]
    );
    if (parent) {
      tileData = parent.tile;
      renderTileTuple = [parent.ancestorZ, parent.ancestorX, parent.ancestorY];
    } else {
      const children = findBestChildTiles(
        tileCache,
        zarrTile[0],
        zarrTile[1],
        zarrTile[2],
        datasetMaxZoom
      );
      if (children && children.length > 0) {
        let anyChildRendered = false;
        for (const child of children) {
          if (!child.tile.data) continue;
          const rendered = renderChild4326Tile(
            renderer,
            shaderProgram,
            child,
            mapboxTileBounds,
            tileMatrix,
            tiledState,
            context,
            xyLimits
          );
          if (rendered) anyChildRendered = true;
        }
        return { rendered: anyChildRendered, missing: true };
      }
      return { rendered: false, missing: true };
    }
  }
  const [z, tx, ty] = renderTileTuple;
  const renderTileKey = tileToKey(renderTileTuple);
  const zarrBounds = getTileMercatorBounds(
    z,
    tx,
    ty,
    zarrTileBoundsMap,
    xyLimits
  );
  const boundsAndTex = computeTileBoundsAndTexCoords(
    zarrBounds,
    mapboxTileBounds
  );
  if (!boundsAndTex) {
    return { rendered: false, missing };
  }
  const { overlap, latBounds, texScale, texOffset } = boundsAndTex;
  const tileBoundsForRender = {
    [renderTileKey]: {
      x0: overlap.x0,
      y0: overlap.y0,
      x1: overlap.x1,
      y1: overlap.y1,
      latMin: latBounds.min,
      latMax: latBounds.max
    }
  };
  const isGlobe = context.isGlobe ?? true;
  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: isGlobe ? "globe" : "mercator" },
      globeToMercatorMatrix: MAPBOX_IDENTITY_MATRIX,
      transition: isGlobe ? 0 : 1
    },
    tileMatrix,
    true
  );
  renderer.renderTiles(
    shaderProgram,
    [renderTileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    tileBoundsForRender,
    customShaderConfig,
    true,
    void 0,
    {
      [renderTileKey]: {
        texScale,
        texOffset
      }
    },
    tiledState.latIsAscending
  );
  return { rendered: true, missing };
}
function renderChild4326Tile(renderer, shaderProgram, child, mapboxTileBounds, tileMatrix, tiledState, context, xyLimits) {
  const {
    tileCache,
    vertexArr,
    pixCoordArr,
    tileSize,
    tileBounds: zarrTileBoundsMap
  } = tiledState;
  const { colormapTexture, uniforms, customShaderConfig } = context;
  const childTileTuple = [child.childZ, child.childX, child.childY];
  const childTileKey = tileToKey(childTileTuple);
  const childBounds = getTileMercatorBounds(
    child.childZ,
    child.childX,
    child.childY,
    zarrTileBoundsMap,
    xyLimits
  );
  const boundsAndTex = computeTileBoundsAndTexCoords(
    childBounds,
    mapboxTileBounds
  );
  if (!boundsAndTex) {
    return false;
  }
  const { overlap, latBounds, texScale, texOffset } = boundsAndTex;
  const childTileBoundsForRender = {
    [childTileKey]: {
      x0: overlap.x0,
      y0: overlap.y0,
      x1: overlap.x1,
      y1: overlap.y1,
      latMin: latBounds.min,
      latMax: latBounds.max
    }
  };
  const isGlobe = context.isGlobe ?? true;
  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: isGlobe ? "globe" : "mercator" },
      globeToMercatorMatrix: MAPBOX_IDENTITY_MATRIX,
      transition: isGlobe ? 0 : 1
    },
    tileMatrix,
    true
  );
  renderer.renderTiles(
    shaderProgram,
    [childTileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    childTileBoundsForRender,
    customShaderConfig,
    true,
    void 0,
    {
      [childTileKey]: {
        texScale,
        texOffset
      }
    },
    tiledState.latIsAscending
  );
  return true;
}
function render3857TiledToTile(renderer, mode, tileId, context, tiledState) {
  const { tileCache, vertexArr, pixCoordArr, tileSize, tileBounds } = tiledState;
  const { colormapTexture, uniforms, customShaderConfig } = context;
  const levels = mode.getLevels();
  const maxLevelIndex = mode.getMaxLevelIndex();
  const mapboxTileBounds = getMapboxTileBounds(tileId);
  const tileMatrix = createMapboxTileMatrix(
    mapboxTileBounds.x0,
    mapboxTileBounds.y0,
    mapboxTileBounds.x1,
    mapboxTileBounds.y1
  );
  const tileTuple = [tileId.z, tileId.x, tileId.y];
  const tileKey = tileTuple.join(",");
  const boundsForTile = tileBounds?.[tileKey];
  const tileBoundsOverride = {
    [tileKey]: {
      x0: mapboxTileBounds.x0,
      y0: mapboxTileBounds.y0,
      x1: mapboxTileBounds.x1,
      y1: mapboxTileBounds.y1,
      latMin: boundsForTile?.latMin,
      latMax: boundsForTile?.latMax
    }
  };
  const maxZoomLevelPath = levels[maxLevelIndex] ?? "";
  const datasetMaxZoom = parseLevelZoom(maxZoomLevelPath, maxLevelIndex);
  const shaderProgram = renderer.getProgram(
    context.shaderData,
    customShaderConfig,
    true
  );
  renderer.gl.useProgram(shaderProgram.program);
  const isGlobe = context.isGlobe ?? true;
  renderer.applyCommonUniforms(
    shaderProgram,
    colormapTexture,
    uniforms,
    customShaderConfig,
    context.projectionData,
    {
      projection: { name: isGlobe ? "globe" : "mercator" },
      globeToMercatorMatrix: MAPBOX_IDENTITY_MATRIX,
      transition: isGlobe ? 0 : 1
    },
    tileMatrix,
    true
  );
  renderer.renderTiles(
    shaderProgram,
    [tileTuple],
    [0],
    tileCache,
    tileSize,
    vertexArr,
    pixCoordArr,
    tileBoundsOverride,
    customShaderConfig,
    true,
    datasetMaxZoom
  );
  const tileHasData = tileCache.get(tileKey)?.data;
  return !tileHasData;
}

// src/tiled-mode.ts
function toFullBounds(bounds) {
  if (!bounds || bounds.latMin === void 0 || bounds.latMax === void 0 || bounds.lonMin === void 0 || bounds.lonMax === void 0) {
    return void 0;
  }
  return {
    latMin: bounds.latMin,
    latMax: bounds.latMax,
    lonMin: bounds.lonMin,
    lonMax: bounds.lonMax,
    x0: bounds.x0,
    y0: bounds.y0,
    x1: bounds.x1,
    y1: bounds.y1
  };
}
var TiledMode = class {
  constructor(store, variable, selector, invalidate, fixedDataScale = 1) {
    this.isMultiscale = true;
    this.tileCache = null;
    this.vertexArr = new Float32Array();
    this.pixCoordArr = new Float32Array();
    this.currentSubdivisions = 0;
    this.maxLevelIndex = 0;
    this.tileSize = DEFAULT_TILE_SIZE;
    this.visibleTiles = [];
    this.crs = "EPSG:4326";
    this.xyLimits = null;
    this.tileBounds = {};
    this.pendingChunks = /* @__PURE__ */ new Set();
    this.currentLevel = null;
    this.selectorVersion = 0;
    this._antimeridianWarnings = /* @__PURE__ */ new Set();
    // Shared state managers
    this.requestCanceller = createRequestCanceller();
    this.loadingManager = createLoadingManager();
    this.loadingDebouncer = createChunkLoadingDebouncer(
      this.loadingManager
    );
    this.zarrStore = store;
    this.variable = variable;
    this.selector = selector;
    this.invalidate = invalidate;
    this.fixedDataScale = fixedDataScale;
  }
  async initialize() {
    this.loadingManager.metadataLoading = true;
    this.emitLoadingState();
    try {
      const desc = this.zarrStore.describe();
      this.maxLevelIndex = desc.levels.length - 1;
      this.tileSize = desc.tileSize || DEFAULT_TILE_SIZE;
      this.crs = desc.crs;
      this.xyLimits = desc.xyLimits;
      const bandNames = getBands(this.variable, this.selector);
      this.tileCache = new Tiles({
        store: this.zarrStore,
        selector: this.selector,
        fillValue: desc.fill_value ?? 0,
        dimIndices: desc.dimIndices,
        coordinates: desc.coordinates,
        maxCachedTiles: MAX_CACHED_TILES,
        bandNames,
        crs: this.crs,
        fixedDataScale: this.fixedDataScale
      });
      this.updateGeometryForProjection(false);
    } finally {
      this.loadingManager.metadataLoading = false;
      this.emitLoadingState();
    }
  }
  update(map, gl) {
    if (!this.tileCache) {
      return;
    }
    this.tileCache.setGL(gl);
    const projection = map.getProjection ? map.getProjection() : null;
    const isGlobe = isGlobeProjection(projection);
    this.updateGeometryForProjection(isGlobe);
    const visibleInfo = this.getVisibleTilesWithContext(map);
    this.visibleTiles = visibleInfo.tiles;
    this.tileBounds = this.computeTileBounds(this.visibleTiles);
    if (visibleInfo.pyramidLevel !== null) {
      this.currentLevel = visibleInfo.pyramidLevel;
    }
    for (const [tileKey, mercBounds] of Object.entries(this.tileBounds)) {
      const fullBounds = toFullBounds(mercBounds);
      if (fullBounds) {
        this.tileCache.setTileBounds(tileKey, fullBounds);
      }
    }
    const currentHash = hashSelector(this.selector);
    const tilesToFetch = [];
    for (const tileTuple of this.visibleTiles) {
      const tileKey = tileToKey(tileTuple);
      if (this.pendingChunks.has(tileKey)) {
        continue;
      }
      const tile = this.tileCache.upsert(tileKey);
      if (!tile.data || tile.selectorHash !== currentHash) {
        tilesToFetch.push(tileTuple);
      }
    }
    if (tilesToFetch.length > 0) {
      for (const tileTuple of tilesToFetch) {
        this.pendingChunks.add(tileToKey(tileTuple));
      }
      this.syncChunksLoading();
      const version = this.selectorVersion;
      this.prefetchTileData(tilesToFetch, currentHash, version).catch((err) => {
        console.error("Error prefetching tile data:", err);
        for (const tileTuple of tilesToFetch) {
          this.pendingChunks.delete(tileToKey(tileTuple));
        }
        this.syncChunksLoading();
      });
    }
  }
  render(renderer, context) {
    if (!this.tileCache) {
      return;
    }
    const useMapbox = !!context.mapbox;
    const shaderProgram = renderer.getProgram(
      context.shaderData,
      context.customShaderConfig,
      useMapbox,
      false
      // useWgs84 - fragment shader reprojection for EPSG:4326
    );
    renderer.gl.useProgram(shaderProgram.program);
    renderer.applyCommonUniforms(
      shaderProgram,
      context.colormapTexture,
      context.uniforms,
      context.customShaderConfig,
      context.projectionData,
      context.mapbox,
      context.matrix,
      false
    );
    const maxLevelPath = this.zarrStore.levels[this.maxLevelIndex];
    const datasetMaxZoom = parseLevelZoom(maxLevelPath, this.maxLevelIndex);
    renderer.renderTiles(
      shaderProgram,
      this.visibleTiles,
      context.worldOffsets,
      this.tileCache,
      this.tileSize,
      this.vertexArr,
      this.pixCoordArr,
      Object.keys(this.tileBounds).length > 0 ? this.tileBounds : void 0,
      context.customShaderConfig,
      false,
      datasetMaxZoom,
      void 0,
      // tileTexOverrides
      this.zarrStore.latIsAscending
    );
  }
  renderToTile(renderer, tileId, context) {
    return renderMapboxTile({
      renderer,
      mode: this,
      tileId,
      context
    });
  }
  onProjectionChange(isGlobe) {
    this.updateGeometryForProjection(isGlobe);
  }
  getTiledState() {
    if (!this.tileCache) return null;
    return {
      tileCache: this.tileCache,
      visibleTiles: this.visibleTiles,
      tileSize: this.tileSize,
      vertexArr: this.vertexArr,
      pixCoordArr: this.pixCoordArr,
      tileBounds: Object.keys(this.tileBounds).length > 0 ? this.tileBounds : void 0,
      latIsAscending: this.zarrStore.latIsAscending
    };
  }
  getSingleImageState() {
    return null;
  }
  dispose(_gl) {
    cancelAllRequests(this.requestCanceller);
    this.tileCache?.clear();
    this.tileCache = null;
    this.pendingChunks.clear();
    this.loadingDebouncer.hide();
  }
  setLoadingCallback(callback) {
    setLoadingCallback(this.loadingManager, callback);
  }
  getCRS() {
    return this.crs;
  }
  getXYLimits() {
    return this.xyLimits;
  }
  getMaxLevelIndex() {
    return this.maxLevelIndex;
  }
  getLevels() {
    return this.zarrStore.levels;
  }
  emitLoadingState() {
    emitLoadingState(this.loadingManager);
  }
  /**
   * Sync the chunk-loading spinner with `pendingChunks`. Routes through
   * the debouncer so cache-hit refetches don't flash it on.
   */
  syncChunksLoading() {
    if (this.pendingChunks.size > 0) {
      this.loadingDebouncer.show();
    } else {
      this.loadingDebouncer.hide();
    }
  }
  async setSelector(selector) {
    this.selector = selector;
    this.selectorVersion++;
    cancelAllRequests(this.requestCanceller);
    const bandNames = getBands(this.variable, selector);
    this.tileCache?.updateSelector(this.selector);
    this.tileCache?.updateBandNames(bandNames);
    if (this.tileCache && this.visibleTiles.length > 0) {
      this.tileCache.invalidateSelector(this.visibleTiles, this.selectorVersion);
    }
    this.invalidate();
  }
  updateGeometryForProjection(isGlobe) {
    const targetSubdivisions = isGlobe ? TILE_SUBDIVISIONS : 1;
    if (this.currentSubdivisions === targetSubdivisions) return;
    const subdivided = createSubdividedQuad(targetSubdivisions);
    this.vertexArr = subdivided.vertexArr;
    this.pixCoordArr = subdivided.texCoordArr;
    this.currentSubdivisions = targetSubdivisions;
    this.tileCache?.markGeometryDirty();
  }
  getVisibleTilesWithContext(map) {
    if (!map.getZoom || !map.getBounds) {
      return { tiles: [], pyramidLevel: null, mapZoom: null, bounds: null };
    }
    const mapZoom = map.getZoom();
    const levelIndex = zoomToLevel(mapZoom, this.maxLevelIndex);
    const bounds = map.getBounds()?.toArray();
    if (!bounds) {
      return { tiles: [], pyramidLevel: levelIndex, mapZoom, bounds: null };
    }
    const levelPath = this.zarrStore.levels[levelIndex];
    const actualZoom = parseLevelZoom(levelPath, levelIndex);
    if (this.crs === "EPSG:4326" && this.xyLimits) {
      return {
        tiles: getTilesAtZoomEquirect(actualZoom, bounds, this.xyLimits),
        pyramidLevel: levelIndex,
        mapZoom,
        bounds
      };
    }
    return {
      tiles: getTilesAtZoom(actualZoom, bounds),
      pyramidLevel: levelIndex,
      mapZoom,
      bounds
    };
  }
  computeTileBounds(tiles) {
    if (this.crs !== "EPSG:4326" || !this.xyLimits) return {};
    const { xMin, xMax, yMin, yMax } = normalizeGlobalExtent(this.xyLimits);
    const lonExtent = xMax - xMin;
    const latExtent = yMax - yMin;
    const bounds = {};
    for (const tile of tiles) {
      const [z, x, y] = tile;
      const tilesPerSide = Math.pow(2, z);
      const lonSpan = lonExtent / tilesPerSide;
      const latSpan = latExtent / tilesPerSide;
      const lonMin = xMin + x * lonSpan;
      const lonMax = lonMin + lonSpan;
      const latNorth = yMax - y * latSpan;
      const latSouth = latNorth - latSpan;
      const x0 = lonToMercatorNorm(lonMin);
      const x1 = lonToMercatorNorm(lonMax);
      const y0 = latToMercatorNorm(latNorth);
      const y1 = latToMercatorNorm(latSouth);
      bounds[tileToKey(tile)] = {
        x0,
        y0,
        x1,
        y1,
        latMin: latSouth,
        latMax: latNorth,
        lonMin,
        lonMax
      };
    }
    return bounds;
  }
  async prefetchTileData(tiles, selectorHash, version) {
    const controller = new AbortController();
    this.requestCanceller.controllers.set(version, controller);
    try {
      const fetchPromises = tiles.map(
        (tiletuple) => this.fetchTileData(tiletuple, selectorHash, version, controller.signal)
      );
      const results = await Promise.allSettled(fetchPromises);
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected) {
        throw rejected.reason;
      }
    } finally {
      this.requestCanceller.controllers.delete(version);
    }
  }
  async fetchTileData(tileTuple, selectorHash, version, signal) {
    if (!this.tileCache) {
      const tileKey2 = tileToKey(tileTuple);
      this.pendingChunks.delete(tileKey2);
      this.syncChunksLoading();
      return null;
    }
    const tileKey = tileToKey(tileTuple);
    const bounds = toFullBounds(this.tileBounds[tileKey]);
    try {
      const tile = await this.tileCache.fetchTile(
        tileTuple,
        selectorHash,
        version,
        signal,
        bounds
      );
      this.pendingChunks.delete(tileKey);
      if (!tile) {
        this.syncChunksLoading();
        this.invalidate();
        return null;
      }
      cancelOlderRequests(this.requestCanceller, version);
      this.syncChunksLoading();
      this.invalidate();
      return tile.data;
    } catch (err) {
      this.pendingChunks.delete(tileKey);
      this.syncChunksLoading();
      if (err instanceof DOMException && err.name === "AbortError") {
        return null;
      }
      throw err;
    }
  }
  /**
   * Query data for point or region geometries.
   */
  async queryData(geometry, selector, options) {
    if (!this.tileCache || !this.xyLimits) {
      return {
        [this.variable]: [],
        dimensions: [],
        coordinates: { lat: [], lon: [] }
      };
    }
    const querySelector = selector ? normalizeSelector(selector) : this.selector;
    const level = this.currentLevel ?? this.maxLevelIndex;
    const desc = this.zarrStore.describe();
    const transforms = {
      scaleFactor: desc.scaleFactor,
      addOffset: desc.addOffset,
      fillValue: desc.fill_value
    };
    const { geometry: processedGeometry, bbox: wrappedBbox } = preprocessQueryGeometry(geometry);
    if (wrappedBbox.crossesAntimeridian && rasterExtentCrossesAntimeridian(this.crs, this.xyLimits)) {
      if (!this._antimeridianWarnings.has("raster-extent-crossing")) {
        this._antimeridianWarnings.add("raster-extent-crossing");
        console.warn(
          "Antimeridian-crossing polygon queries are not supported for rasters whose own extent crosses the antimeridian; results may be incorrect"
        );
      }
      return queryRegionTiled(
        this.variable,
        geometry,
        querySelector,
        this.zarrStore,
        this.crs,
        this.xyLimits,
        level,
        this.tileSize,
        transforms,
        options
      );
    }
    return queryRegionTiled(
      this.variable,
      processedGeometry,
      querySelector,
      this.zarrStore,
      this.crs,
      this.xyLimits,
      level,
      this.tileSize,
      transforms,
      options,
      wrappedBbox
    );
  }
};

// src/untiled-mode.ts
import * as zarr4 from "zarrita";

// src/mesh-reprojector.ts
import Delaunator from "delaunator";
import { RasterReprojector } from "@developmentseed/raster-reproject";
var MAX_ADAPTIVE_VERTICES = 1e4;
var MAX_ITERATIONS = 1e3;
var POLAR_LON_COVERAGE_THRESHOLD = 270;
function normalizeLon180(lon) {
  if (!isFinite(lon)) return lon;
  return ((lon + 180) % 360 + 360) % 360 - 180;
}
function createReprojector(config) {
  const { bounds, width, height, latIsAscending, transformer } = config;
  const scaleX = width > 1 ? width / (width - 1) : 1;
  const scaleY = height > 1 ? height / (height - 1) : 1;
  return new RasterReprojector(
    {
      // Pixel coords [0, width-1] → source CRS coords (scaled to edge-based model)
      forwardTransform: (px, py) => pixelToSourceCRS(
        px * scaleX,
        py * scaleY,
        bounds,
        width,
        height,
        latIsAscending
      ),
      // Source CRS coords → pixel coords [0, width-1] (unscale from edge-based model)
      inverseTransform: (x, y) => {
        const [scaledPx, scaledPy] = sourceCRSToPixel(
          x,
          y,
          bounds,
          width,
          height,
          latIsAscending
        );
        return [scaledPx / scaleX, scaledPy / scaleY];
      },
      // Source CRS → EPSG:4326 (lon, lat)
      forwardReproject: (x, y) => transformer.forward(x, y),
      // EPSG:4326 → source CRS
      inverseReproject: (lon, lat) => transformer.inverse(lon, lat)
    },
    width,
    height
  );
}
function encodeAbsoluteWgs84(positions, minLon, crossesAntimeridian) {
  const numVerts = positions.length / 2;
  const encoded = new Float32Array(numVerts * 2);
  for (let i = 0; i < numVerts; i++) {
    let lon = normalizeLon180(positions[i * 2]);
    const lat = positions[i * 2 + 1];
    if (crossesAntimeridian && lon < minLon) {
      lon += 360;
    }
    if (!isFinite(lon) || !isFinite(lat)) {
      encoded[i * 2] = NaN;
      encoded[i * 2 + 1] = NaN;
      continue;
    }
    encoded[i * 2] = (lon + 180) / 360 * 2 - 1;
    encoded[i * 2 + 1] = (lat + 90) / 180 * 2 - 1;
  }
  return encoded;
}
function edgeCrossesAntimeridian(lon1, lon2) {
  return Math.abs(lon1 - lon2) > 180;
}
function computeAntimeridianIntersection(lon1, lat1, lon2, lat2) {
  let l1 = lon1;
  let l2 = lon2;
  if (lon1 > 0 && lon2 < 0 && lon1 - lon2 > 180) {
    l2 += 360;
  } else if (lon2 > 0 && lon1 < 0 && lon2 - lon1 > 180) {
    l1 += 360;
  }
  const t = (180 - l1) / (l2 - l1);
  const lat = lat1 + t * (lat2 - lat1);
  return { lat, t };
}
function splitAntimeridianTriangles(wgs84Positions, texCoords, triangles, canCrossAntimeridian) {
  const numVerts = wgs84Positions.length / 2;
  const validVertex = new Uint8Array(numVerts);
  for (let i = 0; i < numVerts; i++) {
    const lon = wgs84Positions[i * 2];
    const lat = wgs84Positions[i * 2 + 1];
    validVertex[i] = isFinite(lon) && isFinite(lat) ? 1 : 0;
  }
  if (!canCrossAntimeridian) {
    const newIndices2 = [];
    for (let i = 0; i < triangles.length; i += 3) {
      const i0 = triangles[i];
      const i1 = triangles[i + 1];
      const i2 = triangles[i + 2];
      if (validVertex[i0] && validVertex[i1] && validVertex[i2]) {
        newIndices2.push(i0, i1, i2);
      }
    }
    return {
      positions: wgs84Positions,
      texCoords,
      indices: new Uint32Array(newIndices2)
    };
  }
  const newPositions = new Array(wgs84Positions.length);
  for (let i = 0; i < wgs84Positions.length; i++)
    newPositions[i] = wgs84Positions[i];
  const newTexCoords = new Array(texCoords.length);
  for (let i = 0; i < texCoords.length; i++) newTexCoords[i] = texCoords[i];
  const newIndices = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const i0 = triangles[i];
    const i1 = triangles[i + 1];
    const i2 = triangles[i + 2];
    if (!validVertex[i0] || !validVertex[i1] || !validVertex[i2]) {
      continue;
    }
    const lon0raw = wgs84Positions[i0 * 2];
    const lat0 = wgs84Positions[i0 * 2 + 1];
    const u0 = texCoords[i0 * 2];
    const v0 = texCoords[i0 * 2 + 1];
    const lon1raw = wgs84Positions[i1 * 2];
    const lat1 = wgs84Positions[i1 * 2 + 1];
    const u1 = texCoords[i1 * 2];
    const v1 = texCoords[i1 * 2 + 1];
    const lon2raw = wgs84Positions[i2 * 2];
    const lat2 = wgs84Positions[i2 * 2 + 1];
    const u2 = texCoords[i2 * 2];
    const v2 = texCoords[i2 * 2 + 1];
    const lon0 = normalizeLon180(lon0raw);
    const lon1 = normalizeLon180(lon1raw);
    const lon2 = normalizeLon180(lon2raw);
    const cross01 = edgeCrossesAntimeridian(lon0, lon1);
    const cross12 = edgeCrossesAntimeridian(lon1, lon2);
    const cross20 = edgeCrossesAntimeridian(lon2, lon0);
    const crossCount = (cross01 ? 1 : 0) + (cross12 ? 1 : 0) + (cross20 ? 1 : 0);
    if (crossCount === 0) {
      newIndices.push(i0, i1, i2);
    } else if (crossCount === 2) {
      const vertexOrder = !cross01 ? [2, 0, 1] : !cross12 ? [0, 1, 2] : [1, 2, 0];
      const [ai, o1i, o2i] = vertexOrder;
      const idxArr = [i0, i1, i2];
      const lonArr = [lon0, lon1, lon2];
      const latArr = [lat0, lat1, lat2];
      const uArr = [u0, u1, u2];
      const vArr = [v0, v1, v2];
      const alone = idxArr[ai];
      const other1 = idxArr[o1i];
      const other2 = idxArr[o2i];
      const lonAlone = lonArr[ai];
      const latAlone = latArr[ai];
      const uAlone = uArr[ai];
      const vAlone = vArr[ai];
      const lonOther1 = lonArr[o1i];
      const latOther1 = latArr[o1i];
      const uOther1 = uArr[o1i];
      const vOther1 = vArr[o1i];
      const lonOther2 = lonArr[o2i];
      const latOther2 = latArr[o2i];
      const uOther2 = uArr[o2i];
      const vOther2 = vArr[o2i];
      const int1 = computeAntimeridianIntersection(
        lonAlone,
        latAlone,
        lonOther1,
        latOther1
      );
      const int2 = computeAntimeridianIntersection(
        lonAlone,
        latAlone,
        lonOther2,
        latOther2
      );
      const intU1 = uAlone + int1.t * (uOther1 - uAlone);
      const intV1 = vAlone + int1.t * (vOther1 - vAlone);
      const intU2 = uAlone + int2.t * (uOther2 - uAlone);
      const intV2 = vAlone + int2.t * (vOther2 - vAlone);
      const aloneOnEast = lonAlone > 0;
      const lonAloneSide = aloneOnEast ? 179.9999 : -179.9999;
      const lonOtherSide = aloneOnEast ? -179.9999 : 179.9999;
      const baseIdx = newPositions.length / 2;
      newPositions.push(lonAloneSide, int1.lat, lonAloneSide, int2.lat);
      newPositions.push(lonOtherSide, int1.lat, lonOtherSide, int2.lat);
      newTexCoords.push(intU1, intV1, intU2, intV2);
      newTexCoords.push(intU1, intV1, intU2, intV2);
      const intAlone1 = baseIdx;
      const intAlone2 = baseIdx + 1;
      const intOther1 = baseIdx + 2;
      const intOther2 = baseIdx + 3;
      newIndices.push(alone, intAlone1, intAlone2);
      newIndices.push(intOther1, other1, other2);
      newIndices.push(intOther1, other2, intOther2);
    } else {
      newIndices.push(i0, i1, i2);
    }
  }
  return {
    positions: new Float64Array(newPositions),
    texCoords: new Float64Array(newTexCoords),
    indices: new Uint32Array(newIndices)
  };
}
function createHybridMesh(options) {
  const {
    geoBounds,
    width,
    height,
    subdivisions,
    transformer,
    latIsAscending,
    maxError = DEFAULT_MESH_MAX_ERROR
  } = options;
  const { xMin, xMax, yMin, yMax } = geoBounds;
  const bounds = [xMin, yMin, xMax, yMax];
  const reprojector = createReprojector({
    bounds,
    width,
    height,
    latIsAscending,
    transformer
  });
  for (let i = 0; i < MAX_ITERATIONS && reprojector.getMaxError() > maxError; i++) {
    const prevVertCount = reprojector.uvs.length / 2;
    reprojector.refine();
    const newVertCount = reprojector.uvs.length / 2;
    if (newVertCount >= MAX_ADAPTIVE_VERTICES || newVertCount === prevVertCount) {
      break;
    }
  }
  const adaptiveUVs = reprojector.uvs;
  const uniformVertices = (subdivisions + 1) ** 2;
  const mergedUVs = new Float64Array(adaptiveUVs.length + uniformVertices * 2);
  mergedUVs.set(adaptiveUVs);
  let offset = adaptiveUVs.length;
  for (let row = 0; row <= subdivisions; row++) {
    for (let col = 0; col <= subdivisions; col++) {
      mergedUVs[offset++] = col / subdivisions;
      mergedUVs[offset++] = row / subdivisions;
    }
  }
  const delaunay = new Delaunator(mergedUVs);
  const triangles = delaunay.triangles;
  const numVerts = mergedUVs.length / 2;
  const wgs84Positions = new Float64Array(numVerts * 2);
  const lons = [];
  let minLat = Infinity, maxLat = -Infinity;
  for (let i = 0; i < numVerts; i++) {
    const u = mergedUVs[i * 2];
    const v = mergedUVs[i * 2 + 1];
    const srcX = xMin + u * (xMax - xMin);
    const srcY = latIsAscending ? yMin + v * (yMax - yMin) : yMax - v * (yMax - yMin);
    const [lon, lat] = transformer.forward(srcX, srcY);
    wgs84Positions[i * 2] = lon;
    wgs84Positions[i * 2 + 1] = lat;
    if (isFinite(lon) && isFinite(lat)) {
      lons.push(normalizeLon180(lon));
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  if (!isFinite(minLat)) minLat = -90;
  if (!isFinite(maxLat)) maxLat = 90;
  let minLon = -180, maxLon = 180, crossesAntimeridian = false;
  if (lons.length > 0) {
    lons.sort((a, b) => a - b);
    minLon = lons[0];
    maxLon = lons[lons.length - 1];
    const lonCoverage = maxLon - minLon;
    if (lonCoverage > 0) {
      let maxGap = 0;
      let gapEndIndex = 0;
      for (let i = 0; i < lons.length - 1; i++) {
        const gap = lons[i + 1] - lons[i];
        if (gap > maxGap) {
          maxGap = gap;
          gapEndIndex = i + 1;
        }
      }
      const wrapGap = lons[0] + 360 - lons[lons.length - 1];
      if (wrapGap < maxGap && lonCoverage < POLAR_LON_COVERAGE_THRESHOLD) {
        crossesAntimeridian = true;
        minLon = lons[gapEndIndex];
        maxLon = lons[gapEndIndex - 1];
      }
    }
  }
  if (crossesAntimeridian && minLon >= 180) {
    minLon = minLon - 360;
    if (minLon <= maxLon) {
      crossesAntimeridian = false;
    }
  }
  const canCrossAntimeridian = crossesAntimeridian || maxLon - minLon >= 180;
  const texCoords = new Float64Array(mergedUVs);
  const splitResult = splitAntimeridianTriangles(
    wgs84Positions,
    texCoords,
    triangles,
    canCrossAntimeridian
  );
  const positions = encodeAbsoluteWgs84(
    splitResult.positions,
    minLon,
    crossesAntimeridian
  );
  const wgs84Bounds = { lon0: 0, lat0: 0, lon1: 1, lat1: 1 };
  return {
    positions,
    texCoords: new Float32Array(splitResult.texCoords),
    indices: splitResult.indices,
    wgs84Bounds
  };
}

// src/untiled-mode.ts
var MAX_CACHED_REGIONS = 128;
var UntiledMode = class {
  constructor(store, variable, selector, invalidate, fixedDataScale = 1) {
    this.isMultiscale = false;
    this.channels = 1;
    // PATCH[fill-override]: when set from the owning ZarrLayer's config, this
    // takes precedence over currentLevel?.fillValue ?? desc.fill_value in every
    // fallback expression below. See PATCH-NOTES.md for context.
    this.configFillValue = null;
    // The single committed snapshot. All per-level state (array, dims, slice
    // args) is swapped atomically through `loadLevel()`; nothing else mutates
    // these fields.
    this.activeLevel = null;
    // Monotonic id stamped by each `loadLevel` call. Async loads check this
    // before committing — a bump invalidates older pending work.
    this.loadToken = 0;
    // Target level requested by zoom/init. `update()` writes this; `loadLevel`
    // reads it to re-target if a zoom change happened mid-load.
    this.desiredLevelIndex = 0;
    // Target of the currently-running `loadLevel`, or null when idle. Used
    // by `update()` to dedupe: if we're already loading the target level,
    // don't restart the fetch every frame (ZarrLayer.prerender calls
    // update() once per frame, so without this we'd never commit).
    this.loadingLevelIndex = null;
    // Bounds
    this.mercatorBounds = null;
    this.variables = [];
    this.bandNames = [];
    this.dimIndices = {};
    this.xyLimits = null;
    this.crs = "EPSG:4326";
    this.latIsAscending = true;
    // Multi-level support
    this.levels = [];
    this.levelMetadataFetched = /* @__PURE__ */ new Set();
    // Tracks which levels have had metadata fetched
    this.proj4def = null;
    // Cached transformers for proj4 reprojection (created once, reused everywhere)
    this.cachedMercatorTransformer = null;
    this.cachedWGS84Transformer = null;
    // Transformer: source CRS → EPSG:4326 (for WGS84 vertex positions and ECEF projection)
    this.cached4326Transformer = null;
    // Loading state
    this.isRemoved = false;
    this._antimeridianWarnings = /* @__PURE__ */ new Set();
    // Shared state managers
    this.requestCanceller = createRequestCanceller();
    this.loadingManager = createLoadingManager();
    this.loadingDebouncer = createChunkLoadingDebouncer(
      this.loadingManager
    );
    // Dimension values cache (supports numeric and string coordinate arrays)
    this.dimensionValues = {};
    // Region-based loading (for multi-level datasets with chunking/sharding)
    // Single unified cache with LRU eviction - keys include level index (e.g., "2:0,0")
    this.regionCache = /* @__PURE__ */ new Map();
    // Keys of regions protected from eviction. Lifecycle:
    // - Added: in updateVisibleRegions() for current level's visible regions
    // - Retained: across level switches to protect fallback regions during transitions
    // - Cleared: in updateVisibleRegions() when currentLevelCoversViewport() returns true,
    //   at which point non-current-level keys are removed (fallbacks no longer needed)
    this.visibleRegionKeys = /* @__PURE__ */ new Set();
    this.lastVisibleRegions = [];
    // Last computed visible regions
    this.lastVisibleRegionsLevel = -1;
    // Level index that lastVisibleRegions corresponds to
    this.lastViewportHash = "";
    this.selectorVersion = 0;
    // Incremented on selector change to track stale regions
    // Cached WebGL context for use in setSelector
    this.cachedGl = null;
    // Track current projection for subdivision optimization
    this.isGlobeProjection = false;
    // Deferred geometry rebuild: when globe→flat transition starts, onProjectionChange(false)
    // fires before projectionTransition reaches 0. Rebuilding geometry immediately would drop
    // subdivisions to 1 while the ECEF shader is still rendering on the globe.
    // This flag defers the rebuild until projectionTransition reaches 0.
    this.pendingGeometryRebuild = false;
    // Fixed data scale for normalization (set at initialization, passed from ZarrLayer)
    this.fixedDataScale = 1;
    // Pre-computed mean data for rendering. When set, replaces live data in render.
    this.timeMeanTexture = null;
    this.timeMeanWidth = 0;
    this.timeMeanHeight = 0;
    this.timeMeanPixelOffset = { x: 0, y: 0 };
    this.timeMeanLevelW = 0;
    this.timeMeanLevelH = 0;
    this.pendingMeanUpdate = false;
    this.pendingMeanData = null;
    this.zarrStore = store;
    this.variables = Array.isArray(variable) ? variable : [variable];
    this.selector = selector;
    this.bandNames = getBands(
      this.variables.length > 1 ? this.variables : this.variables[0],
      selector
    );
    this.invalidate = invalidate;
    this.fixedDataScale = fixedDataScale;
  }
  async initialize() {
    this.loadingManager.metadataLoading = true;
    this.emitLoadingState();
    try {
      const desc = this.zarrStore.describe();
      this.dimIndices = desc.dimIndices;
      this.crs = desc.crs;
      this.xyLimits = desc.xyLimits;
      this.latIsAscending = desc.latIsAscending;
      this.proj4def = desc.proj4 ?? null;
      if (this.proj4def && this.xyLimits) {
        const bounds = [
          this.xyLimits.xMin,
          this.xyLimits.yMin,
          this.xyLimits.xMax,
          this.xyLimits.yMax
        ];
        this.cachedMercatorTransformer = createTransformer(
          this.proj4def,
          bounds
        );
        this.cachedWGS84Transformer = createWGS84ToSourceTransformer(
          this.proj4def
        );
        this.cached4326Transformer = createTransformerTo4326(
          this.proj4def,
          bounds
        );
      }
      if (this.crs !== "EPSG:4326" && this.crs !== "EPSG:3857") {
        console.warn(
          `Unsupported CRS "${this.crs}" - rendering may be incorrect. Supported: EPSG:4326, EPSG:3857`
        );
      }
      if (desc.untiledLevels && desc.untiledLevels.length > 0) {
        this.levels = desc.untiledLevels;
        this.isMultiscale = true;
        await this.ensureAllLevelShapes();
      } else {
        this.isMultiscale = false;
        await this.loadLevel(0);
      }
      if (this.xyLimits) {
        if (this.proj4def) {
          this.mercatorBounds = this.computeMercatorBoundsFromProjection();
        } else {
          this.mercatorBounds = boundsToMercatorNorm(
            this.xyLimits,
            this.crs
          );
        }
      } else {
        console.warn("UntiledMode: No XY limits found");
      }
    } finally {
      this.loadingManager.metadataLoading = false;
      this.emitLoadingState();
    }
  }
  /**
   * Lazily ensure metadata for a specific level is loaded.
   * Fetch per-level zarr.json if:
   * - We haven't already attempted a fetch for this level, AND
   * - Any of dtype/scaleFactor/addOffset are missing (consolidated metadata incomplete)
   */
  async ensureLevelMetadata(levelIndex) {
    const level = this.levels[levelIndex];
    if (!level) {
      return;
    }
    if (this.levelMetadataFetched.has(levelIndex)) {
      return;
    }
    if (level.dtype !== void 0 && level.scaleFactor !== void 0 && level.addOffset !== void 0) {
      return;
    }
    this.levelMetadataFetched.add(levelIndex);
    try {
      const meta = await this.zarrStore.getUntiledLevelMetadata(level.asset);
      level.shape = meta.shape;
      level.chunks = meta.chunks;
      if (meta.scaleFactor !== void 0) {
        level.scaleFactor = meta.scaleFactor;
      }
      if (meta.addOffset !== void 0) {
        level.addOffset = meta.addOffset;
      }
      level.fillValue = meta.fillValue;
      level.dtype = meta.dtype;
    } catch (err) {
      console.warn(`Failed to load metadata for level ${level.asset}:`, err);
    }
  }
  /**
   * Ensure all levels have shape data (required for level selection).
   * Only fetches metadata for levels where consolidated metadata was incomplete.
   * This runs during initialization to enable proper zoom-based level selection.
   */
  async ensureAllLevelShapes() {
    const levelsNeedingShape = this.levels.map((level, index) => ({ level, index })).filter(({ level }) => !level.shape);
    if (levelsNeedingShape.length === 0) {
      return;
    }
    await Promise.all(
      levelsNeedingShape.map(async ({ level, index }) => {
        if (this.levelMetadataFetched.has(index)) {
          return;
        }
        this.levelMetadataFetched.add(index);
        try {
          const meta = await this.zarrStore.getUntiledLevelMetadata(level.asset);
          level.shape = meta.shape;
          level.chunks = meta.chunks;
          if (meta.scaleFactor !== void 0) {
            level.scaleFactor = meta.scaleFactor;
          }
          if (meta.addOffset !== void 0) {
            level.addOffset = meta.addOffset;
          }
          level.fillValue = meta.fillValue;
          level.dtype = meta.dtype;
        } catch (err) {
          console.warn(`Failed to load shape for level ${level.asset}:`, err);
        }
      })
    );
  }
  /**
   * Detect optimal region size from array metadata.
   * For sharded arrays: use shard chunk_shape
   * For standard chunked arrays: use array chunks
   */
  getRegionSize(array) {
    const latIdx = this.dimIndices.lat?.index;
    const lonIdx = this.dimIndices.lon?.index;
    if (latIdx === void 0 || lonIdx === void 0) return null;
    const codecs = array.codecs || [];
    for (const codec of codecs) {
      if (codec.name === "sharding_indexed" && codec.configuration?.chunk_shape) {
        const shardShape = codec.configuration.chunk_shape;
        return [shardShape[latIdx], shardShape[lonIdx]];
      }
    }
    const chunks = array.chunks;
    if (chunks && chunks.length > Math.max(latIdx, lonIdx)) {
      const chunkH = chunks[latIdx];
      const chunkW = chunks[lonIdx];
      const shape = array.shape;
      if (chunkH < shape[latIdx] || chunkW < shape[lonIdx]) {
        return [chunkH, chunkW];
      }
    }
    return null;
  }
  /**
   * Clear region cache and dispose WebGL resources.
   */
  clearRegionCache(gl) {
    for (const region of this.regionCache.values()) {
      this.disposeRegion(region, gl);
    }
    this.regionCache.clear();
    this.lastViewportHash = "";
  }
  /**
   * Dispose WebGL resources for a single region.
   */
  disposeRegion(region, gl) {
    if (region.texture) gl.deleteTexture(region.texture);
    if (region.vertexBuffer) gl.deleteBuffer(region.vertexBuffer);
    if (region.pixCoordBuffer) gl.deleteBuffer(region.pixCoordBuffer);
    if (region.indexBuffer) gl.deleteBuffer(region.indexBuffer);
    for (const tex of region.bandTextures.values()) {
      gl.deleteTexture(tex);
    }
  }
  /**
   * Evict oldest regions when cache exceeds limit (LRU eviction).
   * Uses Map iteration order (oldest first).
   * Never evicts currently visible regions.
   */
  evictOldRegions(gl) {
    while (this.regionCache.size > MAX_CACHED_REGIONS) {
      let evictedKey = null;
      for (const key of this.regionCache.keys()) {
        if (!this.visibleRegionKeys.has(key)) {
          evictedKey = key;
          break;
        }
      }
      if (!evictedKey) break;
      const region = this.regionCache.get(evictedKey);
      if (region) this.disposeRegion(region, gl);
      this.regionCache.delete(evictedKey);
    }
  }
  /**
   * Calculate which regions are visible in the current viewport.
   */
  getVisibleRegions(map) {
    const bounds = map.getBounds?.()?.toArray?.();
    if (!bounds || !this.xyLimits || !this.activeLevel) return [];
    const { width, height, regionSize } = this.activeLevel;
    const [[west, south], [east, north]] = bounds;
    const { xMin, xMax, yMin, yMax } = this.xyLimits;
    const [regionH, regionW] = regionSize;
    if (this.proj4def && this.cachedWGS84Transformer) {
      const transformer = this.cachedWGS84Transformer;
      const numRegionsX2 = Math.ceil(width / regionW);
      const numRegionsY2 = Math.ceil(height / regionH);
      const candidates = this.getCandidateRegions(
        west,
        south,
        east,
        north,
        transformer,
        numRegionsX2,
        numRegionsY2,
        regionW,
        regionH,
        width,
        height
      );
      const regions2 = [];
      for (const { regionX, regionY } of candidates) {
        const regBounds = this.getRegionBounds(regionX, regionY, {
          width,
          height,
          regionSize
        });
        const xMid = (regBounds.xMin + regBounds.xMax) / 2;
        const yMid = (regBounds.yMin + regBounds.yMax) / 2;
        const samplePoints = [
          transformer.inverse(regBounds.xMin, regBounds.yMin),
          transformer.inverse(regBounds.xMax, regBounds.yMin),
          transformer.inverse(regBounds.xMax, regBounds.yMax),
          transformer.inverse(regBounds.xMin, regBounds.yMax),
          transformer.inverse(xMid, regBounds.yMin),
          transformer.inverse(xMid, regBounds.yMax),
          transformer.inverse(regBounds.xMin, yMid),
          transformer.inverse(regBounds.xMax, yMid)
        ];
        let regWest = Infinity;
        let regEast = -Infinity;
        let regSouth = Infinity;
        let regNorth = -Infinity;
        let hasValid = false;
        for (const [lon, lat] of samplePoints) {
          if (!isFinite(lon) || !isFinite(lat)) continue;
          hasValid = true;
          if (lon < regWest) regWest = lon;
          if (lon > regEast) regEast = lon;
          if (lat < regSouth) regSouth = lat;
          if (lat > regNorth) regNorth = lat;
        }
        if (!hasValid) continue;
        if (regEast >= west && regWest <= east && regNorth >= south && regSouth <= north) {
          regions2.push({ regionX, regionY });
        }
      }
      return regions2;
    }
    const xMinIdx = geoToArrayIndex(west, xMin, xMax, width);
    const xMaxIdx = geoToArrayIndex(east, xMin, xMax, width);
    let ySouthIdx = geoToArrayIndex(south, yMin, yMax, height);
    let yNorthIdx = geoToArrayIndex(north, yMin, yMax, height);
    if (this.latIsAscending === false) {
      ySouthIdx = height - 1 - ySouthIdx;
      yNorthIdx = height - 1 - yNorthIdx;
    }
    const regionXMin = Math.floor(Math.min(xMinIdx, xMaxIdx) / regionW);
    const regionXMax = Math.floor(Math.max(xMinIdx, xMaxIdx) / regionW);
    const regionYMin = Math.floor(Math.min(ySouthIdx, yNorthIdx) / regionH);
    const regionYMax = Math.floor(Math.max(ySouthIdx, yNorthIdx) / regionH);
    const numRegionsX = Math.ceil(width / regionW);
    const numRegionsY = Math.ceil(height / regionH);
    const clampedXMin = Math.max(0, regionXMin);
    const clampedXMax = Math.min(numRegionsX - 1, regionXMax);
    const clampedYMin = Math.max(0, regionYMin);
    const clampedYMax = Math.min(numRegionsY - 1, regionYMax);
    const regions = [];
    for (let ry = clampedYMin; ry <= clampedYMax; ry++) {
      for (let rx = clampedXMin; rx <= clampedXMax; rx++) {
        regions.push({ regionX: rx, regionY: ry });
      }
    }
    return regions;
  }
  /**
   * Create a region key that includes level index for unified caching.
   */
  makeRegionKey(levelIndex, regionX, regionY) {
    return `${levelIndex}:${regionX},${regionY}`;
  }
  /**
   * Create a new region state entry.
   */
  createRegionState(levelIndex, regionX, regionY) {
    return {
      key: this.makeRegionKey(levelIndex, regionX, regionY),
      levelIndex,
      regionX,
      regionY,
      data: null,
      width: 0,
      height: 0,
      loading: false,
      requestId: null,
      channels: 1,
      texture: null,
      textureUploaded: false,
      vertexBuffer: null,
      pixCoordBuffer: null,
      indexBuffer: null,
      vertexArr: null,
      pixCoordArr: null,
      indexArr: null,
      vertexCount: 0,
      useIndexedMesh: false,
      mercatorBounds: null,
      wgs84Bounds: null,
      latIsAscending: this.latIsAscending,
      selectorVersion: this.selectorVersion,
      bandData: /* @__PURE__ */ new Map(),
      bandTextures: /* @__PURE__ */ new Map(),
      bandTexturesUploaded: /* @__PURE__ */ new Set(),
      bandTexturesConfigured: /* @__PURE__ */ new Set(),
      levelMeta: null
      // Set from snapshot in fetchRegion
    };
  }
  /**
   * Check if a region has all required data for rendering.
   */
  isRegionValid(region) {
    return !!(region.data && region.textureUploaded && region.texture && region.vertexBuffer && region.pixCoordBuffer && region.vertexArr && region.mercatorBounds && region.levelMeta);
  }
  /**
   * Clear loading flags for queued-but-not-started regions in a batch.
   * Only touches regions where requestId is null (pre-marked as loading
   * but no fetch was started). In-flight regions (requestId set) are
   * cleaned up by their own finally block.
   */
  clearBatchLoadingFlags(regions, levelIndex) {
    for (const { regionX, regionY } of regions) {
      const key = this.makeRegionKey(levelIndex, regionX, regionY);
      const region = this.regionCache.get(key);
      if (region && region.requestId === null) {
        region.loading = false;
      }
    }
  }
  /**
   * Get uniforms for rendering with scale/offset disabled.
   * Untiled mode applies per-level scale/offset in JS (in fetchRegion),
   * so we tell the shader to skip its scale/offset application.
   */
  getUniformsForRender(contextUniforms) {
    return {
      ...contextUniforms,
      scaleFactor: 1,
      offset: 0
    };
  }
  /**
   * Check if current level fully covers the visible viewport.
   * Returns true if all visible regions have valid loaded data.
   */
  currentLevelCoversViewport() {
    if (this.lastVisibleRegionsLevel !== (this.activeLevel?.index ?? -1)) {
      return false;
    }
    const levelIndex = this.activeLevel?.index ?? -1;
    for (const { regionX, regionY } of this.lastVisibleRegions) {
      const key = this.makeRegionKey(levelIndex, regionX, regionY);
      const region = this.regionCache.get(key);
      if (!region || !this.isRegionValid(region)) {
        return false;
      }
    }
    return this.lastVisibleRegions.length > 0;
  }
  /**
   * Get fallback regions from other levels that are protected from eviction.
   * These were visible before or during level transitions and provide
   * coverage while the current level loads.
   */
  getProtectedFallbackRegions() {
    const fallbacks = [];
    for (const region of this.regionCache.values()) {
      if (region.levelIndex === (this.activeLevel?.index ?? -1)) continue;
      if (!this.isRegionValid(region)) continue;
      if (!this.visibleRegionKeys.has(region.key)) continue;
      fallbacks.push(region);
    }
    return fallbacks;
  }
  /**
   * Get regions to render: current level regions plus fallbacks if needed.
   * When current level fully covers viewport, returns only current level.
   * Otherwise, includes protected fallback regions from other levels.
   */
  getLoadedRegions() {
    const currentLevel = this.activeLevel?.index ?? -1;
    const currentLevelRegions = [];
    for (const region of this.regionCache.values()) {
      if (!this.isRegionValid(region)) continue;
      if (region.levelIndex === currentLevel) {
        currentLevelRegions.push(region);
      }
    }
    if (this.currentLevelCoversViewport()) {
      return currentLevelRegions;
    }
    const fallbackRegions = this.getProtectedFallbackRegions();
    return [...fallbackRegions, ...currentLevelRegions];
  }
  /**
   * Build all index combinations from multi-value dimensions.
   * Returns cartesian product of all dimension value arrays.
   */
  buildChannelCombinations(multiValueDims) {
    let combinations = [[]];
    let labelCombinations = [[]];
    for (const { values, labels } of multiValueDims) {
      const nextCombos = [];
      const nextLabels = [];
      for (let idx = 0; idx < values.length; idx++) {
        for (let c = 0; c < combinations.length; c++) {
          nextCombos.push([...combinations[c], values[idx]]);
          nextLabels.push([...labelCombinations[c], labels[idx]]);
        }
      }
      combinations = nextCombos;
      labelCombinations = nextLabels;
    }
    return { combinations, labelCombinations };
  }
  /**
   * Find candidate regions by forward-transforming viewport edges to source CRS
   * and using grid index math to find overlapping region indices.
   *
   * This is a fast prefilter that may include false positives (e.g., for non-
   * bijective projections like UTM outside their zone). Callers must verify
   * candidates with inverse-transform overlap checks.
   *
   * On partial transform failures (projection boundary), uses valid points
   * with a wider margin. Falls back to all regions only if no points are valid.
   */
  getCandidateRegions(west, south, east, north, transformer, numRegionsX, numRegionsY, regionW, regionH, width, height) {
    if (!this.xyLimits) return [];
    const { xMin, xMax, yMin, yMax } = this.xyLimits;
    const edgeSamples = 16;
    let srcXMin = Infinity;
    let srcXMax = -Infinity;
    let srcYMin = Infinity;
    let srcYMax = -Infinity;
    let validCount = 0;
    let totalCount = 0;
    for (let i = 0; i <= edgeSamples; i++) {
      const t = i / edgeSamples;
      const lon = west + t * (east - west);
      const lat = south + t * (north - south);
      const points = [
        transformer.forward(lon, south),
        transformer.forward(lon, north),
        transformer.forward(west, lat),
        transformer.forward(east, lat)
      ];
      for (const [x, y] of points) {
        totalCount++;
        if (!isFinite(x) || !isFinite(y)) continue;
        validCount++;
        if (x < srcXMin) srcXMin = x;
        if (x > srcXMax) srcXMax = x;
        if (y < srcYMin) srcYMin = y;
        if (y > srcYMax) srcYMax = y;
      }
    }
    const interiorSamples = 4;
    for (let iy = 1; iy <= interiorSamples; iy++) {
      for (let ix = 1; ix <= interiorSamples; ix++) {
        const lon = west + ix / (interiorSamples + 1) * (east - west);
        const lat = south + iy / (interiorSamples + 1) * (north - south);
        const [x, y] = transformer.forward(lon, lat);
        totalCount++;
        if (!isFinite(x) || !isFinite(y)) continue;
        validCount++;
        if (x < srcXMin) srcXMin = x;
        if (x > srcXMax) srcXMax = x;
        if (y < srcYMin) srcYMin = y;
        if (y > srcYMax) srcYMax = y;
      }
    }
    if (validCount === 0) {
      const all = [];
      for (let ry = 0; ry < numRegionsY; ry++) {
        for (let rx = 0; rx < numRegionsX; rx++) {
          all.push({ regionX: rx, regionY: ry });
        }
      }
      return all;
    }
    const margin = validCount < totalCount ? 8 : 2;
    const pxXMin = (srcXMin - xMin) / (xMax - xMin) * width;
    const pxXMax = (srcXMax - xMin) / (xMax - xMin) * width;
    const pxYMin = (srcYMin - yMin) / (yMax - yMin) * height;
    const pxYMax = (srcYMax - yMin) / (yMax - yMin) * height;
    let rXMin, rXMax, rYMin, rYMax;
    if (this.latIsAscending === false) {
      const invYMin = height - pxYMax;
      const invYMax = height - pxYMin;
      rYMin = Math.floor(invYMin / regionH) - margin;
      rYMax = Math.floor(invYMax / regionH) + margin;
    } else {
      rYMin = Math.floor(pxYMin / regionH) - margin;
      rYMax = Math.floor(pxYMax / regionH) + margin;
    }
    rXMin = Math.floor(pxXMin / regionW) - margin;
    rXMax = Math.floor(pxXMax / regionW) + margin;
    rXMin = Math.max(0, rXMin);
    rXMax = Math.min(numRegionsX - 1, rXMax);
    rYMin = Math.max(0, rYMin);
    rYMax = Math.min(numRegionsY - 1, rYMax);
    const candidates = [];
    for (let ry = rYMin; ry <= rYMax; ry++) {
      for (let rx = rXMin; rx <= rXMax; rx++) {
        candidates.push({ regionX: rx, regionY: ry });
      }
    }
    return candidates;
  }
  /**
   * Get geographic bounds for a region.
   * Accounts for data orientation (latIsAscending).
   * Requires level-specific dimensions so async work never reaches back into
   * `activeLevel`, which may have changed since the caller captured a region.
   */
  getRegionBounds(regionX, regionY, levelMeta) {
    const { width, height, regionSize } = levelMeta;
    if (!this.xyLimits) {
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }
    const [regionH, regionW] = regionSize;
    const { xMin, xMax, yMin, yMax } = this.xyLimits;
    const pxXStart = regionX * regionW;
    const pxXEnd = Math.min(pxXStart + regionW, width);
    const pxYStart = regionY * regionH;
    const pxYEnd = Math.min(pxYStart + regionH, height);
    const geoXMin = xMin + pxXStart / width * (xMax - xMin);
    const geoXMax = xMin + pxXEnd / width * (xMax - xMin);
    let geoYMin;
    let geoYMax;
    if (this.latIsAscending === false) {
      geoYMax = yMax - pxYStart / height * (yMax - yMin);
      geoYMin = yMax - pxYEnd / height * (yMax - yMin);
    } else {
      geoYMin = yMin + pxYStart / height * (yMax - yMin);
      geoYMax = yMin + pxYEnd / height * (yMax - yMin);
    }
    return { xMin: geoXMin, xMax: geoXMax, yMin: geoYMin, yMax: geoYMax };
  }
  /**
   * Create geometry (vertex positions and tex coords) for a region.
   * Uses subdivided geometry for smooth globe rendering.
   *
   * Three geometry paths based on CRS (GPU projection chosen at render time):
   * - Proj4 datasets: Adaptive mesh with WGS84 vertices (GPU: → Mercator or → ECEF)
   * - EPSG:4326: Subdivided quad in Mercator space (GPU: fragment reprojection or ECEF direct)
   * - EPSG:3857: Subdivided quad with linear texture coords (data already in Mercator)
   */
  createRegionGeometry(regionX, regionY, gl, region) {
    if (!region.levelMeta) return;
    region.wgs84Bounds = null;
    region.indexArr = null;
    region.useIndexedMesh = false;
    const geoBounds = this.getRegionBounds(regionX, regionY, region.levelMeta);
    const mercBounds = region.mercatorBounds ?? boundsToMercatorNorm(
      geoBounds,
      this.crs
    );
    region.mercatorBounds = mercBounds;
    if (this.proj4def && this.cached4326Transformer) {
      const centerX = (geoBounds.xMin + geoBounds.xMax) / 2;
      const centerY = (geoBounds.yMin + geoBounds.yMax) / 2;
      const samplePoints = [
        this.cached4326Transformer.forward(geoBounds.xMin, geoBounds.yMin),
        this.cached4326Transformer.forward(geoBounds.xMax, geoBounds.yMin),
        this.cached4326Transformer.forward(geoBounds.xMin, geoBounds.yMax),
        this.cached4326Transformer.forward(geoBounds.xMax, geoBounds.yMax),
        this.cached4326Transformer.forward(centerX, centerY)
        // Center point (pole for polar projections)
      ];
      const validLats = samplePoints.map((p) => p[1]).filter((lat) => isFinite(lat));
      const latSpan = validLats.length > 0 ? Math.max(...validLats) - Math.min(...validLats) : 0;
      const meshSubdivisions = Math.max(
        MIN_SUBDIVISIONS,
        Math.min(MAX_SUBDIVISIONS, Math.ceil(latSpan))
      );
      const meshResult = createHybridMesh({
        geoBounds,
        width: region.width,
        height: region.height,
        subdivisions: meshSubdivisions,
        transformer: this.cached4326Transformer,
        latIsAscending: this.latIsAscending
      });
      region.vertexArr = meshResult.positions;
      region.pixCoordArr = meshResult.texCoords;
      region.indexArr = meshResult.indices;
      region.wgs84Bounds = meshResult.wgs84Bounds;
      region.useIndexedMesh = true;
      region.vertexCount = region.indexArr.length;
    } else {
      let latSpanDegrees;
      if (this.crs === "EPSG:3857") {
        const yMinNorm = 0.5 - geoBounds.yMin / (2 * WEB_MERCATOR_EXTENT);
        const yMaxNorm = 0.5 - geoBounds.yMax / (2 * WEB_MERCATOR_EXTENT);
        latSpanDegrees = Math.abs(
          mercatorNormToLat(yMaxNorm) - mercatorNormToLat(yMinNorm)
        );
      } else {
        latSpanDegrees = Math.abs(geoBounds.yMax - geoBounds.yMin);
      }
      const subdivisions = this.isGlobeProjection ? Math.max(
        MIN_SUBDIVISIONS,
        Math.min(MAX_SUBDIVISIONS, Math.ceil(latSpanDegrees))
      ) : MERCATOR_SUBDIVISIONS;
      if (this.crs === "EPSG:4326") {
        const subdivided = createSubdividedQuad(subdivisions);
        region.vertexArr = subdivided.vertexArr;
        region.pixCoordArr = subdivided.texCoordArr;
        region.vertexCount = subdivided.vertexArr.length / 2;
        const latMin = geoBounds.yMin;
        const latMax = geoBounds.yMax;
        region.mercatorBounds = {
          x0: lonToMercatorNorm(geoBounds.xMin),
          x1: lonToMercatorNorm(geoBounds.xMax),
          y0: latToMercatorNorm(latMax),
          y1: latToMercatorNorm(latMin),
          // Include lat bounds for fragment shader reprojection
          latMin,
          latMax
        };
        region.latIsAscending = this.latIsAscending;
      } else {
        const subdivided = createSubdividedQuad(subdivisions);
        region.vertexArr = subdivided.vertexArr;
        region.vertexCount = subdivided.vertexArr.length / 2;
        region.pixCoordArr = this.latIsAscending ? flipTexCoordV(subdivided.texCoordArr) : subdivided.texCoordArr;
      }
    }
    if (!region.vertexBuffer) {
      region.vertexBuffer = gl.createBuffer();
    }
    if (!region.pixCoordBuffer) {
      region.pixCoordBuffer = gl.createBuffer();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, region.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, region.vertexArr, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, region.pixCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, region.pixCoordArr, gl.STATIC_DRAW);
    if (region.useIndexedMesh && region.indexArr) {
      if (!region.indexBuffer) {
        region.indexBuffer = gl.createBuffer();
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, region.indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, region.indexArr, gl.STATIC_DRAW);
    }
  }
  /**
   * Classify a dimension by its name.
   * Used to identify spatial (lat/lon) vs non-spatial dimensions.
   */
  classifyDimension(dimKey) {
    const key = dimKey.toLowerCase();
    if (key === "lon" || key === "x" || key === "lng" || key.includes("lon")) {
      return "lon";
    }
    if (key === "lat" || key === "y" || key.includes("lat")) {
      return "lat";
    }
    if (key.includes("time")) {
      return "time";
    }
    return "other";
  }
  /**
   * Build slice arguments from a selector for all dimensions.
   * Shared logic used by both display (buildBaseSliceArgs) and queries (fetchDataForSelector).
   */
  async buildSliceArgsForSelector(selector, options) {
    const { array } = options;
    const sliceArgs = new Array(
      array.shape.length
    ).fill(0);
    const multiValueDims = [];
    const dimNames = Object.keys(this.dimIndices);
    for (const dimName of dimNames) {
      const dimInfo = this.dimIndices[dimName];
      const dimType = this.classifyDimension(dimName);
      if (dimType === "lon") {
        if (options.spatialBounds) {
          sliceArgs[dimInfo.index] = zarr4.slice(
            options.spatialBounds.minX,
            options.spatialBounds.maxX
          );
        } else {
          sliceArgs[dimInfo.index] = options.includeSpatialSlices ? zarr4.slice(0, array.shape[dimInfo.index] ?? 0) : 0;
        }
      } else if (dimType === "lat") {
        if (options.spatialBounds) {
          sliceArgs[dimInfo.index] = zarr4.slice(
            options.spatialBounds.minY,
            options.spatialBounds.maxY
          );
        } else {
          sliceArgs[dimInfo.index] = options.includeSpatialSlices ? zarr4.slice(0, array.shape[dimInfo.index] ?? 0) : 0;
        }
      } else {
        const selectionSpec = selector[dimName] || (dimType === "time" ? selector["time"] : void 0);
        if (selectionSpec !== void 0) {
          const selectionValue = selectionSpec.selected;
          const selectionType = selectionSpec.type;
          if (options.trackMultiValue && Array.isArray(selectionValue) && selectionValue.length > 1) {
            const resolvedIndices = [];
            const labelValues = [];
            for (const val of selectionValue) {
              const idx = await this.resolveSelectionIndex(
                dimName,
                dimInfo,
                val,
                selectionType
              );
              resolvedIndices.push(idx);
              labelValues.push(val);
            }
            multiValueDims.push({
              dimIndex: dimInfo.index,
              dimName,
              values: resolvedIndices,
              labels: labelValues
            });
            sliceArgs[dimInfo.index] = resolvedIndices[0];
          } else {
            const primaryValue = Array.isArray(selectionValue) ? selectionValue[0] : selectionValue;
            sliceArgs[dimInfo.index] = await this.resolveSelectionIndex(
              dimName,
              dimInfo,
              primaryValue,
              selectionType
            );
          }
        } else {
          sliceArgs[dimInfo.index] = 0;
        }
      }
    }
    return { sliceArgs, multiValueDims };
  }
  /**
   * Reset visible region state after a level switch.
   * This clears stale coordinates from the previous level and forces
   * a fresh viewport calculation on the next update.
   * Note: We intentionally do NOT clear visibleRegionKeys here - old regions
   * need eviction protection until new level's regions are computed.
   */
  resetVisibleRegions() {
    this.lastVisibleRegions = [];
    this.lastVisibleRegionsLevel = -1;
    this.lastViewportHash = "";
  }
  /**
   * Update visible regions based on current viewport.
   */
  updateVisibleRegions(map, gl) {
    const visible = this.getVisibleRegions(map);
    this.lastVisibleRegions = visible;
    this.lastVisibleRegionsLevel = this.activeLevel?.index ?? -1;
    const levelIndex = this.activeLevel?.index ?? -1;
    for (const { regionX, regionY } of visible) {
      this.visibleRegionKeys.add(
        this.makeRegionKey(levelIndex, regionX, regionY)
      );
    }
    if (this.currentLevelCoversViewport()) {
      const currentLevelPrefix = `${levelIndex}:`;
      for (const key of this.visibleRegionKeys) {
        if (!key.startsWith(currentLevelPrefix)) {
          this.visibleRegionKeys.delete(key);
        }
      }
    }
    const visibleKeys = new Set(
      visible.map(
        ({ regionX, regionY }) => this.makeRegionKey(levelIndex, regionX, regionY)
      )
    );
    for (const [key, region] of this.regionCache) {
      if (region.loading && region.levelIndex === levelIndex && region.requestId !== null && !visibleKeys.has(key)) {
        this.requestCanceller.controllers.get(region.requestId)?.abort();
      }
    }
    const newRegions = [];
    const staleRegions = [];
    for (const { regionX, regionY } of visible) {
      const key = this.makeRegionKey(levelIndex, regionX, regionY);
      const cached = this.regionCache.get(key);
      if (cached?.loading) {
        continue;
      }
      if (!cached?.data) {
        newRegions.push({ regionX, regionY });
      } else if (cached.selectorVersion !== this.selectorVersion) {
        staleRegions.push({ regionX, regionY });
      }
    }
    const viewportHash = `${levelIndex}:${this.selectorVersion}:${visible.map((r) => `${r.regionX},${r.regionY}`).join("|")}`;
    const viewportChanged = viewportHash !== this.lastViewportHash;
    this.lastViewportHash = viewportHash;
    if (newRegions.length === 0 && staleRegions.length === 0 && !viewportChanged) {
      return;
    }
    if (newRegions.length > 0) {
      this.fetchRegions(newRegions, gl);
    }
    if (staleRegions.length > 0) {
      this.fetchRegions(staleRegions, gl);
    }
  }
  /**
   * Fetch multiple regions with limited concurrency to avoid overwhelming the browser.
   */
  async fetchRegions(regions, gl) {
    if (!this.activeLevel) return;
    const level = this.activeLevel;
    const snapshot = {
      index: level.index,
      zarrArray: level.zarrArray,
      baseSliceArgs: [...level.baseSliceArgs],
      width: level.width,
      height: level.height,
      regionSize: level.regionSize,
      selectorVersion: this.selectorVersion,
      bandNames: [...this.bandNames],
      baseMultiValueDims: level.baseMultiValueDims.map((dim) => ({
        dimIndex: dim.dimIndex,
        dimName: dim.dimName,
        values: [...dim.values],
        labels: [...dim.labels]
      }))
    };
    this.loadingDebouncer.show();
    for (const { regionX, regionY } of regions) {
      const key = this.makeRegionKey(snapshot.index, regionX, regionY);
      let region = this.regionCache.get(key);
      if (!region) {
        region = this.createRegionState(snapshot.index, regionX, regionY);
        this.regionCache.set(key, region);
      }
      region.loading = true;
    }
    if ((this.activeLevel?.index ?? -1) !== snapshot.index || this.selectorVersion !== snapshot.selectorVersion) {
      cancelAllRequests(this.requestCanceller);
      this.clearBatchLoadingFlags(regions, snapshot.index);
    } else {
      const fetches = regions.map(
        ({ regionX, regionY }) => this.fetchRegion(regionX, regionY, gl, snapshot)
      );
      await Promise.allSettled(fetches);
    }
    if (!hasActiveRequests(this.requestCanceller)) {
      this.loadingDebouncer.hide();
      this.evictOldRegions(gl);
      this.invalidate();
    }
  }
  /**
   * Fetch data for a single region.
   * Handles multi-band extraction when selector has multi-value dimensions.
   * @param snapshot - Captured level state from when fetch batch started (prevents race conditions)
   */
  async fetchRegion(regionX, regionY, gl, snapshot) {
    if ((this.activeLevel?.index ?? -1) !== snapshot.index) {
      return;
    }
    if (this.isRemoved) {
      return;
    }
    const key = this.makeRegionKey(snapshot.index, regionX, regionY);
    const requestId = ++this.requestCanceller.currentVersion;
    const fetchSelectorVersion = snapshot.selectorVersion;
    const controller = new AbortController();
    this.requestCanceller.controllers.set(requestId, controller);
    let region = this.regionCache.get(key);
    if (!region) {
      region = this.createRegionState(snapshot.index, regionX, regionY);
      this.regionCache.set(key, region);
    }
    region.loading = true;
    region.requestId = requestId;
    const [regionH, regionW] = snapshot.regionSize;
    const yStart = regionY * regionH;
    const yEnd = Math.min(yStart + regionH, snapshot.height);
    const xStart = regionX * regionW;
    const xEnd = Math.min(xStart + regionW, snapshot.width);
    const actualW = xEnd - xStart;
    const actualH = yEnd - yStart;
    try {
      const baseSliceArgs = [...snapshot.baseSliceArgs];
      const latIdx = this.dimIndices.lat.index;
      const lonIdx = this.dimIndices.lon.index;
      baseSliceArgs[latIdx] = zarr4.slice(yStart, yEnd);
      baseSliceArgs[lonIdx] = zarr4.slice(xStart, xEnd);
      const desc = this.zarrStore.describe();
      const currentLevel = this.levels[snapshot.index];
      const fillValue = this.configFillValue ?? currentLevel?.fillValue ?? desc.fill_value;
      const { combinations: channelCombinations } = this.buildChannelCombinations(snapshot.baseMultiValueDims);
      const numChannels = channelCombinations.length || 1;
      const bandArrays = [];
      const isStale = () => controller.signal.aborted || this.isRemoved || (this.activeLevel?.index ?? -1) !== snapshot.index;
      if (this.variables.length > 1) {
        if (isStale()) return;
        const levelAsset = this.levels[snapshot.index].asset;
        const arrays = await this.zarrStore.getLevelArrays(
          levelAsset,
          this.variables
        );
        const results = await Promise.all(
          arrays.map(
            (arr) => zarr4.get(arr, baseSliceArgs, { signal: controller.signal })
          )
        );
        if (isStale()) return;
        for (const r of results)
          bandArrays.push(
            new Float32Array(r.data)
          );
      } else if (numChannels === 1) {
        if (isStale()) return;
        const result2 = await zarr4.get(snapshot.zarrArray, baseSliceArgs, {
          signal: controller.signal
        });
        if (isStale()) return;
        const rawData = new Float32Array(result2.data);
        bandArrays.push(rawData);
      } else {
        if (isStale()) return;
        const allSliceArgs = [];
        for (let c = 0; c < numChannels; c++) {
          const sliceArgs = [...baseSliceArgs];
          const combo = channelCombinations[c];
          for (let i = 0; i < snapshot.baseMultiValueDims.length; i++) {
            sliceArgs[snapshot.baseMultiValueDims[i].dimIndex] = combo[i];
          }
          allSliceArgs.push(sliceArgs);
        }
        const results = await Promise.all(
          allSliceArgs.map(
            (sliceArgs) => zarr4.get(snapshot.zarrArray, sliceArgs, {
              signal: controller.signal
            })
          )
        );
        if (isStale()) return;
        for (let c = 0; c < numChannels; c++) {
          const result2 = results[c];
          const bandData = new Float32Array(result2.data);
          bandArrays.push(bandData);
        }
      }
      if (fetchSelectorVersion < region.selectorVersion) return;
      region.selectorVersion = fetchSelectorVersion;
      const needsProj4MercBounds = this.proj4def && this.cachedMercatorTransformer;
      if (needsProj4MercBounds && this.xyLimits && !region.mercatorBounds) {
        const levelMeta = {
          width: snapshot.width,
          height: snapshot.height,
          regionSize: snapshot.regionSize
        };
        const geoBounds = this.getRegionBounds(regionX, regionY, levelMeta);
        region.mercatorBounds = this.computeRegionMercatorBounds(geoBounds);
      }
      const scaleFactor = currentLevel?.scaleFactor ?? desc.scaleFactor;
      const addOffset = currentLevel?.addOffset ?? desc.addOffset;
      region.bandData.clear();
      region.bandTexturesUploaded.clear();
      const normalizedBands = [];
      for (let c = 0; c < bandArrays.length; c++) {
        const bandName = snapshot.bandNames[c] || `band_${c}`;
        let bandData = bandArrays[c];
        if (scaleFactor !== 1 || addOffset !== 0) {
          const scaled = new Float32Array(bandData.length);
          for (let i = 0; i < bandData.length; i++) {
            const raw = bandData[i];
            if (fillValue !== null && raw === fillValue) {
              if (i === 0)
                console.log(
                  "[zarr-layer] fill hit: raw=",
                  raw,
                  "fillValue=",
                  fillValue
                );
              scaled[i] = NaN;
            } else if (!Number.isFinite(raw)) {
              scaled[i] = raw;
            } else {
              scaled[i] = raw * scaleFactor + addOffset;
            }
          }
          bandData = scaled;
        }
        const effectiveFillValue = scaleFactor === 1 && addOffset === 0 ? fillValue : null;
        const { normalized: bandNormalized } = normalizeDataForTexture(
          bandData,
          effectiveFillValue,
          this.fixedDataScale
        );
        region.bandData.set(bandName, bandNormalized);
        normalizedBands.push(bandNormalized);
      }
      region.data = interleaveBands(normalizedBands, numChannels);
      const needsGeometry = !region.vertexBuffer || region.width !== actualW || region.height !== actualH;
      region.width = actualW;
      region.height = actualH;
      region.channels = numChannels;
      region.loading = false;
      region.levelMeta = {
        width: snapshot.width,
        height: snapshot.height,
        regionSize: [...snapshot.regionSize]
      };
      if (!region.texture) {
        region.texture = gl.createTexture();
      }
      const result = uploadDataTexture(gl, {
        texture: region.texture,
        data: region.data,
        width: actualW,
        height: actualH,
        channels: numChannels,
        configured: false
      });
      region.textureUploaded = result.uploaded;
      if (needsGeometry) {
        this.createRegionGeometry(regionX, regionY, gl, region);
      }
      this.invalidate();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(`[fetchRegion] Error fetching region ${key}:`, err);
      }
    } finally {
      region.loading = false;
      region.requestId = null;
      this.requestCanceller.controllers.delete(requestId);
      if (controller.signal.aborted && !this.isRemoved) {
        this.invalidate();
      }
    }
  }
  update(map, gl) {
    this.cachedGl = gl;
    if (this.loadingManager.metadataLoading) {
      return;
    }
    if (this.isMultiscale && this.levels.length > 0) {
      const mapZoom = map.getZoom?.() ?? 0;
      this.desiredLevelIndex = this.selectLevelForZoom(mapZoom);
    } else {
      this.desiredLevelIndex = 0;
    }
    if (this.activeLevel?.index !== this.desiredLevelIndex) {
      if (this.loadingLevelIndex !== this.desiredLevelIndex) {
        this.loadLevel(this.desiredLevelIndex);
      }
      return;
    }
    if (this.loadingLevelIndex === this.activeLevel.index) return;
    this.updateVisibleRegions(map, gl);
  }
  /**
   * Unified level load: handles initial load, zoom-driven switch, and
   * selector-driven slice-args rebuild. Builds a `LevelRuntime` off to
   * the side and swaps it into `this.activeLevel` atomically, so readers
   * never see a half-committed level.
   *
   * `reuseArray` reuses the current committed array/dims — used by
   * `setSelector` to rebuild slice args without refetching. `loadToken`
   * acts as a cancellation token: any load whose token is stale at
   * commit time drops its result.
   */
  async loadLevel(levelIndex, { reuseArray = false } = {}) {
    if (this.isMultiscale && this.levels.length > 0) {
      if (levelIndex < 0 || levelIndex >= this.levels.length) return;
    } else if (levelIndex !== 0) {
      return;
    }
    if (this.loadingLevelIndex === levelIndex && !reuseArray) {
      return;
    }
    const token = ++this.loadToken;
    const selectorSnapshot = this.selector;
    this.loadingLevelIndex = levelIndex;
    if (this.requestCanceller.controllers.size > 0) {
      cancelAllRequests(this.requestCanceller);
      this.loadingDebouncer.hide();
    }
    try {
      const existing = this.activeLevel;
      const canReuseArray = reuseArray && existing !== null && existing.index === levelIndex;
      let newArray;
      let newWidth;
      let newHeight;
      let newRegionSize;
      if (canReuseArray) {
        newArray = existing.zarrArray;
        newWidth = existing.width;
        newHeight = existing.height;
        newRegionSize = existing.regionSize;
      } else {
        if (this.isMultiscale) {
          await this.ensureLevelMetadata(levelIndex);
          const level = this.levels[levelIndex];
          newArray = await this.zarrStore.getLevelArray(level.asset);
        } else {
          newArray = await this.zarrStore.getArray();
        }
        newWidth = newArray.shape[this.dimIndices.lon.index];
        newHeight = newArray.shape[this.dimIndices.lat.index];
        const detected = this.getRegionSize(newArray);
        newRegionSize = detected ?? [newHeight, newWidth];
      }
      const { sliceArgs, multiValueDims } = await this.buildSliceArgsForSelector(selectorSnapshot, {
        includeSpatialSlices: false,
        trackMultiValue: true,
        array: newArray
      });
      const targetStillDesired = reuseArray || !this.isMultiscale || levelIndex === this.desiredLevelIndex;
      if (token !== this.loadToken || this.isRemoved || this.selector !== selectorSnapshot || !targetStillDesired) {
        this.invalidate();
        return;
      }
      this.activeLevel = {
        index: levelIndex,
        zarrArray: newArray,
        width: newWidth,
        height: newHeight,
        regionSize: newRegionSize,
        baseSliceArgs: sliceArgs,
        baseMultiValueDims: multiValueDims
      };
      if (!canReuseArray) {
        this.resetVisibleRegions();
      }
      this.invalidate();
    } catch (err) {
      if (token === this.loadToken) {
        const assetLabel = this.isMultiscale ? this.levels[levelIndex]?.asset ?? String(levelIndex) : "single-level";
        console.error(`Failed to load level ${assetLabel}:`, err);
      }
    } finally {
      if (token === this.loadToken) {
        this.loadingLevelIndex = null;
      }
    }
  }
  selectLevelForZoom(mapZoom) {
    if (!this.xyLimits || this.levels.length === 0) return 0;
    const mapPixelsPerWorld = 256 * Math.pow(2, mapZoom);
    let worldFraction;
    if (this.proj4def && this.cachedMercatorTransformer) {
      const [minMercX] = this.cachedMercatorTransformer.forward(
        this.xyLimits.xMin,
        this.xyLimits.yMin
      );
      const [maxMercX] = this.cachedMercatorTransformer.forward(
        this.xyLimits.xMax,
        this.xyLimits.yMax
      );
      const dataWidthMeters = Math.abs(maxMercX - minMercX);
      const fullWorldMeters = 2 * WEB_MERCATOR_EXTENT;
      worldFraction = dataWidthMeters / fullWorldMeters;
    } else if (this.crs === "EPSG:3857") {
      const dataWidth = this.xyLimits.xMax - this.xyLimits.xMin;
      const fullWorldMeters = 2 * WEB_MERCATOR_EXTENT;
      worldFraction = dataWidth / fullWorldMeters;
    } else {
      const dataWidth = this.xyLimits.xMax - this.xyLimits.xMin;
      worldFraction = dataWidth / 360;
    }
    const levelResolutions = [];
    for (let i = 0; i < this.levels.length; i++) {
      const level = this.levels[i];
      if (!level.shape) continue;
      const lonIndex = this.dimIndices.lon?.index ?? level.shape.length - 1;
      const effectivePixels = level.shape[lonIndex] / worldFraction;
      levelResolutions.push({ index: i, effectivePixels });
    }
    if (levelResolutions.length === 0) return this.levels.length - 1;
    levelResolutions.sort((a, b) => a.effectivePixels - b.effectivePixels);
    for (const { index, effectivePixels } of levelResolutions) {
      if (effectivePixels >= mapPixelsPerWorld) {
        return index;
      }
    }
    return levelResolutions[levelResolutions.length - 1].index;
  }
  render(renderer, context) {
    const useMapbox = !!context.mapbox;
    const useWgs84 = !!this.proj4def && !!this.cached4326Transformer;
    const hasMaplibreGlobeTransition = context.projectionData?.projectionTransition != null && context.projectionData.projectionTransition > 0;
    const hasMapboxGlobe = useMapbox && this.isGlobeProjection;
    const hasMapboxDirectGlobePath = hasMapboxGlobe && context.mapbox?.directGlobePathActive === true;
    const ecefEligible = useWgs84 || this.crs === "EPSG:4326";
    const useDirectEcef = useMapbox ? hasMapboxDirectGlobePath && ecefEligible : hasMaplibreGlobeTransition && ecefEligible;
    if (this.pendingGeometryRebuild) {
      if (useWgs84) {
        this.pendingGeometryRebuild = false;
      } else if (!hasMaplibreGlobeTransition && !hasMapboxGlobe) {
        this.pendingGeometryRebuild = false;
        this.rebuildAllGeometry();
      }
    }
    const shaderProgram = renderer.getProgram(
      context.shaderData,
      context.customShaderConfig,
      useMapbox,
      useWgs84 || useDirectEcef,
      useDirectEcef
    );
    renderer.gl.useProgram(shaderProgram.program);
    renderer.applyCommonUniforms(
      shaderProgram,
      context.colormapTexture,
      this.getUniformsForRender(context.uniforms),
      context.customShaderConfig,
      context.projectionData,
      context.mapbox,
      context.matrix,
      false
    );
    const worldOffsets = useDirectEcef ? [0] : context.worldOffsets;
    this.renderRegions(
      renderer,
      shaderProgram,
      worldOffsets,
      context.customShaderConfig,
      useDirectEcef
    );
  }
  /**
   * Convert a RegionState to a RenderableRegion for unified rendering.
   * When useDirectEcef is true, computes WGS84 bounds and sets positionSpace/sampleMode
   * for the ECEF vertex shader path. These fields are computed at render time,
   * never cached on RegionState, so projection toggles have no stale state.
   */
  regionToRenderable(region, useDirectEcef = false) {
    const base = {
      mercatorBounds: region.mercatorBounds,
      vertexBuffer: region.vertexBuffer,
      pixCoordBuffer: region.pixCoordBuffer,
      vertexCount: region.useIndexedMesh ? region.vertexCount : region.vertexArr.length / 2,
      indexBuffer: region.indexBuffer,
      useIndexedMesh: region.useIndexedMesh,
      wgs84Bounds: region.wgs84Bounds ?? void 0,
      latIsAscending: region.latIsAscending,
      texture: region.texture,
      bandData: region.bandData,
      bandTextures: region.bandTextures,
      bandTexturesUploaded: region.bandTexturesUploaded,
      bandTexturesConfigured: region.bandTexturesConfigured,
      width: region.width,
      height: region.height
    };
    if (useDirectEcef && this.crs === "EPSG:4326" && region.mercatorBounds?.latMin != null && region.mercatorBounds?.latMax != null) {
      const mb = region.mercatorBounds;
      base.wgs84Bounds = {
        lon0: mb.x0,
        // lon mapping is linear, same as Mercator X
        lat0: latToWgs84Norm(mb.latMin),
        lon1: mb.x1,
        lat1: latToWgs84Norm(mb.latMax)
      };
      base.positionSpace = "wgs84-ecef";
      base.sampleMode = "wgs84-lookup";
      return base;
    }
    if (useDirectEcef && region.wgs84Bounds) {
      base.positionSpace = "wgs84-ecef";
      base.sampleMode = "linear";
      return base;
    }
    return base;
  }
  /**
   * Render all loaded regions using the unified render path.
   * Note: Regions have geometry already positioned in mercator space,
   * so we disable the equirectangular shader correction to avoid double transformation.
   */
  renderRegions(renderer, shaderProgram, worldOffsets, customShaderConfig, useDirectEcef = false) {
    const gl = renderer.gl;
    if (this.pendingMeanUpdate) {
      if (this.timeMeanTexture) {
        gl.deleteTexture(this.timeMeanTexture);
        this.timeMeanTexture = null;
      }
      const r = this.pendingMeanData;
      if (r && r.data.length > 0) {
        const { normalized } = normalizeDataForTexture(
          r.data,
          null,
          this.fixedDataScale
        );
        const tex = gl.createTexture();
        uploadDataTexture(gl, {
          texture: tex,
          data: normalized,
          width: r.width,
          height: r.height,
          channels: 1,
          configured: false
        });
        this.timeMeanTexture = tex;
        this.timeMeanWidth = r.width;
        this.timeMeanHeight = r.height;
        this.timeMeanPixelOffset = r.pixelOffset ?? { x: 0, y: 0 };
        this.timeMeanLevelW = r.width;
        this.timeMeanLevelH = r.height;
      }
      this.pendingMeanUpdate = false;
      this.pendingMeanData = null;
    }
    setupBandTextureUniforms(gl, shaderProgram, customShaderConfig);
    if (this.timeMeanTexture && this.activeLevel) {
      const { regionSize } = this.activeLevel;
      const [regionH, regionW] = regionSize;
      const meanW = this.timeMeanWidth;
      const meanH = this.timeMeanHeight;
      const pxOffX = this.timeMeanPixelOffset.x;
      const pxOffY = this.timeMeanPixelOffset.y;
      const scaleX = this.timeMeanLevelW > 0 ? this.timeMeanLevelW / this.activeLevel.width : 1;
      const scaleY = this.timeMeanLevelH > 0 ? this.timeMeanLevelH / this.activeLevel.height : 1;
      for (const region of this.getLoadedRegions()) {
        const rx0 = region.regionX * regionW;
        const ry0 = region.regionY * regionH;
        const crx0 = rx0 * scaleX;
        const cry0 = ry0 * scaleY;
        const crW = regionW * scaleX;
        const crH = regionH * scaleY;
        const inMeanX = crx0 < pxOffX + meanW && crx0 + crW > pxOffX;
        const inMeanY = cry0 < pxOffY + meanH && cry0 + crH > pxOffY;
        if (!inMeanX || !inMeanY) {
          renderRegion(
            gl,
            shaderProgram,
            this.regionToRenderable(region, useDirectEcef),
            worldOffsets,
            customShaderConfig
          );
          continue;
        }
        const renderable = this.regionToRenderable(region, useDirectEcef);
        renderable.texture = this.timeMeanTexture;
        const actualW = Math.min(crW, pxOffX + meanW - crx0);
        const actualH = Math.min(crH, pxOffY + meanH - cry0);
        renderable.texOffset = [
          (crx0 - pxOffX) / meanW,
          (cry0 - pxOffY) / meanH
        ];
        renderable.texScale = [actualW / meanW, actualH / meanH];
        renderRegion(
          gl,
          shaderProgram,
          renderable,
          worldOffsets,
          customShaderConfig
        );
      }
      return;
    }
    for (const region of this.getLoadedRegions()) {
      renderRegion(
        gl,
        shaderProgram,
        this.regionToRenderable(region, useDirectEcef),
        worldOffsets,
        customShaderConfig
      );
    }
  }
  renderToTile(renderer, tileId, context) {
    return renderMapboxTile({
      renderer,
      mode: this,
      tileId,
      context: {
        ...context,
        uniforms: this.getUniformsForRender(context.uniforms)
      },
      regions: this.getRegionStates()
    });
  }
  onProjectionChange(isGlobe) {
    if (this.isGlobeProjection === isGlobe) return;
    this.isGlobeProjection = isGlobe;
    if (this.proj4def) return;
    if (!isGlobe) {
      this.pendingGeometryRebuild = true;
      return;
    }
    this.rebuildAllGeometry();
  }
  rebuildAllGeometry() {
    const gl = this.cachedGl;
    if (!gl) return;
    for (const region of this.regionCache.values()) {
      if (!region.data) continue;
      this.createRegionGeometry(region.regionX, region.regionY, gl, region);
    }
    this.invalidate();
  }
  getTiledState() {
    return null;
  }
  /**
   * Get render states for all loaded regions (for multi-region rendering).
   * Includes previous level regions as fallback during level transitions.
   */
  getRegionStates() {
    if (!(this.activeLevel?.regionSize ?? null)) {
      return [];
    }
    return this.getLoadedRegions().map((region) => ({
      texture: region.texture,
      vertexBuffer: region.vertexBuffer,
      pixCoordBuffer: region.pixCoordBuffer,
      vertexArr: region.vertexArr,
      mercatorBounds: region.mercatorBounds,
      width: region.width,
      height: region.height,
      channels: this.channels,
      bandData: region.bandData,
      bandTextures: region.bandTextures,
      bandTexturesUploaded: region.bandTexturesUploaded,
      bandTexturesConfigured: region.bandTexturesConfigured,
      // Indexed mesh fields for proj4 adaptive mesh
      indexBuffer: region.indexBuffer ?? void 0,
      vertexCount: region.vertexCount,
      useIndexedMesh: region.useIndexedMesh,
      wgs84Bounds: region.wgs84Bounds ?? void 0,
      latIsAscending: region.latIsAscending
    }));
  }
  dispose(gl) {
    this.isRemoved = true;
    this.loadToken++;
    this.loadingLevelIndex = null;
    cancelAllRequests(this.requestCanceller);
    this.clearRegionCache(gl);
    if (this.timeMeanTexture) {
      gl.deleteTexture(this.timeMeanTexture);
      this.timeMeanTexture = null;
    }
    this.activeLevel = null;
    this.cachedMercatorTransformer = null;
    this.cachedWGS84Transformer = null;
    this.cached4326Transformer = null;
    this.loadingDebouncer.hide();
  }
  setLoadingCallback(callback) {
    setLoadingCallback(this.loadingManager, callback);
  }
  // PATCH[fill-override]: see PATCH-NOTES.md. Lets ZarrLayer forward the
  // explicit fillValue option so it beats metadata declarations.
  setConfigFillValue(v) {
    this.configFillValue = v;
    console.log("[PATCH fill-override] setConfigFillValue:", v);
  }
  getCRS() {
    return this.crs;
  }
  getXYLimits() {
    return this.xyLimits;
  }
  /**
   * Compute mercator bounds from proj4 by sampling edge points.
   */
  computeMercatorBoundsFromProjection() {
    if (!this.proj4def || !this.xyLimits || !this.cachedMercatorTransformer) {
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    const result = sampleEdgesToMercatorBounds(
      this.xyLimits,
      this.cachedMercatorTransformer,
      20
    );
    if (!result) {
      console.warn(
        "computeMercatorBoundsFromProjection: No valid samples found"
      );
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    return result;
  }
  /**
   * Compute mercator bounds for a specific region from source CRS bounds.
   */
  computeRegionMercatorBounds(bounds) {
    if (!this.proj4def || !this.cachedMercatorTransformer) {
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    const result = sampleEdgesToMercatorBounds(
      bounds,
      this.cachedMercatorTransformer,
      5
    );
    if (!result) {
      console.warn("computeRegionMercatorBounds: No valid samples found");
      return { x0: 0, y0: 0, x1: 1, y1: 1 };
    }
    return result;
  }
  getMaxLevelIndex() {
    return this.levels.length > 0 ? this.levels.length - 1 : 0;
  }
  getLevels() {
    return this.levels.map((l) => l.asset);
  }
  async setSelector(selector) {
    this.selector = selector;
    this.bandNames = getBands(
      this.variables.length > 1 ? this.variables : this.variables[0],
      selector
    );
    if (!this.cachedGl) {
      this.invalidate();
      return;
    }
    for (const [, region] of this.regionCache) {
      if (region.loading && region.requestId !== null) {
        this.requestCanceller.controllers.get(region.requestId)?.abort();
      }
    }
    if (this.activeLevel) {
      await this.loadLevel(this.activeLevel.index, { reuseArray: true });
    } else if (this.loadingLevelIndex !== null) {
      await this.loadLevel(this.loadingLevelIndex, { reuseArray: false });
    }
    this.selectorVersion++;
    this.lastViewportHash = "";
    this.invalidate();
  }
  emitLoadingState() {
    emitLoadingState(this.loadingManager);
  }
  async resolveSelectionIndex(dimName, dimInfo, value, type) {
    if (type === "index") {
      return typeof value === "number" ? value : 0;
    }
    if (!this.zarrStore.root) {
      return typeof value === "number" ? value : 0;
    }
    try {
      const coords = await loadDimensionValues(
        this.dimensionValues,
        null,
        dimInfo,
        this.zarrStore.root,
        this.zarrStore.version
      );
      this.dimensionValues[dimName] = coords;
      if (typeof value === "number" || typeof value === "string") {
        const coordIdx = coords.indexOf(value);
        if (coordIdx >= 0) return coordIdx;
        throw new Error(
          `[ZarrLayer] Selector value '${value}' not found in coordinate array for dimension '${dimName}'. Available values: [${coords.slice(0, 10).join(", ")}${coords.length > 10 ? ", ..." : ""}]. Use { selected: <index>, type: 'index' } to select by array index instead.`
        );
      }
    } catch (err) {
      console.debug(`Could not resolve coordinate for '${dimName}':`, err);
    }
    return typeof value === "number" ? value : 0;
  }
  /**
   * Unified method to fetch query data for either point or region queries.
   * Handles multi-value dimensions and channel combinations.
   */
  async fetchQueryData(level, selector, spatialQuery, signal) {
    try {
      const { sliceArgs: baseSliceArgs, multiValueDims } = await this.buildSliceArgsForSelector(selector, {
        includeSpatialSlices: false,
        trackMultiValue: true,
        spatialBounds: spatialQuery,
        array: level.zarrArray
      });
      const {
        combinations: channelCombinations,
        labelCombinations: channelLabelCombinations
      } = this.buildChannelCombinations(multiValueDims);
      const numChannels = channelCombinations.length || 1;
      const multiValueDimNames = multiValueDims.map((d) => d.dimName);
      const getOpts = signal ? { signal } : void 0;
      const fetchWidth = spatialQuery.maxX - spatialQuery.minX;
      const fetchHeight = spatialQuery.maxY - spatialQuery.minY;
      if (numChannels === 1) {
        const result = await zarr4.get(
          level.zarrArray,
          baseSliceArgs,
          getOpts
        );
        return {
          data: new Float32Array(result.data),
          width: fetchWidth,
          height: fetchHeight,
          channels: 1,
          channelLabels: channelLabelCombinations,
          multiValueDimNames
        };
      }
      const packedData = new Float32Array(
        fetchWidth * fetchHeight * numChannels
      );
      for (let c = 0; c < numChannels; c++) {
        const sliceArgs = [...baseSliceArgs];
        const combo = channelCombinations[c];
        for (let i = 0; i < multiValueDims.length; i++) {
          sliceArgs[multiValueDims[i].dimIndex] = combo[i];
        }
        const bandData = await zarr4.get(
          level.zarrArray,
          sliceArgs,
          getOpts
        );
        for (let pixIdx = 0; pixIdx < fetchWidth * fetchHeight; pixIdx++) {
          packedData[pixIdx * numChannels + c] = bandData.data[pixIdx];
        }
      }
      return {
        data: packedData,
        width: fetchWidth,
        height: fetchHeight,
        channels: numChannels,
        channelLabels: channelLabelCombinations,
        multiValueDimNames
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      console.error("Error fetching query data:", err);
      return null;
    }
  }
  /**
   * Compute subset bounds from pixel bounds against the full mercator bounds.
   */
  computeSubsetBounds(pixelBounds, level) {
    const { minX, maxX, minY, maxY } = pixelBounds;
    const xRange = this.mercatorBounds.x1 - this.mercatorBounds.x0;
    const yRange = this.mercatorBounds.y1 - this.mercatorBounds.y0;
    const subsetBounds = {
      x0: this.mercatorBounds.x0 + minX / level.width * xRange,
      x1: this.mercatorBounds.x0 + maxX / level.width * xRange,
      y0: this.mercatorBounds.y0 + minY / level.height * yRange,
      y1: this.mercatorBounds.y0 + maxY / level.height * yRange
    };
    if (this.mercatorBounds.latMin !== void 0 && this.mercatorBounds.latMax !== void 0) {
      const latRange = this.mercatorBounds.latMax - this.mercatorBounds.latMin;
      if (this.latIsAscending) {
        subsetBounds.latMin = this.mercatorBounds.latMin + minY / level.height * latRange;
        subsetBounds.latMax = this.mercatorBounds.latMin + maxY / level.height * latRange;
      } else {
        subsetBounds.latMax = this.mercatorBounds.latMax - minY / level.height * latRange;
        subsetBounds.latMin = this.mercatorBounds.latMax - maxY / level.height * latRange;
      }
    }
    return subsetBounds;
  }
  /**
   * Query data for point or region geometries.
   */
  async queryData(geometry, selector, options) {
    const emptyResult = () => ({
      [this.variables[0]]: [],
      dimensions: [],
      coordinates: { lat: [], lon: [] }
    });
    const activeLevel = this.activeLevel;
    if (!this.mercatorBounds || !activeLevel) return emptyResult();
    const level = {
      index: activeLevel.index,
      zarrArray: activeLevel.zarrArray,
      width: activeLevel.width,
      height: activeLevel.height
    };
    const normalizedSelector = selector ? normalizeSelector(selector) : this.selector;
    const desc = this.zarrStore.describe();
    const currentLevel = this.levels[level.index];
    const transforms = {
      scaleFactor: currentLevel?.scaleFactor ?? desc.scaleFactor,
      addOffset: currentLevel?.addOffset ?? desc.addOffset,
      // PATCH[fill-override]: configFillValue (if set) wins over metadata.
      fillValue: this.configFillValue ?? currentLevel?.fillValue ?? desc.fill_value
    };
    const sourceBounds = this.xyLimits ? [
      this.xyLimits.xMin,
      this.xyLimits.yMin,
      this.xyLimits.xMax,
      this.xyLimits.yMax
    ] : null;
    const runStrip = async (geom, pixelBounds, opts) => {
      console.log(
        "[query-debug] runStrip pixelBounds=%o level=%dx%d latIsAscending=%s proj4=%s sourceBounds=%o",
        pixelBounds,
        level.width,
        level.height,
        this.latIsAscending,
        !!this.proj4def,
        sourceBounds
      );
      const fetched = await this.fetchQueryData(
        level,
        normalizedSelector,
        pixelBounds,
        opts?.signal
      );
      console.log(
        "[query-debug] fetchQueryData result: null=%s width=%s height=%s dataLen=%s",
        !fetched,
        fetched?.width,
        fetched?.height,
        fetched?.data?.length
      );
      if (!fetched) return null;
      const subsetBounds = this.computeSubsetBounds(pixelBounds, level);
      console.log("[query-debug] subsetBounds=%o", subsetBounds);
      let subsetSourceBounds = null;
      if (this.proj4def && sourceBounds) {
        const { minX, minY, maxX, maxY } = pixelBounds;
        const [xMin, yMin] = pixelToSourceCRS(
          minX,
          minY,
          sourceBounds,
          level.width,
          level.height,
          this.latIsAscending
        );
        const [xMax, yMax] = pixelToSourceCRS(
          maxX,
          maxY,
          sourceBounds,
          level.width,
          level.height,
          this.latIsAscending
        );
        subsetSourceBounds = [
          Math.min(xMin, xMax),
          Math.min(yMin, yMax),
          Math.max(xMin, xMax),
          Math.max(yMin, yMax)
        ];
        console.log("[query-debug] subsetSourceBounds=%o", subsetSourceBounds);
      }
      return queryRegionUntiled(
        this.variables[0],
        geom,
        normalizedSelector,
        fetched.data,
        fetched.width,
        fetched.height,
        subsetBounds,
        this.crs ?? "EPSG:4326",
        desc.dimensions,
        desc.coordinates,
        fetched.channels,
        fetched.channelLabels,
        fetched.multiValueDimNames,
        this.latIsAscending,
        transforms,
        this.proj4def,
        subsetSourceBounds,
        opts,
        desc.dimIndices
      );
    };
    const singleFetch = async (geom) => {
      console.log(
        "[query-debug] singleFetch: mercatorBounds=%o level=%dx%d crs=%s latIsAscending=%s proj4=%s sourceBounds=%o",
        this.mercatorBounds,
        level.width,
        level.height,
        this.crs,
        this.latIsAscending,
        !!this.proj4def,
        sourceBounds
      );
      const pixelBounds = computePixelBoundsFromGeometry(
        geom,
        this.mercatorBounds,
        level.width,
        level.height,
        this.crs ?? "EPSG:4326",
        this.latIsAscending,
        this.proj4def,
        sourceBounds,
        this.cachedWGS84Transformer ?? void 0
      );
      console.log(
        "[query-debug] computePixelBoundsFromGeometry => %o",
        pixelBounds
      );
      if (!pixelBounds) return emptyResult();
      const result = await runStrip(geom, pixelBounds, options);
      return result ?? emptyResult();
    };
    if (this.proj4def) {
      const { bbox } = preprocessQueryGeometry(geometry);
      if (bbox.crossesAntimeridian) {
        if (!this._antimeridianWarnings.has("proj4-crossing")) {
          this._antimeridianWarnings.add("proj4-crossing");
          console.warn(
            "Antimeridian-crossing polygon queries are not supported for proj4 projections; results may be incorrect"
          );
        }
      }
      return singleFetch(geometry);
    }
    const { geometry: processedGeometry, bbox: wrappedBbox } = preprocessQueryGeometry(geometry);
    if (!wrappedBbox.crossesAntimeridian) {
      return singleFetch(processedGeometry);
    }
    if (rasterExtentCrossesAntimeridian(this.crs ?? "EPSG:4326", this.xyLimits)) {
      if (!this._antimeridianWarnings.has("raster-extent-crossing")) {
        this._antimeridianWarnings.add("raster-extent-crossing");
        console.warn(
          "Antimeridian-crossing polygon queries are not supported for rasters whose own extent crosses the antimeridian; results may be incorrect"
        );
      }
      return singleFetch(geometry);
    }
    const spans = wrappedBboxToPixelSpans(
      wrappedBbox,
      this.mercatorBounds,
      level.width,
      level.height,
      this.crs ?? "EPSG:4326",
      this.latIsAscending
    );
    const westResult = spans.west ? await runStrip(processedGeometry, spans.west, options) : null;
    const eastResult = spans.east ? await runStrip(processedGeometry, spans.east, options) : null;
    if (spans.west && !westResult || spans.east && !eastResult) {
      return emptyResult();
    }
    if (!westResult && !eastResult) return emptyResult();
    if (!westResult || !eastResult) return westResult ?? eastResult;
    const { yDim, xDim } = findSpatialDimNames(
      desc.dimensions,
      false,
      desc.dimIndices
    );
    return mergeQueryResults(
      westResult,
      eastResult,
      this.variables[0],
      yDim,
      xDim
    );
  }
  async queryTimeSeries(geometry, options) {
    const timeDim = options?.timeDimension ?? "time";
    const start = options?.start ?? 0;
    const step = options?.step ?? 1;
    const empty = () => ({
      variable: options?.variable ?? this.variables[0],
      values: [],
      timeIndices: []
    });
    const activeLevel = this.activeLevel;
    if (!this.mercatorBounds || !activeLevel) return empty();
    const coarsestIdx = this.levels.length > 0 ? this.levels.length - 1 : activeLevel.index;
    const coarsestLevelInfo = this.levels[coarsestIdx];
    const tsBaseArray = coarsestLevelInfo && coarsestIdx !== activeLevel.index ? await this.zarrStore.getLevelArray(coarsestLevelInfo.asset) : activeLevel.zarrArray;
    let tsWidth = activeLevel.width;
    let tsHeight = activeLevel.height;
    if (coarsestLevelInfo && coarsestIdx !== activeLevel.index) {
      for (const [name, info] of Object.entries(this.dimIndices)) {
        const t = this.classifyDimension(name);
        if (t === "lat")
          tsHeight = tsBaseArray.shape[info.index] ?? tsHeight;
        else if (t === "lon")
          tsWidth = tsBaseArray.shape[info.index] ?? tsWidth;
      }
    }
    const level = {
      index: coarsestIdx,
      zarrArray: tsBaseArray,
      width: tsWidth,
      height: tsHeight
    };
    const sourceBounds = this.xyLimits ? [
      this.xyLimits.xMin,
      this.xyLimits.yMin,
      this.xyLimits.xMax,
      this.xyLimits.yMax
    ] : null;
    const pixelBounds = computePixelBoundsFromGeometry(
      geometry,
      this.mercatorBounds,
      level.width,
      level.height,
      this.crs ?? "EPSG:4326",
      this.latIsAscending,
      this.proj4def,
      sourceBounds,
      this.cachedWGS84Transformer ?? void 0
    );
    console.log("[time-series] pixelBounds=%o", pixelBounds);
    if (!pixelBounds) return empty();
    const px = Math.max(
      0,
      Math.min(Math.floor(pixelBounds.minX), level.width - 1)
    );
    const py = Math.max(
      0,
      Math.min(Math.floor(pixelBounds.minY), level.height - 1)
    );
    console.log(
      "[time-series] px=%d py=%d level=%dx%d start=%d end=%s",
      px,
      py,
      level.width,
      level.height,
      start,
      options?.end
    );
    const normalizedSelector = options?.selector ? normalizeSelector(options.selector) : this.selector;
    const { sliceArgs } = await this.buildSliceArgsForSelector(
      normalizedSelector,
      {
        includeSpatialSlices: false,
        trackMultiValue: false,
        array: level.zarrArray
      }
    );
    let timeAxisLength = 0;
    for (const [name, dimInfo] of Object.entries(this.dimIndices)) {
      const dimType = this.classifyDimension(name);
      if (dimType === "lat") {
        sliceArgs[dimInfo.index] = py;
      } else if (dimType === "lon") {
        sliceArgs[dimInfo.index] = px;
      } else if (dimType === "time" || name === timeDim) {
        timeAxisLength = level.zarrArray.shape[dimInfo.index] ?? 0;
        const end = Math.min(options?.end ?? timeAxisLength, timeAxisLength);
        sliceArgs[dimInfo.index] = zarr4.slice(start, end, step);
      }
    }
    if (timeAxisLength === 0) return empty();
    let queryArray = level.zarrArray;
    let scaleFactor;
    let addOffset;
    let fillValue;
    if (options?.variable) {
      const levelAsset = this.levels[level.index]?.asset;
      const key = levelAsset ? `${levelAsset}/${options.variable}` : options.variable;
      queryArray = await this.zarrStore.openArray(key);
      const attrs = queryArray.attrs;
      const rawFill = queryArray.fillValue;
      fillValue = typeof rawFill === "number" ? rawFill : typeof rawFill === "string" ? Number(rawFill) : null;
      scaleFactor = attrs?.scale_factor ?? 1;
      addOffset = attrs?.add_offset ?? 0;
    } else {
      const desc = this.zarrStore.describe();
      const currentLevel = this.levels[level.index];
      scaleFactor = currentLevel?.scaleFactor ?? desc.scaleFactor;
      addOffset = currentLevel?.addOffset ?? desc.addOffset;
      fillValue = this.configFillValue ?? currentLevel?.fillValue ?? desc.fill_value;
    }
    console.log(
      "[time-series] sliceArgs=%o shape=%o variable=%s",
      sliceArgs,
      level.zarrArray.shape,
      options?.variable ?? this.variables[0]
    );
    const getOpts = options?.signal ? { signal: options.signal } : void 0;
    const result = await zarr4.get(queryArray, sliceArgs, getOpts);
    console.log(
      "[time-series] scaleFactor=%s addOffset=%s fillValue=%s result.data.length=%d",
      scaleFactor,
      addOffset,
      fillValue,
      result.data.length
    );
    console.log(
      "[time-series] raw[0..4]=%o",
      Array.from(result.data).slice(0, 5)
    );
    const actualEnd = Math.min(options?.end ?? timeAxisLength, timeAxisLength);
    const count = Math.ceil((actualEnd - start) / step);
    const timeIndices = Array.from(
      { length: count },
      (_, i) => start + i * step
    );
    const values = Array.from(result.data).map((raw) => {
      const v = Number(raw);
      if (!Number.isFinite(v)) return NaN;
      if (Math.abs(v) > 1e30) return NaN;
      if (fillValue !== null) {
        if (v === fillValue) return NaN;
        if (Math.abs(v - fillValue) / (Math.abs(fillValue) || 1) < 1e-4)
          return NaN;
      }
      return v * scaleFactor + addOffset;
    });
    console.log(
      "[time-series] count=%d timeIndices[0]=%d values[0]=%s values.length=%d",
      count,
      timeIndices[0],
      values[0],
      values.length
    );
    return {
      variable: options?.variable ?? this.variables[0],
      values,
      timeIndices
    };
  }
  setTimeMeanData(result) {
    this.pendingMeanData = result;
    this.pendingMeanUpdate = true;
    this.invalidate();
  }
  async computeTimeMean(options) {
    const timeDim = options?.timeDimension ?? "time";
    const rawStart = options?.start;
    const start = rawStart != null && Number.isFinite(rawStart) ? Math.max(0, Math.floor(rawStart)) : 0;
    const step = options?.step ?? 1;
    const empty = () => ({
      variable: this.variables[0],
      data: new Float32Array(0),
      height: 0,
      width: 0,
      latIsAscending: this.latIsAscending
    });
    const activeLevel = this.activeLevel;
    if (!activeLevel) return empty();
    const coarsestIdx = this.levels.length > 0 ? this.levels.length - 1 : activeLevel.index;
    const coarsestLevelInfo = this.levels[coarsestIdx];
    const meanBaseArray = coarsestLevelInfo && coarsestIdx !== activeLevel.index ? await this.zarrStore.getLevelArray(coarsestLevelInfo.asset) : activeLevel.zarrArray;
    let meanLevelW = activeLevel.width;
    let meanLevelH = activeLevel.height;
    if (coarsestLevelInfo && coarsestIdx !== activeLevel.index) {
      for (const [name, info] of Object.entries(this.dimIndices)) {
        const t = this.classifyDimension(name);
        if (t === "lat")
          meanLevelH = meanBaseArray.shape[info.index] ?? meanLevelH;
        else if (t === "lon")
          meanLevelW = meanBaseArray.shape[info.index] ?? meanLevelW;
      }
    }
    const level = {
      index: coarsestIdx,
      zarrArray: meanBaseArray,
      width: meanLevelW,
      height: meanLevelH
    };
    const normalizedSelector = options?.selector ? normalizeSelector(options.selector) : this.selector;
    const { sliceArgs } = await this.buildSliceArgsForSelector(
      normalizedSelector,
      {
        includeSpatialSlices: true,
        trackMultiValue: false,
        array: level.zarrArray
      }
    );
    const pixelOffset = { x: 0, y: 0 };
    let timeAxisLength = 0;
    for (const [name, dimInfo] of Object.entries(this.dimIndices)) {
      const dimType = this.classifyDimension(name);
      if (dimType === "time" || name === timeDim) {
        timeAxisLength = level.zarrArray.shape[dimInfo.index] ?? 0;
        const rawEnd = options?.end;
        const end = rawEnd != null && Number.isFinite(rawEnd) ? Math.min(Math.floor(rawEnd), timeAxisLength) : timeAxisLength;
        sliceArgs[dimInfo.index] = zarr4.slice(start, Math.max(start, end), step);
      }
    }
    if (timeAxisLength === 0) return empty();
    const estimatedElements = sliceArgs.reduce((acc, arg) => {
      if (typeof arg === "number") return acc;
      const s = arg;
      const n = Math.max(
        0,
        Math.ceil(((s.stop ?? 1) - (s.start ?? 0)) / (s.step ?? 1))
      );
      return acc * n;
    }, 1);
    if (estimatedElements > 1e8) {
      throw new Error(
        `Time mean requires too many data points (${(estimatedElements / 1e6).toFixed(0)}M). Please specify a date range to limit the computation.`
      );
    }
    const getOpts = options?.signal ? { signal: options.signal } : void 0;
    const result = await zarr4.get(level.zarrArray, sliceArgs, getOpts);
    const sliceEntries = Object.entries(this.dimIndices).filter(([, dimInfo]) => typeof sliceArgs[dimInfo.index] !== "number").sort((a, b) => a[1].index - b[1].index);
    let timeOutAxis = -1;
    let latOutAxis = -1;
    let lonOutAxis = -1;
    sliceEntries.forEach(([name, _dimInfo], outAxis) => {
      const dimType = this.classifyDimension(name);
      if (dimType === "time" || name === timeDim) {
        timeOutAxis = outAxis;
      } else if (dimType === "lat") {
        latOutAxis = outAxis;
      } else if (dimType === "lon") {
        lonOutAxis = outAxis;
      }
    });
    if (timeOutAxis === -1 || latOutAxis === -1 || lonOutAxis === -1)
      return empty();
    const shape = result.shape;
    const ndim = shape.length;
    const strides = new Array(ndim);
    strides[ndim - 1] = 1;
    for (let i = ndim - 2; i >= 0; i--) {
      strides[i] = strides[i + 1] * shape[i + 1];
    }
    const tLen = shape[timeOutAxis];
    const height = shape[latOutAxis];
    const width = shape[lonOutAxis];
    const desc = this.zarrStore.describe();
    const currentLevel = this.levels[level.index];
    const scaleFactor = currentLevel?.scaleFactor ?? desc.scaleFactor;
    const addOffset = currentLevel?.addOffset ?? desc.addOffset;
    const fillValue = this.configFillValue ?? currentLevel?.fillValue ?? desc.fill_value;
    const strideT = strides[timeOutAxis];
    const strideY = strides[latOutAxis];
    const strideX = strides[lonOutAxis];
    const sumArr = new Float64Array(height * width);
    const countArr = new Int32Array(height * width);
    for (let t = 0; t < tLen; t++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const flatIn = t * strideT + y * strideY + x * strideX;
          const raw = Number(result.data[flatIn]);
          if (!Number.isFinite(raw)) continue;
          if (Math.abs(raw) > 1e30) continue;
          if (fillValue !== null) {
            if (raw === fillValue) continue;
            if (Math.abs(raw - fillValue) / (Math.abs(fillValue) || 1) < 1e-4)
              continue;
          }
          const physical = raw * scaleFactor + addOffset;
          const flatOut = y * width + x;
          sumArr[flatOut] += physical;
          countArr[flatOut]++;
        }
      }
    }
    const meanData = new Float32Array(height * width);
    for (let i = 0; i < meanData.length; i++) {
      meanData[i] = countArr[i] > 0 ? sumArr[i] / countArr[i] : NaN;
    }
    return {
      variable: this.variables[0],
      data: meanData,
      height,
      width,
      latIsAscending: this.latIsAscending,
      pixelOffset
    };
  }
};
function mergeQueryResults(a, b, variable, yDim, xDim) {
  const spatialKeys = /* @__PURE__ */ new Set([yDim, xDim]);
  const coordinates = {};
  for (const key of Object.keys(a.coordinates)) {
    if (spatialKeys.has(key)) {
      coordinates[key] = [...a.coordinates[key], ...b.coordinates[key]];
    } else {
      coordinates[key] = a.coordinates[key];
    }
  }
  const aVals = a[variable];
  const bVals = b[variable];
  let merged;
  if (Array.isArray(aVals) && Array.isArray(bVals)) {
    merged = [...aVals, ...bVals];
  } else if (!Array.isArray(aVals) && !Array.isArray(bVals)) {
    merged = mergeNestedValues(aVals, bVals);
  } else {
    merged = aVals;
  }
  return {
    [variable]: merged,
    dimensions: a.dimensions,
    coordinates
  };
}
function mergeNestedValues(a, b) {
  const result = {};
  for (const key of Object.keys(a)) {
    const aVal = a[key];
    const bVal = b[key];
    if (Array.isArray(aVal) && Array.isArray(bVal)) {
      result[key] = [...aVal, ...bVal];
    } else if (aVal && bVal && !Array.isArray(aVal) && !Array.isArray(bVal) && typeof aVal === "object" && typeof bVal === "object") {
      result[key] = mergeNestedValues(
        aVal,
        bVal
      );
    } else {
      result[key] = aVal;
    }
  }
  for (const key of Object.keys(b)) {
    if (!(key in result)) {
      result[key] = b[key];
    }
  }
  return result;
}

// src/zarr-layer.ts
function getMapboxGlobeInternals(map) {
  const m = map;
  return {
    expandedFarZProjMatrix: m.transform?.expandedFarZProjMatrix ?? m.painter?.transform?.expandedFarZProjMatrix,
    worldSize: m.transform?.worldSize ?? m.painter?.transform?.worldSize
  };
}
function scaleMercatorMatrix(matrix, scale) {
  const out = new Float32Array(matrix);
  for (let i = 0; i < 4; i++) out[i] *= scale;
  for (let i = 4; i < 8; i++) out[i] *= scale;
  for (let i = 8; i < 12; i++) out[i] *= scale;
  return out;
}
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
function mapboxGlobeToMercatorTransition(zoom) {
  return smoothstep(5, 6, zoom);
}
var ZarrLayer = class {
  constructor({
    id,
    source,
    variable,
    selector = {},
    colormap,
    clim,
    opacity = 1,
    minzoom = 0,
    maxzoom = Infinity,
    zarrVersion,
    spatialDimensions = {},
    bounds,
    crs,
    latIsAscending = null,
    fillValue,
    customFrag,
    uniforms,
    renderingMode = "3d",
    onLoadingStateChange,
    proj4: proj42,
    transformRequest,
    store,
    renderPoles = false
  }) {
    this.type = "custom";
    this.variables = [];
    this.zarrVersion = null;
    this.latIsAscending = null;
    this.selectorHash = "";
    this._fillValue = null;
    // PATCH[fill-override]: separate from _fillValue so we only override the
    // mode's metadata-derived fill when the user explicitly declared one.
    this._fillValueFromConfig = null;
    this.scaleFactor = 1;
    this.offset = 0;
    // Once true, fixedDataScale is locked (mode has captured it)
    this.dataScaleLocked = false;
    this.map = null;
    this.renderer = null;
    this.mode = null;
    this.tileNeedsRender = true;
    this.projectionChangeHandler = null;
    this.zarrStore = null;
    this.levelInfos = [];
    this.dimIndices = {};
    this.dimensionValues = {};
    this.normalizedSelector = {};
    this.isRemoved = false;
    this.fragmentShaderSource = maplibreFragmentShaderSource;
    this.customUniforms = {};
    this.bandNames = [];
    this.customShaderConfig = null;
    this.metadataLoading = false;
    this.chunksLoading = false;
    this.initError = null;
    this.lastIsGlobe = null;
    this.usingDirectMapboxGlobePath = false;
    this.mapboxDirectGlobePathAvailable = false;
    this.handleChunkLoadingChange = (state) => {
      this.chunksLoading = state.chunks;
      this.emitLoadingState();
    };
    if (!id) {
      throw new Error("[ZarrLayer] id is required");
    }
    if (!source && !store) {
      throw new Error(
        "[ZarrLayer] source is required when store is not provided"
      );
    }
    if (!variable) {
      throw new Error("[ZarrLayer] variable is required");
    }
    if (!colormap || !Array.isArray(colormap) || colormap.length === 0) {
      throw new Error(
        "[ZarrLayer] colormap is required and must be an array of [r, g, b] or hex string values"
      );
    }
    if (!clim || !Array.isArray(clim) || clim.length !== 2) {
      throw new Error("[ZarrLayer] clim is required and must be [min, max]");
    }
    if (proj42 && !bounds) {
      console.warn(
        `[ZarrLayer] proj4 provided without explicit bounds. Bounds will be derived from coordinate arrays if available (see subsequent log for values). For best performance, provide bounds in source CRS units.`
      );
    }
    this.id = id;
    this.url = source ?? id;
    this.variables = Array.isArray(variable) ? variable : [variable];
    this.zarrVersion = zarrVersion ?? null;
    this.spatialDimensions = spatialDimensions;
    this.bounds = bounds;
    this.crs = crs;
    this.latIsAscending = latIsAscending ?? null;
    this.selector = selector;
    this.normalizedSelector = normalizeSelector(selector);
    this.selectorHash = hashSelector(this.normalizedSelector);
    this.renderingMode = renderingMode;
    this.invalidate = () => {
    };
    this.colormap = new ColormapState(colormap);
    this.clim = clim;
    this.fixedDataScale = Math.max(Math.abs(clim[0]), Math.abs(clim[1]), 1);
    this.opacity = opacity;
    this.minZoom = minzoom;
    this.maxZoom = maxzoom;
    this.customFrag = customFrag;
    this.customUniforms = uniforms || {};
    this.bandNames = getBands(
      this.variables.length > 1 ? this.variables : this.variables[0],
      this.normalizedSelector
    );
    if (this.bandNames.length > 1 || customFrag) {
      this.customShaderConfig = {
        bands: this.bandNames,
        customFrag,
        customUniforms: this.customUniforms
      };
    }
    if (fillValue !== void 0) {
      this._fillValue = fillValue;
      this._fillValueFromConfig = fillValue;
    }
    this.onLoadingStateChange = onLoadingStateChange;
    this.proj4 = proj42;
    this.transformRequest = transformRequest;
    this.customStore = store;
    this.renderPoles = renderPoles;
  }
  resolveGl(map, gl) {
    const isWebGL2 = gl && typeof gl.getUniformLocation === "function" && typeof gl.drawBuffers === "function";
    if (isWebGL2) {
      return gl;
    }
    const describe = (obj) => obj ? {
      type: obj.constructor?.name,
      keys: Object.keys(obj)
    } : null;
    console.error("Invalid WebGL2 context passed to onAdd", {
      providedGl: describe(gl),
      painterGl: describe(map?.painter?.context?.gl),
      rendererGl: describe(map?.renderer?.getContext?.())
    });
    throw new Error("`map` did not provide a valid WebGL2 context");
  }
  canUseMapboxDirectGlobePath() {
    if (this.mapboxDirectGlobePathAvailable) {
      return true;
    }
    if (!this.map || !this.isGlobeProjection()) {
      return false;
    }
    const { expandedFarZProjMatrix, worldSize } = getMapboxGlobeInternals(
      this.map
    );
    if (expandedFarZProjMatrix && worldSize) {
      this.mapboxDirectGlobePathAvailable = true;
      return true;
    }
    return false;
  }
  configureMapboxRenderPath() {
    if (!this.map || !this.mode) return;
    const isUntiled = this.mode instanceof UntiledMode;
    const resolvedProj4 = this.zarrStore?.proj4 ?? this.proj4;
    const resolvedCrs = this.zarrStore?.crs ?? this.crs;
    const isEcefEligible = !!resolvedProj4 || resolvedCrs === "EPSG:4326";
    const isGlobe = this.isGlobeProjection();
    const transition = this.map.getZoom && isGlobe ? mapboxGlobeToMercatorTransition(this.map.getZoom()) : 1;
    const shouldUseDirectGlobePath = this.renderPoles && isUntiled && isEcefEligible && !this.map.getTerrain?.() && isGlobe && this.canUseMapboxDirectGlobePath() && transition <= 1e-3;
    if (shouldUseDirectGlobePath === this.usingDirectMapboxGlobePath) return;
    this.usingDirectMapboxGlobePath = shouldUseDirectGlobePath;
    if (shouldUseDirectGlobePath) {
      Object.defineProperty(this, "renderToTile", {
        value: void 0,
        configurable: true,
        writable: true
      });
      this.map.triggerRepaint?.();
    } else if (Object.prototype.hasOwnProperty.call(this, "renderToTile")) {
      delete this.renderToTile;
      this.tileNeedsRender = true;
      this.map.triggerRepaint?.();
    }
  }
  get fillValue() {
    return this._fillValue;
  }
  isGlobeProjection() {
    const projection = this.map?.getProjection ? this.map.getProjection() : null;
    return isGlobeProjection(projection);
  }
  /** Check for projection changes and notify mode. Returns current isGlobe state. */
  syncProjectionState() {
    const isGlobe = this.isGlobeProjection();
    if (this.lastIsGlobe !== null && this.lastIsGlobe !== isGlobe) {
      this.mode?.onProjectionChange(isGlobe);
    }
    this.lastIsGlobe = isGlobe;
    return isGlobe;
  }
  emitLoadingState() {
    if (!this.onLoadingStateChange) return;
    this.onLoadingStateChange({
      loading: this.metadataLoading || this.chunksLoading,
      metadata: this.metadataLoading,
      chunks: this.chunksLoading,
      error: this.initError
    });
  }
  setOpacity(opacity) {
    this.opacity = opacity;
    this.invalidate();
  }
  setClim(clim) {
    this.clim = clim;
    if (!this.dataScaleLocked) {
      this.fixedDataScale = Math.max(Math.abs(clim[0]), Math.abs(clim[1]), 1);
    }
    this.invalidate();
  }
  setColormap(colormap) {
    this.colormap.apply(colormap);
    if (this.gl) {
      this.colormap.upload(this.gl);
    }
    this.invalidate();
  }
  setUniforms(uniforms) {
    if (!this.customShaderConfig) {
      console.warn(
        "[ZarrLayer] setUniforms() called but layer was not created with customFrag. Uniforms will not be applied. Recreate the layer with customFrag and uniforms options."
      );
      return;
    }
    this.customUniforms = { ...this.customUniforms, ...uniforms };
    this.customShaderConfig.customUniforms = this.customUniforms;
    this.invalidate();
  }
  async setVariable(variable) {
    const normalized = Array.isArray(variable) ? variable : [variable];
    if (JSON.stringify(normalized) === JSON.stringify(this.variables)) return;
    this.metadataLoading = true;
    this.emitLoadingState();
    try {
      this.initError = null;
      this.variables = normalized;
      if (this.zarrStore) {
        this.zarrStore.cleanup();
        this.zarrStore = null;
      }
      this.dimensionValues = {};
      this._fillValue = null;
      this.dataScaleLocked = false;
      this.fixedDataScale = Math.max(
        Math.abs(this.clim[0]),
        Math.abs(this.clim[1]),
        1
      );
      await this.initialize();
      await this.initializeMode();
      this.invalidate();
    } catch (err) {
      this.initError = err instanceof Error ? err : new Error(String(err));
      console.error("[zarr-layer] Failed to reset:", this.initError.message);
      if (this.mode && this.gl) {
        this.mode.dispose(this.gl);
        this.mode = null;
      }
      if (this.zarrStore) {
        this.zarrStore.cleanup();
        this.zarrStore = null;
      }
    } finally {
      this.metadataLoading = false;
      this.emitLoadingState();
    }
  }
  async setSelector(selector) {
    const normalized = normalizeSelector(selector);
    const nextHash = hashSelector(normalized);
    if (nextHash === this.selectorHash) {
      return;
    }
    this.selectorHash = nextHash;
    this.selector = selector;
    this.normalizedSelector = normalized;
    this.bandNames = getBands(
      this.variables.length > 1 ? this.variables : this.variables[0],
      this.normalizedSelector
    );
    if (this.bandNames.length > 1 || this.customFrag) {
      this.customShaderConfig = {
        bands: this.bandNames,
        customFrag: this.customFrag,
        customUniforms: this.customUniforms
      };
    } else {
      this.customShaderConfig = null;
    }
    if (this.mode) {
      await this.mode.setSelector(this.normalizedSelector);
    }
    this.invalidate();
  }
  onAdd(map, gl) {
    this._onAddAsync(map, gl);
  }
  async _onAddAsync(map, gl) {
    this.map = map;
    const resolvedGl = this.resolveGl(map, gl);
    this.gl = resolvedGl;
    this.invalidate = () => {
      this.tileNeedsRender = true;
      if (map.triggerRepaint) map.triggerRepaint();
    };
    this.initError = null;
    this.metadataLoading = true;
    this.emitLoadingState();
    try {
      this.colormap.upload(resolvedGl);
      this.renderer = new ZarrRenderer(
        resolvedGl,
        this.fragmentShaderSource
      );
      this.projectionChangeHandler = () => {
        const isGlobe2 = this.isGlobeProjection();
        if (this.lastIsGlobe !== isGlobe2) {
          this.mode?.onProjectionChange(isGlobe2);
          this.lastIsGlobe = isGlobe2;
        }
        this.configureMapboxRenderPath();
      };
      if (typeof map.on === "function" && this.projectionChangeHandler) {
        map.on("projectionchange", this.projectionChangeHandler);
        map.on("style.load", this.projectionChangeHandler);
        map.on("move", this.projectionChangeHandler);
      }
      await this.initialize();
      await this.initializeMode();
      this.configureMapboxRenderPath();
      const isGlobe = this.isGlobeProjection();
      this.lastIsGlobe = isGlobe;
      this.mode?.onProjectionChange(isGlobe);
      this.mode?.update(this.map, this.gl);
    } catch (err) {
      this.initError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[zarr-layer] Failed to initialize: ${this.initError.message}. Use onLoadingStateChange callback to handle errors and call map.removeLayer('${this.id}') to clean up.`
      );
      this._disposeResources(resolvedGl);
    } finally {
      this.metadataLoading = false;
      this.emitLoadingState();
    }
    if (!this.initError) {
      this.invalidate();
    }
  }
  async initializeMode() {
    if (!this.zarrStore || !this.gl) return;
    if (this.mode) {
      this.mode.dispose(this.gl);
    }
    const desc = this.zarrStore.describe();
    if (desc.multiscaleType === "tiled") {
      this.mode = new TiledMode(
        this.zarrStore,
        this.variables[0],
        this.normalizedSelector,
        this.invalidate,
        this.fixedDataScale
      );
    } else {
      this.mode = new UntiledMode(
        this.zarrStore,
        this.variables,
        this.normalizedSelector,
        this.invalidate,
        this.fixedDataScale
      );
      this.mode.setConfigFillValue(this._fillValueFromConfig);
    }
    this.dataScaleLocked = true;
    this.mode.setLoadingCallback(this.handleChunkLoadingChange);
    await this.mode.initialize();
    if (this.map && this.gl) {
      this.mode.update(this.map, this.gl);
    }
  }
  async initialize() {
    try {
      this.zarrStore = new ZarrStore({
        source: this.url,
        version: this.zarrVersion,
        variable: this.variables[0],
        spatialDimensions: this.spatialDimensions,
        bounds: this.bounds,
        crs: this.crs,
        latIsAscending: this.latIsAscending,
        coordinateKeys: Object.keys(this.selector),
        proj4: this.proj4,
        transformRequest: this.transformRequest,
        customStore: this.customStore
      });
      await this.zarrStore.initialized;
      const desc = this.zarrStore.describe();
      this.levelInfos = desc.levels;
      this.dimIndices = desc.dimIndices;
      this.scaleFactor = desc.scaleFactor;
      this.offset = desc.addOffset;
      if (this._fillValue === null && desc.fill_value !== null && desc.fill_value !== void 0) {
        this._fillValue = desc.fill_value;
      }
      this.normalizedSelector = normalizeSelector(this.selector);
      await this.loadInitialDimensionValues();
      this.bandNames = getBands(
        this.variables.length > 1 ? this.variables : this.variables[0],
        this.normalizedSelector
      );
      if (this.bandNames.length > 1 || this.customFrag) {
        this.customShaderConfig = {
          bands: this.bandNames,
          customFrag: this.customFrag,
          customUniforms: this.customUniforms
        };
      } else {
        this.customShaderConfig = null;
      }
    } catch (err) {
      if (this.zarrStore) {
        this.zarrStore.cleanup();
        this.zarrStore = null;
      }
      throw err;
    }
  }
  async loadInitialDimensionValues() {
    if (!this.zarrStore?.root) return;
    const multiscaleLevel = this.levelInfos.length > 0 ? this.levelInfos[0] : null;
    for (const [dimName, value] of Object.entries(this.selector)) {
      this.normalizedSelector[dimName] = toSelectorProps(value);
    }
    for (const dimName of Object.keys(this.dimIndices)) {
      if (!SPATIAL_DIM_NAMES.has(dimName.toLowerCase())) {
        try {
          this.dimensionValues[dimName] = await loadDimensionValues(
            this.dimensionValues,
            multiscaleLevel,
            this.dimIndices[dimName],
            this.zarrStore.root,
            this.zarrStore.version
          );
          if (!this.normalizedSelector[dimName]) {
            this.normalizedSelector[dimName] = { selected: 0 };
          }
        } catch (err) {
          if (!(err instanceof Error && err.name === "NotFoundError")) {
            console.warn(`Failed to load dimension values for ${dimName}:`, err);
          }
        }
      }
    }
  }
  isZoomInRange() {
    if (!this.map?.getZoom) return true;
    const zoom = Math.max(0, this.map.getZoom());
    return zoom >= this.minZoom && zoom <= this.maxZoom;
  }
  prerender(_gl, _params) {
    if (this.isRemoved || !this.gl || !this.mode || !this.map) return;
    if (!this.isZoomInRange()) return;
    this.syncProjectionState();
    this.mode.update(this.map, this.gl);
  }
  render(_gl, params, projection, projectionToMercatorMatrix, projectionToMercatorTransition, _centerInMercator, _pixelsPerMeterRatio) {
    if (this.isRemoved || !this.renderer || !this.gl || !this.mode || !this.map) {
      return;
    }
    if (!this.isZoomInRange()) {
      return;
    }
    this.configureMapboxRenderPath();
    const projectionParams = resolveProjectionParams(
      params,
      projection,
      projectionToMercatorMatrix,
      projectionToMercatorTransition
    );
    if (!projectionParams.matrix) {
      return;
    }
    const legacyMapboxFallback = !projectionParams.mapbox && !projectionParams.shaderData ? {
      projection: { name: "mercator" },
      globeToMercatorMatrix: MAPBOX_IDENTITY_MATRIX,
      transition: 1
    } : void 0;
    const isGlobe = this.isGlobeProjection();
    const worldOffsets = computeWorldOffsets(this.map, isGlobe);
    const colormapTexture = this.colormap.ensureTexture(this.gl);
    let expandedFarZMercatorMatrix;
    if (projectionParams.mapbox?.projection.name === "globe") {
      const { expandedFarZProjMatrix, worldSize } = getMapboxGlobeInternals(
        this.map
      );
      if (expandedFarZProjMatrix && worldSize) {
        expandedFarZMercatorMatrix = scaleMercatorMatrix(
          expandedFarZProjMatrix,
          worldSize
        );
      }
    }
    const context = {
      gl: this.gl,
      matrix: projectionParams.matrix,
      uniforms: {
        clim: this.clim,
        opacity: this.opacity,
        fillValue: this._fillValue,
        scaleFactor: this.scaleFactor,
        offset: this.offset,
        fixedDataScale: this.fixedDataScale
      },
      colormapTexture,
      worldOffsets,
      customShaderConfig: this.customShaderConfig || void 0,
      shaderData: projectionParams.shaderData,
      projectionData: projectionParams.projectionData,
      mapbox: projectionParams.mapbox ? {
        ...projectionParams.mapbox,
        directGlobePathActive: this.usingDirectMapboxGlobePath,
        expandedFarZMercatorMatrix: projectionParams.mapbox.projection.name === "globe" ? expandedFarZMercatorMatrix : void 0
      } : legacyMapboxFallback
    };
    this.mode.render(this.renderer, context);
    this.tileNeedsRender = false;
  }
  renderToTile(_gl, tileId) {
    if (this.isRemoved || !this.renderer || !this.gl || !this.mode || !this.map) {
      return;
    }
    this.configureMapboxRenderPath();
    const isGlobe = this.syncProjectionState();
    this.mode.update(this.map, this.gl);
    const colormapTexture = this.colormap.ensureTexture(this.gl);
    const context = {
      gl: this.gl,
      matrix: new Float32Array(16),
      uniforms: {
        clim: this.clim,
        opacity: this.opacity,
        fillValue: this._fillValue,
        scaleFactor: this.scaleFactor,
        offset: this.offset,
        fixedDataScale: this.fixedDataScale
      },
      colormapTexture,
      worldOffsets: [0],
      customShaderConfig: this.customShaderConfig || void 0,
      isGlobe
    };
    this.tileNeedsRender = this.mode.renderToTile?.(this.renderer, tileId, context) ?? false;
  }
  // Mapbox specific custom layer method required to trigger rerender on eg dataset update.
  shouldRerenderTiles() {
    const needsRender = this.tileNeedsRender;
    this.tileNeedsRender = false;
    return needsRender;
  }
  /**
   * Dispose all GL resources and internal state.
   * Does NOT remove the layer from the map - call map.removeLayer(id) for that.
   */
  _disposeResources(gl) {
    this.isRemoved = true;
    this.renderer?.dispose();
    this.renderer = null;
    this.colormap.dispose(gl);
    this.mode?.dispose(gl);
    this.mode = null;
    if (this.zarrStore) {
      this.zarrStore.cleanup();
      this.zarrStore = null;
    }
    if (this.map && this.projectionChangeHandler && typeof this.map.off === "function") {
      this.map.off("projectionchange", this.projectionChangeHandler);
      this.map.off("style.load", this.projectionChangeHandler);
      this.map.off("move", this.projectionChangeHandler);
    }
  }
  onRemove(_map, gl) {
    const resolvedGl = this.gl ?? this.resolveGl(_map, gl);
    this._disposeResources(resolvedGl);
  }
  // ========== Query Interface ==========
  /**
   * Query all data values within a geographic region.
   * @param geometry - GeoJSON Point, Polygon or MultiPolygon geometry.
   * @param selector - Optional selector to override the layer's selector.
   * @returns Promise resolving to the query result matching carbonplan/maps structure.
   */
  async queryData(geometry, selector, options) {
    if (!this.mode?.queryData) {
      return {
        [this.variables[0]]: [],
        dimensions: [],
        coordinates: {}
      };
    }
    return this.mode.queryData(geometry, selector, options);
  }
  async queryTimeSeries(geometry, options) {
    if (!this.mode?.queryTimeSeries) {
      return { variable: this.variables[0], values: [], timeIndices: [] };
    }
    return this.mode.queryTimeSeries(geometry, options);
  }
  setTimeMeanData(result) {
    this.mode?.setTimeMeanData?.(result);
    this.invalidate();
  }
  async computeTimeMean(options) {
    if (!this.mode?.computeTimeMean) {
      return {
        variable: this.variables[0],
        data: new Float32Array(0),
        height: 0,
        width: 0,
        latIsAscending: true
      };
    }
    return this.mode.computeTimeMean(options);
  }
};

// src/index.ts
import { registry } from "zarrita";

// src/viewer-utils.ts
function percentileClim(data, lo = 0.01, hi = 0.99) {
  const valid = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) valid.push(v);
  }
  if (valid.length === 0) return [0, 1];
  valid.sort((a, b) => a - b);
  return [
    valid[Math.floor(lo * valid.length)],
    valid[Math.ceil(hi * valid.length) - 1]
  ];
}
function smartDecimals(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return 2;
  for (let d = 0; d <= 10; d++) {
    if (min.toFixed(d) !== max.toFixed(d)) return d;
  }
  return 10;
}
function collectNumbers(values, fillValue, depth = 0) {
  if (!values) return [];
  if (depth > 10) return [];
  if (Array.isArray(values)) {
    return values.filter(
      (v) => v !== fillValue && typeof v === "number" && Number.isFinite(v)
    );
  }
  if (typeof values !== "object" || values === null) return [];
  let results = [];
  for (const entry of Object.values(values)) {
    if (entry === values) continue;
    results = results.concat(
      collectNumbers(entry, fillValue, depth + 1)
    );
  }
  return results;
}
function getRegionMean(result, fillValue) {
  if (!result) return null;
  let numbers = [];
  for (const [key, value] of Object.entries(result)) {
    if (key === "dimensions" || key === "coordinates") continue;
    if (!value || typeof value !== "object") continue;
    try {
      numbers = numbers.concat(
        collectNumbers(value, fillValue, 0)
      );
    } catch {
    }
  }
  if (numbers.length === 0) return null;
  return numbers.reduce((acc, v) => acc + v, 0) / numbers.length;
}
function clampLat(lat) {
  return Math.max(-90, Math.min(90, lat));
}
function normLng(lng) {
  const w = ((lng + 180) % 360 + 360) % 360 - 180;
  return w === -180 ? 180 : w;
}
function boundsToGeometry(bounds) {
  let west, east, south, north;
  if (Array.isArray(bounds)) {
    ;
    [west, south, east, north] = bounds;
  } else {
    const arr = bounds.toArray();
    const [[, swLat], [, neLat]] = arr;
    south = clampLat(Math.min(swLat, neLat));
    north = clampLat(Math.max(swLat, neLat));
    west = normLng(bounds.getWest());
    east = normLng(bounds.getEast());
    if (bounds.getSouth) south = clampLat(bounds.getSouth());
    if (bounds.getNorth) north = clampLat(bounds.getNorth());
  }
  south = clampLat(south);
  north = clampLat(north);
  west = normLng(west);
  east = normLng(east);
  if (east >= west) {
    return {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [west, north],
          [east, north],
          [east, south],
          [west, south]
        ]
      ]
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [west, south],
          [west, north],
          [180, north],
          [180, south],
          [west, south]
        ]
      ],
      [
        [
          [-180, south],
          [-180, north],
          [east, north],
          [east, south],
          [-180, south]
        ]
      ]
    ]
  };
}

// src/eodc-colormap.ts
var EODC_STOPS = [
  [8, 58, 89],
  [60, 190, 224],
  [160, 215, 231],
  [185, 209, 214],
  [209, 163, 107],
  [216, 140, 80],
  [168, 146, 85],
  [139, 108, 50]
];
function interpolateStops(stops, count) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const seg = t * (stops.length - 1);
    const idx = Math.min(Math.floor(seg), stops.length - 2);
    const f = seg - idx;
    const [r1, g1, b1] = stops[idx];
    const [r2, g2, b2] = stops[idx + 1];
    const r = Math.round(r1 + (r2 - r1) * f);
    const g = Math.round(g1 + (g2 - g1) * f);
    const b = Math.round(b1 + (b2 - b1) * f);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  });
}
var EODC_COLORMAP = interpolateStops(EODC_STOPS, 255);
export {
  EODC_COLORMAP,
  ZarrLayer,
  boundsToGeometry,
  registry as codecRegistry,
  collectNumbers,
  createTransformerTo4326,
  getRegionMean,
  percentileClim,
  smartDecimals
};
//# sourceMappingURL=index.js.map