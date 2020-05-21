import { loadModules, setDefaultOptions } from 'https://unpkg.com/esri-loader/dist/esm/esri-loader.js';

let TimeSlider, Histogram;

loadModules([
  "esri/widgets/TimeSlider",
  "esri/widgets/Histogram",
]).then( r => {
  [ TimeSlider, Histogram ] = r;
  });

let widgetsList = [];

async function makeTimeSlider ({ dataset, fieldName, layerView, container }) {
  console.log('TimeSlider:', TimeSlider);
  try {
    const field = getDatasetField(dataset, fieldName);
    // let {min: startDate, max: endDate } = dataset.attributes.statistics.date[fieldname.toLowerCase()].statistics.values;
    const startDate = new Date(field.statistics.values.min);
    const endDate = new Date(field.statistics.values.max);
    const widget = new TimeSlider({
      container: container,
      // view: view,
      mode: "time-window",
      fullTimeExtent: {
        start: startDate,
        end: endDate,
      },
      values: [
        startDate,
        endDate
      ],
      // track timeSlider selection state
      selectionWasFullExtent: false
    });

    return { widget };
  }
  catch(e) {
    throw new Error(e);
    return {};
  }
}

// make and place a histogram
export async function makeHistogramWidget({ dataset, fieldName, layer, layerView, slider = true }) {
    const container = document.createElement('div');
    container.classList.add('histogramWidget');
    document.getElementById('widgets').appendChild(container);

    const histogram = await makeHistogram({ dataset, fieldName, layer, layerView, container, slider: true });
    if (histogram.widget) {
      container.widget = histogram.widget;

      // set event handler to update map filter and histograms when handles are dragged
      histogram.widget.on(["thumb-change", "thumb-drag", "segment-drag"], event => {
        updateLayerView(layerView, fieldName, histogram.widget);
        updateWidgets(layerView, fieldName, histogram.widget)
      });

      // register widget
      widgetsList.push(histogram.widget)
    }
    return histogram.widget;
}

// update layerview filter based on widget, throttled
export const updateLayerView = _.throttle(
  async (layerView, fieldName, widget, value = null) => {
    let whereClause;
    if (widget.label === "Histogram Range Slider") {
      whereClause = widget.generateWhereClause(fieldName);
    }
    if (widget.label === "TimeSlider") {
      // instead of unix timestamps, use SQL date formatting, as expected by layer.queryFeatures()
      whereClause = `${fieldName} BETWEEN DATE ${formatSQLDate(value.start)} AND DATE ${formatSQLDate(value.end)}`;
    }
    // set whereClause attribute
    widget.container.setAttribute('whereClause', whereClause);
    const where = concatWheres();
    await updateLayerViewEffect(layerView, {where: where, updateExtent: false });
  },
  10,
  {trailing: false}
);

// update the bins of all histograms except the current widget, throttled
const updateWidgets = _.throttle(
  async (layerView, fieldName, currentWidget) => {
    // if there's only one widget, skip this
    if (widgetsList.length === 1) return
    // collect other widgets' fieldNames, skipping the current widget (handles nested widgets too)
    let otherWidgets = widgetsList.filter(w => w.fieldName != fieldName);
    let fieldNames = otherWidgets.map(w => w.fieldName);
    // convert to a set to remove any duplicates (nested widgets), then back to array
    fieldNames = [...new Set(fieldNames)];

    const whereClause = currentWidget.container.getAttribute('whereClause');
    try {
      let { features } = await layer.queryFeatures( { where: whereClause, outFields: fieldNames });
      // update other widgets, passing in the filtered feature set
      throttledUpdateOthers(otherWidgets, layerView, concatWheres(), features);
    } catch(e) {
      throw new Error('Tried to update other widgets: '+e)
    }
  },
  100,
  {trailing: false}
);

