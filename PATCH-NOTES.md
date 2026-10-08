# Local Patches to Upstream zarr-layer

Running list of EODC-side patches on top of upstream. Keep each entry greppable
in-code via a `PATCH[<tag>]` marker so a future revert is mechanical.

---

## PATCH[fill-override] — config `fillValue` overrides zarr metadata

**When:** 2026-10-08 (SHA follow-up to `7128c0b`)
**Why:** The S5P Zarr `CO/carbonmonoxide_total_column` declares
`fill_value: "NaN"` in its v3 array metadata, but the actual data in the
chunks is `9.969e+36` (the netCDF default float fill, visible in the
`_FillValue` attribute). Because the metadata lied, `normalizeDataForTexture`
never converted those pixels to NaN, so the shader's `isnan` discard didn't
fire and no-data rendered as bright colored pixels.

Giving a config-supplied `fillValue` priority over the metadata lets the
EODC catalogue declare the real fill (`9.9692099683868690e+36`) on the S5P
dataset and have it actually reach the texture-upload path.

**Change sites (grep `PATCH[fill-override]`):**
- `src/zarr-layer.ts` — new `_fillValueFromConfig` field, propagate to mode
- `src/untiled-mode.ts` — new `configFillValue` field + setter; four
  fallback expressions now prefer `this.configFillValue` over
  `currentLevel?.fillValue ?? desc.fill_value`

**Behavior:** No-op for datasets that don't pass `fillValue` in options.
Datasets that do pass it get priority over whatever the zarr store declares.

**To revert:** `git grep "PATCH\[fill-override\]"` then delete those blocks
and restore the four `currentLevel?.fillValue ?? desc.fill_value`
expressions. Also delete the `_fillValueFromConfig` field and the
`setConfigFillValue` call site after mode creation. Rebuild with
`nvm use 20 && npm run build`.
