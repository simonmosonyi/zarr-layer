import * as zarr from 'zarrita';
export { registry as codecRegistry } from 'zarrita';

/** Bounds tuple: [xMin, yMin, xMax, yMax] */
type Bounds = [number, number, number, number];
interface RequestParameters extends Omit<RequestInit, 'headers'> {
    url: string;
    headers?: {
        [key: string]: string;
    };
}
/**
 * Options passed to transformRequest
 */
interface TransformRequestOptions {
    /** HTTP method that will be used for this request */
    method?: 'GET' | 'HEAD';
}
type TransformRequest = (url: string, options?: TransformRequestOptions) => RequestParameters | Promise<RequestParameters>;
type ColormapArray = number[][] | string[];
type SelectorValue = number | number[] | string | string[];
interface SelectorSpec {
    selected: SelectorValue;
    type?: 'index' | 'value';
}
type Selector = Record<string, SelectorValue | SelectorSpec>;
/**
 * Override the names used to identify spatial dimensions (lat/lon).
 * Only needed if your dataset uses non-standard names that aren't auto-detected.
 * Standard names (lat, latitude, y, lon, longitude, x) are detected automatically.
 */
interface SpatialDimensions {
    lat?: string;
    lon?: string;
}
interface LoadingState {
    loading: boolean;
    metadata: boolean;
    chunks: boolean;
    error?: Error | null;
}
type LoadingStateCallback = (state: LoadingState) => void;
interface ZarrLayerOptions {
    id: string;
    /**
     * URL to the Zarr store. Required unless `store` is provided.
     */
    source?: string;
    variable: string;
    /**
     * Custom zarrita-compatible store to use instead of creating a FetchStore from source.
     * Useful for IcechunkStore or other custom storage backends.
     *
     * The store must implement the zarrita Readable interface with at minimum:
     * - `get(key: string): Promise<Uint8Array | undefined>` - fetch data at path
     *
     * Optionally implement AsyncReadable for range requests:
     * - `getRange(key: string, range: RangeQuery): Promise<Uint8Array | undefined>`
     *
     * When provided:
     * - `source` becomes optional (falls back to layer id for identification)
     * - Metadata caching is bypassed (each layer fetches fresh metadata)
     *
     * @example
     * ```ts
     * import { IcechunkStore } from '@icechunk/icechunk-python'
     * const store = await IcechunkStore.open(...)
     * new ZarrLayer({ id: 'my-layer', store, variable: 'temperature', ... })
     * ```
     */
    store?: zarr.Readable;
    selector?: Selector;
    colormap: ColormapArray;
    clim: [number, number];
    opacity?: number;
    minzoom?: number;
    maxzoom?: number;
    zarrVersion?: 2 | 3;
    spatialDimensions?: SpatialDimensions;
    /**
     * Explicit spatial bounds [xMin, yMin, xMax, yMax].
     * Units depend on CRS: degrees for EPSG:4326, source CRS units (e.g. meters) when proj4 is provided.
     * If not provided, bounds are read from coordinate arrays or default to global.
     */
    bounds?: Bounds;
    /**
     * CRS identifier for built-in projections (EPSG:4326, EPSG:3857) or EQUI7GRID continental zones.
     * EQUI7GRID codes (EPSG:27701-27707) are automatically resolved to their proj4 definitions.
     * For other custom CRS, optionally provide a matching proj4 definition.
     */
    crs?: string;
    latIsAscending?: boolean | null;
    fillValue?: number;
    customFrag?: string;
    uniforms?: Record<string, number>;
    renderingMode?: '2d' | '3d';
    onLoadingStateChange?: LoadingStateCallback;
    /**
     * Proj4 definition string for reprojection (untiled mode only).
     * When provided, bounds are interpreted as source CRS units and data is reprojected to Web Mercator.
     * Example: "+proj=lcc +lat_1=38.5 +lat_2=38.5 +lat_0=38.5 +lon_0=-97.5 +x_0=0 +y_0=0 +R=6371229 +units=m +no_defs"
     */
    proj4?: string;
    /**
     * Function to transform request URLs and add custom headers/credentials.
     * Useful for authentication, proxy routing, or request customization.
     * When provided, the store cache is bypassed to prevent credential sharing between layers.
     */
    transformRequest?: TransformRequest;
    /**
     * Enable full polar coverage in Mapbox globe view for untiled EPSG:4326 or
     * proj4 datasets. Has no effect on tiled or EPSG:3857 data.
     *
     * MapLibre globe always renders to the poles automatically.
     *
     * For Mapbox, this enables an experimental direct ECEF path that bypasses
     * tile draping. Only activates at the fully-globe zoom endpoint; during
     * the globe-to-mercator zoom morph the layer falls back to the standard
     * draped path. Incompatible with Mapbox terrain — when terrain is enabled
     * the layer uses the draped tile path. Relies on Mapbox internal APIs and
     * may break across Mapbox GL JS versions.
     *
     * Default: `false`
     */
    renderPoles?: boolean;
}
interface BoundsLike {
    getWest(): number;
    getEast(): number;
    toArray(): [number, number][];
}
interface MapLike {
    getProjection?(): {
        type?: unknown;
        name?: string;
    } | null;
    getRenderWorldCopies?(): boolean;
    getTerrain?(): unknown;
    on?(event: string, handler: (...args: unknown[]) => void): void;
    off?(event: string, handler: (...args: unknown[]) => void): void;
    triggerRepaint?(): void;
    getBounds?(): BoundsLike | null;
    getZoom?(): number;
    painter?: {
        context?: {
            gl?: unknown;
        };
    };
    renderer?: {
        getContext?: () => unknown;
    };
}

