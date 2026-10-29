# Remove debug console.log from computeTimeMean

Removed two `console.log` statements added during development of the viewport clipping feature:

- `[time-mean] viewportBounds=... mercatorBounds=... xyLimits=... level=...`
- `[time-mean] spatialPixBounds=...`

These were debugging aids only; the feature (NaN-padding the clipped result back to full level extent) is already in place and working.
