  import { loadModules, setDefaultOptions } from 'https://unpkg.com/esri-loader/dist/esm/esri-loader.js';

  (async () => {

    setDefaultOptions({
      css: true,
      // url: 'http://localhost:8000/buildOutput/init.js',
      // url: 'https://jscore.esri.com/debug/4.16/dojo/dojo.js',
      // version: 'next',
    });

    const [
    Map,
    MapView,
    FeatureLayer,
    generateHistogram,
    HistogramRangeSlider,
    Histogram,
    uniqueValues,
    Legend,
    Renderer,
    colorRamps,
    Color,
    viewColorUtils,
  ] = await loadModules([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/smartMapping/statistics/histogram",
    "esri/widgets/HistogramRangeSlider",
    "esri/widgets/Histogram",
    "esri/smartMapping/statistics/uniqueValues",
    "esri/widgets/Legend",
    "esri/renderers/Renderer",
    "esri/smartMapping/symbology/support/colorRamps",
    "esri/smartMapping/symbology/color",
    "esri/views/support/colorUtils",
  ]);


    // data urls
    var datasets = {
      'Citclops Water': "8581a7460e144ae09ad25d47f8e82af8_0",
      'Tucson Demographics': "35fda63efad14a7b8c2a0a68d77020b7_0",
      'Seattle Bike Facilities': "f4f509fa13504fb7957cef168fad74f0_1",
      'Traffic Circles': "717b10434d4945658355eba78b66971a_6",
      'Black Cat Range': "28b0a8a0727d4cc5a2b9703cf6ca4425_0",
      'King County Photos': "383878300c4c4f8c940272ba5bfcce34_1036",
      'NYC bags': "7264acdf886941199f7c01648ba04e6b_0",
    }

    let widgetsDiv = document.getElementById('widgetsDiv');
    let filterResults = document.getElementById('filterResults');

    // dataset switcher
    var datasetList = document.getElementById('datasetList');
    // populate dropdown with all attributes
    for (let [key, value] of Object.entries(datasets)) {
      // create new option element and add it to the dropdown
      var opt = document.createElement('option');
      opt.text = key;
      opt.value = value;
      datasetList.appendChild(opt);
    }

    datasetList.addEventListener('change', async event => {
      ({ layer, dataset } = await loadDataset({ datasetId: event.target.value, env: 'prod' }));
    });

    // track widgets and state
    var timeSlider = null;
    var dataset = null;
    var layer = null;
    var view = null;
    var layerView = null;
    var widgets = [];
    // var zoomToDataCheckbox;
    var attributeList;

    // URL params
    const params = new URLSearchParams(window.location.search);
    var env = 'prod';
    if (Array.from(params).length != 0) {
      var datasetId = params.get('dataset');
      const datasetSlug = params.get('slug');
      ({ layer, dataset } = await loadDataset({ datasetId: datasetId, datasetSlug: datasetSlug, env: env }));
      env = params.get('env');
    } else {
      var datasetId = datasetList.options[datasetList.selectedIndex].value;
      ({ layer, dataset } = await loadDataset({ datasetId: datasetId, env: env }));
    }

    async function switchSelected (event, fieldName = null) {
      fieldName = fieldName ? fieldName : event.currentTarget.dataset.field;
      const field = getDatasetField(dataset, fieldName);

      // guess at a style for this field
      try {
        // initialize a new layer
        layer = new FeatureLayer({
          renderer: {type: 'simple'},
          url: dataset.attributes.url
        });

        switchStyles(null, layer, fieldName);
      } catch(e) {
        console.log('e:', e)
      }

    }

    async function addFilter(event = null, fieldName = null, fieldStats = null) {
      let target = event ? event.currentTarget : document.getElementById(fieldName);
      fieldName = fieldName ? fieldName : target.dataset.field;
      const field = getDatasetField(dataset, fieldName);

      let firstFilter = document.getElementById('firstfilter');
      firstFilter ? firstFilter.remove() : null;

      let filter = document.createElement('div');
      filter.classList.add('filterDiv');
      fieldStats = fieldStats ? fieldStats : field.statistics;
      filter.innerHTML = generateLabel(field, fieldStats);

      // actions
      let icons = document.createElement('span');
      icons.innerHTML = "&nbsp🅧&nbsp";
      icons.onclick = removeFilter;
      icons.classList.add('filterIcons');
      let tooltip = document.createElement('span');
      tooltip.classList.add('tooltip')
      tooltip.innerText = "Delete filter";

      filter.appendChild(icons);
      icons.insertBefore(tooltip, icons.firstChild)

      let filtersList = document.getElementById('filtersList');
      filtersList.appendChild(filter);
      document.getElementById('filtersCount').innerHTML = `Applying ${filtersList.children.length} filters`;
      let container = document.createElement('div');
      filter.appendChild(container);

      if (!view) {
        view = await drawMap(layer, dataset)
      }
      layerView = await view.whenLayerView(layer);

      const { categorical, pseudoCategorical } = await datasetFieldCategorical(dataset, fieldName, layer);
      const numberLike = await datasetFieldIsNumberLike(dataset, fieldName, layer);

      // (pseudo-)categorical - most records are covered by a limited # of unique values
      // or all other string values

      if (pseudoCategorical || (field.simpleType === 'string' && !numberLike)) {
        // value list
        widget = await makeStringWidget({ dataset, fieldName, layer, layerView, container, slider: true });
      }
      // numerics and dates
      else {
        var widget = await makeHistogramWidget({ dataset, fieldName, layer, layerView, container, slider: true });
        container.classList.add('histogramWidget');
        // set whereClause attribute
        let whereClause = widget.generateWhereClause(fieldName);
        // whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        widget.container.setAttribute('whereClause', whereClause);
      }
      // if (field.simpleType === 'date') {
      //   // Time slider
      //   widget = await makeTimeSliderWidget({ dataset, fieldName, layer, layerView, slider: true });
      // }

      let sidebar = document.getElementById('sidebar')
      sidebar.scrollTop = sidebar.scrollHeight;
      widget.container.setAttribute('fieldName', fieldName);
      widget.container.setAttribute('numberLike', numberLike);
    }

    // create a histogram
    async function makeHistogram ({dataset, fieldName, layer, layerView, container, slider = false, where = null, features = null }) {
      // wrap in another container to handle height without fighting w/JSAPI and rest of sidebar
      const parentContainer = container;
      let newcontainer = document.createElement('div');
      parentContainer.appendChild(newcontainer);

      try {
        let params = {
          layer: layer,
          field: fieldName,
          numBins: 30,
          where,
          features // optional existing set of features
        };

        let values, bins, source, coverage;

        try {
          values = await generateHistogram(params);
          source = 'widgets';
          coverage = 1;
        } catch(e) {
          try {
            // histogram generation failed with automated server call, try using features from server query
            console.log('histogram generation failed with automated server call, try using features from server query', e);
            // params.features = (await layer.queryFeatures()).features;
            // const featureCount = await layer.queryFeatureCount();
            // if (params.features.length != featureCount) throw new Error('params.features.length != featureCount');

            const { features, exceededTransferLimit } = await layer.queryFeatures();
            if (exceededTransferLimit) throw new Error('exceeded server limit querying features');
            params.features = features;

            values = await generateHistogram(params);
            source = 'layerQuery';
            // coverage = params.features.length / featureCount;
          } catch(e) {
            // histogram generation failed with automated server call, try using features from server query
            console.log('histogram generation failed with automated server call, try reconstructing from unique values', e);

            try {
              let uniqueValues = (await getDatasetFieldUniqueValues(dataset, fieldName, layer)).values;
              let domain = [Math.min(...uniqueValues.map(a => a.value)),
                            Math.max(...uniqueValues.map(a => a.value))]
              // remove nulls
              var filtered = uniqueValues.filter(a => a.value != null);
              // manually reconstruct a feature values array from the unique values and their counts -
              // normalize array length to 1000, as precision isn't as important as speed here
              const divisor = dataset.attributes.recordCount / 1000;
              let arr = [];
              for (let x = 0; x < filtered.length; x++) {
                for (let y = 0; y < Math.ceil(filtered[x].count/divisor); y++) {
                  arr.push(filtered[x].value);
                };
              }
              // use d3 to bin histograms
              let d3bins = d3.histogram()  // create layout object
              .domain([Math.min(...filtered.map(a => a.value)),
              Math.max(...filtered.map(a => a.value))])  // to cover range
              .thresholds(29) // separated into 30 bins
              (arr);          // pass the array
              // convert the d3 bins array to a bins object
              bins = [];
              for (let x = 0; x < d3bins.length; x++) {
                bins.push({
                  minValue: d3bins[x]['x0'],
                  maxValue: d3bins[x]['x1'],
                  count: d3bins[x].length,
                });
              }
              // put the bins in the params object
              values = {
                'bins': bins,
                'minValue': Math.min(...filtered.map(a => a.value)),
                'maxValue': Math.max(...filtered.map(a => a.value)),
              }
              const featureCount = arr.length;
              source = 'layerQuery';
              coverage = 1;
            } catch(e) {
            // histogram generation failed with unique values, try using features in layer view
            console.log('histogram generation failed with unique values, try using features in layer view', e);
            params.features = (await layerView.queryFeatures()).features;
            // const featureCount = await layer.queryFeatureCount();
            values = await generateHistogram(params);
            source = 'layerView';
            // coverage = params.features.length / featureCount;
            }
          }
        }

        // Determine if field is an integer
        const field = getDatasetField(dataset, fieldName);
        const integer = await datasetFieldIsInteger(dataset, fieldName, layer);
        const widget =
          slider ?
            // Histogram range slider widget
            new HistogramRangeSlider({
              bins: values.bins,
              min: values.minValue,
              max: values.maxValue,
              values: [values.minValue, values.maxValue],
              precision: integer ? 0 : 2,
              container: container,
              excludedBarColor: "#dddddd",
              rangeType: "between",
              labelFormatFunction: (value, type) => {
                // apply date formatting to histogram
                if (field.simpleType == 'date') {
                  return formatDate(value);
                }
                return value;
              }
            })
          :
            // plain histogram, for miniHistogram nested in timeSlider
            new Histogram({
              bins: values.bins,
              min: values.minValue,
              max: values.maxValue,
              container: container,
              rangeType: "between",
            })
        ;
        return { widget, values, source, coverage };
      }
      catch(e) {
        console.log('histogram generation failed', e);
        return {};
      }
    }

    // make and place a histogram
    async function makeHistogramWidget({ dataset, fieldName, layer, layerView, container = null, slider = true }) {
      const wrapper = document.createElement('div');
      wrapper.classList.add('histogramWidget');
      container = container ? container : document.getElementById('filters');
      container.appendChild(wrapper);

      // filter by existing widgets on creation?
      let features;
      if (widgets.length > 0) {
        const where = concatWheres({ server: true });
        // query layer for all features in the other layers, filtered by the state of current layer
        features = (await layer.queryFeatures( { where, outFields: [fieldName] })).features;
      }

      const histogram = await makeHistogram({ dataset, fieldName, layer, layerView, features, container: wrapper, slider: true });
      if (histogram.widget) {
        wrapper.widget = histogram.widget;

        // set event handler to update map filter and histograms when handles are dragged
        histogram.widget.on(["thumb-change", "thumb-drag", "segment-drag"], event => {
          updateLayerView(layerView, fieldName, histogram.widget);
          updateWidgets(layerView, fieldName, histogram.widget);
        });

        // register widget
        widgets.push(histogram.widget);
      }
      return histogram.widget;
    }

    // make and place a value list of checkboxes
    async function makeStringWidget({ dataset, fieldName, layer, container = null, slider = true }) {
      // const listContainer = document.createElement('div');
      // const listContainer = document.createElement('div');
      container.classList.add('valueListWidget');
      const field = getDatasetField(dataset, fieldName);

      // Build filter/where clause and update layer
      const onCheckboxChange = ({ checkboxes, layerView }) => {
        let checked = checkboxes.filter(c => c.checked).map(c => JSON.parse(c.value));
        let whereClause = '1=1';
        if (checked.length > 0) {
          const hasNull = checked.find(c => c.value == null) ? true : false;
          checked = checked.filter(c => c.value != null);

          let whereVals;
          if (field.simpleType === 'date') {
            whereVals = checked.map(c => +new Date(c.value));
            whereClause = whereVals.map(v => `${fieldName} = ${v}`).join(' OR ');
          } else {
            whereVals = checked.map(c => {
              if (typeof c.value === 'string') {
                return `'${c.value}'`
              } else {
                return c.value;
              }
            });
            whereClause = `${fieldName} IN (${whereVals.join(', ')})`;
          }

          if (hasNull) {
            whereClause = whereVals ? `${whereClause} OR ` : '';
            whereClause = `${fieldName} IS NULL`; // need special SQL handling for null vales
          }
        }

        container.setAttribute('whereClause', whereClause);
        const where = concatWheres({ server: false });
        updateLayerViewEffect({ where });
      };

      const { fieldStats } = await createValueList({ dataset, fieldName, layer, container, onUpdateValues: onCheckboxChange });

      fieldStats.container = container;

      // register widget
      widgets.push(fieldStats)

      return fieldStats;
    }

    async function createValueList ({ dataset, fieldName, layer, container, onUpdateValues }) {
      // <label>
      //   <calcite-checkbox checked="true"></calcite-checkbox> Switch is on
      // </label>
      container.classList.add('filter');


      const list = document.createElement('div');

      const header = document.createElement('div');
      // header.innerText = 'Values';
      header.classList.add('sidebarItemHeader');
      list.appendChild(header);

      const checkboxList = document.createElement('div');
      list.appendChild(checkboxList);

      const field = getDatasetField(dataset, fieldName);
      const stats = await getDatasetFieldUniqueValues(dataset, fieldName, layer);
      // if (!stats.topValues || stats.topValues.length === 0) {
      //   return {};
      // }

      let checkboxListenerDisabled = false;

      function addValueListCheckbox (value, checkboxes) {
        const checkbox = document.createElement('calcite-checkbox');
        checkbox.value = JSON.stringify(value);

        // const labelText = document.createTextNode(`${value.value} (${(value.pct * 100).toFixed(2)}% of records)`);
        const labelText = document.createElement('span');

        // handle null-ish, date, and other field formatting
        if (value.value == null || (typeof value.value === 'string' && value.value.trim() === '')) {
          labelText.innerHTML = '<span style="color: gray">No value</span>';
        } else if (field.simpleType === 'date') {
          labelText.innerHTML = formatDate(value.value);
        } else {
          labelText.innerHTML = value.value;
        }

        const labelSubText = document.createElement('span');
        labelSubText.classList.add('subText');
        labelSubText.innerText = value.pct != null ? `${(value.pct * 100).toFixed(2)}%` : '';

        const onlyLink = document.createElement('a');
        onlyLink.classList.add('valueListSideLink');
        onlyLink.href = '#';
        onlyLink.innerText = 'only';

        const label = document.createElement('label');
        label.classList.add('valueListCheckbox');
        label.appendChild(checkbox);
        label.appendChild(labelText);
        label.appendChild(labelSubText);
        label.appendChild(onlyLink);

        checkbox.addEventListener('calciteCheckboxChange', (event) => {
          if (!checkboxListenerDisabled) {
            onUpdateValues({ checkboxes, event });
          }
        });

        onlyLink.addEventListener('click', event => {
          // disable change listener to keep it from firing as all checkboxes are updated
          checkboxListenerDisabled = true;

          // check selected box and un-check all others
          checkboxes.forEach(c => {
            c.checked = c === checkbox ? true : false;
          });

          // re-enable listener and invoke update handler just once
          checkboxListenerDisabled = false;
          onUpdateValues({ checkboxes, event });
        });

        checkboxList.appendChild(label);
        return checkbox;
      }

      // clear all link
      const clearLink = document.createElement('a');
      clearLink.classList.add('valueListSideLink');
      clearLink.href = '#';
      clearLink.innerText = 'clear';
      header.appendChild(clearLink);

      clearLink.addEventListener('click', event => {
        // disable change listener to keep it from firing as all checkboxes are updated
        checkboxListenerDisabled = true;

        // un-check all checkboxes
        checkboxes.forEach(c => c.checked = false);

        // re-enable listener and invoke update handler just once
        checkboxListenerDisabled = false;
        onUpdateValues({ checkboxes, event });
      });

      const checkboxes = [];
      checkboxes.push(...stats.topValues.map(value => addValueListCheckbox(value, checkboxes)));

      container.appendChild(list);

      // search box
      if (stats.uniqueCount > stats.topValues.length) {
        const searchBox = document.createElement('input');
        searchBox.classList.add('valueListSearchBox');
        searchBox.type = 'text';
        searchBox.placeholder = `Search ${stats.uniqueCount} ${fieldName} values...`;
        const wrapper = document.createElement('div');
        wrapper.classList.add('valueListSearchBoxWrapper');
        list.appendChild(searchBox);

        function searchSource(params) {
          return async function doSearch(query, callback) {
            const where = field.simpleType === 'date' ?
              `CAST(${fieldName} AS VARCHAR(256)) LIKE lower('%${query}%')` : // convert dates to strings
              `lower(${fieldName}) LIKE lower('%${query}%')`

            const { features } = await layer.queryFeatures({
              // where: `lower(${fieldName}) LIKE lower('%${query}%')`,
              // where: `CAST(${fieldName} AS VARCHAR(256)) LIKE lower('%${query}%')`,
              where,
              orderByFields: [fieldName],
              outFields: [fieldName],
              returnDistinctValues: true,
              num: 10
            });

            // de-dupe results (by turning into set)
            const vals = new Set(features
              .map(f => f.attributes[fieldName])
              .map(v => typeof v === 'string' ? v.trim() : v)
              .filter(value => {
                // exclude any results already selected in checkboxes
                return !checkboxes
                  .filter(c => c.checked)
                  .map(c => JSON.parse(c.value))
                  .map(v => v.value)
                  .includes(value);
              })
            );

            // return values
            callback([...vals].map(value => ({
              value,
              label: field.simpleType === 'date' ? formatDate(value) : value
            })));
          };
        }

        autocomplete(searchBox, { hint: false, clearOnSelected: false, }, [{
          source: searchSource({ hitsPerPage: 5 }),
          displayKey: 'label',
          templates: {
            suggestion: function(suggestion) {
              return suggestion.label;
            }
          }
        }]).on('autocomplete:selected', function(event, suggestion, dataset, context) {
          let checkbox = checkboxes
            .filter(c => !c.checked)
            .find(c => JSON.parse(c.value).value === suggestion.value);

          if (!checkbox) {
            checkbox = addValueListCheckbox(suggestion, checkboxes);
            checkboxes.push(checkbox);
          }

          checkbox.checked = true;
          // TODO: why is this necessary? calcite event listener doesn't fire when checkbox added and set to checked in this flow
          onUpdateValues({ checkboxes });
        });
      }

      return { checkboxes, fieldStats: stats };
    }

    // update layerview filter based on widget, throttled
    const updateLayerView = _.throttle(
      async (layerView, fieldName, widget, value = null) => {
        let whereClause;
        if (widget.label === "Histogram Range Slider") {
          whereClause = widget.generateWhereClause(fieldName);
          // whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        }
        if (widget.label === "TimeSlider") {
          // instead of unix timestamps, use SQL date formatting, as expected by layer.queryFeatures()
          whereClause = `${fieldName} BETWEEN DATE ${formatSQLDate(value.start)} AND DATE ${formatSQLDate(value.end)}`;
        }
        // set whereClause attribute
        widget.container.setAttribute('whereClause', whereClause);
        const where = concatWheres({ server: false });
        await updateLayerViewEffect({ where: where });
      },
      100,
      {trailing: false}
    );

    // update the bins of all histograms except the current widget, throttled
    const updateWidgets = _.throttle(
      async (layerView, fieldName, currentWidget) => {
        let widgets = Array.from(listWidgetElements());
        // if there's only one widget, skip this
        if (widgets.length === 1) return
        // collect other widgets' fieldNames, skipping the current widget (handles nested widgets too)
        let otherWidgets = widgets.filter(w => w.getAttribute('fieldname') != fieldName);
        let fieldNames = otherWidgets.map(w => w.getAttribute('fieldname'));
        // convert to a set to remove any duplicates (nested widgets), then back to array
        fieldNames = [...new Set(fieldNames)];

        let whereClause = currentWidget.container.getAttribute('whereClause');
        const numberLike = currentWidget.container.getAttribute('numberLike') === "true";
        if (numberLike) {
          whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        }
        try {
          // query layer for all features in the other layers, filtered by the state of current layer
          let { features } = await layer.queryFeatures( { where: whereClause, outFields: fieldNames });
          // update other widgets, passing in the filtered feature set
          throttledUpdateOthers(otherWidgets, features);
        } catch(e) {
          throw new Error('Tried to update other widgets: '+e)
        }
      },
      100,
      {trailing: false}
    );

    // update the bins of a histogram
    async function updateHistogram(widget, fieldName, features, { numberLike } = {}) {
      let values;
      if (features) {

        let valueExpression;
        let sqlExpression;
        if (numberLike) {
          // copy features and cast string field to number
          // features = features.map(f => {
          //   const clone = f.clone();
          //   const value = Number(clone.getAttribute(fieldName));
          //   clone.setAttribute(fieldName, value);
          //   // clone.sourceLayer = null;
          //   return clone;
          // });
          valueExpression = `Number($feature.${fieldName})`;
          sqlExpression = `CAST(${fieldName} AS FLOAT})`;
        }

        let params = {
          layer,
          view: layerView.view,
          features,
          field: valueExpression ? null : fieldName,
          valueExpression,
          // field: fieldName,
          // sqlExpression,
          numBins: 30,
          // minValue: widget.min,
          // maxValue: widget.max,
          // values: [widget.values[0], widget.values[1]]
          // values: [widget.min, widget.max]
          // sqlWhere: concatWheres()
          // sqlWhere: where
        };
        try {
          values = await generateHistogram(params);
          if (values.bins) {
            widget.bins = values.bins;
          }
        } catch(e) {
          console.log('e:', e)
        }
      }
    }

    function updateOthers(otherWidgets, features) {
      for (const widget of otherWidgets) {
        // can't update TimeSliders
        if (widget.label == "TimeSlider") continue;
        const numberLike = widget.getAttribute('numberLike') === "true";
        updateHistogram(widget.widget, widget.getAttribute('fieldName'), features, { numberLike });
      }
    }
    const throttledUpdateOthers = _.throttle(updateOthers, 100, {trailing: false});

    // list all known widget DOM elements
    function listWidgetElements() {
      return [...document.getElementById('filtersList').querySelectorAll('[whereClause]')];
    }

    // concatenate all the where clauses from all the widgets
    function concatWheres( { server }) {
      let whereClause = '';
      let widgets = listWidgetElements();
      // generate master here clause with simple string concatenation
      for (const [x, widget] of widgets.entries()) {
        if (x > 0) whereClause += ' AND ';
        let widgetWhere = widget.getAttribute('whereClause');

        // explicit cast for number-likes, for feature layer (server-side) queries ONLY
        // skip for feature layer view (client-side) queries, which work *without* the cast (but fail with it)
        const numberLike = widget.getAttribute('numberLike') === "true";
        if (server && numberLike) {
          const fieldName = widget.getAttribute('fieldName');
          widgetWhere = widgetWhere.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        }

        whereClause += '(' + widgetWhere + ')';
        // whereClause += '(' + widget.getAttribute('whereClause') + ')';
      }
      return whereClause;
    }

    // update the map view with a new where clause


    async function removeFilter(event, fieldName = null) {
      fieldName = fieldName ? fieldName : event.currentTarget.dataset.field;
      let filter = event.currentTarget.parentElement;
      let filtersList = filter.parentElement;
      filter.remove();
      document.getElementById('filtersCount').innerHTML = `Applying ${filtersList.children.length} filters`;
    }

    async function switchAttribute(event, fieldName = null) {
      fieldName = fieldName ? fieldName : event.currentTarget.dataset.field;
      const field = getDatasetField(dataset, fieldName);
      document.querySelector('#attributeListButton').innerHTML = fieldName;

      switchStyles(null, layer, fieldName);
    }

    async function switchStyles(view, layer, fieldName) {
      var field;
      try {
        if (!view) {
          view = await drawMap(layer, dataset)
        }
        widgets.innerText += '\nDrawing '+fieldName+'.';

        layerView = await view.whenLayerView(layer);
      } catch(e) {
        console.error(new Error(e));
        layerView = await view.whenLayerView(layer);
      }

      var {renderer} = await autoStyle(null, fieldName, dataset, layer, true);
      field = getDatasetField(dataset, fieldName);
      layer.renderer = renderer;
      layer.minScale = 0; // draw at all scales
      layer.outFields = ["*"]; // get all fields (easier for prototyping, optimize by managing for necessary fields)

      // clear previous filters
      if (typeof layerView != 'undefined') {
        updateLayerViewEffect({ updateExtent: true });
      }

      // wait for renderer to finish
      var watcher = await layerView.watch("updating", value => {
        if (renderer) {
          layerView.queryFeatureCount({
            where: '1=1',
            outSpatialReference: layerView.view.spatialReference
          }).then(count => {
            let featuresCount = document.getElementById('featuresCount');
            featuresCount.innerText = count;
            let filterResults = document.getElementById('filterResults');
            // filterResults.innerText = 'Showing '+count+' '+field.simpleType+' features.';
            cleanup();
          });
        }
      });
      // remove watcher as soon as it finishes
      function cleanup() {
        watcher.remove()
      }
    };

    async function drawMap(layer, dataset) {
      const map = new Map({
        basemap: "gray-vector",
        layers: layer,
      });
      view = new MapView({
        container: "viewDiv",
        map: map,
        extent: getDatasetExtent(dataset),
        ui: { components: [] }
      });
      layerView = await view.whenLayerView(layer).then((layerView) => {
        // var legend = await new Legend({
        //   view: view,
        //   layerInfos: [{
        //     layer: layer,
        //     title: "Legend"
        //   }]
        // });
        // view.ui.add(legend, "bottom-right");
      });

      view.ui.add('zoomToData', 'bottom-right');
      const zoomToDataCheckbox = document.querySelector('#zoomToData calcite-checkbox');
      zoomToDataCheckbox.addEventListener('calciteCheckboxChange', () => {
        updateLayerViewEffect({ updateExtent: zoomToDataCheckbox.checked });
      });

      // put vars on window for debugging
      Object.assign(window, { view, map, dataset, layer, layerView, getDatasetField, getDatasetFieldUniqueValues, /*histogram, histogramValues,*/ generateHistogram, HistogramRangeSlider, uniqueValues });

      // Dataset info
      document.querySelector('#datasetName').innerHTML = dataset.attributes.name;
      document.querySelector('#orgName').innerHTML = dataset.attributes.orgName || '';
      document.querySelector('#recordCount').innerHTML = `${dataset.attributes.recordCount} records`;

      return view;
    }

    // update layerview filter based on histogram widget, throttled
    const updateLayerViewWithHistogram = _.throttle(
      async (layerView, fieldName, where) => {
        await updateLayerViewEffect({ where });
      },
      50
    );


    async function loadDataset (args) {
      if (args.url) { // dataset url provided directly
        const datasetURL = args.url;
        try {
          // dataset = (await fetch(datasetURL).then(r => r.json()));
          dataset = {attributes: {url: args.url}}
        } catch(e) { console.log('failed to load dataset from url:', args.url, e); }
      } else if (args.datasetId) { // dataset id provided directly
        // https://opendataqa.arcgis.com/api/v3/datasets/97a641ac39904f349fb5fc25b94207f6
        const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets/${args.datasetId}`;
        try {
          dataset = (await fetch(datasetURL).then(r => r.json())).data;
        } catch(e) { console.log('failed to load dataset from id', args.datasetId, e); }
      } else if (args.datasetSlug) { // dataset slug provided as alternate
        // https://opendata.arcgis.com/api/v3/datasets?filter%5Bslug%5D=kingcounty%3A%3Aphoto-centers-for-2010-king-county-orthoimagery-project-ortho-image10-point
        const filter = `${encodeURIComponent('filter[slug]')}=${encodeURIComponent(args.datasetSlug)}`
        const datasetURL = `https://opendata${args.env === 'qa' ? 'qa' : ''}.arcgis.com/api/v3/datasets?${filter}`;
        try {
          dataset = (await fetch(datasetURL).then(r => r.json())).data[0];
        } catch(e) { console.log('failed to load dataset from slug', args.datasetSlug, e); }
      }

      let attributesCountDiv = document.getElementById('attributesCount');
      attributeList = updateAttributeList(dataset, '#attributeList', () => { addFilter(event) });
      // updateAttributeList(dataset, '#displayListItems')
      updateAttributeList(dataset, '#styleListItems', async () => {var { renderer } = await autoStyle(event, null, dataset, null); layer.renderer = renderer})

      let predefinedStyle = dataset.attributes?.layer?.drawingInfo;

      var renderer;
      let fieldName = Object.keys(dataset.attributes.statistics.numeric)[0]
      let field = getDatasetField(dataset, fieldName)
      switchSelected(null, field.name);

      // iterate through all attributes and run stat & style generation for all
      // for (let x in Object.keys(dataset.attributes.statistics.numeric)) {
      //   let fieldName = Object.keys(dataset.attributes.statistics.numeric)[x]
      //   let field = getDatasetField(dataset, fieldName)
      //   switchSelected(null, field.name);
      // }

      return { dataset, layer };
    }

    // analyze a dataset and choose an initial best-guess symbology for it
    async function autoStyle(event = null, fieldName = null, dataset = null, layer = null, first = false) {
      let target = event ? event.currentTarget : document.getElementById(fieldName);
      fieldName = fieldName ? fieldName : target.getAttribute('data-field');
      const field = getDatasetField(dataset, fieldName);
      const geometryType = dataset.attributes.geometryType;
      // debugger
      let datasetStats = dataset.attributes.statistics[field.simpleType][fieldName.toLowerCase()].statistics;
      let fieldStats = field.statistics;
      let minValue = fieldStats.values.min;
      let maxValue = fieldStats.values.max;
      let symbol;

      var geotype = (geometryType == 'esriGeometryPoint') ? 'point'
                  : (geometryType == 'esriGeometryMultiPoint') ? 'point'
                  : (geometryType == 'esriGeometryPolygon') ? 'polygon'
                  : (geometryType == 'esriGeometryLine') ? 'line'
                  : (geometryType == 'esriGeometryPolyline') ? 'line'
                  : geometryType;

      if (!!layer) {

        var query = layer.createQuery();
        // query.outFields = [fieldName]
        try {
          let uniqueValues = (await getDatasetFieldUniqueValues(dataset, fieldName, layer)).values;
          let domain = [Math.min(...uniqueValues.map(a => a.value)),
                        Math.max(...uniqueValues.map(a => a.value))]
          // remove nulls
          var filtered = uniqueValues.filter(a => a.value != null);
          // manually reconstruct a feature values array from the unique values and their counts -

          // normalize array length to 1000, as precision isn't as important as speed here
          // const divisor = dataset.attributes.recordCount / 1000;

          // use the whole set
          const divisor = 1;
          let arr = [];
          for (let x = 0; x < filtered.length; x++) {
            for (let y = 0; y < Math.ceil(filtered[x].count/divisor); y++) {
              arr.push(filtered[x].value);
            };
          }

          var numBins = (uniqueValues.length > 30 ? 30 : uniqueValues.length)
          // use d3 to bin histograms
          let d3bins = d3.histogram()  // create layout object
            .domain([Math.min(...filtered.map(a => a.value)),
            Math.max(...filtered.map(a => a.value))])  // to cover range
            .thresholds(numBins - 1) // separated into 30 bins
            (arr);          // pass the array
          // convert the d3 bins array to a bins object
          var bins = [];
          for (let x = 0; x < d3bins.length; x++) {
            bins.push({
              minValue: d3bins[x]['x0'],
              maxValue: d3bins[x]['x1'],
              count: d3bins[x].length,
            });
          }
          // put the bins in the params object
          var values = {
            'bins': bins,
            'minValue': Math.min(...filtered.map(a => a.value)),
            'maxValue': Math.max(...filtered.map(a => a.value)),
          }
          const featureCount = arr.length;
          var source = 'layerQuery';
          var coverage = 1;
        } catch(e) {
          // histogram generation failed with unique values, try using features in layer view
          console.log('histogram generation failed with unique values, try using features in layer view:');
          console.error(new Error(e));
          if (typeof layerView != 'undefined') {
            const { features } = await layerView.queryFeatures();
            const featureCount = await layer.queryFeatureCount();
            var values = await generateHistogram(params);
            var source = 'layerView';
            var coverage = params.features.length / featureCount;
          } else {
            console.warn('No layerView')
          }
        }

        var {features} = await layer.queryFeatures(query);

        var numValues = datasetStats.values.count;

        if (features) {
          var values = Object.values(features).map(v => v.attributes[fieldName])
        } else {
          console.log('no features returned for', fieldName)
        }

      }

      var opacity = .5;

      // get basemap color theme: "light" or "dark"
      let bgColor = await viewColorUtils.getBackgroundColorTheme(view);

      if (geometryType === 'esriGeometryPoint') {
        let stats = dataset.attributes.statistics
        // scale point size based on viewport size, number of points, and "clumpiness" of the data,
        // in order to reduce overlap of points

        // if there's still a lot of points, adjust opacity to show points through each other

        // pick a color scheme based on distribution of the data:
        // if a linear distribution, choose a linear–
        // if a log or exp distribution, choose log or exp –
        // if a normal distribution or something similar, choose "extremes"

        // choose colors based on background theme – dark on light, light on dark

        symbol = {
          type: "simple-marker",
          outline: {
            // makes the outlines of all features consistently light gray
            color: "lightgray",
            width: 0.05
          },
          size: '5px',
          opacity: opacity,
        }

      }


      else if (geometryType === 'esriGeometryPolyline') {
        symbol = {type: 'simple-line', width: '4px' };
      }

      else if (geometryType === 'esriGeometryPolygon') {
        symbol = {type: 'simple-fill' };
      }

      // choose ramp

      var num = 9;
      if (!first) {
        while (num == 9) {
          num = Math.floor(Math.random() * 19)+1;
        }
      }
      let thisramp = colorRamps.byName(`Heatmap ${num}`);
      var rampColors = thisramp.colors;

      // filterResults.innerText = 'Showing '+fieldStats.values.count+' '+field.simpleType+' values.';
      var rMin = rampColors[0];
      var rMid = rampColors[Math.floor((rampColors.length-1)/2)];
      var rMax = rampColors[rampColors.length-1];
      var renderer = {
        type: "simple", // autocasts as new SimpleRenderer()
        symbol: symbol,
        visualVariables: [{
          type: "color", // indicates this is a color visual variable
          field: fieldName,
          // normalizationField: "TOTPOP_CY", // total population
          stops: [{
            value: minValue,
            color: {r: rMin.r, g: rMin.g, b: rMin.b, a: opacity},
            label: minValue
          },{
            value: (maxValue+minValue)/2,
            color: {r: rMid.r, g: rMid.g, b: rMid.b, a: opacity},
            label: (maxValue+minValue)/2,
          },{
            value: maxValue,
            color: {r: rMax.r, g: rMax.g, b: rMax.b, a: opacity},
            label: maxValue
          }]
        }]
      };
      return {renderer};
    }

    function getDatasetExtent (dataset) {
      const extent = dataset.attributes.extent;
      return {
        xmin: extent.coordinates[0][0],
        ymin: extent.coordinates[0][1],
        xmax: extent.coordinates[1][0],
        ymax: extent.coordinates[1][1],
        spatialReference: extent.spatialReference
      };
    }

    function getDatasetField (dataset, fieldName) {
      fieldName = fieldName.toLowerCase();
      const field = dataset.attributes.fields.find(f => f.name.toLowerCase() === fieldName);
      const stats = [...Object.entries(dataset.attributes.statistics).values()].find(([, fields]) => fields[fieldName]);

      // add "simple type" (numeric, date, string) and stats into rest of field definition
      return {
        ...field,
        simpleType: stats && stats[0],
        statistics: stats && stats[1][fieldName].statistics
      }
    }

    const DATASET_FIELD_UNIQUE_VALUES = {}; // cache by field name

    async function getDatasetFieldUniqueValues (dataset, fieldName, layer) {
      if (!DATASET_FIELD_UNIQUE_VALUES[fieldName]) {
        const field = getDatasetField(dataset, fieldName);
        let stats;
        if (field.statistics && field.statistics.uniqueCount) {
          stats = { ...field.statistics };
        } else {
          const uniqueValueInfos = (await uniqueValues({ layer, field: fieldName }))
          .uniqueValueInfos
          .sort((a, b) => a.count > b.count ? -1 : 1);
          const count = uniqueValueInfos.reduce((count, f) => count + f.count, 0);
          stats = {
            count,
            uniqueCount: uniqueValueInfos.length,
            values: uniqueValueInfos
          }
        }

        // add percent of records
        stats.values = stats.values
        // .filter(v => v.value != null && (typeof v.value !== 'string' || v.value.trim() !== ''))
        .map(v => ({ ...v, pct: v.count / stats.count }));

        // get top values
        const maxTopValCount = 12;
        // stats.topValues = stats.values.slice(0, maxTopValCount);
        stats.topValues = [];
        if (stats.uniqueCount < maxTopValCount) {
          stats.topValues = stats.values;
        } else {
          let coverage = 0;
          for (let i=0, coverage=0; i < stats.values.length; i++) {
            // let stat = { ...stats.values[i], pct: stats.values[i].count / recordCount };
            const stat = stats.values[i];
            // if (coverage >= 0.80 && stat.pct < 0.05 && stats.topValues.length >= maxTopValCount) break;
            if (stat.pct < 0.015 || stats.topValues.length >= maxTopValCount) break;
            stats.topValues.push(stat);
            coverage += stat.pct;
          }
        }
        DATASET_FIELD_UNIQUE_VALUES[fieldName] = stats;
      }
      return DATASET_FIELD_UNIQUE_VALUES[fieldName];
    }

    // Determine if field is categorical or pseudo-categorical
    async function datasetFieldCategorical (dataset, fieldName, layer) {
      const stats = await getDatasetFieldUniqueValues(dataset, fieldName, layer);

      const categoricalMax = 20;
      const categorical = stats.uniqueCount <= categoricalMax;

      const pseudoCategoricalMax = 80; // categorical max N values must cover at least this % of total records
      const coverage = stats.values.slice(0, categoricalMax).reduce((sum, val) => sum + val.pct);
      const pseudoCategorical = categorical || coverage <= pseudoCategoricalMax;

      return { categorical, pseudoCategorical };
    }

    // Determine if field is an integer
    async function datasetFieldIsInteger (dataset, fieldName, layer) {
      const field = getDatasetField(dataset, fieldName);
      if (field.type.toLowerCase().includes('integer')) { // explicit integer type
        return true;
      } else { // or check the known values to see if they're all integers
        const stats = await getDatasetFieldUniqueValues(dataset, field.name, layer);
        return stats.values.every(v => v.value == null || Number.isInteger(v.value));
      }
   }

    // Determine if field is number-like, e.g. is a number or all non-null values can be parsed as such
    async function datasetFieldIsNumberLike (dataset, fieldName, layer) {
      const field = getDatasetField(dataset, fieldName);
      if (field.simpleType === 'numeric') { // explicit number type
        return true;
      } else { // or check the known values to see if they're all integers
        const stats = await getDatasetFieldUniqueValues(dataset, field.name, layer);
        return stats.values.every(v => v.value == null || !isNaN(Number(v.value)));
      }
   }

    // Add an entry to the attribute dropdown
    function updateAttributeList (dataset, list, callback) {
      // create attributeitem for each attribute
      const attributeList = document.querySelector(list);
      // clear existing entries
      Array.from(attributeList.children)
      .forEach(i => attributeList.removeChild(i))
      const attributes = [
      ...Object.entries(dataset.attributes.statistics.numeric || {}),
      ...Object.entries(dataset.attributes.statistics.date || {}),
      ...Object.entries(dataset.attributes.statistics.string || {})
      ];

      attributes
      .map(([fieldName, { statistics: fieldStats }]) => [fieldName, fieldStats]) // grab stats
      .filter(([fieldName, fieldStats]) => { // exclude fields with one value
        return !fieldStats ||
        !fieldStats.values ||
        fieldStats.uniqueCount > 1 || // unique count reported as 0 for sampled data
        fieldStats.values.min !== fieldStats.values.max
      })
      .forEach(([fieldName, fieldStats]) => {
        // dataset.attributes.fieldNames
        //   .map(fieldName => [fieldName, getDatasetField(dataset, fieldName)])
        //   .filter(([fieldName, field]) => !field.statistics || field.statistics.values.min !== field.statistics.values.max)
        //   .forEach(([fieldName, field]) => {
        const field = getDatasetField(dataset, fieldName);
        // const fieldStats = field.statistics.values;

        // make list entry for attribute
        const item = document.createElement('calcite-dropdown-item');
        item.setAttribute('class', 'attribute');
        item.innerHTML = generateLabel(field, fieldStats);

        // add icon for field type
        if (field.simpleType === 'numeric') {
          item.iconEnd = 'number';
        } else if (field.simpleType === 'string') {
          item.iconEnd = 'description';
        } else if (field.simpleType === 'date') {
          item.iconEnd = 'calendar';
        }

        item.setAttribute('data-field', field.name);
        item.addEventListener('click', () => callback(null, field.name, dataset, null));
        attributeList.appendChild(item);
      });
      return attributeList;
    }

    function getDigits(num) {
      var s = num.toString();
      s = s.split('.');
      if (s.length == 1) {
        s = [s[0], "0"];
      }
      return [s[0].length, Math.min(s[1].length, 4)];
    }

    function generateLabel(field, fieldStats) {
      var label = `${field.alias || fieldName}`;
      var min = fieldStats.values.min;
      var max = fieldStats.values.max;
      if (fieldStats && fieldStats.values && fieldStats.values.min != null && fieldStats.values.max != null) {
        if (field.simpleType === 'numeric') {
          // vary precision based on value range
          let digits = getDigits(max - min);
          let precision = digits[1] == 1 ? 0 : digits[0] > 3 ? 0 : digits[1];
          min = min.toFixed(precision);
          max = max.toFixed(precision);
          label += `<span class="attributeRange">(${min} to ${max})</span>`;
        } else if (field.simpleType === 'date') {
          label += ` (${formatDate(fieldStats.values.min)} to ${formatDate(fieldStats.values.max)})`;
        }
      } else if (fieldStats && fieldStats.uniqueCount && field.simpleType === 'string') {
        label += ` (${fieldStats.uniqueCount} values)`;
      }
      return label
    }

    // update the map view with a new where clause
    async function updateLayerViewEffect({
      // set where to be explicitly undefined if it isn't passed as an argument
      where = undefined,
      updateExtent = document.querySelector('#zoomToData calcite-checkbox')?.checked } = {}) {

      layerView.filter = null;
      layerView.effect = {
        filter: {
          where,
        },
        // excludedEffect: 'grayscale(100%) opacity(5%)'
        excludedEffect: 'grayscale(100%) brightness(25%) opacity(25%)'
      };
      layerView.queryFeatureCount({
        where: where || '1=1',
        outSpatialReference: layerView.view.spatialReference
      }).then(count => {
        let featuresCount = document.getElementById('featuresCount');
        featuresCount.innerText = count;
        // let filterResults = document.getElementById('filterResults');
        // filterResults.innerText = 'Showing '+count+' '+field.simpleType+' features.';
      });

      // adjust view extent (in or out) to fit all filtered data
      if (updateExtent) {
        try {
          let featureExtent;

          const queriedExtent = await layerView.layer.queryExtent({
            // where: (layerView.effect && layerView.effect.filter && layerView.effect.filter.where) || '1=1',
            where: layerView.effect?.filter?.where ? concatWheres({ server: true }) : '1=1',
            outSpatialReference: layerView.view.spatialReference
          });

          if (queriedExtent.count > 0) {
            featureExtent = queriedExtent.extent.expand(1.10);
          } else {
            return;
          }

          if (!layerView.view.extent.contains(featureExtent) ||
          (featureExtent.width * featureExtent.height) / (layerView.view.extent.width * layerView.view.extent.height) < 0.20) {
            layerView.view.goTo(featureExtent, { duration: 350 });
          }
        } catch(e) {
          console.log('could not query or project feature extent to update viewport', e);
        }
      }
    }

    function formatDate (timestamp) {
      const date = new Date(timestamp);
      return `${date.getMonth()+1}/${date.getDate()}/${date.getFullYear()}`;
    }

    function simpleFieldType (fieldType) {
      const fieldTypes = {
        esriFieldTypeGlobalID: 'text',
        esriFieldTypeGUID: 'text',
        esriFieldTypeDate: 'date-time',
        esriFieldTypeString: 'string',
        esriFieldTypeSingle: 'number',
        esriFieldTypeFloat: 'number',
        esriFieldTypeDouble: 'number',
        esriFieldTypeInteger: 'number',
        esriFieldTypeSmallInteger: 'number',
        esriFieldTypeOID: 'number',
      };

      return fieldTypes[fieldType] || '';
    }

    function attributeSearchChange(e) {
      let filtered = Array.from(attributeList.children)
        .map(x => {
          let field = x.getAttribute('data-field');
          x.style.display = field.toLowerCase().indexOf(e.srcElement.value) == -1 ? 'none' : 'flex';
        });
    }

    function attributeSearchKeydown(e) {
      let attributes = Array.from(document.getElementById('attributeList').getElementsByClassName('attribute'));
      attributes = attributes.filter(a => window.getComputedStyle(a).getPropertyValue('display') == 'flex')
      if (e.keyCode == 40) {
        //
      }
    }

    let attributeSearchElement = document.getElementById("attributeSearch")
    attributeSearchElement.addEventListener("input", attributeSearchChange);
    attributeSearchElement.addEventListener("keydown", attributeSearchKeydown);
    let placeholderText = `Search ${dataset.attributes.fields.length} Attributes by Name`;
    attributeSearchElement.setAttribute('placeholder', placeholderText);


    // TESTS

    // addFilter(null, "locationLatitude");
    // addFilter(null, "locationLongitude");
    // addFilter(null, "parametersBottom");
    // addFilter(null, "resultQuality");
    // addFilter(null, "sensorName");

  })();