// update the bins of a histogram
async function updateHistogram(widget, layerView, fieldName, where, features) {
  let values;
  if (features) {
    let params = {
      layer,
      features,
      field: fieldName,
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

// create a histogram
export async function makeHistogram ({dataset, fieldName, layer, layerView, container, slider = false, where = null }) {
  // wrap in another container to handle height without fighting w/JSAPI and rest of sidebar
  const parentContainer = container;
  container = document.createElement('div');
  parentContainer.appendChild(container);

  try {
    let params = {
      layer: layer,
      field: fieldName,
      numBins: 30,
    };
    if (where) params.where = where;

    let values, bins, source, coverage;

    try {
      values = await generateHistogram(params);
      source = 'widgets';
      coverage = 1;
    } catch(e) {
      try {
        // histogram generation failed with automated server call, try using features from server query
        console.log('histogram generation failed with automated server call, try using features from server query', e);
        params.features = (await layer.queryFeatures()).features;
        const featureCount = await layer.queryFeatureCount();
        if (params.features.length != featureCount) throw new Error('params.features.length != featureCount');
        values = await generateHistogram(params);
        source = 'layerQuery';
        coverage = params.features.length / featureCount;
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
        const featureCount = await layer.queryFeatureCount();
        values = await generateHistogram(params);
        source = 'layerView';
        coverage = params.features.length / featureCount;
        }
      }
    }

    // Determine if field is an integer
    const field = getDatasetField(dataset, fieldName);
    const integer = await datasetFieldIsInteger(field);
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


  // make and place a time slider
  export async function makeTimeSliderWidget({ dataset, fieldName, layer, layerView, slider = true }) {
    const container = document.createElement('div');
    container.classList.add('timesliderWidget');
    document.getElementById('widgets').appendChild(container);

    let timeSlider = await makeTimeSlider({ dataset, fieldName, layerView, container });
    // set widget state
    if (timeSlider.widget) {
      try {
        // add a nested histogram
        const histogramContainer = document.createElement('div');
        histogramContainer.classList.add('miniHistogramWidget');
        container.getElementsByClassName("esri-slider__track")[0].after(histogramContainer);
        const miniHistogram = await makeHistogram ({ dataset, fieldName, layer, layerView, container: histogramContainer });
        miniHistogram.widget.fieldName = fieldName;
        // register miniHistogram
        widgetsList.push(miniHistogram.widget)

        const { widget } = timeSlider;
        // set event handler to update map filter when time handles are dragged
        widget.watch("timeExtent", function(value) {
          updateLayerView(layerView, fieldName, widget, value);
          updateWidgets(layerView, fieldName, widget);
        });

        // handle situation where if the whole time extent is selected, the play button does nothing –
        // modify this: select a smaller range, so the play button has room to move the selection
        // first: watch when the widget state changes
        widget.watch('viewModel.state', function(state){
          if (state == "playing") {
            // check values (date selection) against fullTimeExtent -
            // convert to numeric values with unary + operator to check equivalence (with a 10% tolerance)
            if ( +this.values[0] == +this.fullTimeExtent.start &&
                  Math.abs(+this.values[1] - +this.fullTimeExtent.end) <
                  (+new Date(this.fullTimeExtent.end) - +new Date(this.fullTimeExtent.start))/ 10 ) {
              // update selection state
              this.selectionWasFullExtent = true;
              // set new selection end to 10% through the date range
              this.values[1] = new Date(+new Date(this.fullTimeExtent.start) + (+new Date(this.fullTimeExtent.end) - +new Date(this.fullTimeExtent.start)) / 10);
            }
          }
          else if (state == "ready" && this.selectionWasFullExtent) {
            // reset selection state
            this.selectionWasFullExtent = false;
            // reset selection range to full extent
            this.values = [this.fullTimeExtent.start, this.fullTimeExtent.end];
          }
        });

      } catch(e) {
        throw new Error(e);
      }
      // register widget
      widgetsList.push(timeSlider.widget)
    }
    return timeSlider.widget;
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

    // stop all timeSlider playback
    export function stopTimePlayback() {
      // debugger
      for (let i in widgetsList) {
        if (widgetsList[i].label && widgetsList[i].label == "TimeSlider") {
          widgetsList[i].stop();
        }
      }
    }

export { makeTimeSlider };