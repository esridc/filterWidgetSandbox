
The document describes the functionality of the filterWidgetSandbox/attributes-ui.mjs autoStyle() function.

- Overview -

The goal: make a first best guess for displaying the values of a specific feature layer attribute on a map.

Attribute symbolization is guided first by database geometry type, then by attribute type, then by various characteristics of the attribute.

Choosing the ideal symbolization for every possible combination of characteristics is impossible, due to various limitations of the JSAPI, the available renderers, server settings, our limited understanding of the intended usage of a given attribute, foibles of the associated data structures, etc. The current prototype implements workarounds for some of these limitations, but they are not necessarily the best or only methods, and hopefully the final implementation will improve on the current state.

It's likely that the current styling logic can be simplified, given that there are multiple paths to some results. I've left some of this work undone so as not to overfit the solutions to the idiosyncratic structure of the prototype.

- Assumptions -

One dataset is loaded at a time. A dataset's features are only of one geometry type. Supported geometry types are currently points, multiPoints, lines, polyLines, and polygons.

- Arguments and Defaults -

The autoStyle() function takes a single argument, which is an object with two optional parameters: "event" and "fieldName".

It is first triggered on initial page load by the loadDataset() function, which passes it nothing. It may also be called by the "Style by Attribute" list, which passes the list's selection event. It is also called by the "Force labels" checkbox, which passes the current fieldName from state. It may also be passed arbitrary fieldName strings for testing.

If an event is passed, the event's "data-field" attribute is checked for a fieldName. If nothing is passed, autoStyle checks for the dataset's "displayField" parameter, which may be set by the dataset authors. If that doesn't exist, "NAME" is tried as a default fieldName, and if that doesn't exist a simple default styling is used.

- Styling Setup -

A new renderer is created, replacing any existing renderer, along with a new symbol object. Symbol types are chosen based on the geometry type of the dataset. CIMSymbols are used for points, because the simple-marker JSAPI geometry type does not support fractional outline widths.

To symbolize features, we rely on a number of parameters tracked in a global state object - namely the "dataset", "layer", "view", "layerView", and "bgColor" params. State is set directly, in order to annoy React developers. In some cases, these parameters may not be set by the time they are needed, so there are some checks to ensure that they exist, and to set them if not. Some of the parameters (eg layerView) are properties of other tracked parameters (eg view.layer.layerViews) and references may not always propagate.

The first is the bgColor property, set by viewColorUtils.getBackgroundColorTheme(state.view) [https://developers.arcgis.com/javascript/latest/api-reference/esri-views-support-colorUtils.html#getBackgroundColorTheme]. This returns "light" or "dark". If it can't detect the theme "light" is the default. Certain other styling properties are set depending on this value. This property is also used in some utility functions, so it is tracked in state.

Also tracked in state are the "dataset" being visualized, the MapView as "view", and the view's "layerView".
To detect the bgColor, the JSAPI needs to draw the map once first, so all of these properties should be set by the time styling begins.

- Styling Logic -

In every case, symbology type follows dataset geometry type. Default colors and sizes are set, and used if none of the other conditions are met.

If a fieldName is passed to autoStyle(), the field is analyzed and categorized, and further styling choices are made depending on whether it is determined to be categorical, pseudocategorical, or neither.

In certain combinations of situations, fields are displayed using a categorical "unique-value" renderer, but in others, a color ramp is chosen for use in a sequential "simple" renderer. VisualVariables are used to produce color and size stops in each case.

The general theory for styling is that where possible, a categorical renderer is used when the range of values of a field is either non-sequential or the number of possible values is low enough to give them each a different color.

The definition of a "categorical" field is arbitrary, based in part on how many categories will fit comfortably in a legend. At the moment, if there are 7 or fewer unique values in a field, it is deemed categorical. In other cases, a small number of unique values account for an arbitrarily large percentage of a field's values – if 7 values or fewer account for 80% of the values, it is called "pseudo-categorical" and only those top values are assigned unique colors, the rest are lumped into another color and labeled "other".

Labels are applied to polygons in a small set of circumstances by default, namely when each feature has a unique value of a given attribute .

Features with "bad" or missing values are given a special symbol or color, and filtered features are turned gray. The legend currently includes the bad values, but not filtered values (though maybe it should).