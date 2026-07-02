/**
 * cs_inquiry_dashboard_suitelet.js
 *
 * Customer Service Inquiry Dashboard
 * Replaces the legacy "SyAcc Inventory Inquiry" screen with a single NetSuite
 * page: item + lot/serial + vendor + sales history + customer inquiry,
 * filter-driven, with CSV export.
 *
 * Built for: Carole Millette / Kathy (Customer Service), role: Customer Service (custom)
 *
 * IMPORTANT — read 01_REQUIREMENTS_AND_QUESTIONS.md first.
 * Every saved search ID and several field IDs below are best-guess based on
 * standard NetSuite field names and the transcript. Lines marked // VERIFY:
 * must be checked against the live account (Locations vs. Bins, custom
 * fields, saved search IDs) before this goes to production.
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/record', 'N/url', 'N/runtime', 'N/format', 'N/log'],
  (search, record, url, runtime, format, log) => {

    // ---------------------------------------------------------------------
    // Entry point
    // ---------------------------------------------------------------------
    const onRequest = (context) => {
      const { request, response } = context;

      if (request.method === 'GET' && !request.parameters.action) {
        response.write(renderPage());
        return;
      }

      // Every data call and the CSV export come through here as
      // ?action=xxx&... so the whole thing is a single script/deployment.
      const action = request.parameters.action;
      try {
        switch (action) {
          case 'itemSearch':
            return sendJson(response, searchItems(request.parameters.q));
          case 'itemDetail':
            return sendJson(response, getItemDetail(request.parameters.itemId));
          case 'inventoryDetail':
            return sendJson(response, getInventoryDetail(request.parameters.itemId));
          case 'vendorDetail':
            return sendJson(response, getVendorDetail(request.parameters.itemId));
          case 'salesHistory':
            return sendJson(response, getSalesHistory(
              request.parameters.itemId, request.parameters.from, request.parameters.to));
          case 'itemTransactions':
            return sendJson(response, getItemTransactions(request.parameters.itemId));
          case 'committedDrilldown':
            return sendJson(response, getCommittedSalesOrders(request.parameters.itemId));
          case 'serialLotLookup':
            return sendJson(response, serialLotLookup(request.parameters.value));
          case 'customerSearch':
            return sendJson(response, searchCustomers(request.parameters.q));
          case 'customerDetail':
            return sendJson(response, getCustomerDetail(request.parameters.customerId));
          case 'export':
            return sendCsv(response, request.parameters);
          default:
            return sendJson(response, { error: 'Unknown action: ' + action });
        }
      } catch (e) {
        log.error('CS Dashboard error [' + action + ']', e);
        return sendJson(response, { error: e.message || String(e) });
      }
    };

    function sendJson(response, obj) {
      response.setHeader({ name: 'Content-Type', value: 'application/json' });
      response.write(JSON.stringify(obj));
    }

    // ---------------------------------------------------------------------
    // Data layer
    // ---------------------------------------------------------------------

    // Type-ahead item search (Part ID / description)
    function searchItems(q) {
      if (!q) return [];
      const s = search.create({
        type: search.Type.ITEM,
        filters: [
          ['type', 'anyof', 'InvtPart', 'LotNumberedInventoryItem', 'SerializedInventoryItem'],
          'AND',
          ['nameornumber', 'contains', q]
        ],
        columns: ['itemid', 'displayname', 'salesdescription']
      });
      const out = [];
      s.run().each((r) => {
        out.push({
          id: r.id,
          itemId: r.getValue('itemid'),
          name: r.getValue('displayname'),
          description: r.getValue('salesdescription')
        });
        return out.length < 25;
      });
      return out;
    }

    // Item header: description, category, price, status, cost method, UOM
    function getItemDetail(itemId) {
      if (!itemId) return {};
      const rec = record.load({ type: record.Type.LOT_NUMBERED_INVENTORY_ITEM, id: itemId, isDynamic: false });
      // VERIFY: item type may be InventoryItem / SerializedInventoryItem in this account;
      // consider record.load with the type returned from the search result instead of hardcoding.
      return {
        internalId: itemId,
        itemId: rec.getValue('itemid'),
        description: rec.getValue('salesdescription'),
        category: rec.getText('class') || rec.getValue('class'),
        status: rec.getValue('isinactive') ? 'Inactive' : 'Active',
        price: rec.getValue('price') || rec.getSublistValue({ sublist: 'price1', fieldId: 'price_1_', line: 0 }),
        costMethod: rec.getText('costingmethod'),
        qtyUom: rec.getText('unitstype') || rec.getValue('stockunit'),
        trackingMethod: 'Lot' // VERIFY: derive from record type instead of hardcoding once confirmed
      };
    }

    // Warehouse/lot grid — mirrors the legacy inquiry columns:
    // Not Posted, Committed, IOS, Order Qty, On Hand, Allocated Qty, Qty Available
    function getInventoryDetail(itemId) {
      if (!itemId) return [];
      // VERIFY: confirm whether "warehouse" rows in the legacy screen map to
      // NetSuite Locations or Bins. This assumes Locations.
      const s = search.create({
        type: search.Type.ITEM,
        filters: [['internalid', 'anyof', itemId]],
        columns: [
          search.createColumn({ name: 'locationquantityonhand', label: 'onHand' }),
          search.createColumn({ name: 'locationquantitycommitted', label: 'committed' }),
          search.createColumn({ name: 'locationquantityavailable', label: 'available' }),
          search.createColumn({ name: 'locationquantitybackordered', label: 'backordered' }),
          search.createColumn({ name: 'locationquantityonorder', label: 'onOrder' }),
          search.createColumn({ name: 'inventorylocation', label: 'location' })
        ]
      });
      const rows = [];
      s.run().each((r) => {
        rows.push({
          location: r.getText({ name: 'inventorylocation' }) || r.getValue({ name: 'inventorylocation' }),
          onHand: Number(r.getValue({ name: 'locationquantityonhand' })) || 0,
          committed: Number(r.getValue({ name: 'locationquantitycommitted' })) || 0,
          available: Number(r.getValue({ name: 'locationquantityavailable' })) || 0,
          backordered: Number(r.getValue({ name: 'locationquantitybackordered' })) || 0,
          onOrder: Number(r.getValue({ name: 'locationquantityonorder' })) || 0
        });
        return true;
      });

      // Lot-level detail (number + expiration + on-hand per lot)
      const lotSearch = search.create({
        type: 'inventorynumber', // VERIFY: search.Type.INVENTORY_NUMBER
        filters: [['item', 'anyof', itemId]],
        columns: [
          'inventorynumber',
          'expirationdate',
          'quantityonhand',
          'quantityavailable',
          'quantitycommitted',
          'location'
        ]
      });
      const lots = [];
      lotSearch.run().each((r) => {
        lots.push({
          lot: r.getValue('inventorynumber'),
          expirationDate: r.getValue('expirationdate'),
          onHand: Number(r.getValue('quantityonhand')) || 0,
          available: Number(r.getValue('quantityavailable')) || 0,
          committed: Number(r.getValue('quantitycommitted')) || 0,
          location: r.getText('location') || r.getValue('location')
        });
        return true;
      });

      return { byLocation: rows, byLot: lots };
    }

    // Preferred vendor(s), vendor code, cost by currency, alternate vendor
    function getVendorDetail(itemId) {
      if (!itemId) return [];
      const rec = record.load({ type: record.Type.LOT_NUMBERED_INVENTORY_ITEM, id: itemId });
      const count = rec.getLineCount({ sublist: 'itemvendor' });
      const vendors = [];
      for (let i = 0; i < count; i++) {
        vendors.push({
          vendor: rec.getSublistText({ sublist: 'itemvendor', fieldId: 'vendor', line: i }),
          vendorCode: rec.getSublistValue({ sublist: 'itemvendor', fieldId: 'vendorcode', line: i }),
          purchasePrice: rec.getSublistValue({ sublist: 'itemvendor', fieldId: 'purchaseprice', line: i }),
          currency: rec.getSublistText({ sublist: 'itemvendor', fieldId: 'currency', line: i }), // VERIFY field id
          preferred: rec.getSublistValue({ sublist: 'itemvendor', fieldId: 'preferredvendor', line: i })
        });
      }
      return vendors;
    }

    // Sales history by customer, filterable by date range
    function getSalesHistory(itemId, from, to) {
      if (!itemId) return [];
      const filters = [
        ['item', 'anyof', itemId],
        'AND',
        ['mainline', 'is', 'F'],
        'AND',
        ['type', 'anyof', 'CustInvc', 'SalesOrd']
      ];
      if (from) filters.push('AND', ['trandate', 'onorafter', from]);
      if (to) filters.push('AND', ['trandate', 'onorbefore', to]);

      const s = search.create({
        type: search.Type.TRANSACTION,
        filters,
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'tranid', 'entity', 'quantity', 'rate', 'amount', 'type'
        ]
      });
      const out = [];
      s.run().each((r) => {
        out.push({
          date: r.getValue('trandate'),
          docNum: r.getValue('tranid'),
          customer: r.getText('entity'),
          qty: r.getValue('quantity'),
          rate: r.getValue('rate'),
          amount: r.getValue('amount'),
          type: r.getText('type')
        });
        return out.length < 500;
      });
      return out;
    }

    // Full related-record history for an item: PO, SO, item receipt,
    // item fulfillment, inventory adjustment
    function getItemTransactions(itemId) {
      if (!itemId) return [];
      const s = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ['item', 'anyof', itemId],
          'AND', ['mainline', 'is', 'F'],
          'AND', ['type', 'anyof', 'PurchOrd', 'SalesOrd', 'ItemRcpt', 'ItemShip', 'InvAdjst']
        ],
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'type', 'tranid', 'entity', 'quantity', 'rate', 'amount', 'status'
        ]
      });
      const out = [];
      s.run().each((r) => {
        out.push({
          date: r.getValue('trandate'),
          type: r.getText('type'),
          docNum: r.getValue('tranid'),
          entity: r.getText('entity'),
          qty: r.getValue('quantity'),
          amount: r.getValue('amount'),
          status: r.getText('status')
        });
        return out.length < 500;
      });
      return out;
    }

    // Drill-down: which sales orders make up the "Committed" quantity
    function getCommittedSalesOrders(itemId) {
      if (!itemId) return [];
      const s = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ['item', 'anyof', itemId],
          'AND', ['mainline', 'is', 'F'],
          'AND', ['type', 'anyof', 'SalesOrd'],
          'AND', ['status', 'noneof', 'SalesOrd:F', 'SalesOrd:C'] // exclude fully billed/closed - VERIFY status ids
        ],
        columns: ['tranid', 'entity', 'quantity', 'quantitycommitted', 'trandate']
      });
      const out = [];
      s.run().each((r) => {
        out.push({
          docNum: r.getValue('tranid'),
          customer: r.getText('entity'),
          qtyOrdered: r.getValue('quantity'),
          qtyCommitted: r.getValue('quantitycommitted'),
          date: r.getValue('trandate')
        });
        return true;
      });
      return out;
    }

    // Serial or lot number -> which customer/order it was issued against
    function serialLotLookup(value) {
      if (!value) return [];
      // VERIFY: 'serialnumbers' filter works reliably on Item Fulfillment /
      // Invoice searches for matching issued inventory detail. Confirm
      // against this account; some setups need a join through the
      // Inventory Number record's "Applied To Transaction" instead.
      const s = search.create({
        type: search.Type.ITEM_FULFILLMENT,
        filters: [['serialnumbers', 'is', value]],
        columns: ['tranid', 'trandate', 'entity', 'item', 'quantity', 'createdfrom']
      });
      const out = [];
      s.run().each((r) => {
        out.push({
          fulfillmentNum: r.getValue('tranid'),
          date: r.getValue('trandate'),
          customer: r.getText('entity'),
          item: r.getText('item'),
          qty: r.getValue('quantity'),
          salesOrder: r.getText('createdfrom')
        });
        return true;
      });
      return out;
    }

    // Type-ahead customer search
    function searchCustomers(q) {
      if (!q) return [];
      const s = search.create({
        type: search.Type.CUSTOMER,
        filters: [['entityid', 'contains', q]],
        columns: ['entityid', 'companyname', 'phone']
      });
      const out = [];
      s.run().each((r) => {
        out.push({ id: r.id, entityId: r.getValue('entityid'), name: r.getValue('companyname') });
        return out.length < 25;
      });
      return out;
    }

    // Customer inquiry: all transactions, items purchased, invoice numbers,
    // open orders + what's allocated/committed
    function getCustomerDetail(customerId) {
      if (!customerId) return {};
      const cust = record.load({ type: record.Type.CUSTOMER, id: customerId });
      const profile = {
        id: customerId,
        entityId: cust.getValue('entityid'),
        companyName: cust.getValue('companyname'),
        phone: cust.getValue('phone'),
        email: cust.getValue('email'),
        recordUrl: url.resolveRecord({ recordType: record.Type.CUSTOMER, recordId: customerId })
      };

      const s = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ['entity', 'anyof', customerId],
          'AND', ['mainline', 'is', 'F'],
          'AND', ['type', 'anyof', 'SalesOrd', 'CustInvc']
        ],
        columns: [
          search.createColumn({ name: 'trandate', sort: search.Sort.DESC }),
          'type', 'tranid', 'item', 'quantity', 'rate', 'amount', 'status'
        ]
      });
      const transactions = [];
      s.run().each((r) => {
        transactions.push({
          date: r.getValue('trandate'),
          type: r.getText('type'),
          docNum: r.getValue('tranid'),
          item: r.getText('item'),
          qty: r.getValue('quantity'),
          amount: r.getValue('amount'),
          status: r.getText('status')
        });
        return transactions.length < 500;
      });

      const openOrders = transactions.filter((t) =>
        t.type === 'Sales Order' && !/closed|billed|fully/i.test(t.status || ''));

      return { profile, transactions, openOrders };
    }

    // ---------------------------------------------------------------------
    // CSV export — re-runs the relevant search server-side and streams CSV.
    // Front end just does: window.location = <suiteletUrl>&action=export&...
    // ---------------------------------------------------------------------
    function sendCsv(response, params) {
      let rows = [];
      let headers = [];
      const view = params.view;

      if (view === 'salesHistory') {
        rows = getSalesHistory(params.itemId, params.from, params.to);
        headers = ['date', 'docNum', 'customer', 'qty', 'rate', 'amount', 'type'];
      } else if (view === 'itemTransactions') {
        rows = getItemTransactions(params.itemId);
        headers = ['date', 'type', 'docNum', 'entity', 'qty', 'amount', 'status'];
      } else if (view === 'inventoryByLot') {
        rows = getInventoryDetail(params.itemId).byLot;
        headers = ['lot', 'expirationDate', 'onHand', 'available', 'committed', 'location'];
      } else if (view === 'customerTransactions') {
        rows = getCustomerDetail(params.customerId).transactions;
        headers = ['date', 'type', 'docNum', 'item', 'qty', 'amount', 'status'];
      }

      let csv = headers.join(',') + '\n';
      rows.forEach((row) => {
        csv += headers.map((h) => csvEscape(row[h])).join(',') + '\n';
      });

      response.setHeader({ name: 'Content-Type', value: 'text/csv' });
      response.setHeader({ name: 'Content-Disposition', value: 'attachment; filename="' + (view || 'export') + '.csv"' });
      response.write(csv);
    }

    function csvEscape(val) {
      if (val === null || val === undefined) return '';
      const s = String(val).replace(/"/g, '""');
      return /[",\n]/.test(s) ? '"' + s + '"' : s;
    }

    // ---------------------------------------------------------------------
    // Page shell (HTML/CSS/JS) — see cs_inquiry_dashboard.html for the
    // fully commented, standalone version of this same markup used for
    // design review. This function just returns it as one string.
    // ---------------------------------------------------------------------
    function renderPage() {
      const scriptId = runtime.getCurrentScript().id;
      const deploymentId = runtime.getCurrentScript().deploymentId;
      const suiteletUrl = url.resolveScript({
        scriptId, deploymentId, returnExternalUrl: false
      });

      return getHtmlShell(suiteletUrl);
    }

    function getHtmlShell(suiteletUrl) {
      // Inlined on purpose: a Suitelet must return its own markup (no
      // separate static file hosting), so the full HTML/CSS/JS lives here
      // as one string. cs_inquiry_dashboard_preview.html, delivered
      // alongside this script, is the same markup in its own file purely so
      // you can open it directly in a browser to design-review before it
      // goes into NetSuite. Keep the two in sync if you edit either one.
      return PAGE_HTML.split('__SUITELET_URL__').join(suiteletUrl);
    }

    var PAGE_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>CS Inquiry \u2014 Item &amp; Customer Dashboard</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<style>\n  :root{\n    --bg:#F2F6F5;\n    --surface:#FFFFFF;\n    --ink:#122523;\n    --muted:#5C7472;\n    --line:#DCE6E3;\n    --teal:#0E6E62;\n    --teal-dark:#0A4F46;\n    --teal-tint:#E4F1EE;\n    --amber:#C97A2E;\n    --amber-tint:#FBF0E2;\n    --danger:#B23B3B;\n    --danger-tint:#FBEAEA;\n    --good:#2E8B57;\n    --radius:10px;\n    --shadow:0 1px 2px rgba(18,37,35,.06), 0 8px 24px rgba(18,37,35,.05);\n    font-size:15px;\n  }\n  *{box-sizing:border-box;}\n  html,body{margin:0;padding:0;}\n  body{\n    background:var(--bg);\n    color:var(--ink);\n    font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;\n    -webkit-font-smoothing:antialiased;\n  }\n  .app{ display:grid; grid-template-columns:248px 1fr; min-height:100vh; }\n  .mono{ font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }\n  .display{ font-family:'Space Grotesk',sans-serif; }\n\n  /* ---------- Sidebar ---------- */\n  .sidebar{\n    background:var(--teal-dark);\n    color:#EAF4F2;\n    padding:20px 16px 16px;\n    display:flex; flex-direction:column; gap:22px;\n    position:sticky; top:0; height:100vh;\n  }\n  .brand{ display:flex; align-items:center; gap:10px; }\n  .brand-mark{\n    width:30px;height:30px;border-radius:8px;\n    background:linear-gradient(135deg,#28A794,#0E6E62);\n    display:flex;align-items:center;justify-content:center;\n    font-family:'Space Grotesk',sans-serif; font-weight:700; color:#fff; font-size:14px;\n  }\n  .brand-text .t1{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:15px; line-height:1.1; }\n  .brand-text .t2{ font-size:11px; color:#9FC4BC; letter-spacing:.02em; }\n\n  .nav{ display:flex; flex-direction:column; gap:2px; }\n  .nav-label{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#7FADA4; margin:10px 4px 4px; }\n  .nav-item{\n    display:flex; align-items:center; gap:10px;\n    padding:9px 10px; border-radius:8px; cursor:pointer;\n    color:#D9EEEA; font-size:13.5px; font-weight:500;\n    border:1px solid transparent;\n  }\n  .nav-item:hover{ background:rgba(255,255,255,.06); }\n  .nav-item.active{ background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.14); color:#fff; }\n  .nav-item .dot{ width:6px;height:6px;border-radius:50%; background:#5FC9B4; flex:none; }\n\n  .recent{ margin-top:auto; }\n  .recent-item{\n    font-size:12px; color:#B9DAD3; padding:6px 4px; border-radius:6px; cursor:pointer;\n    display:flex; justify-content:space-between; gap:6px;\n  }\n  .recent-item:hover{ background:rgba(255,255,255,.06); color:#fff; }\n  .user-chip{\n    display:flex; align-items:center; gap:9px; padding-top:14px; border-top:1px solid rgba(255,255,255,.12);\n  }\n  .avatar{ width:26px;height:26px;border-radius:50%; background:#5FC9B4; color:#08322C; font-weight:700; font-size:11px; display:flex;align-items:center;justify-content:center; }\n  .user-chip .name{ font-size:12.5px; font-weight:600; }\n  .user-chip .role{ font-size:11px; color:#9FC4BC; }\n\n  /* ---------- Main ---------- */\n  .main{ padding:22px 28px 40px; max-width:1320px; }\n  .topbar{ display:flex; align-items:center; gap:14px; margin-bottom:18px; }\n  .search-wrap{ position:relative; flex:1; max-width:520px; }\n  .search-wrap input{\n    width:100%; padding:11px 14px 11px 38px; border-radius:10px; border:1px solid var(--line);\n    background:var(--surface); font-size:14px; color:var(--ink); outline:none;\n    box-shadow:var(--shadow);\n  }\n  .search-wrap input:focus{ border-color:var(--teal); }\n  .search-wrap svg{ position:absolute; left:12px; top:50%; transform:translateY(-50%); }\n  .search-results{\n    position:absolute; top:calc(100% + 6px); left:0; right:0; background:var(--surface);\n    border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); overflow:hidden; z-index:20;\n    display:none;\n  }\n  .search-results.open{ display:block; }\n  .search-result{ padding:9px 14px; font-size:13px; cursor:pointer; display:flex; justify-content:space-between; gap:10px; }\n  .search-result:hover{ background:var(--teal-tint); }\n  .search-result .sid{ font-weight:600; }\n  .search-result .sdesc{ color:var(--muted); font-size:12px; }\n\n  .topbar-spacer{ flex:1; }\n  .pill{\n    font-size:11.5px; padding:5px 10px; border-radius:999px; background:var(--teal-tint); color:var(--teal-dark);\n    font-weight:600; letter-spacing:.01em;\n  }\n\n  h1.page-title{ font-family:'Space Grotesk',sans-serif; font-size:22px; margin:2px 0 2px; font-weight:600; }\n  .page-sub{ color:var(--muted); font-size:13px; margin-bottom:18px; }\n\n  .card{\n    background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);\n    box-shadow:var(--shadow); padding:18px 18px 8px; margin-bottom:18px;\n  }\n  .card-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }\n  .card-head h2{ font-family:'Space Grotesk',sans-serif; font-size:15px; margin:0; font-weight:600; }\n  .card-head .actions{ display:flex; gap:8px; }\n  .btn{\n    font-size:12.5px; font-weight:600; padding:7px 12px; border-radius:7px; cursor:pointer;\n    border:1px solid var(--line); background:#fff; color:var(--ink); display:inline-flex; align-items:center; gap:6px;\n  }\n  .btn:hover{ border-color:var(--teal); color:var(--teal-dark); }\n  .btn.primary{ background:var(--teal); color:#fff; border-color:var(--teal); }\n  .btn.primary:hover{ background:var(--teal-dark); }\n\n  .item-header{ display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:24px; }\n  .kv{ display:flex; flex-direction:column; gap:10px; }\n  .kv-row{ display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:6px 0; border-bottom:1px dashed var(--line); }\n  .kv-row .k{ color:var(--muted); }\n  .kv-row .v{ font-weight:600; text-align:right; }\n  .price-tile{\n    background:var(--teal-tint); border-radius:8px; padding:12px 14px; margin-top:2px;\n  }\n  .price-tile .amt{ font-family:'Space Grotesk',sans-serif; font-size:26px; font-weight:700; color:var(--teal-dark); }\n  .price-tile .lbl{ font-size:11.5px; color:var(--teal-dark); opacity:.75; text-transform:uppercase; letter-spacing:.06em; }\n\n  table{ width:100%; border-collapse:collapse; font-size:13px; }\n  thead th{\n    text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);\n    padding:8px 10px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--surface);\n  }\n  tbody td{ padding:9px 10px; border-bottom:1px solid #EEF3F2; }\n  tbody tr:hover{ background:#F7FAF9; }\n  tbody tr.clickable{ cursor:pointer; }\n  .num{ text-align:right; font-family:'IBM Plex Mono',monospace; }\n  .neg{ color:var(--danger); }\n\n  .expiry-pill{ display:inline-flex; align-items:center; gap:6px; font-family:'IBM Plex Mono',monospace; font-size:12px; }\n  .expiry-dot{ width:8px; height:8px; border-radius:50%; flex:none; }\n  .expiry-dot.ok{ background:var(--good); }\n  .expiry-dot.soon{ background:var(--amber); }\n  .expiry-dot.critical{ background:var(--danger); }\n  .expiry-bar{ width:54px; height:4px; border-radius:3px; background:#E4ECEA; overflow:hidden; }\n  .expiry-bar > span{ display:block; height:100%; border-radius:3px; }\n\n  .tabs{ display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:16px; }\n  .tab{ padding:9px 4px; margin-right:18px; font-size:13.5px; font-weight:600; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; }\n  .tab.active{ color:var(--teal-dark); border-bottom-color:var(--teal); }\n\n  .view{ display:none; }\n  .view.active{ display:block; }\n\n  .filter-row{ display:flex; gap:10px; align-items:center; margin-bottom:2px; flex-wrap:wrap; }\n  .filter-row label{ font-size:12px; color:var(--muted); }\n  .filter-row input[type=date]{ padding:6px 8px; border-radius:6px; border:1px solid var(--line); font-size:12.5px; }\n\n  .empty{ padding:34px 10px; text-align:center; color:var(--muted); font-size:13px; }\n  .badge{ font-size:11px; padding:3px 8px; border-radius:999px; font-weight:600; }\n  .badge.open{ background:var(--amber-tint); color:var(--amber); }\n  .badge.closed{ background:#EEF3F2; color:var(--muted); }\n\n  .mock-banner{\n    background:#111; color:#fff; font-size:12px; padding:7px 14px; text-align:center;\n    font-family:'IBM Plex Mono',monospace; letter-spacing:.02em;\n  }\n  .mock-banner b{ color:#5FC9B4; }\n\n  @media (max-width: 900px){\n    .app{ grid-template-columns:1fr; }\n    .sidebar{ position:relative; height:auto; }\n    .item-header{ grid-template-columns:1fr; }\n  }\n</style>\n</head>\n<body>\n\n<div class=\"mock-banner\" id=\"mockBanner\" style=\"display:none;\">\n  <b>PREVIEW MODE</b> \u2014 showing sample data (PL041C) so you can review layout &amp; interactions before this is wired to a live NetSuite account.\n</div>\n\n<div class=\"app\">\n  <aside class=\"sidebar\">\n    <div class=\"brand\">\n      <div class=\"brand-mark\">CS</div>\n      <div class=\"brand-text\">\n        <div class=\"t1\">CS Inquiry</div>\n        <div class=\"t2\">Customer Service Dashboard</div>\n      </div>\n    </div>\n\n    <div class=\"nav\">\n      <div class=\"nav-label\">Lookup</div>\n      <div class=\"nav-item active\" data-nav=\"item\"><span class=\"dot\"></span>Item &amp; Inventory</div>\n      <div class=\"nav-item\" data-nav=\"serial\"><span class=\"dot\"></span>Serial &amp; Lot Lookup</div>\n      <div class=\"nav-item\" data-nav=\"customer\"><span class=\"dot\"></span>Customer Inquiry</div>\n    </div>\n\n    <div class=\"recent\">\n      <div class=\"nav-label\">Recent Items</div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>PL041C</span><span class=\"mono\">Strep-Select</span></div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>HB210</span><span class=\"mono\">HbA1c Kit</span></div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>PL041C</span><span class=\"mono\">RSV Panel</span></div>\n    </div>\n\n    <div class=\"user-chip\">\n      <div class=\"avatar\">CM</div>\n      <div>\n        <div class=\"name\">Carole Millette</div>\n        <div class=\"role\">Customer Service</div>\n      </div>\n    </div>\n  </aside>\n\n  <main class=\"main\">\n    <div class=\"topbar\">\n      <div class=\"search-wrap\">\n        <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5C7472\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/></svg>\n        <input id=\"globalSearch\" placeholder=\"Search item, part ID, or customer\u2026\" autocomplete=\"off\">\n        <div class=\"search-results\" id=\"searchResults\"></div>\n      </div>\n      <div class=\"topbar-spacer\"></div>\n      <span class=\"pill\" id=\"contextPill\">Item Inquiry</span>\n    </div>\n\n    <!-- ============ ITEM & INVENTORY VIEW ============ -->\n    <section class=\"view active\" id=\"view-item\">\n      <h1 class=\"page-title\" id=\"itemTitle\">PL041C \u2014 Strep-Select Grouping</h1>\n      <div class=\"page-sub\" id=\"itemSub\">Choice of 5 latex, controls, extraction reagents, sticks \u00b7 Category 1034 \u00b7 Active</div>\n\n      <div class=\"card\">\n        <div class=\"item-header\">\n          <div class=\"kv\">\n            <div class=\"kv-row\"><span class=\"k\">Tracking method</span><span class=\"v\">Lot</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Cost method</span><span class=\"v\">Exact</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Qty UOM</span><span class=\"v\">EA</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Cost UOM</span><span class=\"v\">EA</span></div>\n          </div>\n          <div class=\"kv\">\n            <div class=\"kv-row\"><span class=\"k\">Status</span><span class=\"v\" style=\"color:var(--good)\">Active</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Dangerous goods</span><span class=\"v\">No</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Dry ice required</span><span class=\"v\">No</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Created</span><span class=\"v\">5/18/2005</span></div>\n          </div>\n          <div class=\"price-tile\">\n            <div class=\"lbl\">List price</div>\n            <div class=\"amt\">$554.00</div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"tabs\">\n        <div class=\"tab active\" data-tab=\"warehouse\">Warehouse &amp; Lots</div>\n        <div class=\"tab\" data-tab=\"vendors\">Vendors &amp; Cost</div>\n        <div class=\"tab\" data-tab=\"sales\">Sales History</div>\n        <div class=\"tab\" data-tab=\"txns\">Transactions</div>\n      </div>\n\n      <!-- Warehouse & Lots -->\n      <div class=\"tab-view active\" data-tabview=\"warehouse\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Inventory by warehouse</h2>\n            <div class=\"actions\">\n              <button class=\"btn\" data-export=\"inventoryByLot\">Export CSV</button>\n            </div>\n          </div>\n          <table>\n            <thead><tr>\n              <th>Warehouse</th><th class=\"num\">Not Posted</th><th class=\"num\">Committed</th><th class=\"num\">IOS</th>\n              <th class=\"num\">Order Qty</th><th class=\"num\">On Hand</th><th class=\"num\">Allocated</th><th class=\"num\">Available</th>\n            </tr></thead>\n            <tbody id=\"warehouseRows\"></tbody>\n          </table>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Lot detail &amp; expiration</h2>\n            <div class=\"actions\">\n              <button class=\"btn\" data-export=\"inventoryByLot\">Export CSV</button>\n            </div>\n          </div>\n          <table>\n            <thead><tr>\n              <th>Lot #</th><th>Warehouse</th><th>Expiration</th><th class=\"num\">On Hand</th>\n              <th class=\"num\">Committed</th><th class=\"num\">Available</th>\n            </tr></thead>\n            <tbody id=\"lotRows\"></tbody>\n          </table>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Committed against \u2014 open sales orders</h2></div>\n          <table>\n            <thead><tr><th>SO #</th><th>Customer</th><th>Date</th><th class=\"num\">Qty Ordered</th><th class=\"num\">Qty Committed</th></tr></thead>\n            <tbody id=\"committedRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <!-- Vendors -->\n      <div class=\"tab-view\" data-tabview=\"vendors\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Preferred &amp; alternate vendors</h2></div>\n          <table>\n            <thead><tr><th>Vendor</th><th>Vendor code</th><th>Currency</th><th class=\"num\">Cost</th><th>Preferred</th></tr></thead>\n            <tbody id=\"vendorRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <!-- Sales history -->\n      <div class=\"tab-view\" data-tabview=\"sales\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Sales history by customer</h2>\n            <div class=\"actions\">\n              <button class=\"btn\" data-export=\"salesHistory\">Export CSV</button>\n            </div>\n          </div>\n          <div class=\"filter-row\" style=\"margin-bottom:12px;\">\n            <label>From</label><input type=\"date\" id=\"salesFrom\">\n            <label>To</label><input type=\"date\" id=\"salesTo\">\n            <button class=\"btn\" id=\"salesFilterBtn\">Apply</button>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Doc #</th><th>Type</th><th>Customer</th><th class=\"num\">Qty</th><th class=\"num\">Rate</th><th class=\"num\">Amount</th></tr></thead>\n            <tbody id=\"salesRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <!-- Transactions -->\n      <div class=\"tab-view\" data-tabview=\"txns\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Related transactions</h2>\n            <div class=\"actions\">\n              <button class=\"btn\" data-export=\"itemTransactions\">Export CSV</button>\n            </div>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Type</th><th>Doc #</th><th>Entity</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody id=\"txnRows\"></tbody>\n          </table>\n        </div>\n      </div>\n    </section>\n\n    <!-- ============ SERIAL & LOT LOOKUP ============ -->\n    <section class=\"view\" id=\"view-serial\">\n      <h1 class=\"page-title\">Serial &amp; Lot Lookup</h1>\n      <div class=\"page-sub\">Find out which customer, sales order, and fulfillment a serial or lot number went to.</div>\n      <div class=\"card\">\n        <div class=\"filter-row\">\n          <input id=\"serialInput\" placeholder=\"Enter serial or lot number\u2026\" style=\"flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--line);\">\n          <button class=\"btn primary\" id=\"serialLookupBtn\">Look up</button>\n        </div>\n      </div>\n      <div class=\"card\" id=\"serialResultsCard\" style=\"display:none;\">\n        <div class=\"card-head\"><h2>Results</h2></div>\n        <table>\n          <thead><tr><th>Fulfillment #</th><th>Date</th><th>Customer</th><th>Item</th><th class=\"num\">Qty</th><th>Sales Order</th></tr></thead>\n          <tbody id=\"serialRows\"></tbody>\n        </table>\n      </div>\n    </section>\n\n    <!-- ============ CUSTOMER INQUIRY ============ -->\n    <section class=\"view\" id=\"view-customer\">\n      <h1 class=\"page-title\">Customer Inquiry</h1>\n      <div class=\"page-sub\">Search a customer to see everything they've purchased, invoice numbers, and open orders.</div>\n      <div class=\"card\">\n        <div class=\"filter-row\">\n          <input id=\"customerSearchInput\" placeholder=\"Search customer name\u2026\" style=\"flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--line);\">\n        </div>\n      </div>\n\n      <div id=\"customerDetailWrap\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"item-header\" style=\"grid-template-columns:1fr 1fr;\">\n            <div class=\"kv\">\n              <div class=\"kv-row\"><span class=\"k\">Customer</span><span class=\"v\" id=\"custName\">\u2014</span></div>\n              <div class=\"kv-row\"><span class=\"k\">Account #</span><span class=\"v\" id=\"custId\">\u2014</span></div>\n            </div>\n            <div class=\"kv\">\n              <div class=\"kv-row\"><span class=\"k\">Phone</span><span class=\"v\" id=\"custPhone\">\u2014</span></div>\n              <div class=\"kv-row\"><span class=\"k\">Email</span><span class=\"v\" id=\"custEmail\">\u2014</span></div>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Open orders</h2></div>\n          <table>\n            <thead><tr><th>SO #</th><th>Item</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody id=\"custOpenRows\"></tbody>\n          </table>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>All transactions</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"customerTransactions\">Export CSV</button></div>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Type</th><th>Doc #</th><th>Item</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody id=\"custAllRows\"></tbody>\n          </table>\n        </div>\n      </div>\n    </section>\n\n  </main>\n</div>\n\n<script>\n(function(){\n  \"use strict\";\n  var SUITELET_URL = \"__SUITELET_URL__\";\n  var MOCK_MODE = (SUITELET_URL.indexOf(\"__SUITELET_URL__\") !== -1 || SUITELET_URL === \"\");\n  if (MOCK_MODE) document.getElementById('mockBanner').style.display = 'block';\n\n  var state = { itemId: 'PL041C', customerId: null };\n\n  // ---------------- Mock data (mirrors the legacy screen 1:1 for PL041C) ----------------\n  var MOCK = {\n    warehouses: [\n      {location:'01', notPosted:-6.0, committed:1.0, ios:0.0, orderQty:70.0, onHand:155.0, allocated:7.0, available:148.0},\n      {location:'02', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'03', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'04', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'05', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'07', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'13', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'ROCHE', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'RS02', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'RS03', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'RS04', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'RS05', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0},\n      {location:'RS07', notPosted:0,committed:0,ios:0,orderQty:0,onHand:0,allocated:0,available:0}\n    ],\n    lots: [\n      {lot:'LN-24118', location:'01', expirationDate:'2026-08-15', onHand:62, committed:1, available:61},\n      {lot:'LN-24142', location:'01', expirationDate:'2026-11-02', onHand:53, committed:0, available:53},\n      {lot:'LN-25009', location:'01', expirationDate:'2027-02-20', onHand:40, committed:0, available:40}\n    ],\n    committed: [\n      {docNum:'SO-10432', customer:'Meridian Diagnostics', date:'2026-06-24', qtyOrdered:1, qtyCommitted:1}\n    ],\n    vendors: [\n      {vendor:'Hycor Biomedical', vendorCode:'HYC-PL041', currency:'USD', purchasePrice:212.50, preferred:true},\n      {vendor:'Hycor Biomedical (CA)', vendorCode:'HYC-PL041-CA', currency:'CAD', purchasePrice:289.10, preferred:false},\n      {vendor:'Meridian Life Science', vendorCode:'MLS-7741', currency:'USD', purchasePrice:219.00, preferred:false}\n    ],\n    sales: [\n      {date:'2026-06-24', docNum:'SO-10432', type:'Sales Order', customer:'Meridian Diagnostics', qty:1, rate:554.00, amount:554.00},\n      {date:'2026-05-11', docNum:'INV-9981', type:'Invoice', customer:'Northshore Labs', qty:3, rate:554.00, amount:1662.00},\n      {date:'2026-04-02', docNum:'INV-9820', type:'Invoice', customer:'Valley Clinical Partners', qty:2, rate:554.00, amount:1108.00},\n      {date:'2026-02-18', docNum:'INV-9601', type:'Invoice', customer:'Meridian Diagnostics', qty:5, rate:540.00, amount:2700.00}\n    ],\n    txns: [\n      {date:'2026-06-24', type:'Sales Order', docNum:'SO-10432', entity:'Meridian Diagnostics', qty:1, amount:554.00, status:'Pending Fulfillment'},\n      {date:'2026-06-02', type:'Purchase Order', docNum:'PO-5521', entity:'Hycor Biomedical', qty:60, amount:12750.00, status:'Partially Received'},\n      {date:'2026-05-11', type:'Item Fulfillment', docNum:'IF-8834', entity:'Northshore Labs', qty:3, amount:0, status:'Shipped'},\n      {date:'2026-04-02', type:'Item Receipt', docNum:'IR-4410', entity:'Hycor Biomedical', qty:50, amount:10625.00, status:'Received'}\n    ],\n    serial: [\n      {fulfillmentNum:'IF-8834', date:'2026-05-11', customer:'Northshore Labs', item:'PL041C', qty:3, salesOrder:'SO-10299'}\n    ],\n    customers: {\n      'Meridian Diagnostics': {\n        profile:{entityId:'C-1042', companyName:'Meridian Diagnostics', phone:'(905) 555-0148', email:'orders@meridiandx.example'},\n        open:[{docNum:'SO-10432', item:'PL041C', qty:1, amount:554.00, status:'Pending Fulfillment'}],\n        all:[\n          {date:'2026-06-24', type:'Sales Order', docNum:'SO-10432', item:'PL041C', qty:1, amount:554.00, status:'Pending Fulfillment'},\n          {date:'2026-02-18', type:'Invoice', docNum:'INV-9601', item:'PL041C', qty:5, amount:2700.00, status:'Paid'}\n        ]\n      }\n    }\n  };\n\n  // ---------------- API layer (mock or live) ----------------\n  function api(action, params){\n    params = params || {};\n    if (MOCK_MODE) return mockApi(action, params);\n    var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');\n    return fetch(SUITELET_URL + '&action=' + action + (q ? '&'+q : '')).then(function(r){ return r.json(); });\n  }\n\n  function mockApi(action, params){\n    return new Promise(function(resolve){\n      setTimeout(function(){\n        switch(action){\n          case 'itemSearch':\n            resolve([{id:'101', itemId:'PL041C', name:'Strep-Select Grouping', description:'Choice of 5 latex, controls, extraction reagents, sticks'}]);\n            break;\n          case 'inventoryDetail':\n            resolve({ byLocation: MOCK.warehouses, byLot: MOCK.lots });\n            break;\n          case 'vendorDetail': resolve(MOCK.vendors); break;\n          case 'salesHistory': resolve(MOCK.sales); break;\n          case 'itemTransactions': resolve(MOCK.txns); break;\n          case 'committedDrilldown': resolve(MOCK.committed); break;\n          case 'serialLotLookup': resolve(MOCK.serial); break;\n          case 'customerSearch':\n            resolve(Object.keys(MOCK.customers).filter(function(n){return n.toLowerCase().indexOf((params.q||'').toLowerCase())>-1;})\n              .map(function(n){ return {id:n, entityId: MOCK.customers[n].profile.entityId, name:n}; }));\n            break;\n          case 'customerDetail':\n            var c = MOCK.customers[params.customerId] || MOCK.customers['Meridian Diagnostics'];\n            resolve({ profile:c.profile, transactions:c.all, openOrders:c.open });\n            break;\n          default: resolve({});\n        }\n      }, 120);\n    });\n  }\n\n  // ---------------- Rendering helpers ----------------\n  function fmtNum(n){ n = Number(n)||0; return n.toLocaleString('en-US', {minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}); }\n  function fmtMoney(n){ return '$' + (Number(n)||0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }\n  function td(text, cls){ return '<td' + (cls?' class=\"'+cls+'\"':'') + '>' + text + '</td>'; }\n  function numCell(n){ var c = Number(n) < 0 ? 'num neg' : 'num'; return td(fmtNum(n), c); }\n\n  function expiryPill(dateStr){\n    if(!dateStr) return '<span class=\"mono\">\u2014</span>';\n    var d = new Date(dateStr);\n    var days = Math.round((d - new Date()) / 86400000);\n    var cls = 'ok', pct = 100;\n    if (days <= 0){ cls='critical'; pct=100; }\n    else if (days < 90){ cls='soon'; pct = Math.max(15, 100 - (days/90*100)); }\n    else { cls='ok'; pct = 30; }\n    var color = cls==='critical' ? 'var(--danger)' : (cls==='soon' ? 'var(--amber)' : 'var(--good)');\n    var label = days <= 0 ? 'Expired' : (days + 'd');\n    return '<span class=\"expiry-pill\"><span class=\"expiry-dot '+cls+'\"></span>' + dateStr +\n      ' <span class=\"expiry-bar\"><span style=\"width:'+pct+'%;background:'+color+'\"></span></span> ' +\n      '<span style=\"color:'+color+'\">' + label + '</span></span>';\n  }\n\n  function renderWarehouses(rows){\n    document.getElementById('warehouseRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b>'+r.location+'</b>') +\n        numCell(r.notPosted) + numCell(r.committed) + numCell(r.ios) +\n        numCell(r.orderQty) + numCell(r.onHand) + numCell(r.allocated) + numCell(r.available) + '</tr>';\n    }).join('') || '<tr><td colspan=\"8\" class=\"empty\">No warehouse data.</td></tr>';\n  }\n\n  function renderLots(rows){\n    document.getElementById('lotRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b class=\"mono\">'+r.lot+'</b>') + td(r.location) + td(expiryPill(r.expirationDate)) +\n        numCell(r.onHand) + numCell(r.committed) + numCell(r.available) + '</tr>';\n    }).join('') || '<tr><td colspan=\"6\" class=\"empty\">No lots on file for this item.</td></tr>';\n  }\n\n  function renderCommitted(rows){\n    document.getElementById('committedRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b>'+r.docNum+'</b>') + td(r.customer) + td(r.date) + numCell(r.qtyOrdered) + numCell(r.qtyCommitted) + '</tr>';\n    }).join('') || '<tr><td colspan=\"5\" class=\"empty\">Nothing currently committed.</td></tr>';\n  }\n\n  function renderVendors(rows){\n    document.getElementById('vendorRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b>'+r.vendor+'</b>') + td('<span class=\"mono\">'+r.vendorCode+'</span>') + td(r.currency) +\n        numCell(r.purchasePrice.toFixed ? fmtMoney(r.purchasePrice) : r.purchasePrice) +\n        td(r.preferred ? '<span class=\"badge open\">Preferred</span>' : '<span class=\"badge closed\">Alternate</span>') + '</tr>';\n    }).join('') || '<tr><td colspan=\"5\" class=\"empty\">No vendors on file.</td></tr>';\n  }\n\n  function renderSales(rows){\n    document.getElementById('salesRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td(r.date) + td('<b>'+r.docNum+'</b>') + td(r.type) + td(r.customer) +\n        numCell(r.qty) + numCell(fmtMoney(r.rate)) + numCell(fmtMoney(r.amount)) + '</tr>';\n    }).join('') || '<tr><td colspan=\"7\" class=\"empty\">No sales in this range.</td></tr>';\n  }\n\n  function renderTxns(rows){\n    document.getElementById('txnRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td(r.date) + td(r.type) + td('<b>'+r.docNum+'</b>') + td(r.entity) +\n        numCell(r.qty) + numCell(fmtMoney(r.amount)) + td(r.status) + '</tr>';\n    }).join('') || '<tr><td colspan=\"7\" class=\"empty\">No related transactions.</td></tr>';\n  }\n\n  function renderSerial(rows){\n    var card = document.getElementById('serialResultsCard');\n    card.style.display = 'block';\n    document.getElementById('serialRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b>'+r.fulfillmentNum+'</b>') + td(r.date) + td(r.customer) + td(r.item) + numCell(r.qty) + td(r.salesOrder) + '</tr>';\n    }).join('') || '<tr><td colspan=\"6\" class=\"empty\">No matches for that serial/lot number.</td></tr>';\n  }\n\n  function renderCustomer(data){\n    document.getElementById('customerDetailWrap').style.display = 'block';\n    document.getElementById('custName').textContent = data.profile.companyName || '\u2014';\n    document.getElementById('custId').textContent = data.profile.entityId || '\u2014';\n    document.getElementById('custPhone').textContent = data.profile.phone || '\u2014';\n    document.getElementById('custEmail').textContent = data.profile.email || '\u2014';\n    document.getElementById('custOpenRows').innerHTML = (data.openOrders||[]).map(function(r){\n      return '<tr>' + td('<b>'+r.docNum+'</b>') + td(r.item) + numCell(r.qty) + numCell(fmtMoney(r.amount)) +\n        td('<span class=\"badge open\">'+r.status+'</span>') + '</tr>';\n    }).join('') || '<tr><td colspan=\"5\" class=\"empty\">No open orders.</td></tr>';\n    document.getElementById('custAllRows').innerHTML = (data.transactions||[]).map(function(r){\n      return '<tr>' + td(r.date) + td(r.type) + td('<b>'+r.docNum+'</b>') + td(r.item) + numCell(r.qty) + numCell(fmtMoney(r.amount)) + td(r.status) + '</tr>';\n    }).join('') || '<tr><td colspan=\"7\" class=\"empty\">No transactions.</td></tr>';\n  }\n\n  // ---------------- Load / refresh ----------------\n  function loadItem(itemId){\n    state.itemId = itemId;\n    api('inventoryDetail', {itemId:itemId}).then(function(d){\n      renderWarehouses(d.byLocation||[]);\n      renderLots(d.byLot||[]);\n    });\n    api('vendorDetail', {itemId:itemId}).then(renderVendors);\n    api('salesHistory', {itemId:itemId}).then(renderSales);\n    api('itemTransactions', {itemId:itemId}).then(renderTxns);\n    api('committedDrilldown', {itemId:itemId}).then(renderCommitted);\n  }\n\n  function switchView(name){\n    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });\n    document.getElementById('view-'+name).classList.add('active');\n    document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.toggle('active', n.dataset.nav===name); });\n    var labels = {item:'Item Inquiry', serial:'Serial & Lot Lookup', customer:'Customer Inquiry'};\n    document.getElementById('contextPill').textContent = labels[name];\n  }\n\n  function switchTab(name){\n    document.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t.dataset.tab===name); });\n    document.querySelectorAll('.tab-view').forEach(function(t){ t.style.display = (t.dataset.tabview===name) ? 'block' : 'none'; });\n  }\n\n  // ---------------- Events ----------------\n  document.querySelectorAll('.nav-item').forEach(function(n){\n    n.addEventListener('click', function(){ switchView(n.dataset.nav); });\n  });\n  document.querySelectorAll('.tab').forEach(function(t){\n    t.addEventListener('click', function(){ switchTab(t.dataset.tab); });\n  });\n  document.querySelectorAll('.recent-item').forEach(function(n){\n    n.addEventListener('click', function(){ switchView('item'); loadItem(n.dataset.recent); });\n  });\n\n  var searchTimer;\n  document.getElementById('globalSearch').addEventListener('input', function(e){\n    var q = e.target.value;\n    clearTimeout(searchTimer);\n    if (!q){ document.getElementById('searchResults').classList.remove('open'); return; }\n    searchTimer = setTimeout(function(){\n      api('itemSearch', {q:q}).then(function(items){\n        var box = document.getElementById('searchResults');\n        box.innerHTML = items.map(function(it){\n          return '<div class=\"search-result\" data-item=\"'+it.itemId+'\"><span class=\"sid\">'+it.itemId+'</span><span class=\"sdesc\">'+(it.description||'')+'</span></div>';\n        }).join('') || '<div class=\"search-result\">No matches</div>';\n        box.classList.add('open');\n        box.querySelectorAll('[data-item]').forEach(function(el){\n          el.addEventListener('click', function(){\n            switchView('item'); loadItem(el.dataset.item);\n            box.classList.remove('open');\n            document.getElementById('globalSearch').value = el.dataset.item;\n          });\n        });\n      });\n    }, 200);\n  });\n\n  document.getElementById('serialLookupBtn').addEventListener('click', function(){\n    var v = document.getElementById('serialInput').value.trim();\n    if (!v) return;\n    api('serialLotLookup', {value:v}).then(renderSerial);\n  });\n\n  var custTimer;\n  document.getElementById('customerSearchInput').addEventListener('input', function(e){\n    var q = e.target.value;\n    clearTimeout(custTimer);\n    if (!q) return;\n    custTimer = setTimeout(function(){\n      api('customerSearch', {q:q}).then(function(list){\n        if (list.length){\n          state.customerId = list[0].id;\n          api('customerDetail', {customerId:list[0].id}).then(renderCustomer);\n        }\n      });\n    }, 250);\n  });\n\n  document.getElementById('salesFilterBtn').addEventListener('click', function(){\n    api('salesHistory', {itemId:state.itemId, from:document.getElementById('salesFrom').value, to:document.getElementById('salesTo').value}).then(renderSales);\n  });\n\n  document.querySelectorAll('[data-export]').forEach(function(btn){\n    btn.addEventListener('click', function(){\n      var view = btn.dataset.export;\n      if (MOCK_MODE){\n        alert('CSV export runs server-side once this is deployed as a Suitelet \u2014 this button will download \"' + view + '.csv\" directly from NetSuite.');\n        return;\n      }\n      var params = {view:view, itemId:state.itemId, customerId:state.customerId||''};\n      var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');\n      window.location = SUITELET_URL + '&action=export&' + q;\n    });\n  });\n\n  // ---------------- Init ----------------\n  loadItem(state.itemId);\n})();\n</script>\n</body>\n</html>\n";

    return { onRequest };
  });
