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
    // Item detail — header + Locations / Vendors / Bin Numbers, record-style
    // -----------------------------------------------------------------------
    function getItemFullDetail(itemId) {
      // TEST HARDCODE: falls back to your sample item (9201) when nothing is
      // selected yet, so this page has something to show the first time you
      // open it. Remove this fallback once the grid is the normal entry point.
      itemId = itemId || '9201';

      return {
        header: getItemHeader(itemId),
        locations: getItemLocations(itemId),
        vendors: getItemVendors(itemId),
        bins: getItemBins(itemId)
      };
    }

    // Header fields — search.lookupFields works against the generic ITEM
    // search type regardless of the item's actual sub-type, so this avoids
    // having to guess/hardcode a record type (the old code's biggest VERIFY).
    function getItemHeader(itemId) {
      const fields = search.lookupFields({
        type: search.Type.ITEM,
        id: itemId,
        columns: ['itemid', 'displayname', 'salesdescription', 'type', 'class', 'subsidiary', 'isinactive']
      });
      return {
        internalId: itemId,
        itemId: fields.itemid,
        displayName: fields.displayname,
        description: fields.salesdescription,
        type: fields.type && fields.type[0] ? fields.type[0].text : '',
        className: fields['class'] && fields['class'][0] ? fields['class'][0].text : '',
        subsidiary: fields.subsidiary && fields.subsidiary[0] ? fields.subsidiary[0].text : '',
        status: fields.isinactive ? 'Inactive' : 'Active'
      };
    }

    // Locations tab — mirrors the item record's Locations subtab
    function getItemLocations(itemId) {
      const s = search.create({
        type: search.Type.ITEM,
        filters: [['internalid', 'anyof', itemId]],
        columns: [
          'inventorylocation',
          'locationquantityonhand',
          'locationquantityavailable',
          'locationquantitycommitted',
          'locationquantitybackordered',
          'locationquantityonorder',
          'locationaveragecost',
          'locationtotalvalue'
        ]
      });
      const rows = [];
      s.run().each((r) => {
        rows.push({
          location: r.getText('inventorylocation') || r.getValue('inventorylocation'),
          onHand: Number(r.getValue('locationquantityonhand')) || 0,
          available: Number(r.getValue('locationquantityavailable')) || 0,
          committed: Number(r.getValue('locationquantitycommitted')) || 0,
          backordered: Number(r.getValue('locationquantitybackordered')) || 0,
          onOrder: Number(r.getValue('locationquantityonorder')) || 0,
          avgCost: Number(r.getValue('locationaveragecost')) || 0,
          totalValue: Number(r.getValue('locationtotalvalue')) || 0
        });
        return true;
      });
      return rows;
    }

    // Vendors tab — mirrors the item record's Vendors subtab
    function getItemVendors(itemId) {
      const s = search.create({
        type: search.Type.ITEM,
        filters: [['internalid', 'anyof', itemId]],
        columns: [
          'vendor', 'vendorcode', 'vendorname', 'vendorcost',
          'vendorcostentered', 'vendorpricecurrency', 'othervendor'
        ]
      });
      const rows = [];
      s.run().each((r) => {
        const preferred = r.getValue('vendor');
        rows.push({
          vendor: r.getText('vendor') || r.getText('othervendor') || r.getValue('vendorname'),
          vendorCode: r.getValue('vendorcode'),
          cost: Number(r.getValue('vendorcost')) || Number(r.getValue('vendorcostentered')) || 0,
          currency: r.getText('vendorpricecurrency') || r.getValue('vendorpricecurrency'),
          preferred: !!preferred
        });
        return true;
      });
      return rows;
    }

    // Bin Numbers tab — mirrors the item record's Bin Numbers subtab.
    // VERIFY: only meaningful if Bin Management is enabled in this account;
    // field ids here (binnumber / binonhand) are best-guess — confirm against
    // a live item that actually has bins before relying on this tab.
    function getItemBins(itemId) {
      try {
        const s = search.create({
          type: search.Type.ITEM,
          filters: [['internalid', 'anyof', itemId]],
          columns: ['binnumber', 'inventorylocation', 'binonhand']
        });
        const rows = [];
        s.run().each((r) => {
          const bin = r.getValue('binnumber');
          if (bin) {
            rows.push({
              bin: r.getText('binnumber') || bin,
              location: r.getText('inventorylocation') || r.getValue('inventorylocation'),
              onHand: Number(r.getValue('binonhand')) || 0
            });
          }
          return true;
        });
        return rows;
      } catch (e) {
        log.debug('getItemBins', 'Bin columns not available in this account: ' + e.message);
        return [];
      }
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

  /* Item detail — record style: header block + subtabs */
  .record-header{ display:grid; grid-template-columns:2fr 1fr 1fr 1fr; gap:24px; }
  .kv-row{ display:flex; flex-direction:column; gap:3px; padding:4px 0; }
  .kv-row .k{ font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .kv-row .v{ font-weight:600; font-size:14px; }

  .subtabs{ display:flex; gap:4px; border-bottom:1px solid var(--line); margin:20px 0 14px; }
  .subtab{ padding:9px 4px; margin-right:20px; font-size:13.5px; font-weight:600; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; }
  .subtab.active{ color:var(--teal-dark); border-bottom-color:var(--teal); }
  .subtabview{ display:none; }
  .subtabview.active{ display:block; }
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

  <!-- ============ ITEM DETAIL (record-style) ============ -->
  <div id="detailSection" style="display:none;">
    <div class="card">
      <button class="btn link" id="backToGrid">&larr; Back to results</button>
      <div class="record-header" style="margin-top:14px;">
        <div class="kv-row"><span class="k">Item</span><span class="v" id="dItemId">—</span></div>
        <div class="kv-row"><span class="k">Type</span><span class="v" id="dType">—</span></div>
        <div class="kv-row"><span class="k">Class</span><span class="v" id="dClass">—</span></div>
        <div class="kv-row"><span class="k">Status</span><span class="v" id="dStatus">—</span></div>
        <div class="kv-row" style="grid-column:1 / -1;"><span class="k">Display Name</span><span class="v" id="dDisplayName">—</span></div>
        <div class="kv-row" style="grid-column:1 / -1;"><span class="k">Description</span><span class="v" id="dDesc">—</span></div>
        <div class="kv-row"><span class="k">Subsidiary</span><span class="v" id="dSub">—</span></div>
      </div>

      <div class="subtabs">
        <div class="subtab active" data-subtab="locations">Locations</div>
        <div class="subtab" data-subtab="vendors">Vendors</div>
        <div class="subtab" data-subtab="bins">Bin Numbers</div>
      </div>

      <div class="subtabview active" data-subtabview="locations">
        <table>
          <thead><tr>
            <th>Location</th><th class="num">On Hand</th><th class="num">Available</th><th class="num">Committed</th>
            <th class="num">Back Ordered</th><th class="num">On Order</th><th class="num">Avg. Cost</th><th class="num">Total Value</th>
          </tr></thead>
          <tbody id="locRows"></tbody>
        </table>
      </div>
      <div class="subtabview" data-subtabview="vendors">
        <table>
          <thead><tr><th>Vendor</th><th>Vendor Code</th><th class="num">Cost</th><th>Currency</th><th>Preferred</th></tr></thead>
          <tbody id="vendRows"></tbody>
        </table>
      </div>
      <div class="subtabview" data-subtabview="bins">
        <table>
          <thead><tr><th>Bin</th><th>Location</th><th class="num">On Hand</th></tr></thead>
          <tbody id="binRows"></tbody>
        </table>
      </div>
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
          resolve({
            header:{internalId: params.itemId||'9201', itemId:'PL041C', displayName:'Strep-Select Grouping', description:'Choice of 5 latex, controls, extraction reagents, sticks', type:'Lot Numbered Inventory Item', className:'Diagnostics', subsidiary:'Main Co.', status:'Active'},
            locations:[{location:'01', onHand:155, available:148, committed:1, backordered:-6, onOrder:70, avgCost:12.4, totalValue:1922}],
            vendors:[{vendor:'Hycor Biomedical', vendorCode:'HYC-PL041', cost:212.5, currency:'USD', preferred:true}],
            bins:[{bin:'A-12', location:'01', onHand:90},{bin:'A-13', location:'01', onHand:65}]
          });
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

  // ---------------- Item detail ----------------
  function openItem(itemId){
    api('itemDetail', {itemId:itemId}).then(function(d){
      var h = d.header || {};
      document.getElementById('dItemId').textContent = h.itemId || '—';
      document.getElementById('dDisplayName').textContent = h.displayName || '—';
      document.getElementById('dDesc').textContent = h.description || '—';
      document.getElementById('dType').textContent = h.type || '—';
      document.getElementById('dClass').textContent = h.className || '—';
      document.getElementById('dSub').textContent = h.subsidiary || '—';
      document.getElementById('dStatus').textContent = h.status || '—';

      document.getElementById('locRows').innerHTML = (d.locations||[]).map(function(r){
        return '<tr>' + td('<b>'+r.location+'</b>') + numCell(r.onHand) + numCell(r.available) + numCell(r.committed) +
          numCell(r.backordered) + numCell(r.onOrder) + numCell(r.avgCost) + numCell(r.totalValue) + '</tr>';
      }).join('') || '<tr><td colspan="8" class="empty">No location data.</td></tr>';

      document.getElementById('vendRows').innerHTML = (d.vendors||[]).map(function(r){
        return '<tr>' + td('<b>'+r.vendor+'</b>') + td(r.vendorCode||'') + numCell(r.cost) + td(r.currency||'') +
          td(r.preferred ? '<span class="badge active">Preferred</span>' : '<span class="badge">Alternate</span>') + '</tr>';
      }).join('') || '<tr><td colspan="5" class="empty">No vendors on file.</td></tr>';

      document.getElementById('binRows').innerHTML = (d.bins||[]).map(function(r){
        return '<tr>' + td('<b>'+r.bin+'</b>') + td(r.location||'') + numCell(r.onHand) + '</tr>';
      }).join('') || '<tr><td colspan="3" class="empty">No bin data (bin management may be off, or item has none).</td></tr>';

      document.getElementById('gridSection').style.display = 'none';
      document.getElementById('detailSection').style.display = 'block';
    });
  }

  document.getElementById('backToGrid').addEventListener('click', function(){
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('gridSection').style.display = 'block';
  });

  document.querySelectorAll('.subtab').forEach(function(t){
    t.addEventListener('click', function(){
      document.querySelectorAll('.subtab').forEach(function(x){ x.classList.toggle('active', x===t); });
      document.querySelectorAll('.subtabview').forEach(function(v){
        v.classList.toggle('active', v.dataset.subtabview === t.dataset.subtab);
      });
    });
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