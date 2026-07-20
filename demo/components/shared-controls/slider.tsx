import React, { useState, useRef, useEffect } from 'react'
import { Slider as CarbonSlider, Row, Column } from '@carbonplan/components'
import { Box, Flex } from 'theme-ui'
import { subheadingSx } from './styles'

export type SliderProps = {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  formatValue?: (value: number) => string
  /** When provided, the displayed value becomes clickable and opens a text input.
   *  Return the integer index for the typed string, or null to reject the input. */
  parseValue?: (str: string) => number | null
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min = 0,
  max = 10,
  step = 1,
  label = 'Value',
  formatValue,
  parseValue,
}) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select()
  }, [editing])

  const commit = () => {
    if (parseValue && draft.trim()) {
      const idx = parseValue(draft.trim())
      if (idx !== null && Number.isFinite(idx)) {
        onChange(Math.max(min, Math.min(max, Math.round(idx))))
      }
    }
    setEditing(false)
  }

  const displayed = formatValue ? formatValue(value) : String(value)

  return (
    <Row columns={[4, 4, 4, 4]} sx={{ alignItems: 'baseline', mt: 2 }}>
      <Column start={1} width={1}>
        <Box sx={subheadingSx}>{label}</Box>
      </Column>
      <Column start={2} width={3}>
        <Flex sx={{ flexDirection: 'column' }}>
          <CarbonSlider
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange(parseFloat(e.target.value))
            }
          />
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commit}
              style={{
                textAlign: 'center',
                background: 'transparent',
                color: 'inherit',
                border: 'none',
                borderBottom: '1px solid #737B8D',
                fontFamily: 'inherit',
                fontSize: 'inherit',
                width: '100%',
                outline: 'none',
                padding: '1px 0',
              }}
            />
          ) : (
            <Box
              onClick={
                parseValue
                  ? () => {
                      setDraft(displayed)
                      setEditing(true)
                    }
                  : undefined
              }
              sx={{
                textAlign: 'center',
                cursor: parseValue ? 'text' : 'default',
                ...(parseValue ? { '&:hover': { opacity: 0.7 } } : {}),
              }}
            >
              {displayed}
            </Box>
          )}
        </Flex>
      </Column>
    </Row>
  )
}
