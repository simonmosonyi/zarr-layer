import type { MercatorBounds, TileTuple, XYLimits } from './map-utils'
import type { ProjectionData, ShaderData } from './shaders'
import type { Tiles } from './tiles'
import type {
  CRS,
  LoadingStateCallback,
  MapLike,
  NormalizedSelector,
  Selector,
} from './types'
import type {
  CustomShaderConfig,
  MapboxParams,
  RendererUniforms,
} from './renderer-types'
import type { ZarrRenderer } from './zarr-renderer'
import type {
  QueryGeometry,
  QueryOptions,
  QueryResult,
  TimeMeanResult,
  TimeSeriesResult,
} from './query/types'

export interface RenderContext {
  gl: WebGL2RenderingContext
  matrix: number[] | Float32Array | Float64Array
  uniforms: RendererUniforms
  colormapTexture: WebGLTexture
  worldOffsets: number[]
  customShaderConfig?: CustomShaderConfig
  shaderData?: ShaderData
  projectionData?: ProjectionData
  mapbox?: MapboxParams
  isGlobe?: boolean
}

export interface TileId {
  z: number
  x: number
  y: number
}

export interface TiledRenderState {
  tileCache: Tiles
  visibleTiles: TileTuple[]
  tileSize: number
  vertexArr: Float32Array
  pixCoordArr: Float32Array
  tileBounds?: Record<string, MercatorBounds>
  latIsAscending: boolean
}

export interface RegionRenderState {
  texture: WebGLTexture
  vertexBuffer: WebGLBuffer
  /** Texture coordinate buffer for sampling resampled data */
  pixCoordBuffer: WebGLBuffer
  vertexArr: Float32Array
  mercatorBounds: MercatorBounds
  width: number
  height: number
  channels: number
  /** Data orientation: true = row 0 is south */
  latIsAscending: boolean
  /** Band textures for multi-band custom shaders */
  bandData?: Map<string, Float32Array>
  bandTextures?: Map<string, WebGLTexture>
  bandTexturesUploaded?: Set<string>
  bandTexturesConfigured?: Set<string>
  /** Index buffer for adaptive mesh (proj4 datasets) */
  indexBuffer?: WebGLBuffer
  /** Number of vertices/indices to draw */
  vertexCount?: number
  /** Whether to use indexed mesh rendering (gl.drawElements) */
  useIndexedMesh?: boolean
  /** WGS84 bounds for two-stage reprojection */
  wgs84Bounds?: import('./map-utils').Wgs84Bounds
}

export interface ZarrMode {
  isMultiscale: boolean
  initialize(): Promise<void>
  update(map: MapLike, gl: WebGL2RenderingContext): void
  render(renderer: ZarrRenderer, context: RenderContext): void
  renderToTile?(
    renderer: ZarrRenderer,
    tileId: TileId,
    context: RenderContext
  ): boolean
  dispose(gl: WebGL2RenderingContext | WebGLRenderingContext): void
  setSelector(selector: NormalizedSelector): Promise<void>
  onProjectionChange(isGlobe: boolean): void
  setLoadingCallback(callback: LoadingStateCallback | undefined): void
  getCRS(): CRS
  getXYLimits(): XYLimits | null
  getMaxLevelIndex(): number
  getLevels(): string[]
  getTiledState?(): TiledRenderState | null

  // Query methods (optional)
  queryData?(
    geometry: QueryGeometry,
    selector?: Selector,
    options?: QueryOptions
  ): Promise<QueryResult>
  queryTimeSeries?(
    geometry: QueryGeometry,
    options?: {
      timeDimension?: string
      start?: number
      end?: number
      step?: number
      selector?: Selector
      signal?: AbortSignal
      variable?: string
    }
  ): Promise<TimeSeriesResult>
  computeTimeMean?(options?: {
    timeDimension?: string
    start?: number
    end?: number
    step?: number
    selector?: Selector
    signal?: AbortSignal
    /**
     * WGS-84 bounding box of the current map viewport.
     *
     * When provided, the spatial dimensions of the zarr array are sliced to
     * the pixel range that covers this box before the mean is computed.
     * This dramatically reduces the element count for large global datasets
     * (e.g. ERA5-Land at full extent would exceed the 100 M element guard,
     * but a typical viewport covers only a few thousand pixels).
     *
     * The bounds are projected from WGS-84 into the dataset's native CRS
     * using `computePixelBoundsFromGeometry`, which samples multiple points
     * along each edge to correctly handle curved projections (LCC, LAEA, etc.).
     * If the projection fails or the viewport does not intersect the dataset,
     * the spatial clip is silently skipped and the full array is used.
     *
     * Coordinates: west/east ∈ [-180, 180], south/north ∈ [-90, 90] (decimal degrees).
     */
    viewportBounds?: {
      north: number
      south: number
      east: number
      west: number
    }
  }): Promise<TimeMeanResult>
  setTimeMeanData?(result: TimeMeanResult | null): void
}