/**
 * Result from a pixel-wise temporal mean computation over a time window.
 */
interface TimeMeanResult {
    variable: string;
    /** Pixel-wise mean values, [height × width] row-major. NaN = fill/missing. Row 0 = south if latIsAscending=true. */
    data: Float32Array;
    height: number;
    width: number;
    latIsAscending: boolean;
    /** Top-left pixel offset into the full-resolution array. Present when the mean was computed
     *  over a viewport sub-region rather than the full spatial extent. */
    pixelOffset?: {
        x: number;
        y: number;
    };
}
/**
 * Result from a time series query at a point.
 */
interface TimeSeriesResult {
    variable: string;
    /** Physical values (NaN for fill values / gaps) */
    values: number[];
    /** Integer indices into the time axis corresponding to each value */
    timeIndices: number[];
}
/**
 * Nested values structure for multi-dimensional data queries.
 */
interface NestedValues {
    [key: string]: number[] | NestedValues;
    [key: number]: number[] | NestedValues;
}
/**
 * Values from a data query. Can be flat array or nested when selector has array values.
 *
 * Flat: `number[]` when selector = `{ month: 1 }`
 * Nested: `{ 1: number[], 2: number[] }` when selector = `{ month: [1, 2] }`
 */
type QueryDataValues = number[] | NestedValues;
/**
 * Result from a query (point or region).
 * Matches carbonplan/maps structure: { [variable]: values, dimensions, coordinates }
 *
 * Spatial coordinate keys depend on the dataset's CRS:
 * - Standard CRS (EPSG:3857/4326): `lat`/`lon`
 * - Projected CRS (proj4): `y`/`x` in the source coordinate system
 */
interface QueryResult {
    /** Variable name mapped to its values (flat array or nested based on selector) */
    [variable: string]: QueryDataValues | string[] | {
        [key: string]: (number | string)[];
    };
    /** Dimension names in order (e.g., ['month', 'lat', 'lon'] or ['month', 'y', 'x']) */
    dimensions: string[];
    /** Coordinate arrays for each dimension */
    coordinates: {
        [key: string]: (number | string)[];
    };
}
/**
 * GeoJSON Point geometry.
 */
interface GeoJSONPoint {
    type: 'Point';
    coordinates: [number, number];
}
/**
 * GeoJSON Polygon geometry.
 */
interface GeoJSONPolygon {
    type: 'Polygon';
    coordinates: number[][][];
}
/**
 * GeoJSON MultiPolygon geometry.
 */
interface GeoJSONMultiPolygon {
    type: 'MultiPolygon';
    coordinates: number[][][][];
}
/**
 * Supported GeoJSON geometry types for queries.
 */
type QueryGeometry = GeoJSONPoint | GeoJSONPolygon | GeoJSONMultiPolygon;
/**
 * Options for queryData calls.
 */
interface QueryOptions {
    /** AbortSignal to cancel the query. */
    signal?: AbortSignal;
    /** Include per-pixel coordinates in the result. Defaults to true. */
    includeSpatialCoordinates?: boolean;
}

/**
 * @module zarr-layer
 *
 * MapLibre/Mapbox custom layer implementation for rendering Zarr datasets.
 * Implements CustomLayerInterface for direct WebGL rendering.
 */

