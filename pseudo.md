Implementation:

Prototype: https://esridc.github.io/filterWidgetSandbox/autoStyle.html

Attribute symbolization is guided by database geometry type, field type, and various characteristics of the field data

- Symbol type follows dataset geometry type:
  - simple-lines for lines
  - simple-fill for polygons
  - CIMSymbols for points, because the JSAPI simple-marker symbol does not support fractional outline widths. Prototype implementation here: https://github.com/esridc/filterWidgetSandbox/blob/master/autostyle.mjs#L937-L979
- Fields are classified in three ways:
  - type ("string", "date", or "numeric")
  - Number-like, using datasetFieldIsNumberLike()
  - Categorical or pseudo-categorical, using datasetFieldCategorical()
    - Categorical is defined as no more than 7 non-bad unique values, used for all features
    - Pseudo-categorical is defined as not categorical, and at least 80% of all features have one of no more than 7 non-bad unique values
- Renderer follows field classification:
  - Categorical, Pseudo-categorical, and non-number-like numeric string fields are rendered using the uniqueValueRenderer in all cases
  - Numeric, date, and number-like string fields fields are rendered using a simpleRenderer, unless they are determined to be categorical
- Feature colors are chosen based on combinations of a few factors:
  - Renderer type
    - uniqueValueRenderers use the "Mushroom Soup" ramp
    - simpleRanderers use a custom sequential ramp
  - Unique value count
    - If only a single non-bad value is present in the field, features with that field will get a color chosen from Mushroom Soup, using the hashed fieldName to index into the ramp. This reduces the odds that the user will see two consecutive single-value fields with identical symbolizations when browsing dataset attributes.
  - value badness – null values, empty strings, and all-whitespace values are given an "other" color
  - Basemap "theme" ("light" or "dark") as reported by getBackgroundColorTheme() (https://developers.arcgis.com/javascript/latest/api-reference/esri-views-support-colorUtils.html#getBackgroundColorTheme). Generally, light colors are shown on "dark" basemaps and vice versa – this is primarily used for "other" colors and filtered "excludedEffect" coloring.

More context is available at https://github.com/esridc/filterWidgetSandbox/blob/master/Styling.md