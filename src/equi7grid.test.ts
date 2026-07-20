import { describe, it, expect } from 'vitest'
import { resolveEqui7GridProj4 } from '../src/projection-utils'
import { EQUI7GRID_PROJ4, EQUI7GRID_ZONES } from '../src/constants'

describe('EQUI7GRID Support', () => {
  describe('resolveEqui7GridProj4', () => {
    it('should resolve EQUI7GRID EPSG codes to proj4 strings', () => {
      const testCases = [
        ['EPSG:27701', EQUI7GRID_PROJ4['EPSG:27701']], // Africa
        ['EPSG:27704', EQUI7GRID_PROJ4['EPSG:27704']], // Europe
        ['EPSG:27705', EQUI7GRID_PROJ4['EPSG:27705']], // North America
      ]

      testCases.forEach(([code, expected]) => {
        const result = resolveEqui7GridProj4(code)
        expect(result).toBe(expected)
        expect(result).toContain('+proj=aeqd')
      })
    })

    it('should return undefined for undefined input', () => {
      expect(resolveEqui7GridProj4(undefined)).toBeUndefined()
    })

    it('should return input unchanged for non-EQUI7GRID codes', () => {
      expect(resolveEqui7GridProj4('EPSG:4326')).toBe('EPSG:4326')
      expect(resolveEqui7GridProj4('EPSG:3857')).toBe('EPSG:3857')
      expect(resolveEqui7GridProj4('some-custom-proj4')).toBe(
        'some-custom-proj4'
      )
    })
  })

  describe('EQUI7GRID_PROJ4 constants', () => {
    it('should have all 7 zones defined', () => {
      expect(Object.keys(EQUI7GRID_PROJ4)).toHaveLength(7)
    })

    it('all proj4 strings should use azimuthal equidistant projection', () => {
      Object.values(EQUI7GRID_PROJ4).forEach((proj4Str) => {
        expect(proj4Str).toContain('+proj=aeqd')
        expect(proj4Str).toContain('+datum=WGS84')
        expect(proj4Str).toContain('+units=m')
      })
    })
  })

  describe('EQUI7GRID_ZONES mapping', () => {
    it('should map all EQUI7GRID EPSG codes to zone names', () => {
      expect(EQUI7GRID_ZONES['EPSG:27701']).toBe('AF') // Africa
      expect(EQUI7GRID_ZONES['EPSG:27702']).toBe('AN') // Antarctica
      expect(EQUI7GRID_ZONES['EPSG:27703']).toBe('AS') // Asia
      expect(EQUI7GRID_ZONES['EPSG:27704']).toBe('EU') // Europe
      expect(EQUI7GRID_ZONES['EPSG:27705']).toBe('NA') // North America
      expect(EQUI7GRID_ZONES['EPSG:27706']).toBe('OC') // Oceania
      expect(EQUI7GRID_ZONES['EPSG:27707']).toBe('SA') // South America
    })
  })
})
