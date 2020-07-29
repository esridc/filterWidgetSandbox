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
    ] = await loadModules([
    "esri/Map",
    "esri/views/MapView",
    "esri/layers/FeatureLayer",
    "esri/renderers/smartMapping/statistics/histogram",
    "esri/widgets/HistogramRangeSlider",
    "esri/widgets/Histogram",
    "esri/renderers/smartMapping/statistics/uniqueValues",
    "esri/widgets/Legend",
    "esri/renderers/Renderer",
    "esri/renderers/smartMapping/symbology/support/colorRamps",
    "esri/renderers/smartMapping/symbology/color",
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

    let widgets = document.getElementById('widgetsDiv');
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
    var layerView = null;
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
      document.querySelector('#attributeListButton').innerHTML = fieldName;

      // Reset UI state

      widgets.innerHTML = ''; // clear previous widget

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

    async function addFilter(event, fieldName = null) {
      fieldName = fieldName ? fieldName : event.currentTarget.dataset.field;
      const field = getDatasetField(dataset, fieldName);
      // document.querySelector('#attributeListButton').innerHTML = fieldName;

      let firstFilter = document.getElementById('firstfilter');
      firstFilter ? firstFilter.remove() : null;

      let filter = document.createElement('div');
      filter.innerText = fieldName;
      let filtersList = document.getElementById('filtersList');
      filtersList.appendChild(filter);
      let widget = document.createElement('div');
      widget.classList.add('histogramWidget');
      filter.appendChild(widget);

      // Numeric fields - histogram
      if (field.simpleType === 'numeric' || field.simpleType === 'date') {
        const histogram = await createHistogram({ dataset, fieldName, layer, layerView, container: widget, slider: true });
      }
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
          var view = await drawMap(layer, dataset)
        }
        widgets.innerText += '\nDrawing '+fieldName+'.';

        layerView = await view.whenLayerView(layer);
      } catch(e) {
        console.error(new Error(e));
        layerView = await view.whenLayerView(layer);
      }

      var {renderer} = await autoStyle(fieldName, dataset, layer);
      field = getDatasetField(dataset, fieldName);
      layer.renderer = renderer;
      layer.minScale = 0; // draw at all scales
      layer.outFields = ["*"]; // get all fields (easier for prototyping, optimize by managing for necessary fields)

      // clear previous filters
      if (typeof layerView != 'undefined') {
        updateLayerViewEffect(layerView, { updateExtent: true });
      }

    };

    async function drawMap(layer, dataset) {
      const map = new Map({
        basemap: "dark-gray-vector",
        layers: layer,
      });
      const view = new MapView({
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
      await updateLayerViewEffect(layerView, { where: where, updateExtent: true });
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

      attributeList = updateAttributeList(dataset, '#attributeList')
      updateAttributeList(dataset, '#displayListItems')
      updateAttributeList(dataset, '#styleListItems')

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
    async function autoStyle(fieldName, dataset, layer) {
      const geometryType = dataset.attributes.geometryType;
      var field = getDatasetField(dataset, fieldName);
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

      let thisramp = colorRamps.byName("Heatmap 9");
      var rampColors = thisramp.colors;

      widgets.innerText += '\nShowing '+fieldStats.values.count+' '+field.simpleType+' values.';
      filterResults.innerText = 'Showing '+fieldStats.values.count+' '+field.simpleType+' values.';
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
      return {renderer: renderer};
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

    // Determine if field is an integer
    async function datasetFieldIsInteger (field) {
      if (field.type.toLowerCase().includes('integer')) { // explicit integer type
        return true;
      } else { // or check the known values to see if they're all integers
        const stats = await getDatasetFieldUniqueValues(dataset, field.name, layer);
        return stats.values.every(v => v.value == null || Number.isInteger(v.value));
      }
   }

    // Add an entry to the attribute dropdown
    function updateAttributeList (dataset, list) {
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
        const item = document.createElement('calcite-dropdown-item');
        item.innerHTML = `${field.alias || fieldName}`;
        if (fieldStats && fieldStats.values && fieldStats.values.min != null && fieldStats.values.max != null) {
          if (field.simpleType === 'numeric') {
            // TODO: vary precision based on value range
            item.innerHTML += `<br><small>(${fieldStats.values.min.toFixed(2)} to ${fieldStats.values.max.toFixed(2)})</small>`;
          } else if (field.simpleType === 'date') {
            item.innerHTML += ` (${formatDate(fieldStats.values.min)} to ${formatDate(fieldStats.values.max)})`;
          }
        } else if (fieldStats && fieldStats.uniqueCount && field.simpleType === 'string') {
          item.innerHTML += ` (${fieldStats.uniqueCount} values)`;
        }

        // add icon for field type
        if (field.simpleType === 'numeric') {
          item.iconEnd = 'number';
        } else if (field.simpleType === 'string') {
          item.iconEnd = 'description';
        } else if (field.simpleType === 'date') {
          item.iconEnd = 'calendar';
        }

        item.setAttribute('data-field', field.name);
        item.addEventListener('click', addFilter);
        attributeList.appendChild(item);
      });
      return attributeList;
    }

    async function updateLayerViewEffect(layerView, { where = undefined, updateExtent = true } = {}) {
      layerView.filter = null;

      if (where) {
        layerView.effect = {
          filter: {
            where,
          },
          excludedEffect: 'grayscale(100%) opacity(15%)'
        };
      }

      // adjust view extent (in or out) to fit all filtered data
      if (updateExtent) {
        try {
          let featureExtent;

          const queriedExtent = await layerView.layer.queryExtent({
            where: (layerView.effect && layerView.effect.filter && layerView.effect.filter.where) || '1=1',
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

    async function createHistogram ({dataset, fieldName, layer, layerView, container, slider = false }) {
      // wrap in another container to handle height without fighting w/JSAPI and rest of sidebar
      const parentContainer = container;
      container = document.createElement('div');
      parentContainer.appendChild(container);

      let uniqueValues = (await getDatasetFieldUniqueValues(dataset, fieldName, layer)).values;
      var numBins = (uniqueValues.length > 30 ? 30 : uniqueValues.length)

      try {
        const params = {
          layer: layer,
          field: fieldName,
          numBins: numBins
        };

        let values, source, coverage;
        try {
          values = await generateHistogram(params);
          source = 'widget';
          coverage = 1;
        } catch(e) {
          try {
            // histogram generation failed with automated server call, try using features from server query
            console.log('histogram generation failed with automated server call, try using features from server query');
            params.features = (await layer.queryFeatures()).features;
            const featureCount = await layer.queryFeatureCount();
            values = await generateHistogram(params);
            source = 'layerQuery';
            // coverage = params.features.length / featureCount;
            coverage = 1;
          } catch(e) {
            // histogram generation failed with server call, try using features in layer view
            console.log('histogram generation failed with server call, try using features in layer view');
            params.features = (await layerView.queryFeatures()).features;
            const featureCount = await layer.queryFeatureCount();
            values = await generateHistogram(params);
            source = 'layerView';
            coverage = params.features.length / featureCount;
          }
        }

        // Determine if field is an integer
        const field = getDatasetField(dataset, fieldName);
        const integer = await datasetFieldIsInteger(field);
        let widget;
        if (slider) {
          // Histogram range slider widget
          widget = new HistogramRangeSlider({
            bins: values.bins,
            min: values.minValue,
            max: values.maxValue+1,
            values: [values.minValue, values.maxValue+1],
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
          });
        } else {
          // plain histogram, for miniHistogram nested in timeSlider
          widget = new Histogram({
            bins: values.bins,
            min: values.minValue,
            max: values.maxValue,
            container: container,
            rangeType: "between",
          });
        }
        return { widget, values, source, coverage };
      }
      catch(e) {
        console.log('histogram generation failed', e);
        return {};
      }
    }

    async function createTimeSlider ({ dataset, fieldName, layerView, container }) {
      try {
        const field = getDatasetField(dataset, fieldName);
        // let {min: startDate, max: endDate } = dataset.attributes.statistics.date[fieldname.toLowerCase()].statistics.values;
        const startDate = new Date(field.statistics.values.min);
        const endDate = new Date(field.statistics.values.max);
        const widget = new TimeSlider({
          container: container,
          //   view: view,
          mode: "time-window",
          fullTimeExtent: {
            start: startDate,
            end: endDate,
          },
          values: [
          startDate,
          endDate
          ],
        });

        // handle play button behavior
        let selectionWasFullExtent;
        widget.watch('viewModel.state', function(state){
          if (state == "playing") {
            // check values (date selection) against fullTimeExtent
            // convert to numeric values with unary + operator to check equivalence (with a 10% tolerance)
            if ( +this.values[0] == +this.fullTimeExtent.start &&
            Math.abs(+this.values[1] - +this.fullTimeExtent.end) <
            (+new Date(this.fullTimeExtent.end) - +new Date(this.fullTimeExtent.start))/ 10 ) {
              // make a note
              selectionWasFullExtent = true;
              // set new selection end to 10% through the date range
              this.values[1] = new Date(+new Date(this.fullTimeExtent.start) + (+new Date(this.fullTimeExtent.end) - +new Date(this.fullTimeExtent.start)) / 10);
            }
          }
          else if (state == "ready" && selectionWasFullExtent) {
            // reset note
            selectionWasFullExtent = false;
            this.values = [this.fullTimeExtent.start, this.fullTimeExtent.end];
          }
        });

        return { widget };
      }
      catch(e) {
        console.log(e);
        return {};
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
      console.log(e.srcElement.value);
    }

    let attributeSearchElement = document.getElementById("attributeSearch")
    attributeSearchElement.addEventListener("input", attributeSearchChange);

    // TESTS

    // makeWidget(null, "phenomenonTime");

  })();