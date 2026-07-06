/**
 * CS Item Inquiry Suitelet — simple version
 *
 * Read-only report: filter items, click a row, see item detail (Header /
 * Locations / Vendors / Bins), all driven off saved searches set as script
 * parameters. No writes, no posting — just search, filter, display.
 *
 * Deployment parameters (Script record > Parameters):
 *   custscript_img_item_dropdown  - saved search for the "Item" filter list
 *   custscript_img_subsidiary     - saved search for the Subsidiary filter list
 *   custscript_img_category       - saved search for the Class filter list
 *   custscript_img_item_grid      - saved search for the results grid
 *   custscript_img_item_header    - saved search for the item detail header
 *   custscript_img_item_locations - saved search for the Locations tab
 *   custscript_img_item_vendors   - saved search for the Vendors tab
 *   custscript_img_bin_balance    - saved search for the Bin Numbers tab
 *
 * All five detail/grid searches can have any columns you want — this script
 * doesn't hardcode column names anywhere. Add/remove columns in the saved
 * search and the page follows automatically.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'], function (search, url, runtime, log) {

    const MAX_ITEM_OPTIONS = 500;
    const MAX_GRID_ROWS = 300;
    const MAX_DETAIL_ROWS = 1000;

    const PARAMS = {
        itemDropdown: 'custscript_img_item_dropdown',
        subsidiary: 'custscript_img_subsidiary',
        category: 'custscript_img_category',
        itemGrid: 'custscript_img_item_grid',
        itemHeader: 'custscript_img_item_header',
        itemLocations: 'custscript_img_item_locations',
        itemVendors: 'custscript_img_item_vendors',
        binBalance: 'custscript_img_bin_balance'
    };

    const ITEM_TYPES = [
        { value: 'InvtPart', text: 'Inventory Item' },
        { value: 'Assembly', text: 'Assembly Item' },
        { value: 'Kit', text: 'Kit / Package' },
        { value: 'NonInvtPart', text: 'Non-Inventory Item' },
        { value: 'Service', text: 'Service Item' },
        { value: 'OthCharge', text: 'Other Charge Item' }
    ];

    // =========================================================
    // REQUEST HANDLING
    // =========================================================

    function onRequest(context) {
        const request = context.request;
        const response = context.response;
        const action = request.parameters.action;

        if (request.method === 'GET' && !action) {
            response.write(renderPage());
            return;
        }

        try {
            if (action === 'filterOptions') return sendJson(response, getFilterOptions());
            if (action === 'itemSearch') return sendJson(response, searchItemsFiltered(request.parameters));
            if (action === 'itemDetail') return sendJson(response, getItemFullDetail(request.parameters.itemId));
            sendJson(response, { error: 'Unknown action: ' + action });
        } catch (e) {
            log.error('CS Item Inquiry Error', { action: action, message: e.message, stack: e.stack });
            sendJson(response, { error: e.message || String(e) });
        }
    }

    function sendJson(response, obj) {
        response.setHeader({ name: 'Content-Type', value: 'application/json' });
        response.write(JSON.stringify(obj || {}));
    }

    // =========================================================
    // SEARCH HELPERS
    // =========================================================

    function loadSearch(paramKey) {
        const searchId = runtime.getCurrentScript().getParameter({ name: PARAMS[paramKey] });
        if (!searchId) throw new Error('Missing saved search parameter: ' + PARAMS[paramKey]);
        return search.load({ id: String(searchId).trim() });
    }

    // "Parent : Child" -> "Child" (NetSuite's hierarchy display for Class/Subsidiary/etc.)
    function stripHierarchy(text) {
        if (!text) return text;
        const parts = String(text).split(':');
        return parts[parts.length - 1].trim();
    }

    // Filters a search down to one item, by internal id.
    function filterToItem(s, itemId) {
        s.filterExpression = (s.filterExpression || []).length
            ? [s.filterExpression, 'AND', ['internalid', 'anyof', itemId]]
            : ['internalid', 'anyof', itemId];
        return s;
    }

    // Runs a search and returns it as {columns, rows, total} — columns/rows
    // are entirely driven by whatever columns the search itself defines.
    function runSearch(s, maxRows, withTotal) {
        const cols = s.columns || [];
        const columns = cols.map(function (c, i) {
            return { key: 'c' + i, name: c.name || '', label: c.label || c.name || ('Column ' + (i + 1)) };
        });

        let total = 0;
        if (withTotal) {
            try { total = s.runPaged().count; } catch (e) { log.error('runPaged failed', e); }
        }

        const rows = [];
        s.run().each(function (r) {
            const row = { internalId: r.id };
            cols.forEach(function (c, i) {
                let v = '';
                try { v = r.getText(c); } catch (e) { /* not a list field */ }
                if (!v) v = r.getValue(c) || '';
                row['c' + i] = typeof v === 'string' ? stripHierarchy(v) : v;
            });
            rows.push(row);
            return rows.length < maxRows;
        });

        return { total: withTotal ? total : rows.length, columns: columns, rows: rows };
    }

    // Wraps a detail-tab load so one bad saved search doesn't break the page.
    function safely(label, fn) {
        try {
            return fn();
        } catch (e) {
            log.error(label + ' failed', e);
            return { columns: [], rows: [], error: e.message || String(e) };
        }
    }

    // Sorts rows by a column matched by name/label keyword, highest first.
    // Only reorders what was already fetched — see note in searchItemsFiltered.
    function sortByColumnDesc(dataSet, matchTerms) {
        const col = (dataSet.columns || []).find(function (c) {
            const haystack = (c.name + ' ' + c.label).toLowerCase();
            return matchTerms.some(function (t) { return haystack.indexOf(t) !== -1; });
        });
        if (!col) return dataSet;
        dataSet.rows.sort(function (a, b) {
            return (Number(String(b[col.key]).replace(/,/g, '')) || 0) - (Number(String(a[col.key]).replace(/,/g, '')) || 0);
        });
        return dataSet;
    }

    // =========================================================
    // FILTER OPTIONS
    // =========================================================

    function getFilterOptions() {
        return {
            items: safely('Item dropdown', function () { return firstColumnOptions('itemDropdown', MAX_ITEM_OPTIONS); }),
            itemTypes: ITEM_TYPES,
            classes: safely('Class dropdown', function () { return firstColumnOptions('category'); }),
            subsidiaries: safely('Subsidiary dropdown', function () { return firstColumnOptions('subsidiary'); })
        };
    }

    // Builds {value, text} options from a saved search's FIRST result column only.
    function firstColumnOptions(paramKey, max) {
        const s = loadSearch(paramKey);
        const cols = s.columns || [];
        const rows = [];
        s.run().each(function (r) {
            let text = cols.length ? (r.getText(cols[0]) || r.getValue(cols[0]) || '') : '';
            rows.push({ value: r.id, text: stripHierarchy(String(text || r.id)) });
            return !max || rows.length < max;
        });
        return rows;
    }

    // =========================================================
    // GRID + DETAIL
    // =========================================================

    function searchItemsFiltered(params) {
        const s = loadSearch('itemGrid');
        const filters = [];

        if (params.itemId) filters.push(['internalid', 'anyof', params.itemId]);
        if (params.itemType) filters.push(['type', 'anyof', params.itemType]);
        if (params.classId) filters.push(['class', 'anyof', params.classId]);
        if (params.subsidiaryId) filters.push(['subsidiary', 'anyof', params.subsidiaryId]);
        if (params.q) {
            filters.push([
                ['nameornumber', 'contains', params.q], 'OR',
                ['displayname', 'contains', params.q], 'OR',
                ['salesdescription', 'contains', params.q]
            ]);
        }

        if (filters.length) {
            let expr = filters[0];
            for (let i = 1; i < filters.length; i++) expr = [expr, 'AND', filters[i]];
            s.filterExpression = (s.filterExpression || []).length ? [s.filterExpression, 'AND', expr] : expr;
        }

        const result = runSearch(s, MAX_GRID_ROWS, true);

        // Highest On Hand first. NOTE: only sorts the rows already fetched
        // (capped at MAX_GRID_ROWS). For a fully correct top-N, also set a
        // descending sort on Quantity On Hand inside the saved search itself
        // (Results tab) so NetSuite returns rows in that order to begin with.
        sortByColumnDesc(result, ['on hand', 'onhand', 'quantityonhand']);
        return result;
    }

    function getItemFullDetail(itemId) {
        if (!itemId) {
            const empty = { columns: [], rows: [] };
            return { header: empty, locations: empty, vendors: empty, bins: empty };
        }
        return {
            header: safely('Item header', function () { return runSearch(filterToItem(loadSearch('itemHeader'), itemId), 1, false); }),
            locations: safely('Item locations', function () { return runSearch(filterToItem(loadSearch('itemLocations'), itemId), MAX_DETAIL_ROWS, false); }),
            vendors: safely('Item vendors', function () { return runSearch(filterToItem(loadSearch('itemVendors'), itemId), MAX_DETAIL_ROWS, false); }),
            // Bin Balance search is an ITEM search too, so it's filtered by internalid like the rest.
            bins: safely('Bin balance', function () { return runSearch(filterToItem(loadSearch('binBalance'), itemId), MAX_DETAIL_ROWS, false); })
        };
    }

    // =========================================================
    // PAGE
    // =========================================================

    function renderPage() {
        const s = runtime.getCurrentScript();
        const suiteletUrl = url.resolveScript({ scriptId: s.id, deploymentId: s.deploymentId, returnExternalUrl: false });
        return PAGE_HTML.replace('__SUITELET_URL_JSON__', JSON.stringify(suiteletUrl));
    }

    const PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CS Item Inquiry</title>