declare class ZarrLayer {
    readonly type: 'custom';
    readonly renderingMode: '2d' | '3d';
    id: string;
    private url;
    private variable;
    private zarrVersion;
    private spatialDimensions;
    private bounds;
    private crs;
    private latIsAscending;
    private selector;
    private invalidate;
    private colormap;
    private clim;
    private opacity;
    private minZoom;
    private maxZoom;
    private selectorHash;
    private _fillValue;
    private scaleFactor;
    private offset;
    private fixedDataScale;
    private dataScaleLocked;
    private gl;
    private map;
    private renderer;
    private mode;
    private tileNeedsRender;
    private projectionChangeHandler;
    private resolveGl;
    private zarrStore;
    private levelInfos;
    private dimIndices;
    private dimensionValues;
    private normalizedSelector;
    private isRemoved;
    private fragmentShaderSource;
    private customFrag;
    private customUniforms;
    private bandNames;
    private customShaderConfig;
    private onLoadingStateChange;
    private metadataLoading;
    private chunksLoading;
    private initError;
    private proj4;
    private transformRequest;
    private customStore;
    private renderPoles;
    private lastIsGlobe;
    private usingDirectMapboxGlobePath;
    private mapboxDirectGlobePathAvailable;
    private canUseMapboxDirectGlobePath;
    private configureMapboxRenderPath;
    get fillValue(): number | null;
    private isGlobeProjection;
    /** Check for projection changes and notify mode. Returns current isGlobe state. */
    private syncProjectionState;
    constructor({ id, source, variable, selector, colormap, clim, opacity, minzoom, maxzoom, zarrVersion, spatialDimensions, bounds, crs, latIsAscending, fillValue, customFrag, uniforms, renderingMode, onLoadingStateChange, proj4, transformRequest, store, renderPoles, }: ZarrLayerOptions);
    private emitLoadingState;
    private handleChunkLoadingChange;
    setOpacity(opacity: number): void;
    setClim(clim: [number, number]): void;
    setColormap(colormap: ColormapArray): void;
    setUniforms(uniforms: Record<string, number>): void;
    setVariable(variable: string): Promise<void>;
    setSelector(selector: Selector): Promise<void>;
    onAdd(map: MapLike, gl: WebGL2RenderingContext | WebGLRenderingContext): void;
    private _onAddAsync;
    private initializeMode;
    private initialize;
    private loadInitialDimensionValues;
    private isZoomInRange;
    prerender(_gl: WebGL2RenderingContext | WebGLRenderingContext, _params: unknown): void;
    render(_gl: WebGL2RenderingContext | WebGLRenderingContext, params: unknown, projection?: {
        name: string;
    }, projectionToMercatorMatrix?: number[] | Float32Array | Float64Array, projectionToMercatorTransition?: number, _centerInMercator?: number[], _pixelsPerMeterRatio?: number): void;
    renderToTile(_gl: WebGL2RenderingContext | WebGLRenderingContext, tileId: {
        z: number;
        x: number;
        y: number;
    }): void;
    shouldRerenderTiles(): boolean;
    /**
     * Dispose all GL resources and internal state.
     * Does NOT remove the layer from the map - call map.removeLayer(id) for that.
     */
    private _disposeResources;
    onRemove(_map: MapLike, gl: WebGL2RenderingContext | WebGLRenderingContext): void;
    /**
     * Query all data values within a geographic region.
     * @param geometry - GeoJSON Point, Polygon or MultiPolygon geometry.
     * @param selector - Optional selector to override the layer's selector.
     * @returns Promise resolving to the query result matching carbonplan/maps structure.
     */
    queryData(geometry: QueryGeometry, selector?: Selector, options?: QueryOptions): Promise<QueryResult>;
    queryTimeSeries(geometry: QueryGeometry, options?: {
        timeDimension?: string;
        start?: number;
        end?: number;
        step?: number;
        selector?: Selector;
        signal?: AbortSignal;
        variable?: string;
    }): Promise<TimeSeriesResult>;
    setTimeMeanData(result: TimeMeanResult | null): void;
    computeTimeMean(options?: {
        timeDimension?: string;
        start?: number;
        end?: number;
        step?: number;
        selector?: Selector;
        signal?: AbortSignal;
    }): Promise<TimeMeanResult>;
}

/**
 * A transformer for converting coordinates between source CRS and EPSG:4326 (WGS84).
 */
interface Wgs84Transformer {
    /** Transform from source CRS to EPSG:4326 [lon, lat] */
    forward: (x: number, y: number) => [number, number];
    /** Transform from EPSG:4326 to source CRS [x, y] */
    inverse: (lon: number, lat: number) => [number, number];
    /** Source projection bounds in source CRS units */
    bounds: Bounds;
}
/**
 * Creates a reusable transformer for converting between source CRS and EPSG:4326.
 * Used for the two-stage reprojection pipeline where Stage 1 targets 4326.
 */
declare function createTransformerTo4326(proj4def: string, bounds: Bounds): Wgs84Transformer;

export { type ColormapArray, type LoadingState, type LoadingStateCallback, type QueryDataValues, type QueryGeometry, type QueryOptions, type QueryResult, type RequestParameters, type Selector, type SpatialDimensions, type TimeMeanResult, type TimeSeriesResult, type TransformRequest, ZarrLayer, type ZarrLayerOptions, createTransformerTo4326 };
