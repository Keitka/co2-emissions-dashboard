(function () {
  'use strict';

  const bundle = window.CO2_DASHBOARD;
  if (!bundle || !Array.isArray(bundle.rows)) {
    document.body.innerHTML = '<main class="main-content"><h1>โหลดข้อมูลไม่สำเร็จ</h1><p>โปรดวางโฟลเดอร์ assets ไว้ข้างไฟล์ index.html แล้วเปิดไฟล์อีกครั้ง</p></main>';
    return;
  }

  const records = bundle.rows.map(([code, name, region, year, value]) => ({ code, name, region, year, value }));
  const recordsByYear = new Map();
  const entities = new Map();
  for (const record of records) {
    if (!recordsByYear.has(record.year)) recordsByYear.set(record.year, []);
    recordsByYear.get(record.year).push(record);
    if (!entities.has(record.code)) entities.set(record.code, { code: record.code, name: record.name, region: record.region });
  }
  const years = [...recordsByYear.keys()].sort((a, b) => a - b);
  const entityList = [...entities.values()].sort((a, b) => a.name.localeCompare(b.name));
  const regions = [...new Set(entityList.map(entity => entity.region))].sort();
  const selected = { year: years[years.length - 1], country: '', region: '', classification: '' };
  const trendState = {
    start: years[0],
    end: years[years.length - 1],
    mode: 'global',
    selections: [],
    normalized: false,
    movingAverage: false,
    movingAverageWindow: 5,
    showPoints: true,
    viewStart: years[0],
    viewEnd: years[years.length - 1]
  };
  const classNames = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
  const classLabels = { 'Very Low': 'ต่ำมาก', Low: 'ต่ำ', Medium: 'ปานกลาง', High: 'สูง', 'Very High': 'สูงมาก' };
  const regionLabels = {
    Africa: 'แอฟริกา',
    Asia: 'เอเชีย',
    Europe: 'ยุโรป',
    'North America': 'อเมริกาเหนือ',
    Oceania: 'โอเชียเนีย',
    'South America': 'อเมริกาใต้',
    Unknown: 'ไม่ระบุภูมิภาค'
  };
  const classColors = {
    'Very Low': '#FFF3B0',
    Low: '#F9D976',
    Medium: '#F29E4C',
    High: '#D95D39',
    'Very High': '#8C1D18'
  };
  const trendColors = ['#316d52', '#d97947', '#8c1d18', '#4c7890', '#746c62'];
  const noDataColor = '#D9D9D9';
  const numberFormat = new Intl.NumberFormat('th-TH-u-nu-latn', { maximumFractionDigits: 0 });
  const millionTonneFormat = new Intl.NumberFormat('th-TH-u-nu-latn', { maximumFractionDigits: 1 });
  const displayClass = name => classLabels[name] || name;
  const displayRegion = name => regionLabels[name] || name;
  const formatMillionTonnes = kilotonnes => millionTonneFormat.format(kilotonnes / 1000);
  const byCodeAndYear = new Map(records.map(record => [`${record.code}|${record.year}`, record]));
  const mapTooltip = document.getElementById('map-tooltip');
  let mapTransform = null;
  let mapZoomBehavior = null;
  let mapSvg = null;
  const trendTooltip = document.getElementById('trend-tooltip');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function populateFilters() {
    const yearSelect = document.getElementById('year-filter');
    yearSelect.innerHTML = [...years].reverse().map(year => `<option value="${year}">${year}</option>`).join('');
    const countrySelect = document.getElementById('country-filter');
    countrySelect.insertAdjacentHTML('beforeend', entityList.map(entity => `<option value="${escapeHtml(entity.code)}">${escapeHtml(entity.name)}</option>`).join(''));
    document.getElementById('region-filter').insertAdjacentHTML('beforeend', regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(displayRegion(region))}</option>`).join(''));
    yearSelect.value = String(selected.year);
    yearSelect.addEventListener('change', () => {
      selected.year = Number(yearSelect.value);
      trendState.end = selected.year;
      if (trendState.start > trendState.end) trendState.start = trendState.end;
      resetTrendViewport();
      render();
    });
    countrySelect.addEventListener('change', () => { selected.country = countrySelect.value; render(); });
    document.getElementById('region-filter').addEventListener('change', event => { selected.region = event.target.value; render(); });
    document.getElementById('class-filter').addEventListener('change', event => { selected.classification = event.target.value; render(); });
    document.getElementById('reset-filters').addEventListener('click', () => {
      selected.year = years[years.length - 1];
      selected.country = '';
      selected.region = '';
      selected.classification = '';
      trendState.start = years[0];
      trendState.end = years[years.length - 1];
      trendState.mode = 'global';
      trendState.selections = [];
      trendState.normalized = false;
      trendState.movingAverage = false;
      trendState.movingAverageWindow = 5;
      trendState.showPoints = true;
      resetTrendViewport();
      yearSelect.value = String(selected.year);
      countrySelect.value = '';
      document.getElementById('region-filter').value = '';
      document.getElementById('class-filter').value = '';
      document.getElementById('trend-series-mode').value = 'global';
      document.getElementById('moving-average-toggle').checked = false;
      document.getElementById('moving-average-window').value = '5';
      document.getElementById('trend-points-toggle').checked = true;
      document.querySelector('input[name="trend-mode"][value="absolute"]').checked = true;
      refreshTrendSeriesOptions();
      render();
    });
    document.getElementById('map-zoom-in').addEventListener('click', () => {
      if (mapSvg && mapZoomBehavior) window.d3.select(mapSvg).transition().call(mapZoomBehavior.scaleBy, 1.4);
    });
    document.getElementById('map-zoom-out').addEventListener('click', () => {
      if (mapSvg && mapZoomBehavior) window.d3.select(mapSvg).transition().call(mapZoomBehavior.scaleBy, 1 / 1.4);
    });
    document.getElementById('reset-map').addEventListener('click', () => {
      if (mapSvg && mapZoomBehavior) window.d3.select(mapSvg).transition().call(mapZoomBehavior.transform, window.d3.zoomIdentity);
    });
    setupTrendControls();
  }

  function resetTrendViewport() {
    trendState.viewStart = trendState.start;
    trendState.viewEnd = trendState.end;
  }

  function syncTrendYearControls() {
    document.getElementById('trend-start-year').value = String(trendState.start);
    document.getElementById('trend-end-year').value = String(trendState.end);
  }

  function refreshTrendSeriesOptions() {
    const picker = document.getElementById('trend-series-picker');
    const mode = document.getElementById('trend-series-mode').value;
    const search = document.getElementById('trend-series-search').value.trim().toLocaleLowerCase();
    const options = document.getElementById('trend-series-options');
    const rows = mode === 'region'
      ? regions.map(region => ({ key: region, label: displayRegion(region) }))
      : entityList.map(entity => ({ key: entity.code, label: entity.name }));
    picker.hidden = mode === 'global';
    updateTrendSeriesSelectionLabel();
    options.innerHTML = rows.filter(row => row.label.toLocaleLowerCase().includes(search)).map(row => `<label><input type="checkbox" value="${escapeHtml(row.key)}"${trendState.selections.includes(row.key) ? ' checked' : ''}><span>${escapeHtml(row.label)}</span></label>`).join('');
  }

  function updateTrendSeriesSelectionLabel() {
    const mode = document.getElementById('trend-series-mode').value;
    document.getElementById('trend-series-summary').textContent = trendState.selections.length
      ? trendState.selections.map(key => mode === 'region' ? displayRegion(key) : entities.get(key)?.name).filter(Boolean).join(', ')
      : mode === 'region' ? 'เลือกภูมิภาค' : 'เลือกหลายประเทศ';
    document.getElementById('trend-series-feedback').textContent = trendState.selections.length
      ? `เลือกแล้ว ${trendState.selections.length} รายการ (สูงสุด 5 รายการ)`
      : 'เลือกได้สูงสุด 5 รายการ';
  }

  function setupTrendControls() {
    const startSelect = document.getElementById('trend-start-year');
    const endSelect = document.getElementById('trend-end-year');
    const yearOptions = years.map(year => `<option value="${year}">${year}</option>`).join('');
    startSelect.innerHTML = yearOptions;
    endSelect.innerHTML = yearOptions;
    syncTrendYearControls();
    startSelect.addEventListener('change', () => {
      trendState.start = Number(startSelect.value);
      if (trendState.start > trendState.end) {
        trendState.end = trendState.start;
        selected.year = trendState.end;
        document.getElementById('year-filter').value = String(selected.year);
      }
      resetTrendViewport();
      render();
    });
    endSelect.addEventListener('change', () => {
      trendState.end = Number(endSelect.value);
      if (trendState.end < trendState.start) trendState.start = trendState.end;
      selected.year = trendState.end;
      document.getElementById('year-filter').value = String(selected.year);
      resetTrendViewport();
      render();
    });
    document.getElementById('trend-all-years').addEventListener('click', () => {
      trendState.start = years[0];
      trendState.end = years[years.length - 1];
      selected.year = trendState.end;
      document.getElementById('year-filter').value = String(selected.year);
      resetTrendViewport();
      render();
    });
    document.getElementById('trend-series-mode').addEventListener('change', event => {
      trendState.mode = event.target.value;
      trendState.selections = [];
      refreshTrendSeriesOptions();
      drawTrend(getYearClasses(selected.year));
    });
    document.getElementById('trend-series-search').addEventListener('input', refreshTrendSeriesOptions);
    document.getElementById('trend-series-options').addEventListener('change', event => {
      if (event.target.type !== 'checkbox') return;
      const key = event.target.value;
      if (event.target.checked && trendState.selections.length >= 5) {
        event.target.checked = false;
        document.getElementById('trend-series-feedback').textContent = 'เลือกได้ไม่เกิน 5 รายการ';
        return;
      }
      const selections = new Set(trendState.selections);
      if (event.target.checked) selections.add(key);
      else selections.delete(key);
      trendState.selections = [...selections];
      updateTrendSeriesSelectionLabel();
      drawTrend(getYearClasses(selected.year));
    });
    document.addEventListener('click', event => {
      const picker = document.getElementById('trend-series-picker');
      if (!picker.contains(event.target)) picker.open = false;
    });
    document.getElementById('moving-average-toggle').addEventListener('change', event => {
      trendState.movingAverage = event.target.checked;
      drawTrend(getYearClasses(selected.year));
    });
    document.getElementById('moving-average-window').addEventListener('change', event => {
      trendState.movingAverageWindow = Number(event.target.value);
      if (trendState.movingAverage) drawTrend(getYearClasses(selected.year));
    });
    document.querySelectorAll('input[name="trend-mode"]').forEach(input => input.addEventListener('change', () => {
      trendState.normalized = input.value === 'normalized';
      drawTrend(getYearClasses(selected.year));
    }));
    document.getElementById('trend-points-toggle').addEventListener('change', event => {
      trendState.showPoints = event.target.checked;
      drawTrend(getYearClasses(selected.year));
    });
    document.getElementById('trend-zoom-in').addEventListener('click', () => zoomTrend(.7));
    document.getElementById('trend-zoom-out').addEventListener('click', () => zoomTrend(1 / .7));
    document.getElementById('trend-zoom-reset').addEventListener('click', () => {
      resetTrendViewport();
      drawTrend(getYearClasses(selected.year));
    });
    document.getElementById('trend-pan-back').addEventListener('click', () => panTrend(-1));
    document.getElementById('trend-pan-forward').addEventListener('click', () => panTrend(1));
    refreshTrendSeriesOptions();
  }

  function zoomTrend(factor) {
    const currentSpan = trendState.viewEnd - trendState.viewStart + 1;
    const totalSpan = trendState.end - trendState.start + 1;
    const nextSpan = Math.max(1, Math.min(totalSpan, Math.max(3, Math.round(currentSpan * factor))));
    trendState.viewEnd = Math.min(trendState.end, trendState.viewEnd);
    trendState.viewStart = Math.max(trendState.start, trendState.viewEnd - nextSpan + 1);
    drawTrend(getYearClasses(selected.year));
  }

  function panTrend(direction) {
    const span = trendState.viewEnd - trendState.viewStart + 1;
    const shift = Math.max(1, Math.round(span * .35)) * direction;
    let start = trendState.viewStart + shift;
    let end = trendState.viewEnd + shift;
    if (start < trendState.start) { end += trendState.start - start; start = trendState.start; }
    if (end > trendState.end) { start -= end - trendState.end; end = trendState.end; }
    trendState.viewStart = Math.max(trendState.start, start);
    trendState.viewEnd = Math.min(trendState.end, end);
    drawTrend(getYearClasses(selected.year));
  }

  function getYearClasses(year) {
    const yearRecords = recordsByYear.get(year) || [];
    const sorted = yearRecords.map(record => record.value).sort((a, b) => a - b);
    if (!sorted.length) return new Map();
    const quantile = fraction => sorted[Math.floor((sorted.length - 1) * fraction)];
    const boundaries = [quantile(.2), quantile(.4), quantile(.6), quantile(.8)];
    const classMap = new Map();
    for (const record of yearRecords) {
      const index = boundaries.findIndex(boundary => record.value <= boundary);
      classMap.set(record.code, classNames[index === -1 ? classNames.length - 1 : index]);
    }
    return classMap;
  }

  function inScope(record, classMap, applyClassification = true) {
    if (selected.country && record.code !== selected.country) return false;
    if (selected.region && record.region !== selected.region) return false;
    if (applyClassification && selected.classification && classMap.get(record.code) !== selected.classification) return false;
    return true;
  }

  function render() {
    const classMap = getYearClasses(selected.year);
    const yearRows = recordsByYear.get(selected.year) || [];
    const currentRows = yearRows.filter(record => inScope(record, classMap));
    const total = currentRows.reduce((sum, record) => sum + record.value, 0);
    const leader = [...currentRows].sort((a, b) => b.value - a.value)[0];
    document.getElementById('kpi-total').textContent = formatMillionTonnes(total);
    document.getElementById('kpi-leader').textContent = leader ? leader.name : 'ไม่มีข้อมูล';
    document.getElementById('kpi-leader-value').textContent = leader ? `${formatMillionTonnes(leader.value)} ล้านตัน` : 'ไม่มีข้อมูลตามตัวกรองที่เลือก';
    document.getElementById('kpi-year').textContent = String(selected.year);
    document.getElementById('kpi-coverage').textContent = `${numberFormat.format(currentRows.length)} ประเทศที่มีข้อมูล`;
    document.getElementById('overview-caption').textContent = `${selected.region ? displayRegion(selected.region) : 'ทุกภูมิภาค'} · ${selected.classification ? displayClass(selected.classification) : 'ทุกระดับ'}`;
    trendState.end = selected.year;
    if (trendState.start > trendState.end) trendState.start = trendState.end;
    syncTrendYearControls();
    document.getElementById('trend-range').textContent = `${trendState.start} — ${trendState.end}`;
    document.getElementById('map-year').textContent = String(selected.year);
    drawTrend(classMap);
    drawComparison(currentRows);
    drawClassification(classMap);
    drawMap(classMap);
    drawInsights(currentRows, classMap);
  }

  function drawTrend(classMap) {
    const container = document.getElementById('trend-chart');
    trendTooltip.style.display = 'none';
    const allSeries = getTrendSeries(classMap);
    const seriesWithData = allSeries.filter(series => series.points.some(point => point.rawValue !== null));
    if (!seriesWithData.length) {
      container.innerHTML = '<div class="empty-state">ไม่พบข้อมูลที่ตรงกับตัวเลือกนี้</div>';
      document.getElementById('trend-legend').innerHTML = '';
      document.getElementById('trend-summary-grid').innerHTML = '<p class="empty-state">ไม่มีข้อมูลสำหรับสรุป</p>';
      document.getElementById('trend-story-text').textContent = 'ไม่มีข้อมูลในช่วงเวลาที่เลือก';
      document.getElementById('trend-yoy-indicator').textContent = 'ไม่มีข้อมูลสำหรับเปรียบเทียบ';
      document.getElementById('trend-selected-indicator').textContent = `ปีที่เลือก: ${trendState.end} · ไม่มีข้อมูล`;
      return;
    }

    const visibleSeries = seriesWithData.map(series => ({
      ...series,
      points: series.points.filter(point => point.year >= trendState.viewStart && point.year <= trendState.viewEnd)
    }));
    const plottedValues = visibleSeries.flatMap(series => series.points.flatMap(point => {
      if (point.value === null) return [];
      return trendState.movingAverage && point.movingAverage !== null ? [point.value, point.movingAverage] : [point.value];
    }));
    if (!plottedValues.length) {
      container.innerHTML = '<div class="empty-state">ไม่มีข้อมูลในช่วงกราฟที่แสดง</div>';
      return;
    }
    const width = Math.max(container.clientWidth, 360);
    const height = container.clientHeight || 310;
    const margin = { top: 28, right: 28, bottom: 34, left: 64 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const minimumValue = trendState.normalized ? Math.min(100, ...plottedValues) : 0;
    const maximumValue = Math.max(...plottedValues, minimumValue + 1);
    const valueSpan = maximumValue - minimumValue || 1;
    const xPosition = year => margin.left + (trendState.viewStart === trendState.viewEnd ? plotWidth / 2 : (year - trendState.viewStart) / (trendState.viewEnd - trendState.viewStart) * plotWidth);
    const yPosition = value => margin.top + plotHeight - (value - minimumValue) / valueSpan * plotHeight;
    const tickFractions = [0, .25, .5, .75, 1];
    const grid = tickFractions.map(fraction => {
      const value = minimumValue + valueSpan * fraction;
      const y = yPosition(value);
      const label = trendState.normalized ? value.toFixed(0) : numberFormat.format(value);
      return `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y}" y2="${y}" stroke="#e8ece6"/><text x="${margin.left - 9}" y="${y + 3}" text-anchor="end" fill="#929a91" font-size="9" font-family="DM Mono, monospace">${label}</text>`;
    }).join('');
    const xTicks = [...new Set([trendState.viewStart, Math.round((trendState.viewStart + trendState.viewEnd) / 2), trendState.viewEnd])];
    const xLabels = xTicks.map(year => `<text x="${xPosition(year)}" y="${height - 8}" text-anchor="middle" fill="#929a91" font-size="9" font-family="DM Mono, monospace">${year}</text>`).join('');
    const paths = [];
    const markers = [];
    const legends = [];
    for (const [seriesIndex, series] of visibleSeries.entries()) {
      const color = trendColors[seriesIndex % trendColors.length];
      const segments = [];
      let segment = [];
      for (const point of series.points) {
        if (point.value === null) {
          if (segment.length) segments.push(segment);
          segment = [];
        } else {
          segment.push(point);
        }
      }
      if (segment.length) segments.push(segment);
      for (const points of segments) {
        const path = points.map((point, index) => `${index ? 'L' : 'M'}${xPosition(point.year).toFixed(1)},${yPosition(point.value).toFixed(1)}`).join(' ');
        paths.push(`<path class="trend-series-line" d="${path}" fill="none" stroke="${color}" stroke-width="2.4" vector-effect="non-scaling-stroke"/>`);
      }
      if (trendState.movingAverage) {
        const averageSegments = [];
        let averageSegment = [];
        for (const point of series.points) {
          if (point.movingAverage === null) {
            if (averageSegment.length) averageSegments.push(averageSegment);
            averageSegment = [];
          } else {
            averageSegment.push(point);
          }
        }
        if (averageSegment.length) averageSegments.push(averageSegment);
        for (const points of averageSegments) {
          const path = points.map((point, index) => `${index ? 'L' : 'M'}${xPosition(point.year).toFixed(1)},${yPosition(point.movingAverage).toFixed(1)}`).join(' ');
          paths.push(`<path class="trend-average-line" d="${path}" fill="none" stroke="${color}" stroke-width="1.7" stroke-dasharray="5 4" opacity=".72" vector-effect="non-scaling-stroke"/>`);
        }
      }

      const observed = series.points.filter(point => point.value !== null);
      const minimumPoint = observed.reduce((best, point) => point.rawValue < best.rawValue ? point : best, observed[0]);
      const maximumPoint = observed.reduce((best, point) => point.rawValue > best.rawValue ? point : best, observed[0]);
      const extrema = [
        { point: minimumPoint, label: 'ค่าต่ำสุด', offset: 15 },
        { point: maximumPoint, label: 'ค่าสูงสุด', offset: -8 }
      ];
      for (const [extremeIndex, extreme] of extrema.entries()) {
        if (minimumPoint.year === maximumPoint.year && extremeIndex === 1) continue;
        if (extreme.point.year < trendState.viewStart || extreme.point.year > trendState.viewEnd) continue;
        markers.push(`<circle class="trend-extreme-point" data-series="${seriesIndex}" data-year="${extreme.point.year}" cx="${xPosition(extreme.point.year)}" cy="${yPosition(extreme.point.value)}" r="5" fill="${color}" stroke="#fff" stroke-width="2"/><text class="trend-extreme-label" x="${xPosition(extreme.point.year) + 7}" y="${yPosition(extreme.point.value) + extreme.offset}" fill="${color}" font-size="9" font-weight="700">${extreme.label}</text>`);
      }
      if (trendState.showPoints) {
        markers.push(series.points.filter(point => point.rawValue !== null).map(point => `<circle class="trend-point" data-series="${seriesIndex}" data-year="${point.year}" cx="${xPosition(point.year)}" cy="${yPosition(point.value)}" r="2.1" fill="${color}"/>`).join(''));
      }
      legends.push(`<span class="trend-legend-item"><i style="--series-color:${color}"></i>${escapeHtml(series.label)}</span>`);
    }

    const selectedLine = trendState.end >= trendState.viewStart && trendState.end <= trendState.viewEnd
      ? `<line class="trend-reference-line" x1="${xPosition(trendState.end)}" x2="${xPosition(trendState.end)}" y1="${margin.top}" y2="${margin.top + plotHeight}"/><text x="${xPosition(trendState.end) - 5}" y="${margin.top - 9}" text-anchor="end" class="trend-reference-label">ปี ${trendState.end}</text>`
      : '';
    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}${selectedLine}${paths.join('')}${markers.join('')}${xLabels}</svg>`;
    document.getElementById('trend-legend').innerHTML = `${legends.join('')}${trendState.movingAverage ? '<span class="trend-legend-item trend-average-legend"><i></i>ค่าเฉลี่ยเคลื่อนที่</span>' : ''}`;
    document.getElementById('trend-unit').textContent = trendState.normalized ? 'ดัชนี (ปีเริ่มต้น = 100)' : 'kt';
    document.getElementById('trend-range').textContent = `${trendState.start} — ${trendState.end}`;

    const primarySeries = seriesWithData[0];
    const selectedPoints = seriesWithData.map(series => ({ series, point: series.points.find(point => point.year === trendState.end) })).filter(item => item.point?.rawValue !== null);
    document.getElementById('trend-selected-indicator').textContent = selectedPoints.length
      ? `ปีที่เลือก ${trendState.end} · ${selectedPoints.map(item => `${item.series.label}: ${numberFormat.format(item.point.rawValue)} kt`).join(' · ')}`
      : `ปีที่เลือก ${trendState.end} · ไม่มีข้อมูล`;
    const latestPoint = primarySeries.points.find(point => point.year === trendState.end);
    const yoyIndicator = document.getElementById('trend-yoy-indicator');
    if (latestPoint?.yoy !== null && latestPoint?.yoy !== undefined) {
      yoyIndicator.textContent = `${latestPoint.yoy >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(latestPoint.yoy).toFixed(2)}% เทียบปีก่อน`;
      yoyIndicator.classList.toggle('is-negative', latestPoint.yoy < 0);
    } else {
      yoyIndicator.textContent = 'ไม่มีข้อมูลปีก่อนสำหรับเปรียบเทียบ';
    }
    renderTrendSummary(seriesWithData);

    container.querySelectorAll('.trend-point,.trend-extreme-point').forEach(marker => {
      marker.addEventListener('mouseenter', event => {
        const series = seriesWithData[Number(event.currentTarget.dataset.series)];
        const point = series?.points.find(item => item.year === Number(event.currentTarget.dataset.year));
        if (!point) return;
        const details = [`<b>${escapeHtml(series.label)} · ปี ${point.year}</b>`, `การปล่อย CO₂ · ${numberFormat.format(point.rawValue)} kt`];
        if (point.yoy !== null) details.push(`เปลี่ยนแปลงจากปีก่อน · ${point.yoy >= 0 ? '+' : ''}${point.yoy.toFixed(2)}%`);
        if (point.fromBaseline !== null) details.push(`เปลี่ยนแปลงจากปีเริ่มต้น · ${point.fromBaseline >= 0 ? '+' : ''}${point.fromBaseline.toFixed(2)}%`);
        if (trendState.normalized && point.normalizedValue !== null) details.push(`ดัชนี · ${point.normalizedValue.toFixed(1)} (ปีเริ่มต้น = 100)`);
        if (point.movingAverage !== null && trendState.movingAverage) {
          const averageValue = trendState.normalized ? `${point.movingAverage.toFixed(1)} (ดัชนี)` : `${numberFormat.format(point.movingAverage)} kt`;
          details.push(`ค่าเฉลี่ยเคลื่อนที่ ${trendState.movingAverageWindow} ปี · ${averageValue}`);
        }
        if (point.year === series.minimum.year) details.push('ค่าต่ำสุดในช่วงที่เลือก');
        if (point.year === series.maximum.year) details.push('ค่าสูงสุดในช่วงที่เลือก');
        trendTooltip.innerHTML = details.map((detail, index) => index === 0 ? detail : `<span>${detail}</span>`).join('');
        trendTooltip.style.display = 'block';
        const frame = container.parentElement.getBoundingClientRect();
        trendTooltip.style.left = `${Math.min(event.clientX - frame.left + 12, frame.width - 260)}px`;
        trendTooltip.style.top = `${Math.max(event.clientY - frame.top - 35, 8)}px`;
      });
      marker.addEventListener('mouseleave', () => { trendTooltip.style.display = 'none'; });
    });
  }

  function getTrendSeries(classMap) {
    const timeline = years.filter(year => year >= trendState.start && year <= trendState.end);
    const selections = trendState.mode === 'global'
      ? [{ key: 'global', label: selected.country ? entities.get(selected.country).name : selected.region ? displayRegion(selected.region) : 'ทั่วโลก' }]
      : trendState.selections.map(key => ({
        key,
        label: trendState.mode === 'region' ? displayRegion(key) : entities.get(key)?.name
      })).filter(item => item.label);
    const output = [];
    for (const [seriesIndex, selection] of selections.entries()) {
      const points = [];
      const rawByYear = new Map();
      for (const year of timeline) {
        const scopedRows = (recordsByYear.get(year) || []).filter(record => {
          if (selected.region && record.region !== selected.region) return false;
          if (selected.classification && classMap.get(record.code) !== selected.classification) return false;
          if (trendState.mode === 'global' && selected.country && record.code !== selected.country) return false;
          if (trendState.mode === 'region' && record.region !== selection.key) return false;
          if (trendState.mode === 'country' && record.code !== selection.key) return false;
          return true;
        });
        const rawValue = scopedRows.length ? scopedRows.reduce((sum, record) => sum + record.value, 0) : null;
        rawByYear.set(year, rawValue);
        points.push({ year, rawValue, count: scopedRows.length, yoy: null, normalizedValue: null, fromBaseline: null, movingAverage: null, value: null });
      }
      const baseline = points.find(point => point.rawValue !== null && point.rawValue > 0) || null;
      for (const point of points) {
        const previous = rawByYear.get(point.year - 1);
        if (point.rawValue !== null && previous !== null && previous !== undefined && previous > 0) {
          point.yoy = (point.rawValue - previous) / previous * 100;
        }
        if (baseline && point.rawValue !== null) {
          point.normalizedValue = point.rawValue / baseline.rawValue * 100;
          point.fromBaseline = (point.rawValue - baseline.rawValue) / baseline.rawValue * 100;
        }
        const windowValues = [];
        for (let offset = 0; offset < trendState.movingAverageWindow; offset++) {
          const value = rawByYear.get(point.year - offset);
          if (value === null || value === undefined) break;
          windowValues.push(value);
        }
        if (windowValues.length === trendState.movingAverageWindow) {
          point.movingAverage = windowValues.reduce((sum, value) => sum + value, 0) / trendState.movingAverageWindow;
        }
        point.value = trendState.normalized ? point.normalizedValue : point.rawValue;
        if (trendState.normalized && trendState.movingAverage && point.movingAverage !== null && baseline) {
          point.movingAverage /= baseline.rawValue / 100;
        }
      }
      const observed = points.filter(point => point.rawValue !== null);
      if (!observed.length) continue;
      const minimum = observed.reduce((best, point) => point.rawValue < best.rawValue ? point : best, observed[0]);
      const maximum = observed.reduce((best, point) => point.rawValue > best.rawValue ? point : best, observed[0]);
      output.push({ key: selection.key, label: selection.label, color: trendColors[seriesIndex % trendColors.length], points, baseline, minimum, maximum });
    }
    return output;
  }

  function renderTrendSummary(seriesList) {
    const grid = document.getElementById('trend-summary-grid');
    grid.innerHTML = seriesList.map(series => {
      const observed = series.points.filter(point => point.rawValue !== null);
      const first = observed[0];
      const last = observed[observed.length - 1];
      const periodChange = first.rawValue > 0 ? (last.rawValue - first.rawValue) / first.rawValue * 100 : null;
      const changes = observed.filter(point => point.yoy !== null);
      const biggestIncrease = changes.filter(point => point.yoy > 0).reduce((best, point) => !best || point.yoy > best.yoy ? point : best, null);
      const biggestDecrease = changes.filter(point => point.yoy < 0).reduce((best, point) => !best || point.yoy < best.yoy ? point : best, null);
      const interval = point => point ? `${point.year - 1} → ${point.year} · ${point.yoy >= 0 ? '+' : ''}${point.yoy.toFixed(2)}%` : 'ไม่มีข้อมูล';
      return `<article class="trend-summary-series"><h4><i style="--series-color:${series.color}"></i>${escapeHtml(series.label)}</h4><dl><div><dt>ปีเริ่มต้น · ${first.year}</dt><dd>${numberFormat.format(first.rawValue)} kt</dd></div><div><dt>ปีล่าสุด · ${last.year}</dt><dd>${numberFormat.format(last.rawValue)} kt</dd></div><div><dt>เปลี่ยนแปลงตลอดช่วง</dt><dd>${periodChange === null ? 'คำนวณไม่ได้' : `${periodChange >= 0 ? '+' : ''}${periodChange.toFixed(2)}%`}</dd></div><div><dt>ช่วงเพิ่มขึ้นมากที่สุด</dt><dd>${interval(biggestIncrease)}</dd></div><div><dt>ช่วงลดลงมากที่สุด</dt><dd>${interval(biggestDecrease)}</dd></div></dl></article>`;
    }).join('');
    const primary = seriesList[0];
    const observed = primary.points.filter(point => point.rawValue !== null);
    const first = observed[0];
    const last = observed[observed.length - 1];
    const change = first.rawValue > 0 ? (last.rawValue - first.rawValue) / first.rawValue * 100 : null;
    const largestMove = observed.filter(point => point.yoy !== null).reduce((best, point) => !best || Math.abs(point.yoy) > Math.abs(best.yoy) ? point : best, null);
    const story = change === null
      ? `ข้อมูลของ ${primary.label} ในช่วงที่เลือกไม่เพียงพอสำหรับคำนวณการเปลี่ยนแปลงเป็นร้อยละ`
      : `จากปี ${first.year} ถึง ${last.year} การปล่อย CO₂ ของ ${primary.label} ${change >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(change).toFixed(2)}%${largestMove ? `; การเปลี่ยนแปลงรายปีที่เด่นที่สุดเกิดระหว่าง ${largestMove.year - 1}–${largestMove.year} (${largestMove.yoy >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(largestMove.yoy).toFixed(2)}%)` : ''}`;
    document.getElementById('trend-story-text').textContent = story;
  }

  function drawComparison(currentRows) {
    const container = document.getElementById('comparison-chart');
    const top = [...currentRows].sort((a, b) => b.value - a.value).slice(0, 10);
    if (!top.length) {
      container.innerHTML = '<div class="empty-state">ไม่พบข้อมูลที่ตรงกับตัวกรองนี้</div>';
      return;
    }
    const maximum = top[0].value || 1;
    container.innerHTML = top.map(record => `<div class="bar-row" title="${escapeHtml(record.name)} · ${formatMillionTonnes(record.value)} ล้านตัน CO₂"><span class="bar-label">${escapeHtml(record.name)}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${(record.value / maximum * 100).toFixed(2)}%"></span></span><span class="bar-value">${formatMillionTonnes(record.value)}</span></div>`).join('');
  }

  function drawClassification(classMap) {
    const container = document.getElementById('classification-chart');
    const baseRows = (recordsByYear.get(selected.year) || []).filter(record => inScope(record, classMap, false));
    const counts = Object.fromEntries(classNames.map(name => [name, 0]));
    for (const record of baseRows) {
      const classification = classMap.get(record.code);
      if (classification) counts[classification]++;
    }
    const maximum = Math.max(...Object.values(counts), 1);
    container.innerHTML = classNames.map(name => `<div class="class-row${selected.classification === name ? ' selected' : ''}"><span class="class-label">${displayClass(name)}</span><span class="class-track"><span class="class-fill" style="display:block;width:${(counts[name] / maximum * 100).toFixed(2)}%;background:${classColors[name]}"></span></span><span class="class-count">${counts[name]}</span></div>`).join('');
  }

  const topologyObject = bundle.topology?.objects?.countries;
  const worldFeatures = topologyObject && window.topojson
    ? window.topojson.feature(bundle.topology, topologyObject).features
    : [];
  const projection = worldFeatures.length && window.d3
    ? window.d3.geoNaturalEarth1().fitExtent([[4, 4], [956, 496]], { type: 'FeatureCollection', features: worldFeatures })
    : null;
  const geoPath = projection ? window.d3.geoPath(projection) : null;
  const mapShapes = worldFeatures.map(feature => {
    const numericId = feature.id === undefined || feature.id === null ? '' : String(feature.id).padStart(3, '0');
    const iso3 = bundle.mapIso3ById?.[numericId] || bundle.mapIso3ByName?.[feature.properties?.name] || '';
    return {
      iso3,
      name: feature.properties?.name || 'Unknown geometry',
      path: geoPath(feature) || ''
    };
  });
  const geometryCodes = new Set(mapShapes.map(shape => shape.iso3).filter(Boolean));
  const matchedCountries = entityList.filter(entity => geometryCodes.has(entity.code));
  const unmatchedCountries = entityList.filter(entity => !geometryCodes.has(entity.code));
  const unkeyedMapGeometries = mapShapes.filter(shape => !shape.iso3).map(shape => shape.name);
  const duplicateGeometryCodes = mapShapes.map(shape => shape.iso3).filter((code, index, all) => code && all.indexOf(code) !== index);
  const malformedGeometries = mapShapes.filter(shape => !shape.path || /NaN|Infinity/.test(shape.path));
  console.info(`Map countries: ${mapShapes.length}`);
  console.info(`Dataset countries: ${entityList.length}`);
  console.info(`Matched countries: ${matchedCountries.length}`);
  console.info(`Unmatched countries: ${unmatchedCountries.length}`);
  if (unmatchedCountries.length) {
    console.warn('Unmatched dataset ISO3 codes:', unmatchedCountries.map(entity => `${entity.name} [${entity.code}]`));
  }
  if (unkeyedMapGeometries.length) console.warn('Map geometries without ISO identity:', unkeyedMapGeometries);
  if (duplicateGeometryCodes.length) console.error('Duplicate ISO3 map geometry codes:', [...new Set(duplicateGeometryCodes)]);
  if (malformedGeometries.length) console.error('Invalid projected map geometries:', malformedGeometries.map(shape => shape.name));
  if (!window.d3 || !window.topojson) console.error('Map libraries failed to load: d3-geo or topojson-client is missing.');

  function drawMap(classMap) {
    const container = document.getElementById('map-chart');
    const currentByCode = new Map((recordsByYear.get(selected.year) || []).map(record => [record.code, record]));
    const selectedEntity = selected.country ? entities.get(selected.country) : null;
    const paths = mapShapes.map(shape => {
      const record = shape.iso3 ? currentByCode.get(shape.iso3) : null;
      const inSelection = record && inScope(record, classMap);
      const fill = record ? classColors[classMap.get(record.code)] : noDataColor;
      const classes = record ? `map-country has-data${inSelection ? '' : ' is-filtered'}` : 'map-country';
      const attributes = record ? `data-iso3="${escapeHtml(record.code)}" data-name="${escapeHtml(record.name)}"` : '';
      return `<path class="${classes}" d="${shape.path}" fill="${fill}" ${attributes}><title>${escapeHtml(record ? record.name : shape.name)}${record ? ` · ปี ${selected.year} · CO₂ ${formatMillionTonnes(record.value)} ล้านตัน` : ''}</title></path>`;
    }).join('');
    const activeCountry = selectedEntity ? `<text x="18" y="26" fill="#316d52" font-size="12" font-family="Manrope, sans-serif">${escapeHtml(selectedEntity.name)}</text>` : '';
    container.innerHTML = `<svg viewBox="0 0 960 500" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><g class="map-group">${activeCountry}${paths}</g></svg>`;
    mapSvg = container.querySelector('svg');
    const svg = window.d3.select(mapSvg);
    const mapGroup = svg.select('.map-group');
    mapZoomBehavior = window.d3.zoom()
      .scaleExtent([1, 8])
      .extent([[0, 0], [960, 500]])
      .translateExtent([[0, 0], [960, 500]])
      .on('zoom', event => {
        mapGroup.attr('transform', event.transform);
        mapTransform = event.transform;
      });
    svg.call(mapZoomBehavior).call(mapZoomBehavior.transform, mapTransform || window.d3.zoomIdentity);
    container.querySelectorAll('.map-country.has-data').forEach(path => {
      path.addEventListener('mousemove', event => {
        const record = currentByCode.get(event.currentTarget.dataset.iso3);
        if (!record) return;
        mapTooltip.innerHTML = `<b>ประเทศ · ${escapeHtml(record.name)}</b><span>ปี · ${selected.year}</span><span>การปล่อย CO₂ · ${formatMillionTonnes(record.value)} ล้านตัน</span><span>ระดับการปล่อย · ${displayClass(classMap.get(record.code))}</span>`;
        mapTooltip.style.display = 'block';
        const bounds = container.getBoundingClientRect();
        mapTooltip.style.left = `${Math.min(event.clientX - bounds.left + 12, bounds.width - 245)}px`;
        mapTooltip.style.top = `${Math.max(event.clientY - bounds.top - 18, 8)}px`;
      });
      path.addEventListener('mouseleave', () => { mapTooltip.style.display = 'none'; });
    });
  }

  function drawInsights(currentRows, classMap) {
    const container = document.getElementById('insight-list');
    const priorYear = selected.year - 1;
    const priorRows = (recordsByYear.get(priorYear) || []).filter(record => inScope(record, classMap));
    const startRows = (recordsByYear.get(trendState.start) || []).filter(record => inScope(record, classMap));
    const startTotal = startRows.reduce((sum, record) => sum + record.value, 0);
    const currentTotal = currentRows.reduce((sum, record) => sum + record.value, 0);
    const changePercent = startTotal > 0 ? (currentTotal - startTotal) / startTotal * 100 : null;
    const leader = [...currentRows].sort((a, b) => b.value - a.value)[0];
    const selectionLabel = selected.country
      ? `ประเทศ ${entities.get(selected.country).name}`
      : selected.region
        ? `ประเทศในภูมิภาค${displayRegion(selected.region)}`
        : 'ประเทศที่มีข้อมูล';
    const classQualifier = selected.classification ? `ในกลุ่ม${displayClass(selected.classification)}` : '';
    const changeText = changePercent === null
      ? `ไม่มีข้อมูลในปี ${trendState.start} ให้เปรียบเทียบกับปี ${selected.year}`
      : `ในช่วงปี ${trendState.start}–${selected.year} ${selectionLabel}${classQualifier} มีการปล่อย CO₂ ${changePercent >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} <b>${Math.abs(changePercent).toFixed(1)}%</b>`;
    const leaderText = leader
      ? `ในปี ${selected.year} <b>${escapeHtml(leader.name)}</b> ปล่อย CO₂ สูงสุด <b>${formatMillionTonnes(leader.value)} ล้านตัน</b>`
      : `ไม่มีข้อมูลการปล่อย CO₂ ในปี ${selected.year} ตามตัวกรองที่เลือก`;
    const priorByCode = new Map(priorRows.map(record => [record.code, record]));
    const largestChange = currentRows.map(record => ({
      record,
      change: record.value - (priorByCode.get(record.code)?.value ?? record.value)
    })).filter(item => priorByCode.has(item.record.code)).sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];
    const largestChangeText = largestChange
      ? `<b>${escapeHtml(largestChange.record.name)}</b> มีการเปลี่ยนแปลงมากที่สุดระหว่างปี ${priorYear}–${selected.year}: ${largestChange.change >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} <b>${formatMillionTonnes(Math.abs(largestChange.change))} ล้านตัน</b>`
      : `ไม่มีข้อมูลรายปีต่อเนื่องสำหรับเปรียบเทียบการเปลี่ยนแปลง`;
    const insights = [changeText, leaderText, largestChangeText];
    container.innerHTML = insights.map((text, index) => `<article class="insight-item"><span class="insight-number">0${index + 1}</span><p>${text}</p></article>`).join('');
  }

  populateFilters();
  render();
  window.addEventListener('resize', () => drawTrend(getYearClasses(selected.year)));
})();