<style>
  :root { --bg:#f2f3f1; --panel:#fff; --ink:#1a1d21; --muted:#666f7a; --line:#dde1dd; --accent:#3d4a8a; --accent-soft:#e8eaf5; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif; }
  .page { max-width:1400px; margin:0 auto; padding:24px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:16px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:16px; }
  .filters { display:grid; grid-template-columns:2fr 1.2fr 1fr 1fr 1fr auto; gap:10px; align-items:end; }
  label { display:block; font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:600; margin-bottom:4px; }
  input, select { width:100%; height:36px; border:1px solid var(--line); border-radius:6px; padding:6px 9px; font-size:13px; }
  input:focus, select:focus { outline:none; border-color:var(--accent); }
  .btn { height:36px; border:1px solid var(--line); background:#fff; border-radius:6px; padding:0 14px; cursor:pointer; font-weight:600; font-size:13px; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .meta { display:flex; justify-content:space-between; color:var(--muted); font-size:12px; margin-top:10px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; color:var(--muted); padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }
  td { padding:8px 10px; border-bottom:1px solid #eee; }
  tr.clickable { cursor:pointer; }
  tr.clickable:hover td { background:var(--accent-soft); }
  .badge { display:inline-block; padding:2px 8px; border-radius:999px; background:#eee; color:var(--muted); font-size:11px; font-weight:600; }
  .badge.active { background:#e3f3ea; color:#146c43; }
  .item-title { font-size:20px; font-weight:700; margin:6px 0 4px; }
  .item-desc { color:var(--muted); font-size:13px; }
  .header-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-top:14px; }
  .kv { background:#f8f9f7; border:1px solid var(--line); border-radius:6px; padding:10px; }
  .kv .k { font-size:11px; text-transform:uppercase; color:var(--muted); font-weight:600; margin-bottom:4px; }
  .kv .v { font-weight:600; word-break:break-word; }
  .tabs { display:flex; gap:20px; border-bottom:1px solid var(--line); margin-bottom:12px; }
  .tab { border:none; background:none; padding:8px 2px; cursor:pointer; font-weight:600; color:var(--muted); border-bottom:2px solid transparent; margin-bottom:-1px; }
  .tab.active { color:var(--accent); border-color:var(--accent); }
  .panel { display:none; }
  .panel.active { display:block; }
  .empty, .loading { padding:24px; text-align:center; color:var(--muted); font-size:13px; }
  .error { background:#fbf0de; color:#96591a; border:1px solid #ebc994; padding:10px 12px; border-radius:6px; margin-bottom:12px; display:none; font-size:13px; }
  @media (max-width:1000px) { .filters, .header-grid { grid-template-columns:1fr 1fr; } }
</style>
</head>
<body>
<div class="page">

  <h1>CS Item Inquiry</h1>
  <div class="sub">Search item records and view header, location inventory, vendors, and bin balances.</div>

  <div id="errorBox" class="error"></div>

  <div id="gridSection" class="card">
    <div class="filters">
      <div><label>Search</label><input id="fQ" placeholder="Item name, display name, or description"></div>
      <div><label>Item</label><select id="fItem"><option value="">All Items</option></select></div>
      <div><label>Item Type</label><select id="fType"><option value="">All Types</option></select></div>
      <div><label>Subsidiary</label><select id="fSub"><option value="">All Subsidiaries</option></select></div>
      <div><label>Class</label><select id="fClass"><option value="">All Classes</option></select></div>
      <div><label>&nbsp;</label><button id="clearBtn" class="btn">Clear</button></div>
    </div>
    <div class="meta"><span>Total: <b id="totalCount">0</b></span><span>Click a row to open it</span></div>
    <table style="margin-top:12px;">
      <thead><tr id="gridHead"></tr></thead>
      <tbody id="gridRows"><tr><td class="loading">Loading items...</td></tr></tbody>
    </table>
  </div>

  <div id="detailSection" class="card" style="display:none;">
    <button id="backBtn" class="btn">&larr; Back to Results</button>
    <div id="itemTitle" class="item-title"></div>
    <div id="itemDesc" class="item-desc"></div>
    <div id="headerGrid" class="header-grid"></div>

    <div class="tabs" style="margin-top:20px;">
      <button class="tab active" data-tab="locTab">Locations</button>
      <button class="tab" data-tab="vendTab">Vendors</button>
      <button class="tab" data-tab="binTab">Bin Numbers</button>
    </div>
    <div id="locTab" class="panel active"><table><thead><tr id="locHead"></tr></thead><tbody id="locRows"></tbody></table></div>
    <div id="vendTab" class="panel"><table><thead><tr id="vendHead"></tr></thead><tbody id="vendRows"></tbody></table></div>
    <div id="binTab" class="panel"><table><thead><tr id="binHead"></tr></thead><tbody id="binRows"></tbody></table></div>
  </div>

</div>

<script>
(function () {
  var SUITELET_URL = __SUITELET_URL_JSON__;
  var currentItemId = '';

  function esc(v) {
    if (v === null || v === undefined || v === '') return '';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function fmt(v) {
    if (v === null || v === undefined || v === '') return '';
    if (v === 'T') return 'Yes';
    if (v === 'F') return 'No';
    return esc(v);
  }
  function td(v) { return '<td>' + fmt(v) + '</td>'; }
  function emptyRow(colspan, text) { return '<tr><td colspan="' + colspan + '" class="empty">' + esc(text) + '</td></tr>'; }
  function showError(msg) {
    var box = document.getElementById('errorBox');
    box.style.display = msg ? 'block' : 'none';
    box.innerHTML = msg ? esc(msg) : '';
  }

  function api(action, params) {
    params = params || {};
    var q = Object.keys(params).filter(function (k) { return params[k]; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    var reqUrl = SUITELET_URL + (SUITELET_URL.indexOf('?') === -1 ? '?' : '&') + 'action=' + action + (q ? '&' + q : '');
    return fetch(reqUrl).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.error) throw new Error(d.error);
      return d;
    });
  }

  function optionHtml(o) { return '<option value="' + esc(o.value) + '">' + esc(o.text) + '</option>'; }

  function loadFilterOptions() {
    api('filterOptions').then(function (d) {
      document.getElementById('fItem').innerHTML += (d.items || []).map(optionHtml).join('');
      document.getElementById('fType').innerHTML += (d.itemTypes || []).map(optionHtml).join('');
      document.getElementById('fSub').innerHTML += (d.subsidiaries || []).map(optionHtml).join('');
      document.getElementById('fClass').innerHTML += (d.classes || []).map(optionHtml).join('');
    }).catch(function (e) { showError(e.message); });
  }

  function currentFilters() {
    return {
      q: document.getElementById('fQ').value.trim(),
      itemId: document.getElementById('fItem').value,
      itemType: document.getElementById('fType').value,
      subsidiaryId: document.getElementById('fSub').value,
      classId: document.getElementById('fClass').value
    };
  }

  function renderTable(headId, bodyId, columns, rows, emptyText, clickable) {
    columns = columns || []; rows = rows || [];
    document.getElementById(headId).innerHTML = columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('');

    var body = document.getElementById(bodyId);
    if (!columns.length) { body.innerHTML = emptyRow(1, 'No columns returned by this search.'); return; }
    if (!rows.length) { body.innerHTML = emptyRow(columns.length, emptyText); return; }

    body.innerHTML = rows.map(function (row) {
      var attrs = clickable ? ' class="clickable" data-item="' + esc(row.internalId) + '"' : '';
      return '<tr' + attrs + '>' + columns.map(function (c) { return td(row[c.key]); }).join('') + '</tr>';
    }).join('');

    if (clickable) {
      body.querySelectorAll('tr[data-item]').forEach(function (row) {
        row.addEventListener('click', function () { openItem(row.getAttribute('data-item')); });
      });
    }
  }

  function refreshGrid() {
    showError('');
    document.getElementById('gridRows').innerHTML = '<tr><td class="loading">Loading items...</td></tr>';
    api('itemSearch', currentFilters()).then(function (d) {
      document.getElementById('totalCount').textContent = d.total || 0;
      renderTable('gridHead', 'gridRows', d.columns, d.rows, 'No items found for these filters.', true);
    }).catch(function (e) {
      showError(e.message);
      document.getElementById('gridRows').innerHTML = emptyRow(1, 'Unable to load results.');
    });
  }

  function firstValue(dataSet, terms) {
    var columns = dataSet.columns || [], row = (dataSet.rows || [])[0] || {};
    for (var i = 0; i < columns.length; i++) {
      var haystack = (columns[i].name + ' ' + columns[i].label).toLowerCase();
      for (var j = 0; j < terms.length; j++) {
        if (haystack.indexOf(terms[j]) !== -1 && row[columns[i].key]) return row[columns[i].key];
      }
    }
    return '';
  }

  function openItem(itemId) {
    if (!itemId) return;
    currentItemId = itemId;
    showError('');
    document.getElementById('gridSection').style.display = 'none';
    document.getElementById('detailSection').style.display = 'block';
    document.getElementById('itemTitle').textContent = 'Loading...';
    document.getElementById('itemDesc').textContent = '';
    document.getElementById('headerGrid').innerHTML = '';

    api('itemDetail', { itemId: itemId }).then(function (d) {
      var h = d.header || { columns: [], rows: [] };
      var name = firstValue(h, ['itemid', 'name']) || 'Item Detail';
      var display = firstValue(h, ['displayname']);
      var desc = firstValue(h, ['salesdescription', 'description']);
      var inactive = String(firstValue(h, ['isinactive', 'inactive'])).toLowerCase();
      var isInactive = inactive === 't' || inactive === 'true' || inactive === 'yes';

      document.getElementById('itemTitle').innerHTML = esc(name) +
        ' <span class="badge ' + (isInactive ? '' : 'active') + '">' + (isInactive ? 'Inactive' : 'Active') + '</span>';
      document.getElementById('itemDesc').innerHTML = (display ? '<b>' + esc(display) + '</b>' : '') + (desc ? '<br>' + esc(desc) : '');

      var row = (h.rows || [])[0] || {};
      document.getElementById('headerGrid').innerHTML = (h.columns || []).map(function (c) {
        return '<div class="kv"><div class="k">' + esc(c.label) + '</div><div class="v">' + fmt(row[c.key]) + '</div></div>';
      }).join('');

      var l = d.locations || {}, v = d.vendors || {}, b = d.bins || {};
      renderTable('locHead', 'locRows', l.columns, l.rows, 'No location inventory for this item.', false);
      renderTable('vendHead', 'vendRows', v.columns, v.rows, 'No vendor details for this item.', false);
      renderTable('binHead', 'binRows', b.columns, b.rows, 'No bin balance for this item.', false);
    }).catch(function (e) {
      showError(e.message);
      document.getElementById('itemTitle').textContent = 'Unable to load item';
    });
  }

  document.getElementById('clearBtn').addEventListener('click', function () {
    document.getElementById('fQ').value = '';
    ['fItem', 'fType', 'fSub', 'fClass'].forEach(function (id) { document.getElementById(id).value = ''; });
    refreshGrid();
  });
  document.getElementById('backBtn').addEventListener('click', function () {
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('gridSection').style.display = 'block';
  });
  document.getElementById('fItem').addEventListener('change', function () { refreshGrid(); if (this.value) openItem(this.value); });
  ['fType', 'fSub', 'fClass'].forEach(function (id) { document.getElementById(id).addEventListener('change', refreshGrid); });

  var qTimer;
  document.getElementById('fQ').addEventListener('input', function () { clearTimeout(qTimer); qTimer = setTimeout(refreshGrid, 300); });

  document.querySelectorAll('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === btn.dataset.tab); });
    });
  });

  loadFilterOptions();
  refreshGrid();
})();
</script>
</body>
</html>`;

    return { onRequest: onRequest };
});