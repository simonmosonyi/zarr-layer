export type SelectorSection = {
  label: string
  description: string
  datasetIds: string[]
}

export const SELECTOR_SECTIONS: SelectorSection[] = [
  {
    label: 'Sentinel-5P',
    description:
      'Sentinel-5P TROPOMI daily composites in EQUI7GRID Europe projection (EPSG:27704), 10km resolution.',
    datasetIds: ['sentinel5p-equi7grid'],
  },
  {
    label: 'GeoSphere Austria',
    description:
      'Gridded meteorological and climate datasets over Austria by GeoSphere Austria in Austria Lambert projection, 1km resolution.',
    datasetIds: ['inca', 'spartacus'],
  },
  {
    label: 'Sentinel-1 ARD',
    description:
      'Sentinel-1 backscatter datacube (S1-WIZSARD) in EQUI7GRID Europe projection, Austria extent, with 10-level multiscale pyramid.',
    datasetIds: ['s1-ard-at'],
  },
]
