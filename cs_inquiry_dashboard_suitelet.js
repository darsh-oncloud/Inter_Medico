/**
 * cs_item_inquiry_suitelet.js
 *
 * CS Item Inquiry — filter-driven item browser + record-style item detail.
 *
 * WHAT THIS IS
 * A single Suitelet page:
 *   1. A filter bar (Item Type / Class / Subsidiary / free-text search) that
 *      re-runs the item search in real time — no "Apply" button, no reload.
 *   2. A results grid. Click a row to open the item detail.
 *   3. Item detail is laid out like the native NetSuite item record:
 *      a header block, then tabs for Locations / Vendors / Bin Numbers,
 *      each rendered as a sublist-style table.
 *
 * TESTING NOTE
 * getItemFullDetail() defaults to internal id '9201' (your test item) when no
 * itemId is passed, exactly like the script you pasted. Once you click a row
 * in the grid, the real itemId is sent instead — so this is already wired for
 * production, the hardcode is only a fallback for testing this file on its own.
 *
 * VERIFY markers below flag anything that depends on your account's setup
 * (bin management on/off, exact item types in use, class vs. department, etc.)
 * — check these against a live record before this goes out to users.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'],
  (search, url, runtime, log) => {

    // -----------------------------------------------------------------------
    // Entry point
    // -----------------------------------------------------------------------
    const onRequest = (context) => {
      const { request, response } = context;

      if (request.method === 'GET' && !request.parameters.action) {
        response.write(renderPage());
        return;
      }

      const action = request.parameters.action;
      try {
        switch (action) {
          case 'filterOptions':
            return sendJson(response, getFilterOptions());
          case 'itemSearch':
            return sendJson(response, searchItemsFiltered(request.parameters));
          case 'itemDetail':
            return sendJson(response, getItemFullDetail(request.parameters.itemId));
          default:
            return sendJson(response, { error: 'Unknown action: ' + action });
        }
      } catch (e) {
        log.error('CS Item Inquiry error [' + action + ']', e);
        return sendJson(response, { error: e.message || String(e) });
      }
    };

    function sendJson(response, obj) {
      response.setHeader({ name: 'Content-Type', value: 'application/json' });
      response.write(JSON.stringify(obj));
    }

    // -----------------------------------------------------------------------
    // Filter dropdown data — Item Type / Class / Subsidiary
    // -----------------------------------------------------------------------
    function getFilterOptions() {
      // Item Type: static list of the item record types actually searchable
      // under search.Type.ITEM's "type" column. VERIFY this matches the item
      // types actually in use in this account — trim or extend as needed.
      const itemTypes = [
        { value: 'InvtPart', text: 'Inventory Item' },
        { value: 'LotNumberedInventoryItem', text: 'Lot Numbered Inventory Item' },
        { value: 'SerializedInventoryItem', text: 'Serialized Inventory Item' },
        { value: 'Assembly', text: 'Assembly / Bill of Materials' },
        { value: 'Kit', text: 'Kit / Package' },
        { value: 'NonInvtPart', text: 'Non-Inventory Item' },
        { value: 'Service', text: 'Service' }
      ];

      const classes = [];
      search.create({
        type: 'classification',
        filters: [['isinactive', 'is', 'F']],
        columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
      }).run().each((r) => {
        classes.push({ value: r.id, text: r.getValue('name') });
        return true;
      });

      const subsidiaries = [];
      search.create({
        type: 'subsidiary',
        filters: [['isinactive', 'is', 'F']],
        columns: [search.createColumn({ name: 'name', sort: search.Sort.ASC })]
      }).run().each((r) => {
        subsidiaries.push({ value: r.id, text: r.getValue('name') });
        return true;
      });

      return { itemTypes, classes, subsidiaries };
    }

    // -----------------------------------------------------------------------
    // Results grid — combines all active filters, re-run on every change
    // -----------------------------------------------------------------------
    function searchItemsFiltered(params) {
      const filters = [];

      if (params.itemType) {
        if (filters.length) filters.push('AND');
        filters.push(['type', 'anyof', params.itemType]);
      }
      if (params.classId) {
        if (filters.length) filters.push('AND');
        filters.push(['class', 'anyof', params.classId]);
      }
      if (params.subsidiaryId) {
        if (filters.length) filters.push('AND');
        filters.push(['subsidiary', 'anyof', params.subsidiaryId]);
      }
      if (params.q) {
        if (filters.length) filters.push('AND');
        filters.push(['nameornumber', 'contains', params.q]);
      }

      const s = search.create({
        type: search.Type.ITEM,
        filters,
        columns: [
          search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
          'displayname', 'salesdescription', 'type', 'class', 'subsidiary',
          'isinactive', 'quantityonhand', 'quantityavailable'
        ]
      });

      const total = s.runPaged().count;
      const out = [];
      s.run().each((r) => {
        out.push({
          internalId: r.id,
          itemId: r.getValue('itemid'),
          displayName: r.getValue('displayname'),
          description: r.getValue('salesdescription'),
          type: r.getText('type'),
          className: r.getText('class'),
          subsidiary: r.getText('subsidiary'),
          status: r.getValue('isinactive') ? 'Inactive' : 'Active',
          onHand: r.getValue('quantityonhand'),
          available: r.getValue('quantityavailable')
        });
        return out.length < 200; // cap the grid; narrow filters to see more
      });

      return { total, rows: out };
    }

    // -----------------------------------------------------------------------
    // Item detail — fully driven by the search's OWN column list.
    //
    // HOW THIS WORKS
    // We don't hand-list columns in the render code. We load a search (right
    // now built inline from the exact script you pasted — see
    // buildInlineDetailSearch below — later just a saved search loaded by id)
    // and read its .columns straight off the search object. Whatever
    // labels/columns that search has is what gets sent to the page and
    // rendered as table headers. Add a column to the search later and it
    // shows up automatically — this file does not need to change.
    //
    // SWITCHING TO A REAL SAVED SEARCH
    // 1. In NetSuite, build/adjust the search the way you want it (Lists >
    //    Search > Saved Searches > New, type = Item), save it, note its id
    //    (e.g. "customsearch1783350611743").
    // 2. Set DETAIL_SEARCH_ID below to that id. That's the only code change,
    //    ever, needed for adding/removing/relabeling columns from then on.
    // -----------------------------------------------------------------------
    const DETAIL_SEARCH_ID = null; // e.g. 'customsearch1783350611743' once saved

    function loadDetailSearch() {
      return DETAIL_SEARCH_ID
        ? search.load({ id: DETAIL_SEARCH_ID })
        : buildInlineDetailSearch();
    }

    // Exactly the search you pasted, minus the hardcoded item filter (that's
    // applied per-request below instead). This is the "for now hardcoded"
    // stand-in until you save the real search and set DETAIL_SEARCH_ID above.
    function buildInlineDetailSearch() {
      return search.create({
        type: 'item',
        columns: [
          search.createColumn({ name: 'itemid', label: 'Name' }),
          search.createColumn({ name: 'displayname', label: 'Display Name' }),
          search.createColumn({ name: 'salesdescription', label: 'Description' }),
          search.createColumn({ name: 'type', label: 'Type' }),
          search.createColumn({ name: 'inventorylocation', label: 'Inventory Warehouse' }),
          search.createColumn({ name: 'locationquantityavailable', label: 'Warehouse Available' }),
          search.createColumn({ name: 'locationaveragecost', label: 'Warehouse Average Cost' }),
          search.createColumn({ name: 'locationquantitybackordered', label: 'Warehouse Back Ordered' }),
          search.createColumn({ name: 'locationquantitycommitted', label: 'Warehouse Committed' }),
          search.createColumn({ name: 'locationtoresvcommitted', label: 'Warehouse Committed To Reservation' }),
          search.createColumn({ name: 'locationquantityintransit', label: 'Warehouse In Transit' }),
          search.createColumn({ name: 'locationquantityonhand', label: 'Warehouse On Hand' }),
          search.createColumn({ name: 'locationquantityonorder', label: 'Warehouse On Order' }),
          search.createColumn({ name: 'locationtotalvalue', label: 'Warehouse Total Value' }),
          search.createColumn({ name: 'locationqtyintransitext', label: 'Warehouse External Quantity In Transit' }),
          search.createColumn({ name: 'vendor', label: 'Preferred Vendor' }),
          search.createColumn({ name: 'vendorcode', label: 'Vendor Code' }),
          search.createColumn({ name: 'vendorname', label: 'Vendor Name' }),
          search.createColumn({ name: 'vendorcost', label: 'Vendor Price' }),
          search.createColumn({ name: 'vendorcostentered', label: 'Vendor Price (Entered)' }),
          search.createColumn({ name: 'vendorpricecurrency', label: 'Vendor Price Currency' }),
          search.createColumn({ name: 'vendreturnvarianceaccount', label: 'Vendor Return Variance Account' }),
          search.createColumn({ name: 'vendorschedule', label: 'Vendor Schedule' }),
          search.createColumn({ name: 'othervendor', label: 'Vendor' })
        ]
      });
    }

    // Runs the detail search filtered to one item, and returns both the
    // column definitions (id + label, straight off the search) and the rows
    // (cell values keyed to those same ids) — the page just renders whatever
    // comes back, it never assumes specific column names.
    //
    // NOTE ON BLANK "Inventory Warehouse" cells: this search mixes location
    // columns, vendor columns, and (per your screenshot) bin/quality-status
    // columns in one item search. NetSuite returns the cross-product of those
    // joins, so a row only has non-blank warehouse numbers when it's the
    // specific location combination — vendor-only or bin-only rows show
    // blank warehouse fields, and vice versa. That's expected NetSuite
    // behavior for a search built this way, not a loading bug. A clean
    // one-row-per-location result needs a search with only location columns
    // (no vendor/bin joins mixed in).
    function getItemFullDetail(itemId) {
      // TEST HARDCODE: falls back to your sample item (9201) when nothing is
      // selected yet. Once wired to the grid, a real itemId is always passed.
      itemId = itemId || '9201';

      const s = loadDetailSearch();
      s.filters = [search.createFilter({ name: 'internalid', operator: search.Operator.ANYOF, values: [itemId] })];

      const columns = s.columns.map((c, i) => ({
        key: 'c' + i,
        label: c.label || (c.name + (c.join ? ' (' + c.join + ')' : ''))
      }));

      const rows = [];
      s.run().each((r) => {
        const row = {};
        s.columns.forEach((c, i) => {
          row['c' + i] = r.getText(c) || r.getValue(c);
        });
        rows.push(row);
        return true;
      });

      return { columns, rows };
    }

    // -----------------------------------------------------------------------
    // Page shell
    // -----------------------------------------------------------------------
    function renderPage() {
      const scriptId = runtime.getCurrentScript().id;
      const deploymentId = runtime.getCurrentScript().deploymentId;
      const suiteletUrl = url.resolveScript({ scriptId, deploymentId, returnExternalUrl: false });
      return PAGE_HTML.split('__SUITELET_URL__').join(suiteletUrl);
    }

    const PAGE_HTML = buildHtml();

    function buildHtml() {
      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CS Item Inquiry</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F2F6F5; --surface:#FFFFFF; --ink:#122523; --muted:#5C7472; --line:#DCE6E3;
    --teal:#0E6E62; --teal-dark:#0A4F46; --teal-tint:#E4F1EE;
    --radius:10px; --shadow:0 1px 2px rgba(18,37,35,.06), 0 8px 24px rgba(18,37,35,.05);
    font-size:15px;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{ background:var(--bg); color:var(--ink); font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  .mono{ font-family:'IBM Plex Mono',ui-monospace,monospace; font-variant-numeric:tabular-nums; }
  .display{ font-family:'Space Grotesk',sans-serif; }

  /* Centered, full-width main column — no side filter panel */
  .page{ max-width:1200px; margin:0 auto; padding:28px 24px 60px; }
  h1.page-title{ font-family:'Space Grotesk',sans-serif; font-size:22px; font-weight:600; margin:2px 0 2px; }
  .page-sub{ color:var(--muted); font-size:13px; margin-bottom:20px; }

  .card{ background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:18px; margin-bottom:18px; }

  /* Filter bar: full width, all filters in one row, real-time */
  .filter-bar{ display:flex; flex-wrap:wrap; gap:14px; align-items:flex-end; }
  .filter-field{ display:flex; flex-direction:column; gap:5px; min-width:180px; flex:1; }
  .filter-field.grow{ flex:2; min-width:260px; }
  .filter-field label{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:600; }
  .filter-field select, .filter-field input{
    padding:9px 10px; border-radius:8px; border:1px solid var(--line); font-size:13.5px; color:var(--ink); background:#fff; outline:none;
  }
  .filter-field select:focus, .filter-field input:focus{ border-color:var(--teal); }
  .filter-meta{ display:flex; justify-content:space-between; align-items:center; margin:14px 2px 0; font-size:12.5px; color:var(--muted); }
  .filter-meta b{ color:var(--ink); }
  .btn{ font-size:12.5px; font-weight:600; padding:8px 12px; border-radius:7px; cursor:pointer; border:1px solid var(--line); background:#fff; color:var(--ink); }
  .btn:hover{ border-color:var(--teal); color:var(--teal-dark); }
  .btn.link{ border:none; background:none; color:var(--teal-dark); padding:0; text-decoration:underline; }

  table{ width:100%; border-collapse:collapse; font-size:13px; }
  thead th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); padding:9px 10px; border-bottom:1px solid var(--line); }
  tbody td{ padding:9px 10px; border-bottom:1px solid #EEF3F2; }
  tbody tr.clickable{ cursor:pointer; }
  tbody tr.clickable:hover{ background:var(--teal-tint); }
  .num{ text-align:right; font-family:'IBM Plex Mono',monospace; }
  .empty{ padding:34px 10px; text-align:center; color:var(--muted); font-size:13px; }
  .badge{ font-size:11px; padding:3px 8px; border-radius:999px; font-weight:600; background:#EEF3F2; color:var(--muted); }
  .badge.active{ background:var(--teal-tint); color:var(--teal-dark); }

  /* Item detail — one dynamic table, columns driven by the search itself */
  .kv-row{ display:flex; flex-direction:column; gap:3px; padding:4px 0; }
  .kv-row .k{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .kv-row .v{ font-weight:600; font-size:14px; }
</style>
</head>
<body>

<div class="page">

  <h1 class="page-title">CS Item Inquiry</h1>
  <div class="page-sub" id="pageSub">Filter items by type, class, or subsidiary — results update as you go. Click a row to open the item.</div>

  <!-- ============ FILTER BAR + RESULTS GRID ============ -->
  <div class="card" id="gridSection">
    <div class="filter-bar">
      <div class="filter-field grow">
        <label>Search</label>
        <input id="fQ" placeholder="Item ID, name, or description…" autocomplete="off">
      </div>
      <div class="filter-field">
        <label>Item Type</label>
        <select id="fType"><option value="">All</option></select>
      </div>
      <div class="filter-field">
        <label>Class</label>
        <select id="fClass"><option value="">All</option></select>
      </div>
      <div class="filter-field">
        <label>Subsidiary</label>
        <select id="fSub"><option value="">All</option></select>
      </div>
      <div class="filter-field" style="flex:0;">
        <label>&nbsp;</label>
        <button class="btn" id="clearFilters">Clear</button>
      </div>
    </div>
    <div class="filter-meta">
      <span>Total: <b id="totalCount">0</b></span>
    </div>

    <table style="margin-top:14px;">
      <thead><tr>
        <th>Item ID</th><th>Display Name</th><th>Description</th><th>Type</th><th>Class</th><th>Subsidiary</th><th>Status</th>
        <th class="num">On Hand</th><th class="num">Available</th>
      </tr></thead>
      <tbody id="gridRows"></tbody>
    </table>
  </div>

  <!-- ============ ITEM DETAIL — columns come entirely from the search ============ -->
  <div id="detailSection" style="display:none;">
    <div class="card">
      <button class="btn link" id="backToGrid">&larr; Back to results</button>
      <div class="page-sub" style="margin:10px 0 0;">
        Every column below is whatever the underlying search returns — add or remove a column
        in the search and this table follows automatically, no page changes needed.
      </div>
      <table style="margin-top:14px;">
        <thead><tr id="detailHeadRow"></tr></thead>
        <tbody id="detailRows"></tbody>
      </table>
    </div>
  </div>

</div>

<script>
(function(){
  "use strict";
  var SUITELET_URL = "__SUITELET_URL__";
  var MOCK_MODE = (SUITELET_URL.indexOf("__SUITELET_URL__") !== -1 || SUITELET_URL === "");

  function api(action, params){
    params = params || {};
    if (MOCK_MODE) return mockApi(action, params);
    var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');
    return fetch(SUITELET_URL + '&action=' + action + (q ? '&'+q : '')).then(function(r){ return r.json(); });
  }

  // Mock data so this file can be opened directly in a browser to review
  // layout before it's deployed as a real Suitelet. Deployed, MOCK_MODE is
  // false and every call above hits the real NetSuite actions instead.
  function mockApi(action, params){
    return new Promise(function(resolve){
      setTimeout(function(){
        if (action === 'filterOptions'){
          resolve({
            itemTypes:[{value:'InvtPart',text:'Inventory Item'},{value:'LotNumberedInventoryItem',text:'Lot Numbered Inventory Item'}],
            classes:[{value:'1',text:'Diagnostics'},{value:'2',text:'Reagents'}],
            subsidiaries:[{value:'1',text:'Main Co.'},{value:'2',text:'Main Co. (CA)'}]
          });
        } else if (action === 'itemSearch'){
          var rows = [
            {internalId:'9201', itemId:'PL041C', displayName:'Strep-Select Grouping', description:'Choice of 5 latex, controls, extraction reagents, sticks', type:'Lot Numbered Inventory Item', className:'Diagnostics', subsidiary:'Main Co.', status:'Active', onHand:155, available:148},
            {internalId:'9302', itemId:'HB210', displayName:'HbA1c Kit', description:'A1c testing kit', type:'Inventory Item', className:'Reagents', subsidiary:'Main Co.', status:'Active', onHand:40, available:38}
          ].filter(function(r){
            if (params.q && r.itemId.toLowerCase().indexOf(params.q.toLowerCase())===-1 && r.displayName.toLowerCase().indexOf(params.q.toLowerCase())===-1) return false;
            return true;
          });
          resolve({ total: rows.length, rows: rows });
        } else if (action === 'itemDetail'){
          // Shape mirrors what the real search returns: a column list (id +
          // label, as defined by the search) and rows keyed to those ids —
          // same cross-join sparsity you'll see live (location-only rows have
          // blank vendor cells and vice versa).
          var cols = [
            {key:'c0', label:'Name'}, {key:'c1', label:'Display Name'}, {key:'c2', label:'Description'},
            {key:'c3', label:'Type'}, {key:'c4', label:'Inventory Warehouse'}, {key:'c5', label:'Warehouse Available'},
            {key:'c6', label:'Warehouse Average Cost'}, {key:'c15', label:'Preferred Vendor'}, {key:'c16', label:'Vendor Code'}
          ];
          var rows = [
            {c0:'PL041C', c1:'Strep-Select Grouping', c2:'Choice of 5 latex, controls, extraction reagents, sticks', c3:'Inventory Item', c4:'01', c5:148, c6:12.4, c15:'', c16:''},
            {c0:'PL041C', c1:'Strep-Select Grouping', c2:'Choice of 5 latex, controls, extraction reagents, sticks', c3:'Inventory Item', c4:'', c5:'', c6:'', c15:'Hycor Biomedical', c16:'HYC-PL041'}
          ];
          resolve({ columns: cols, rows: rows });
        } else resolve({});
      }, 150);
    });
  }

  function fmtNum(n){ n = Number(n)||0; return n.toLocaleString('en-US', {minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}); }
  function td(text, cls){ return '<td' + (cls?' class="'+cls+'"':'') + '>' + text + '</td>'; }
  function numCell(n){ var c = Number(n) < 0 ? 'num' : 'num'; return td(fmtNum(n), c); }
  function opt(o){ return '<option value="'+o.value+'">'+o.text+'</option>'; }

  // ---------------- Filter dropdowns ----------------
  function loadFilterOptions(){
    api('filterOptions').then(function(d){
      document.getElementById('fType').innerHTML += (d.itemTypes||[]).map(opt).join('');
      document.getElementById('fClass').innerHTML += (d.classes||[]).map(opt).join('');
      document.getElementById('fSub').innerHTML += (d.subsidiaries||[]).map(opt).join('');
    });
  }

  // ---------------- Results grid (real-time) ----------------
  function currentFilters(){
    return {
      q: document.getElementById('fQ').value.trim(),
      itemType: document.getElementById('fType').value,
      classId: document.getElementById('fClass').value,
      subsidiaryId: document.getElementById('fSub').value
    };
  }

  function refreshGrid(){
    api('itemSearch', currentFilters()).then(function(d){
      document.getElementById('totalCount').textContent = d.total || 0;
      document.getElementById('gridRows').innerHTML = (d.rows||[]).map(function(r){
        return '<tr class="clickable" data-item="'+r.internalId+'">' +
          td('<b>'+r.itemId+'</b>') + td(r.displayName||'') + td(r.description||'') + td(r.type||'') +
          td(r.className||'') + td(r.subsidiary||'') +
          td('<span class="badge'+(r.status==='Active'?' active':'')+'">'+r.status+'</span>') +
          numCell(r.onHand) + numCell(r.available) + '</tr>';
      }).join('') || '<tr><td colspan="9" class="empty">No items match these filters.</td></tr>';

      document.querySelectorAll('#gridRows [data-item]').forEach(function(row){
        row.addEventListener('click', function(){ openItem(row.dataset.item); });
      });
    });
  }

  var qTimer;
  document.getElementById('fQ').addEventListener('input', function(){
    clearTimeout(qTimer);
    qTimer = setTimeout(refreshGrid, 250);
  });
  document.getElementById('fType').addEventListener('change', refreshGrid);
  document.getElementById('fClass').addEventListener('change', refreshGrid);
  document.getElementById('fSub').addEventListener('change', refreshGrid);
  document.getElementById('clearFilters').addEventListener('click', function(){
    document.getElementById('fQ').value = '';
    document.getElementById('fType').value = '';
    document.getElementById('fClass').value = '';
    document.getElementById('fSub').value = '';
    refreshGrid();
  });

  // ---------------- Item detail — fully dynamic, driven by d.columns ----------------
  function openItem(itemId){
    api('itemDetail', {itemId:itemId}).then(function(d){
      var columns = d.columns || [];

      // Header row built from whatever columns the search actually has —
      // nothing here is hardcoded to a specific field name.
      document.getElementById('detailHeadRow').innerHTML = columns.map(function(c){
        return '<th>' + c.label + '</th>';
      }).join('');

      document.getElementById('detailRows').innerHTML = (d.rows||[]).map(function(r){
        return '<tr>' + columns.map(function(c){
          var v = r[c.key];
          return td(v === null || v === undefined || v === '' ? '<span style="color:var(--muted);">—</span>' : v);
        }).join('') + '</tr>';
      }).join('') || '<tr><td colspan="'+(columns.length||1)+'" class="empty">No results for this item.</td></tr>';

      document.getElementById('gridSection').style.display = 'none';
      document.getElementById('detailSection').style.display = 'block';
    });
  }

  document.getElementById('backToGrid').addEventListener('click', function(){
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('gridSection').style.display = 'block';
  });

  // ---------------- Init ----------------
  loadFilterOptions();
  refreshGrid();
})();
</script>
</body>
</html>`;
    }

    return { onRequest };
  });