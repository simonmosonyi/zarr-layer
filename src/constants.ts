export const DEFAULT_TILE_SIZE = 128
export const MAX_CACHED_TILES = 64
export const TILE_SUBDIVISIONS = 32
export const MERCATOR_LAT_LIMIT = 85.05112878

/** Default maximum error threshold for adaptive mesh refinement (in pixels) */
export const DEFAULT_MESH_MAX_ERROR = 0.125

/** Default maximum error for query polygon edge densification (in pixels) */
export const DEFAULT_QUERY_DENSIFY_MAX_ERROR = DEFAULT_MESH_MAX_ERROR

/** Minimum subdivisions for region geometry tessellation (globe projection) */
export const MIN_SUBDIVISIONS = 2

/** Maximum subdivisions for region geometry tessellation (globe projection) */
export const MAX_SUBDIVISIONS = 128

/** Subdivisions for flat/mercator projection (simple quad, no curvature needed) */
export const MERCATOR_SUBDIVISIONS = 1

/** Web Mercator world extent in meters (half of full world width) */
export const WEB_MERCATOR_EXTENT = 20037508.342789244

/** Common names for spatial dimensions. These are matched case-insensitively. */
export const SPATIAL_DIMENSION_ALIASES: Record<'lat' | 'lon', string[]> = {
  lat: ['lat', 'latitude', 'y'],
  lon: ['lon', 'longitude', 'x', 'lng'],
}

/** Flat set of all spatial dimension names */
export const SPATIAL_DIM_NAMES = new Set([
  ...SPATIAL_DIMENSION_ALIASES.lat,
  ...SPATIAL_DIMENSION_ALIASES.lon,
])

/** EQUI7GRID proj4 definitions for each continental zone */
export const EQUI7GRID_PROJ4: Record<string, string> = {
  'EPSG:27701':
    '+proj=aeqd +lat_0=8.5 +lon_0=21.5 +x_0=5621452.01998 +y_0=5990638.42298 +datum=WGS84 +units=m +no_defs', // Africa
  'EPSG:27702':
    '+proj=aeqd +lat_0=-90 +lon_0=0 +x_0=3714266.97719 +y_0=3402016.50625 +datum=WGS84 +units=m +no_defs', // Antarctica
  'EPSG:27703':
    '+proj=aeqd +lat_0=47 +lon_0=94 +x_0=4340913.84808 +y_0=4812712.92347 +datum=WGS84 +units=m +no_defs', // Asia
  'EPSG:27704':
    '+proj=aeqd +lat_0=53 +lon_0=24 +x_0=5837287.81977 +y_0=2121415.69617 +datum=WGS84 +units=m +no_defs', // Europe
  'EPSG:27705':
    '+proj=aeqd +lat_0=52 +lon_0=-97.5 +x_0=8264722.17686 +y_0=4867518.35323 +datum=WGS84 +units=m +no_defs', // North America
  'EPSG:27706':
    '+proj=aeqd +lat_0=-19.5 +lon_0=131.5 +x_0=6988408.5356 +y_0=7654884.53733 +datum=WGS84 +units=m +no_defs', // Oceania
  'EPSG:27707':
    '+proj=aeqd +lat_0=-14 +lon_0=-60.5 +x_0=7257179.23559 +y_0=5592024.44605 +datum=WGS84 +units=m +no_defs', // South America
}

/** Map EQUI7GRID EPSG codes to zone names for reference */
export const EQUI7GRID_ZONES: Record<string, string> = {
  'EPSG:27701': 'AF',
  'EPSG:27702': 'AN',
  'EPSG:27703': 'AS',
  'EPSG:27704': 'EU',
  'EPSG:27705': 'NA',
  'EPSG:27706': 'OC',
  'EPSG:27707': 'SA',
}
