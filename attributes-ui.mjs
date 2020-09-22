  import { loadModules, setDefaultOptions } from 'https://unpkg.com/esri-loader/dist/esm/esri-loader.js';

  (async () => {

    setDefaultOptions({
      css: true,
      // url: 'http://localhost:8000/buildOutput/init.js',
      // url: 'http://jscore.esri.com/debug/4.16/dojo/dojo.js',
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
    colorRamps,
    Color,
    viewColorUtils,
    LabelClass,
    CIMSymbol,
  ] = await loadModules([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/smartMapping/statistics/histogram",
    "esri/widgets/HistogramRangeSlider",
    "esri/widgets/Histogram",
    "esri/smartMapping/statistics/uniqueValues",
    "esri/widgets/Legend",
    "esri/smartMapping/symbology/support/colorRamps",
    "esri/smartMapping/symbology/color",
    "esri/views/support/colorUtils",
    "esri/layers/support/LabelClass",
    "esri/symbols/CIMSymbol",
  ]);

    // data urls
    var datasets = {
      'Tucson Demographics': "35fda63efad14a7b8c2a0a68d77020b7_0",
      'Citclops Water': "8581a7460e144ae09ad25d47f8e82af8_0",
      'Seattle Bike Facilities': "f4f509fa13504fb7957cef168fad74f0_1",
      'NYC bags': "7264acdf886941199f7c01648ba04e6b_0",
      'Black Rat Range': "28b0a8a0727d4cc5a2b9703cf6ca4425_0",
      'Traffic Circles': "717b10434d4945658355eba78b66971a_6",
      'King County Photos': "383878300c4c4f8c940272ba5bfcce34_1036",
    }

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
      await loadDataset({ datasetId: event.target.value, env: 'prod' });
    });

    // track state
    var state = {
      timeSlider: null,
      dataset: null,
      layer: null,
      view: null,
      layerView: null,
      widgets: [],
      attributeList: [],
      bgColor: null,
      legend: null,
    }
    // zoomToDataCheckbox,

    // URL params
    const params = new URLSearchParams(window.location.search);
    var env = 'prod';
    if (Array.from(params).length != 0) {
      var datasetId = params.get('dataset');
      const datasetSlug = params.get('slug');
      await loadDataset({ datasetId, datasetSlug, env });
      env = params.get('env');
    } else {
      var datasetId = datasetList.options[datasetList.selectedIndex].value;
      await loadDataset({ datasetId, env });
    }

    async function addFilter({event = null, fieldName = null, fieldStats = null}) {
      let {view, layer, layerView} = state;
      // if no fieldName is passed directly, get it from the attribute selection event
      fieldName = fieldName ? fieldName : event.currentTarget.dataset.field;
      const field = await getDatasetField(fieldName);

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
        view = await drawMap(layer)
        layerView = await view.whenLayerView(layer);
      }

      const { categorical, pseudoCategorical } = await datasetFieldCategorical(fieldName);
      const numberLike = await datasetFieldIsNumberLike(fieldName);

      // (pseudo-)categorical - most records are covered by a limited # of unique values
      // or all other string values

      if ((field.simpleType === 'string' && !numberLike)) {
        // value list
        widget = await makeStringWidget({ fieldName, container, slider: true });
      }
      // numerics and dates
      else {
        var widget = await makeHistogramWidget({ fieldName, container, slider: true });
        container.classList.add('histogramWidget');
        // set whereClause attribute
        let whereClause = widget.generateWhereClause(fieldName);
        // whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        widget.container.setAttribute('whereClause', whereClause);
      }
      // if (field.simpleType === 'date') {
      //   // Time slider
      //   widget = await makeTimeSliderWidget({ fieldName, container, slider: true });
      // }

      let sidebar = document.getElementById('sidebar')
      sidebar.scrollTop = sidebar.scrollHeight;
      widget.container.setAttribute('fieldName', fieldName);
      widget.container.setAttribute('numberLike', numberLike);
      state = {...state, view, layer, layerView};
    }

    // create a histogram
    async function makeHistogram ({fieldName, container, slider = false, where = null, features = null }) {
      // wrap in another container to handle height without fighting w/JSAPI and rest of sidebar
      const parentContainer = container;
      let newcontainer = document.createElement('div');
      parentContainer.appendChild(newcontainer);
      const numberLike = await datasetFieldIsNumberLike(fieldName);
      if (!where) {
        where = "1=1";
      }
      if (numberLike) {
        where = where.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
      }

      try {
        let params = {
          layer: state.layer,
          field: fieldName,
          numBins: 30,
          where, // optional where clause
          features // optional existing set of features
        };
        let values, source, coverage;
        try {
          values = await generateHistogram(params);
          source = 'widgets';
          coverage = 1;
        } catch(e) {
          try {
            // histogram generation failed with automated server call, try using features from server query
            console.warn('Histogram generation failed with automated server call, try using features from server query\n', e);
            // params.features = (await layer.queryFeatures()).features;
            // const featureCount = await layer.queryFeatureCount();
            // if (params.features.length != featureCount) throw new Error('params.features.length != featureCount');

            const { features, exceededTransferLimit } = await state.layer.queryFeatures();
            if (exceededTransferLimit) throw new Error('Exceeded server limit querying features');
            params.features = features;

            values = await generateHistogram(params);
            source = 'layerQuery';
            coverage = params.features.length / featureCount;
          } catch(e) {
            // histogram generation failed with automated server call, try using features from server query
            console.warn('Histogram generation failed with server query, try reconstructing from unique values\n', e);

            try {
              let uniqueValues = (await getDatasetFieldUniqueValues(fieldName)).values;
              let domain = [Math.min(...uniqueValues.map(a => a.value)),
                            Math.max(...uniqueValues.map(a => a.value))]
              // remove nulls
              var filtered = uniqueValues.filter(a => a.value != null);
              // manually reconstruct a feature values array from the unique values and their counts -
              // normalize array length to 1000, as precision isn't as important as speed here
              const divisor = state.dataset.attributes.recordCount / 1000;
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
              var bins = [];
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
            console.warn('Histogram generation failed with unique values, try using features in layer view\n', e);
            params.features = (await state.layerView.queryFeatures()).features;
            // const featureCount = await layer.queryFeatureCount();
            values = await generateHistogram(params);
            source = 'layerView';
            }
          }
        }

        // Determine if field is an integer
        const field = getDatasetField(fieldName);
        const integer = await datasetFieldIsInteger(fieldName);
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
    async function makeHistogramWidget({ fieldName, container = null, slider = true }) {
      var {widgets, layer} = state;
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

      const histogram = await makeHistogram({ fieldName, features, container: wrapper, slider: true });
      if (histogram.widget) {
        wrapper.widget = histogram.widget;

        // set event handler to update map filter and histograms when handles are dragged
        histogram.widget.on(["thumb-change", "thumb-drag", "segment-drag"], event => {
          updateLayerView(fieldName, histogram.widget);
          updateWidgets(fieldName, histogram.widget);
        });

        // register widget
        state.widgets.push(histogram.widget);
      }
      return histogram.widget;
    }

    // make and place a value list of checkboxes
    async function makeStringWidget({ fieldName, container = null, slider = true }) {
      // const listContainer = document.createElement('div');
      // const listContainer = document.createElement('div');
      container.classList.add('valueListWidget');
      const field = getDatasetField(fieldName);

      // Build filter/where clause and update layer
      const onCheckboxChange = ({ checkboxes }) => {
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

      const { fieldStats } = await createValueList({ fieldName, container, onUpdateValues: onCheckboxChange });

      fieldStats.container = container;

      // register widget
      state.widgets.push(fieldStats)

      return fieldStats;
    }

    async function createValueList ({ fieldName, container, onUpdateValues }) {
      var {dataset, layer} = state;
      container.classList.add('filter');


      const list = document.createElement('div');

      const header = document.createElement('div');
      // header.innerText = 'Values';
      header.classList.add('sidebarItemHeader');
      list.appendChild(header);

      const checkboxList = document.createElement('div');
      list.appendChild(checkboxList);

      const field = getDatasetField(fieldName);
      const stats = await getDatasetFieldUniqueValues(fieldName, layer);
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
        }]).on('autocomplete:selected', function(event, suggestion, context) {
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
      async (fieldName, widget, value = null) => {
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
        await updateLayerViewEffect({ where });
      },
      100,
      {trailing: false}
    );

    // update the bins of all histograms except the current widget, throttled
    const updateWidgets = _.throttle(
      async (fieldName, currentWidget) => {
        let widgets = Array.from(listWidgetElements());
        // if there's only one widget, skip this
        if (widgets.length === 1) return
        // collect other widgets' fieldNames, skipping the current widget (handles nested widgets too)
        let otherWidgets = widgets.filter(w => w.getAttribute('fieldname') != fieldName);
        let fieldNames = otherWidgets.map(w => w.getAttribute('fieldname'));
        // convert to a set to remove any duplicates (nested widgets), then back to array
        fieldNames = [...new Set(fieldNames)];
        if (fieldNames.length == 0) return;

        let whereClause = currentWidget.container.getAttribute('whereClause');
        const numberLike = currentWidget.container.getAttribute('numberLike') === "true";
        if (numberLike) {
          whereClause = whereClause.replace(fieldName, `CAST(${fieldName} AS FLOAT)`); // for number-like fields
        }
        try {
          // query layer for all features in the other layers, filtered by the state of current layer
          var { features } = await state.layer.queryFeatures( { where: whereClause, outFields: fieldNames });
        } catch(e) {
          throw new Error(`Failed to query layer for ${fieldName}: ${e}`)
        }
        try {
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
      var {layer, view} = state;
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
          view,
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
    function concatWheres( { server = false } = {}) {
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
      updateLayerViewEffect();
    }

    async function drawMap() {
      var {dataset, layer} = state;
      const map = new Map({
        // choose a light or dark background theme
        basemap: "gray-vector",
        // basemap: "dark-gray-vector",
        layers: layer,
      });
      var view = new MapView({
        container: "viewDiv",
        map: map,
        extent: getDatasetExtent(dataset),
        ui: { components: [] }
      });
      var layerView = await view.whenLayerView(layer).then((layerView) => {
        return layerView;
      });

      view.ui.add('zoomToData', 'top-right');
      const zoomToDataCheckbox = document.querySelector('#zoomToData calcite-checkbox');
      zoomToDataCheckbox.addEventListener('calciteCheckboxChange', () => {
        updateLayerViewEffect();
      });

      // put vars on window for debugging
      Object.assign(window, { state, map, getDatasetField, getDatasetFieldUniqueValues, /*histogram, histogramValues,*/ generateHistogram, HistogramRangeSlider, uniqueValues });

      // Dataset info
      document.querySelector('#datasetName').innerHTML = dataset.attributes.name;
      document.querySelector('#orgName').innerHTML = dataset.attributes.orgName || '';
      document.querySelector('#recordCount').innerHTML = `${dataset.attributes.recordCount} records`;
      state.view = view;
      state.layerView = layerView;
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
      var {dataset, layer} = state;
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
      // update state so dataset is available for attribute list update
      state.dataset = dataset;

      // clear filters list
      clearFilters();

      // clear widgets list
      state.widgets = [];

      // update attributes lists
      state.attributeList = updateAttributeList('#filterAttributeList', () => { addFilter({event}) });
      updateAttributeList('#styleAttributeList', async () => {
        autoStyle({event});
      })

      let filterAttributeSearchElement = document.getElementById("filterAttributeSearch")
      filterAttributeSearchElement.addEventListener("input", filterAttributeSearchChange);
      let filterPlaceholderText = `Search ${dataset.attributes.fields.length} Attributes by Name`;
      filterAttributeSearchElement.setAttribute('placeholder', filterPlaceholderText);

      let styleAttributeSearchElement = document.getElementById("styleAttributeSearch")
      styleAttributeSearchElement.addEventListener("input", styleAttributeSearchChange);
      let stylePlaceholderText = `Search ${dataset.attributes.fields.length} Attributes by Name`;
      styleAttributeSearchElement.setAttribute('placeholder', stylePlaceholderText);

      const url = dataset.attributes.url;

      state.usePredefinedStyle = false; // disable for now
      try {
        // initialize a new layer
        layer = new FeatureLayer({
          renderer: {type: 'simple'},
          url,
          minScale: 0,
          maxScale: 0,
        });
      } catch(e) {
        console.log('e:', e)
      }
      // update state
      state = {...state, layer};
      // draw map once before autoStyling because theme detection requires an initialized layerView object
      state.view = await drawMap(layer);
      // guess at a style for this field
      autoStyle({});
    }

    // manually reconstruct a feature values array from unique values and their counts
    function reconstructDataset(values) {
      // normalize array length to 1000, as precision isn't as important as speed here
      // const divisor = dataset.attributes.recordCount / 1000;

      // use the whole set
      const divisor = 1;
      let arr = [];
      for (let x = 0; x < values.length; x++) {
        for (let y = 0; y < Math.ceil(values[x].count/divisor); y++) {
          arr.push(values[x].value);
        };
      }
      return arr;
    }

    async function getBgColor() {
      try {
        var bgColor = await viewColorUtils.getBackgroundColorTheme(state.view);
      } catch(e) {
          try {
            if (!view) {
              view = await drawMap(layer)
            }
            if (!layerView) {
              layerView = await view.whenLayerView(layer);
            }
            if (view && layerView) {
              bgColor = await viewColorUtils.getBackgroundColorTheme(state.view);
            }
          } catch(e) {
            throw new Error('Problem getting bgColor:', e)
          }

        console.warn(`Couldn't detect basemap color theme (only works if tab is visible), choosing "light."`, e)
        bgColor = "light";
      }
      return bgColor;
    }

    // analyze a dataset and choose an initial best-guess symbology for it
    async function autoStyle({event = null, fieldName = null}) {
      var {dataset, layer, view, usePredefinedStyle, bgColor} = state;
      // get basemap color theme: "light" or "dark"
      bgColor = await getBgColor();

      var symbol;
      var renderer = {
        type: "simple", // autocasts as new SimpleRenderer()
        visualVariables: [],
      };

      const geometryType = dataset.attributes.geometryType;
      var geotype = (geometryType == 'esriGeometryPoint') ? 'point'
                  : (geometryType == 'esriGeometryMultiPoint') ? 'point'
                  : (geometryType == 'esriGeometryPolygon') ? 'polygon'
                  : (geometryType == 'esriGeometryLine') ? 'line'
                  : (geometryType == 'esriGeometryPolyline') ? 'line'
                  : geometryType;

      // check for passed fieldName or pull it from the event object:
      if (!fieldName) { fieldName = event?.currentTarget?.getAttribute('data-field'); }
      // if still no fieldName, check for a displayField in the dataset and use that as the fieldName
      if (!fieldName) {
        fieldName = dataset?.attributes?.displayField; }
      // if there's a fieldName then style it by field
      if (fieldName) {
        var field = getDatasetField(fieldName);
        var datasetStats = dataset.attributes.statistics[field.simpleType][fieldName.toLowerCase()].statistics;
        var fieldStats = field.statistics;
        var minValue = fieldStats.values.min;
        var maxValue = fieldStats.values.max;
        var { categorical, pseudoCategorical } = await datasetFieldCategorical(fieldName);

        // get the features
        if (!!layer) {
          var query = layer.createQuery();
          var {features} = await layer.queryFeatures(query);
          var numValues = datasetStats.values.length;
          if (features) {
            var values = Object.values(features).map(v => v.attributes[fieldName])
          } else {
            console.log('no features returned for', fieldName)
          }
        }

      // } else if (usePredefinedStyle) {
      //   // check for built-in style passed in with the dataset
      //   let predefinedStyle = dataset.attributes?.layer?.drawingInfo;
      //   if (predefinedStyle && usePredefinedStyle) {
      //     layer = await new FeatureLayer({
      //       // renderer: jsonUtils.fromJSON(predefinedStyle.renderer),
      //       // url
      //     });
      //   }
      // } else {
      }

      //
      // Choose symbology based on various dataset and theme attributes
      //

      var opacity = 1;

      // choose colors based on background theme – dark on light, light on dark
      var color = bgColor == "dark" ? "lightblue" : "steelblue";
      var outlineColor = bgColor == "dark" ? "black" : "white";

      // if no fieldName was passed, style an overview of feature geometry
      if (!fieldName) {
        renderer.visualVariables.push({
          type: "color",
          // slightly randomize colors to differentiate between features
          valueExpression: `random()`,
          stops: [
            {
              color: '#4682b4',
              value: '0'
            },
            {
              color: '#325D81',
              value: '1'
            },
          ]
        });
      } else {
        // GET RAMP
        // a more full exploration in auto-style.html
        if (!categorical) {
          var ramp = colorRamps.byName("Blue 3");
          var rampColors = ramp.colors;
          var rMax = rampColors[0];
          var rMin = rampColors[rampColors.length-1];
          // darken the brightest just a bit – white gets lost in the bright basemap
          rMax = {r: (rMax.r + rMin.r) * .8, g: (rMax.g + rMin.g) * .8, b: (rMax.b + rMin.b) * .8}
          var rMid = {r: (rMax.r + rMin.r) / 2, g: (rMax.g + rMin.g) / 2, b: (rMax.b + rMin.b) / 2};

        } else {
          ramp = colorRamps.byName("Mushroom Soup");
          rampColors = ramp.colors;
          var rMin = rampColors[0];
          var rMid = rampColors[Math.floor((rampColors.length-1/2))];
          var rMax = rampColors[rampColors.length-1];
        }

        // clear other color variables
        renderer.visualVariables = renderer.visualVariables.filter(i => i.type != "color");

        // override default color visual variable
        renderer.visualVariables.push({
          type: "color", // indicates this is a color visual variable
          field: fieldName,
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
        });
      }

      if (geotype === 'point') {
        symbol = {
          type: "simple-marker",
          color: color,
          outline: {
            color: outlineColor,
            width: 1, // no fractional outline widths :P
          },
          size: '5px',
          opacity: opacity,
        }
        // scale values from:
        // https://www.esri.com/arcgis-blog/products/product/mapping/web-map-zoom-levels-updated/

        var cimsymbol = new CIMSymbol({
          data:  {
            type: "CIMSymbolReference",
            symbol: {
              type: "CIMPointSymbol",
              symbolLayers: [{
                  type: "CIMVectorMarker",
                  enable: true,
                  size: 16,
                  frame: {
                    xmin: 0,
                    ymin: 0,
                    xmax: 16,
                    ymax: 16
                  },
                  markerGraphics: [{
                    type: "CIMMarkerGraphic",
                    geometry: {
                      rings: [
                        [
                          [8.5, 0.2],[7.06, 0.33],[5.66, 0.7],[4.35, 1.31],[3.16, 2.14],[2.14, 3.16],[1.31, 4.35],[0.7, 5.66],[0.33, 7.06],[0.2, 8.5],[0.33, 9.94],[0.7, 11.34],[1.31, 12.65],[2.14, 13.84],[3.16, 14.86],[4.35, 15.69],[5.66, 16.3],[7.06, 16.67],[8.5, 16.8],[9.94, 16.67],[11.34, 16.3],[12.65, 15.69],[13.84, 14.86],[14.86, 13.84],[15.69, 12.65],[16.3, 11.34],[16.67, 9.94],[16.8, 8.5],[16.67, 7.06],[16.3, 5.66],[15.69, 4.35],[14.86, 3.16],[13.84, 2.14],[12.65, 1.31],[11.34, 0.7],[9.94, 0.33],[8.5, 0.2]
                        ]
                      ]                    },
                    symbol: {
                      type: "CIMPolygonSymbol",
                      symbolLayers: [
                        {
                          type: "CIMSolidStroke",
                          width: .5,
                          color: [240, 94, 35, 255]
                        },
                        {
                          type: "CIMSolidFill",
                          color: [240, 94, 35, 255]
                        },
                      ]
                    }
                  }]
              }]
            }
          }
        });
      }

      else if (geotype === 'line') {
        symbol = {
          type: 'simple-line',
          width: '2px',
          color: color,
          opacity: opacity,
        };
        renderer.visualVariables.push({
          type: "size",
          valueExpression: "$view.scale",
          stops: [
            {
              size: .5,
              value: 1155581.108577 // z8 on map, z9 in docs, etc
            },
            {
              size: 1,
              value: 577790.554289 // z9
            },
            {
              size: 2,
              value: 144447.638572 // z11
            },
          ]
        });
      }

      else if (geotype === 'polygon') {
        symbol = {
          type: 'simple-fill',
          outline: {
            color: outlineColor,
            width: 0.5,
          },
        };
      }

      if (categorical) {
        let uniqueValues = (await getDatasetFieldUniqueValues(fieldName)).values;
        // optional: sort by values
        // uniqueValues.sort((a, b) => a.value !== b.value ? a.value < b.value ? -1 : 1 : 0);
        // TODO: sort before assigning color values, currently values are arranged by frequency,
        // and colors are assigned before this step

        // remove nulls
        var filtered = uniqueValues.filter(a => a.value != null);

        // generate categorical colors for field
        var uniqueValueInfos = [];
        for (let x = 0; x < filtered.length; x++) {
          var uniqueSymbol = cimsymbol.clone();
          // set stroke color to half the value of current ramp color
          let strokeColor = [
            rampColors[(x % rampColors.length)%rampColors.length].r * .5,
            rampColors[(x % rampColors.length)%rampColors.length].g * .5,
            rampColors[(x % rampColors.length)%rampColors.length].b * .5,
            255 //alpha is always opaque
          ];
          uniqueSymbol.data.symbol.symbolLayers[0].markerGraphics[0].symbol.symbolLayers[0].color = strokeColor;
          // set fillColor
          let fillColor = [
            rampColors[(x % rampColors.length)%rampColors.length].r,
            rampColors[(x % rampColors.length)%rampColors.length].g,
            rampColors[(x % rampColors.length)%rampColors.length].b,
            255 //alpha is always opaque
          ];
          uniqueSymbol.data.symbol.symbolLayers[0].markerGraphics[0].symbol.symbolLayers[1].color = fillColor;

          uniqueValueInfos.push( {
            value: filtered[x].value,
            symbol: uniqueSymbol,
          });
        }
        renderer = {
          type: "unique-value",
          field: fieldName,
          uniqueValueInfos
        };
      } else {
        renderer = {...renderer, symbol: symbol};
      }

      // set point scales for all point
      if (geotype == "point") {
        if (!renderer.visualVariables) {
          renderer.visualVariables = [];
        }
        renderer.visualVariables.push({
          type: "size",
          valueExpression: "$view.scale",
          stops: [
            {
              size: 6,
              value: 18055.954822 // z15 map, z16 docs
            },
            {
              size: 3,
              value: 577790.554289 // z9 map, z10 docs
            },
          ]
        });
      }

      layer.renderer = renderer;

      // set up custom labels – this should be done to override any labelingInfo sent from the server –
      // add labels to polygons only for now
      if (geotype == "polygon") {
        if (dataset.attributes.displayField && !fieldName) {
          var expression = "$feature."+dataset.attributes.displayField;
        } else {
          // default to NAME
          expression = "$feature.NAME";
        }
        if (!bgColor) {
          // bgcolor might not be set if the tab wasn't visible when loaded
          bgColor = await getBgColor();
        }
        const labels = new LabelClass({
          labelExpressionInfo: { expression },
            symbol: {
              type: "text",  // autocasts as new TextSymbol()
              color: "white",
              haloSize: 2,
              haloColor: bgColor == "light" ? "steelblue" : "black",
              font: {
                size: '14px',
              }
            }
          });
          layer.labelingInfo = [ labels ];
        if (layer.labelingInfo && !usePredefinedStyle) {
          // console.log('layer.labelingInfo:', layer.labelingInfo)
        }
      }

      // add legend
      var {legend} = state;
        if (fieldName) {
        // remove and replace legend entirely to avoid dojo issues
        view.ui.remove(legend);
        legend = await new Legend({
          view: view
        })
        legend.layerInfos = [{
          layer: layer,
          title: null
        }]
        view.ui.add(legend, "bottom-right");
      } else {
        view.ui.remove(legend);
        legend = null;
      }

      updateLayerViewEffect();

      // update state
      state = {...state, layer, renderer, bgColor, legend}

      return {layer, renderer};
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

    function getDatasetField (fieldName) {
      let lc_fieldName = fieldName.toLowerCase();
      const field = state.dataset.attributes.fields.find(f => f.name.toLowerCase() === lc_fieldName);
      if (!field) {
        throw new Error(`Could not find field "${fieldName}" in dataset.`);
      }
      const stats = [...Object.entries(state.dataset.attributes.statistics).values()].find(([, fields]) => fields[lc_fieldName]);

      // add "simple type" (numeric, date, string) and stats into rest of field definition
      return {
        ...field,
        simpleType: stats && stats[0],
        statistics: stats && stats[1][lc_fieldName].statistics
      }
    }

    const DATASET_FIELD_UNIQUE_VALUES = {}; // cache by field name

    async function getDatasetFieldUniqueValues (fieldName) {
      if (!DATASET_FIELD_UNIQUE_VALUES[fieldName]) {
        const field = getDatasetField(fieldName);
        let stats;
        if (field.statistics && field.statistics.uniqueCount) {
          stats = { ...field.statistics };
        } else {
          const uniqueValueInfos = (await uniqueValues({ layer: state.layer, field: fieldName }))
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
    async function datasetFieldCategorical (fieldName) {
      const field = await getDatasetField(fieldName);
      const stats = await getDatasetFieldUniqueValues(fieldName);

      const categoricalMax = field.type == "string" ? 20 : 10;
      const categorical = stats.uniqueCount <= categoricalMax;

      const pseudoCategoricalMax = 80; // categorical max N values must cover at least this % of total records
      const coverage = stats.values.slice(0, categoricalMax).reduce((sum, val) => sum + val.pct);
      const pseudoCategorical = categorical || coverage <= pseudoCategoricalMax;

      return { categorical, pseudoCategorical };
    }

    // Determine if field is an integer
    async function datasetFieldIsInteger (fieldName) {
      const field = getDatasetField(fieldName);
      if (field.type.toLowerCase().includes('integer')) { // explicit integer type
        return true;
      } else { // or check the known values to see if they're all integers
        const stats = await getDatasetFieldUniqueValues(field.name);
        return stats.values.every(v => v.value == null || Number.isInteger(v.value));
      }
   }

    // Determine if field is number-like, e.g. is a number or all non-null values can be parsed as such
    async function datasetFieldIsNumberLike (fieldName) {
      const field = getDatasetField(fieldName);
      if (field.simpleType === 'numeric') { // explicit number type
        return true;
      } else { // or check the known values to see if they're all integers
        const stats = await getDatasetFieldUniqueValues(field.name);
        return stats.values.every(v => v.value == null || !isNaN(Number(v.value)));
      }
   }

    // Add an entry to the attribute dropdown
    function updateAttributeList (list, callback) {
      var {dataset} = state;
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
        //   .map(fieldName => [fieldName, getDatasetField(fieldName)])
        //   .filter(([fieldName, field]) => !field.statistics || field.statistics.values.min !== field.statistics.values.max)
        //   .forEach(([fieldName, field]) => {
        const field = getDatasetField(fieldName);
        fieldName = field.name;
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

        item.setAttribute('data-field', fieldName);
        item.addEventListener('click', () => callback({fieldName}));
        attributeList.appendChild(item);
      });
      return attributeList;
    }

    // find the number of significant digits of a numberic valeue, for truncation in generateLabel()
    function getDigits(num) {
      var s = num.toString();
      s = s.split('.');
      if (s.length == 1) {
        s = [s[0], "0"];
      }
      // return number of digits to the left and right of the decimal point
      return [s[0].length, Math.min(s[1].length, 4)];
    }

    function generateLabel(field, fieldStats) {
      var label = `${field.alias || field.name}`;
      var min = fieldStats.values.min;
      var max = fieldStats.values.max;
      if (fieldStats && fieldStats.values && fieldStats.values.min != null && fieldStats.values.max != null) {
        if (field.simpleType === 'numeric') {
          // vary precision based on value range – round to integers if range is > 100, otherwise
          // find the decimal exponent of the most sigfig of the value range, and truncate two decimal places past that -
          // eg: if the range is .000999999, most sigfig exponent is -4 (.0001), values will be truncated to -6 (.000001)
          // TODO: test if this is actually working (seems to in practice)
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
      // calculate where if isn't passed as an argument
      where = concatWheres(),
      updateExtent = document.querySelector('#zoomToData calcite-checkbox')?.checked } = {}) {
      var {view, layer, layerView} = state;
      if (!layerView) {
        layerView = await view.whenLayerView(layer);
        // update state
        state = {...state, layerView};
      }
      layerView.filter = null;
      layerView.effect = {
        filter: {
          where,
        },
        excludedEffect: 'grayscale(100%) contrast(50%) brightness(200%) opacity(50%)'
      };
      layerView.queryFeatureCount({
        where: where || '1=1',
        outSpatialReference: view.spatialReference
      }).then(count => {
        let featuresCount = document.getElementById('featuresCount');
        featuresCount.innerText = count;
      });
      // adjust view extent (in or out) to fit all filtered data
      if (updateExtent) {
        try {
          let featureExtent;

          const queriedExtent = await layer.queryExtent({
            // where: (layerView.effect && layerView.effect.filter && layerView.effect.filter.where) || '1=1',
            where: layerView.effect?.filter?.where ? concatWheres({ server: true }) : '1=1',
            outSpatialReference: view.spatialReference
          });

          if (queriedExtent.count > 0) {
            featureExtent = queriedExtent.extent.expand(1.10);
          } else {
            return;
          }
          if (!view.extent.contains(featureExtent) ||
          (featureExtent.width * featureExtent.height) / (view.extent.width * view.extent.height) < 0.30) {
            view.goTo(featureExtent, { duration: 350 });
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

    function filterAttributeSearchChange(e) {
      Array.from(document.getElementById('filterAttributeList').children)
        .map(x => {
          let field = x.getAttribute('data-field');
          let fieldName = getDatasetField(field).alias.toLowerCase();
          x.style.display = fieldName.indexOf(e.srcElement.value) == -1 ? 'none' : 'flex';
        });
    }

    function styleAttributeSearchChange(e) {
      console.log('e.srcElement.value', e.srcElement.value)
      Array.from(document.getElementById('styleAttributeList').children)
      .map(x => {
        let field = x.getAttribute('data-field');
        let fieldName = getDatasetField(field).alias.toLowerCase();
        x.style.display = fieldName.indexOf(e.srcElement.value) == -1 ? 'none' : 'flex';
    });
    }

    // clear filters list and reset filters UI
    function clearFilters() {
      let filtersList = document.getElementById('filtersList');
      for (var i = filtersList.children.length; i > 0 ; i--) {
        // remove the top one in the list
        filtersList.children[0].remove();
      }
      document.getElementById('filtersCount').innerHTML = `Applying ${filtersList.children.length} filters`;
      document.getElementById('featuresCount').innerHTML = '';
    }


    // TESTS
    // autoStyle({fieldName:"sensorPropertiesDevicePlatform"});
    // autoStyle({fieldName:"sensorName"});
    // addFilter({fieldName:"observationResult"});
    // addFilter({fieldName="locationLongitude});
    // addFilter({fieldName="parametersBottom});
    // addFilter({fieldName="resultQuality});
    // addFilter({fieldName="sensorName});
    // addFilter({fieldName="resultTime});
    // addFilter({fieldName:"PROJECT_NUMBER"});

  })();