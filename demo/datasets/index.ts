import equi7gridSentinel5P from './equi7grid'
import inca from './inca'
import spartacus from './spartacus'
import s1Ard from './s1-ard'
import type { Dataset } from './types'

export const DATASETS: Dataset<any>[] = [
  equi7gridSentinel5P,
  inca,
  spartacus,
  s1Ard,
]

export const DATASET_MAP = Object.fromEntries(
  DATASETS.map((d) => [d.id, d])
) as Record<string, Dataset>

export const DEFAULT_DATASET_ID = equi7gridSentinel5P.id

export type { Dataset } from './types'
