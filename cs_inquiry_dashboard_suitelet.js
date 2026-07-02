/**
 * cs_inquiry_dashboard_suitelet.js
 *
 * Customer Service Inquiry Dashboard
 * Replaces the legacy "SyAcc Inventory Inquiry" screen with a single
 * NetSuite page: a filterable, multi-select item list (by standard item
 * type) where clicking a row expands the full record inline — warehouse/lot
 * detail, vendor cost, sales history, related transactions — plus separate
 * Serial/Lot Lookup and Customer Inquiry views. Selected items can be
 * exported together as one combined summary CSV; any single grid can also
 * be exported on its own.
 *
 * Built for: Carole Millette / Kathy (Customer Service), role: Customer Service (custom)
 *
 * Built entirely on standard NetSuite fields — no custom fields or account-
 * specific saved searches required:
 *   - Item record: itemid, salesdescription, class, isinactive, price,
 *     costingmethod, stockunit, purchaseunit, reorderpoint,
 *     preferredstocklevel, created, subsidiary (OneWorld only, read
 *     defensively), itemvendor sublist
 *   - Item search (list view): itemid, salesdescription, type, class,
 *     isinactive, quantityonhand, quantityavailable (account-wide totals)
 *   - Item search (Location join, per-item detail): locationquantityonhand/
 *     committed/backordered/onorder/packed/picked/available
 *   - Inventory Number search: inventorynumber, expirationdate,
 *     quantityonhand/available/committed, location
 *   - Transaction search: standard body/line fields (trandate, tranid,
 *     entity, item, quantity, rate, amount, type, status, closed)
 *   - Item Fulfillment search: serialnumbers filter for serial/lot lookup
 *   - Customer record: entityid, companyname, phone, email
 *
 * One assumption carried over from the legacy system: the warehouse codes
 * (01, 02, 03…, ROCHE, RS02–RS07) are treated as NetSuite Locations. If this
 * account uses Bins instead, swap the "Location" join in getInventoryDetail
 * for a Bin-based search — everything else is unaffected.
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
          case 'itemList':
            return sendJson(response, searchItemList(request.parameters.q, request.parameters.type));
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

    // Item list (Item Inquiry landing table): filter by standard item type,
    // free-text on item ID/description, and roll up total quantity on hand
    // / available across all locations using the item's own aggregate
    // fields (quantityonhand / quantityavailable — standard, no location
    // join needed for a list view; the per-location breakdown is fetched
    // separately, only when a row is expanded).
    const ALL_ITEM_TYPES = [
      'InvtPart', 'LotNumberedInventoryItem', 'LotNumberedAssemblyItem',
      'SerializedInventoryItem', 'SerializedAssemblyItem', 'Assembly'
    ];
    const ITEM_TYPE_LABEL = {
      InvtPart: 'Inventory Item',
      LotNumberedInventoryItem: 'Lot Numbered Inventory Item',
      LotNumberedAssemblyItem: 'Lot Numbered Assembly Item',
      SerializedInventoryItem: 'Serialized Inventory Item',
      SerializedAssemblyItem: 'Serialized Assembly Item',
      Assembly: 'Assembly Item'
    };

    function searchItemList(q, type) {
      const filters = [['type', 'anyof', type ? [type] : ALL_ITEM_TYPES]];
      if (q) filters.push('AND', ['nameornumber', 'contains', q]);

      const s = search.create({
        type: search.Type.ITEM,
        filters,
        columns: [
          'itemid', 'salesdescription', 'type', 'class', 'isinactive',
          'quantityonhand', 'quantityavailable'
        ]
      });
      const out = [];
      s.run().each((r) => {
        const typeId = r.getValue('type');
        out.push({
          id: r.id,
          itemId: r.getValue('itemid'),
          description: r.getValue('salesdescription'),
          type: ITEM_TYPE_LABEL[typeId] || r.getText('type'),
          typeId,
          category: r.getText('class'),
          status: r.getValue('isinactive') ? 'Inactive' : 'Active',
          onHand: Number(r.getValue('quantityonhand')) || 0,
          available: Number(r.getValue('quantityavailable')) || 0
        });
        return out.length < 200;
      });
      return out;
    }

    // Maps the standard NetSuite item "type" search value to the matching
    // record.Type, so we always load the item as the correct record type
    // instead of guessing.
    // Built lazily (inside a function, not at module top level) because
    // SuiteScript API modules — including reading N/record's Type constants
    // — are only available once an entry point (onRequest) is executing,
    // not while the define() callback itself is being evaluated.
    function getItemTypeMap() {
      return {
        InvtPart: record.Type.INVENTORY_ITEM,
        LotNumberedInventoryItem: record.Type.LOT_NUMBERED_INVENTORY_ITEM,
        LotNumberedAssemblyItem: record.Type.LOT_NUMBERED_ASSEMBLY_ITEM,
        SerializedInventoryItem: record.Type.SERIALIZED_INVENTORY_ITEM,
        SerializedAssemblyItem: record.Type.SERIALIZED_ASSEMBLY_ITEM,
        Assembly: record.Type.ASSEMBLY_ITEM
      };
    }
    const TRACKING_LABEL = {
      InvtPart: 'None',
      LotNumberedInventoryItem: 'Lot Numbered',
      LotNumberedAssemblyItem: 'Lot Numbered',
      SerializedInventoryItem: 'Serialized',
      SerializedAssemblyItem: 'Serialized',
      Assembly: 'None'
    };

    function resolveItemRecordType(itemId) {
      const fields = search.lookupFields({ type: search.Type.ITEM, id: itemId, columns: ['type'] });
      const typeId = fields.type && fields.type[0] && fields.type[0].value;
      return { typeId, recordType: getItemTypeMap()[typeId] || record.Type.INVENTORY_ITEM };
    }

    // Item header: description, category, price, status, costing method, UOM.
    // All standard NetSuite item fields.
    function getItemDetail(itemId) {
      if (!itemId) return {};
      const { typeId, recordType } = resolveItemRecordType(itemId);
      const rec = record.load({ type: recordType, id: itemId, isDynamic: false });

      let price = rec.getValue('price');
      if (!price) {
        try { price = rec.getSublistValue({ sublist: 'price1', fieldId: 'price_1_', line: 0 }); } catch (e) { /* no price level */ }
      }

      // Subsidiary only exists on OneWorld accounts — read defensively so
      // this never breaks a single-subsidiary account.
      let subsidiary = '';
      try { subsidiary = rec.getText('subsidiary') || ''; } catch (e) { /* not OneWorld */ }

      return {
        internalId: itemId,
        itemId: rec.getValue('itemid'),
        description: rec.getValue('salesdescription'),
        category: rec.getText('class'),
        status: rec.getValue('isinactive') ? 'Inactive' : 'Active',
        price,
        costingMethod: rec.getText('costingmethod'),
        stockUnit: rec.getText('stockunit'),
        purchaseUnit: rec.getText('purchaseunit'),
        reorderPoint: rec.getValue('reorderpoint'),
        preferredStockLevel: rec.getValue('preferredstocklevel'),
        created: rec.getValue('created'),
        subsidiary,
        trackingMethod: TRACKING_LABEL[typeId] || 'None'
      };
    }

    // Warehouse/lot grid. Columns are the standard NetSuite item-location
    // quantity fields (search.Type.ITEM, "Location" join): On Hand,
    // Committed, Back Ordered, On Order, Packed, Picked, Available — the
    // closest one-to-one match for the legacy inquiry's warehouse grid.
    function getInventoryDetail(itemId) {
      if (!itemId) return { byLocation: [], byLot: [] };

      const s = search.create({
        type: search.Type.ITEM,
        filters: [['internalid', 'anyof', itemId]],
        columns: [
          'locationquantityonhand',
          'locationquantitycommitted',
          'locationquantitybackordered',
          'locationquantityonorder',
          'locationquantitypacked',
          'locationquantitypicked',
          'locationquantityavailable',
          'inventorylocation'
        ]
      });
      const rows = [];
      s.run().each((r) => {
        rows.push({
          location: r.getText('inventorylocation') || r.getValue('inventorylocation'),
          onHand: Number(r.getValue('locationquantityonhand')) || 0,
          committed: Number(r.getValue('locationquantitycommitted')) || 0,
          backOrdered: Number(r.getValue('locationquantitybackordered')) || 0,
          onOrder: Number(r.getValue('locationquantityonorder')) || 0,
          packed: Number(r.getValue('locationquantitypacked')) || 0,
          picked: Number(r.getValue('locationquantitypicked')) || 0,
          available: Number(r.getValue('locationquantityavailable')) || 0
        });
        return true;
      });

      // Lot-level detail: standard Inventory Number search
      // (search.Type.INVENTORY_NUMBER) — number, expiration, quantities, location.
      const lotSearch = search.create({
        type: search.Type.INVENTORY_NUMBER,
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

    // Preferred vendor(s), vendor code, cost, currency, alternate vendor —
    // all from the standard "Item Vendor" sublist (Purchasing subtab).
    function getVendorDetail(itemId) {
      if (!itemId) return [];
      const { recordType } = resolveItemRecordType(itemId);
      const rec = record.load({ type: recordType, id: itemId });
      const count = rec.getLineCount({ sublist: 'itemvendor' });
      const vendors = [];
      for (let i = 0; i < count; i++) {
        vendors.push({
          vendor: rec.getSublistText({ sublist: 'itemvendor', fieldId: 'vendor', line: i }),
          vendorCode: rec.getSublistValue({ sublist: 'itemvendor', fieldId: 'vendorcode', line: i }),
          purchasePrice: rec.getSublistValue({ sublist: 'itemvendor', fieldId: 'purchaseprice', line: i }),
          currency: rec.getSublistText({ sublist: 'itemvendor', fieldId: 'currency', line: i }),
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

    // Drill-down: which open sales order lines make up the "Committed"
    // quantity. Uses the standard line-level "Closed" checkbox rather than
    // guessing at status internal IDs — reliable across any account.
    function getCommittedSalesOrders(itemId) {
      if (!itemId) return [];
      const s = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ['item', 'anyof', itemId],
          'AND', ['mainline', 'is', 'F'],
          'AND', ['type', 'anyof', 'SalesOrd'],
          'AND', ['closed', 'is', 'F']
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

    // Serial or lot number -> which customer/order it was issued against.
    // Uses the standard "Serial/Lot Numbers" filter (serialnumbers) on
    // Item Fulfillment, which matches against the inventory detail issued
    // on that fulfillment's lines.
    function serialLotLookup(value) {
      if (!value) return [];
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

      // Open orders: same standard "Closed" line flag used in
      // getCommittedSalesOrders, queried directly rather than string-matching
      // the status label.
      const openSearch = search.create({
        type: search.Type.TRANSACTION,
        filters: [
          ['entity', 'anyof', customerId],
          'AND', ['mainline', 'is', 'F'],
          'AND', ['type', 'anyof', 'SalesOrd'],
          'AND', ['closed', 'is', 'F']
        ],
        columns: ['tranid', 'item', 'quantity', 'amount', 'status']
      });
      const openOrders = [];
      openSearch.run().each((r) => {
        openOrders.push({
          docNum: r.getValue('tranid'),
          item: r.getText('item'),
          qty: r.getValue('quantity'),
          amount: r.getValue('amount'),
          status: r.getText('status')
        });
        return true;
      });

      return { profile, transactions, openOrders };
    }

    // Combined summary row for one item — used by the multi-item export
    // when the user checks several rows in the Item Inquiry list and clicks
    // "Export selected". Rolls up quantities across all locations and pulls
    // the preferred vendor's cost, all from standard fields already used
    // elsewhere in this script.
    function getItemSummary(itemId) {
      const detail = getItemDetail(itemId);
      const inv = getInventoryDetail(itemId);
      const totals = inv.byLocation.reduce((acc, r) => {
        acc.onHand += r.onHand;
        acc.committed += r.committed;
        acc.available += r.available;
        acc.onOrder += r.onOrder;
        return acc;
      }, { onHand: 0, committed: 0, available: 0, onOrder: 0 });

      const vendors = getVendorDetail(itemId);
      const preferred = vendors.find((v) => v.preferred) || vendors[0] || {};

      return {
        itemId: detail.itemId,
        description: detail.description,
        category: detail.category,
        status: detail.status,
        price: detail.price,
        totalOnHand: totals.onHand,
        totalCommitted: totals.committed,
        totalAvailable: totals.available,
        totalOnOrder: totals.onOrder,
        preferredVendor: preferred.vendor || '',
        preferredVendorCost: preferred.purchasePrice || ''
      };
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
      } else if (view === 'multiItemSummary') {
        const ids = (params.itemIds || '').split(',').map((s) => s.trim()).filter(Boolean);
        rows = ids.map(getItemSummary);
        headers = [
          'itemId', 'description', 'category', 'status', 'price',
          'totalOnHand', 'totalCommitted', 'totalAvailable', 'totalOnOrder',
          'preferredVendor', 'preferredVendorCost'
        ];
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

    var PAGE_HTML = "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>CS Inquiry \u2014 Item &amp; Customer Dashboard</title>\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link href=\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap\" rel=\"stylesheet\">\n<style>\n  :root{\n    --bg:#F2F6F5;\n    --surface:#FFFFFF;\n    --ink:#122523;\n    --muted:#5C7472;\n    --line:#DCE6E3;\n    --teal:#0E6E62;\n    --teal-dark:#0A4F46;\n    --teal-tint:#E4F1EE;\n    --amber:#C97A2E;\n    --amber-tint:#FBF0E2;\n    --danger:#B23B3B;\n    --danger-tint:#FBEAEA;\n    --good:#2E8B57;\n    --radius:10px;\n    --shadow:0 1px 2px rgba(18,37,35,.06), 0 8px 24px rgba(18,37,35,.05);\n    font-size:15px;\n  }\n  *{box-sizing:border-box;}\n  html,body{margin:0;padding:0;}\n  body{\n    background:var(--bg);\n    color:var(--ink);\n    font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;\n    -webkit-font-smoothing:antialiased;\n  }\n  .app{ display:grid; grid-template-columns:248px 1fr; min-height:100vh; }\n  .mono{ font-family:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace; font-variant-numeric:tabular-nums; }\n  .display{ font-family:'Space Grotesk',sans-serif; }\n\n  /* ---------- Sidebar ---------- */\n  .sidebar{\n    background:var(--teal-dark);\n    color:#EAF4F2;\n    padding:20px 16px 16px;\n    display:flex; flex-direction:column; gap:22px;\n    position:sticky; top:0; height:100vh;\n  }\n  .brand{ display:flex; align-items:center; gap:10px; }\n  .brand-mark{\n    width:30px;height:30px;border-radius:8px;\n    background:linear-gradient(135deg,#28A794,#0E6E62);\n    display:flex;align-items:center;justify-content:center;\n    font-family:'Space Grotesk',sans-serif; font-weight:700; color:#fff; font-size:14px;\n  }\n  .brand-text .t1{ font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:15px; line-height:1.1; }\n  .brand-text .t2{ font-size:11px; color:#9FC4BC; letter-spacing:.02em; }\n\n  .nav{ display:flex; flex-direction:column; gap:2px; }\n  .nav-label{ font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#7FADA4; margin:10px 4px 4px; }\n  .nav-item{\n    display:flex; align-items:center; gap:10px;\n    padding:9px 10px; border-radius:8px; cursor:pointer;\n    color:#D9EEEA; font-size:13.5px; font-weight:500;\n    border:1px solid transparent;\n  }\n  .nav-item:hover{ background:rgba(255,255,255,.06); }\n  .nav-item.active{ background:rgba(255,255,255,.12); border-color:rgba(255,255,255,.14); color:#fff; }\n  .nav-item .dot{ width:6px;height:6px;border-radius:50%; background:#5FC9B4; flex:none; }\n\n  .recent{ margin-top:auto; }\n  .recent-item{\n    font-size:12px; color:#B9DAD3; padding:6px 4px; border-radius:6px; cursor:pointer;\n    display:flex; justify-content:space-between; gap:6px;\n  }\n  .recent-item:hover{ background:rgba(255,255,255,.06); color:#fff; }\n  .user-chip{\n    display:flex; align-items:center; gap:9px; padding-top:14px; border-top:1px solid rgba(255,255,255,.12);\n  }\n  .avatar{ width:26px;height:26px;border-radius:50%; background:#5FC9B4; color:#08322C; font-weight:700; font-size:11px; display:flex;align-items:center;justify-content:center; }\n  .user-chip .name{ font-size:12.5px; font-weight:600; }\n  .user-chip .role{ font-size:11px; color:#9FC4BC; }\n\n  /* ---------- Main ---------- */\n  .main{ padding:22px 28px 40px; max-width:1320px; }\n  .topbar{ display:flex; align-items:center; gap:14px; margin-bottom:18px; }\n  .search-wrap{ position:relative; flex:1; max-width:520px; }\n  .search-wrap input{\n    width:100%; padding:11px 14px 11px 38px; border-radius:10px; border:1px solid var(--line);\n    background:var(--surface); font-size:14px; color:var(--ink); outline:none;\n    box-shadow:var(--shadow);\n  }\n  .search-wrap input:focus{ border-color:var(--teal); }\n  .search-wrap svg{ position:absolute; left:12px; top:50%; transform:translateY(-50%); }\n  .search-results{\n    position:absolute; top:calc(100% + 6px); left:0; right:0; background:var(--surface);\n    border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); overflow:hidden; z-index:20;\n    display:none;\n  }\n  .search-results.open{ display:block; }\n  .search-result{ padding:9px 14px; font-size:13px; cursor:pointer; display:flex; justify-content:space-between; gap:10px; }\n  .search-result:hover{ background:var(--teal-tint); }\n  .search-result .sid{ font-weight:600; }\n  .search-result .sdesc{ color:var(--muted); font-size:12px; }\n\n  .topbar-spacer{ flex:1; }\n  .pill{\n    font-size:11.5px; padding:5px 10px; border-radius:999px; background:var(--teal-tint); color:var(--teal-dark);\n    font-weight:600; letter-spacing:.01em;\n  }\n\n  h1.page-title{ font-family:'Space Grotesk',sans-serif; font-size:22px; margin:2px 0 2px; font-weight:600; }\n  .page-sub{ color:var(--muted); font-size:13px; margin-bottom:18px; }\n\n  .card{\n    background:var(--surface); border:1px solid var(--line); border-radius:var(--radius);\n    box-shadow:var(--shadow); padding:18px 18px 8px; margin-bottom:18px;\n  }\n  .card-head{ display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }\n  .card-head h2{ font-family:'Space Grotesk',sans-serif; font-size:15px; margin:0; font-weight:600; }\n  .card-head .actions{ display:flex; gap:8px; }\n  .btn{\n    font-size:12.5px; font-weight:600; padding:7px 12px; border-radius:7px; cursor:pointer;\n    border:1px solid var(--line); background:#fff; color:var(--ink); display:inline-flex; align-items:center; gap:6px;\n  }\n  .btn:hover{ border-color:var(--teal); color:var(--teal-dark); }\n  .btn.primary{ background:var(--teal); color:#fff; border-color:var(--teal); }\n  .btn.primary:hover{ background:var(--teal-dark); }\n\n  .item-header{ display:grid; grid-template-columns:1.4fr 1fr 1fr; gap:24px; }\n  .kv{ display:flex; flex-direction:column; gap:10px; }\n  .kv-row{ display:flex; justify-content:space-between; gap:10px; font-size:13px; padding:6px 0; border-bottom:1px dashed var(--line); }\n  .kv-row .k{ color:var(--muted); }\n  .kv-row .v{ font-weight:600; text-align:right; }\n  .price-tile{\n    background:var(--teal-tint); border-radius:8px; padding:12px 14px; margin-top:2px;\n  }\n  .price-tile .amt{ font-family:'Space Grotesk',sans-serif; font-size:26px; font-weight:700; color:var(--teal-dark); }\n  .price-tile .lbl{ font-size:11.5px; color:var(--teal-dark); opacity:.75; text-transform:uppercase; letter-spacing:.06em; }\n\n  table{ width:100%; border-collapse:collapse; font-size:13px; }\n  thead th{\n    text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted);\n    padding:8px 10px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--surface);\n  }\n  tbody td{ padding:9px 10px; border-bottom:1px solid #EEF3F2; }\n  tbody tr:hover{ background:#F7FAF9; }\n  tbody tr.clickable{ cursor:pointer; }\n  tbody tr.open-row{ background:var(--teal-tint); }\n  .num{ text-align:right; font-family:'IBM Plex Mono',monospace; }\n  .neg{ color:var(--danger); }\n\n  .expiry-pill{ display:inline-flex; align-items:center; gap:6px; font-family:'IBM Plex Mono',monospace; font-size:12px; }\n  .expiry-dot{ width:8px; height:8px; border-radius:50%; flex:none; }\n  .expiry-dot.ok{ background:var(--good); }\n  .expiry-dot.soon{ background:var(--amber); }\n  .expiry-dot.critical{ background:var(--danger); }\n  .expiry-bar{ width:54px; height:4px; border-radius:3px; background:#E4ECEA; overflow:hidden; }\n  .expiry-bar > span{ display:block; height:100%; border-radius:3px; }\n\n  .tabs{ display:flex; gap:4px; border-bottom:1px solid var(--line); margin-bottom:16px; }\n  .tab{ padding:9px 4px; margin-right:18px; font-size:13.5px; font-weight:600; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; }\n  .tab.active{ color:var(--teal-dark); border-bottom-color:var(--teal); }\n\n  .view{ display:none; }\n  .view.active{ display:block; }\n\n  .filter-row{ display:flex; gap:10px; align-items:center; margin-bottom:2px; flex-wrap:wrap; }\n  .filter-row label{ font-size:12px; color:var(--muted); }\n  .filter-row input[type=date]{ padding:6px 8px; border-radius:6px; border:1px solid var(--line); font-size:12.5px; }\n\n  .empty{ padding:34px 10px; text-align:center; color:var(--muted); font-size:13px; }\n  .badge{ font-size:11px; padding:3px 8px; border-radius:999px; font-weight:600; }\n  .badge.open{ background:var(--amber-tint); color:var(--amber); }\n  .badge.closed{ background:#EEF3F2; color:var(--muted); }\n\n  .mock-banner{\n    background:#111; color:#fff; font-size:12px; padding:7px 14px; text-align:center;\n    font-family:'IBM Plex Mono',monospace; letter-spacing:.02em;\n  }\n  .mock-banner b{ color:#5FC9B4; }\n\n  @media (max-width: 900px){\n    .app{ grid-template-columns:1fr; }\n    .sidebar{ position:relative; height:auto; }\n    .item-header{ grid-template-columns:1fr; }\n  }\n</style>\n</head>\n<body>\n\n<div class=\"mock-banner\" id=\"mockBanner\" style=\"display:none;\">\n  <b>PREVIEW MODE</b> \u2014 showing sample data (PL041C) so you can review layout &amp; interactions before this is wired to a live NetSuite account.\n</div>\n\n<div class=\"app\">\n  <aside class=\"sidebar\">\n    <div class=\"brand\">\n      <div class=\"brand-mark\">CS</div>\n      <div class=\"brand-text\">\n        <div class=\"t1\">CS Inquiry</div>\n        <div class=\"t2\">Customer Service Dashboard</div>\n      </div>\n    </div>\n\n    <div class=\"nav\">\n      <div class=\"nav-label\">Lookup</div>\n      <div class=\"nav-item active\" data-nav=\"item\"><span class=\"dot\"></span>Item &amp; Inventory</div>\n      <div class=\"nav-item\" data-nav=\"serial\"><span class=\"dot\"></span>Serial &amp; Lot Lookup</div>\n      <div class=\"nav-item\" data-nav=\"customer\"><span class=\"dot\"></span>Customer Inquiry</div>\n    </div>\n\n    <div class=\"recent\">\n      <div class=\"nav-label\">Recent Items</div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>PL041C</span><span class=\"mono\">Strep-Select</span></div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>HB210</span><span class=\"mono\">HbA1c Kit</span></div>\n      <div class=\"recent-item\" data-recent=\"PL041C\"><span>PL041C</span><span class=\"mono\">RSV Panel</span></div>\n    </div>\n\n    <div class=\"user-chip\">\n      <div class=\"avatar\">CM</div>\n      <div>\n        <div class=\"name\">Carole Millette</div>\n        <div class=\"role\">Customer Service</div>\n      </div>\n    </div>\n  </aside>\n\n  <main class=\"main\">\n    <div class=\"topbar\">\n      <div class=\"search-wrap\">\n        <svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#5C7472\" stroke-width=\"2\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><line x1=\"21\" y1=\"21\" x2=\"16.65\" y2=\"16.65\"/></svg>\n        <input id=\"globalSearch\" placeholder=\"Search item, part ID, or customer\u2026 (press Enter)\" autocomplete=\"off\">\n      </div>\n      <div class=\"topbar-spacer\"></div>\n      <span class=\"pill\" id=\"contextPill\">Item Inquiry</span>\n    </div>\n\n    <!-- ============ ITEM & INVENTORY VIEW ============ -->\n    <section class=\"view active\" id=\"view-item\">\n      <h1 class=\"page-title\">Item Inquiry</h1>\n      <div class=\"page-sub\">Search items, filter by type, then click a row to open the full record. Select more than one to export a combined summary.</div>\n\n      <div class=\"card\">\n        <div class=\"filter-row\">\n          <select id=\"itemTypeFilter\" style=\"padding:9px 10px;border-radius:8px;border:1px solid var(--line);font-size:13px;\">\n            <option value=\"\">All item types</option>\n            <option value=\"InvtPart\">Inventory Item</option>\n            <option value=\"LotNumberedInventoryItem\">Lot Numbered Inventory Item</option>\n            <option value=\"SerializedInventoryItem\">Serialized Inventory Item</option>\n            <option value=\"Assembly\">Assembly Item</option>\n            <option value=\"LotNumberedAssemblyItem\">Lot Numbered Assembly Item</option>\n            <option value=\"SerializedAssemblyItem\">Serialized Assembly Item</option>\n          </select>\n          <input id=\"itemListSearchInput\" placeholder=\"Search item ID or description\u2026\" style=\"flex:1;min-width:220px;padding:9px 12px;border-radius:8px;border:1px solid var(--line);\">\n          <button class=\"btn primary\" id=\"itemListSearchBtn\">Search</button>\n        </div>\n      </div>\n\n      <div class=\"card\">\n        <div class=\"card-head\">\n          <h2>Results</h2>\n          <div class=\"actions\">\n            <span class=\"pill\" id=\"selectedCountPill\" style=\"display:none;\">0 selected</span>\n            <button class=\"btn\" id=\"exportSelectedBtn\" disabled>Export selected (CSV)</button>\n          </div>\n        </div>\n        <table>\n          <thead><tr>\n            <th style=\"width:26px;\"><input type=\"checkbox\" id=\"selectAllItems\"></th>\n            <th>Item ID</th><th>Description</th><th>Type</th><th>Category</th><th>Status</th>\n            <th class=\"num\">On Hand</th><th class=\"num\">Available</th>\n          </tr></thead>\n          <tbody id=\"itemListRows\"></tbody>\n        </table>\n      </div>\n    </section>\n\n    <!-- Accordion detail template \u2014 cloned into the results table via JS\n         when a row is clicked. Kept out-of-flow here so its markup only\n         needs to be written once. -->\n    <template id=\"itemAccordionTemplate\">\n      <div class=\"card\" style=\"margin-top:2px;\">\n        <div class=\"item-header\">\n          <div class=\"kv\">\n            <div class=\"kv-row\"><span class=\"k\">Description</span><span class=\"v\" data-f=\"description\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Category</span><span class=\"v\" data-f=\"category\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Tracking method</span><span class=\"v\" data-f=\"trackingMethod\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Costing method</span><span class=\"v\" data-f=\"costingMethod\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Subsidiary</span><span class=\"v\" data-f=\"subsidiary\">\u2014</span></div>\n          </div>\n          <div class=\"kv\">\n            <div class=\"kv-row\"><span class=\"k\">Status</span><span class=\"v\" data-f=\"status\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Stock unit</span><span class=\"v\" data-f=\"stockUnit\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Purchase unit</span><span class=\"v\" data-f=\"purchaseUnit\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Reorder point</span><span class=\"v\" data-f=\"reorderPoint\">\u2014</span></div>\n            <div class=\"kv-row\"><span class=\"k\">Preferred stock level</span><span class=\"v\" data-f=\"preferredStockLevel\">\u2014</span></div>\n          </div>\n          <div class=\"price-tile\">\n            <div class=\"lbl\">List price</div>\n            <div class=\"amt\" data-f=\"price\">\u2014</div>\n          </div>\n        </div>\n      </div>\n\n      <div class=\"tabs\">\n        <div class=\"tab active\" data-tab=\"warehouse\">Warehouse &amp; Lots</div>\n        <div class=\"tab\" data-tab=\"vendors\">Vendors &amp; Cost</div>\n        <div class=\"tab\" data-tab=\"sales\">Sales History</div>\n        <div class=\"tab\" data-tab=\"txns\">Transactions</div>\n      </div>\n\n      <div class=\"tab-view active\" data-tabview=\"warehouse\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Inventory by location</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"inventoryByLot\">Export CSV</button></div>\n          </div>\n          <table>\n            <thead><tr>\n              <th>Location</th><th class=\"num\">On Hand</th><th class=\"num\">Committed</th><th class=\"num\">Back Ordered</th>\n              <th class=\"num\">On Order</th><th class=\"num\">Packed</th><th class=\"num\">Picked</th><th class=\"num\">Available</th>\n            </tr></thead>\n            <tbody data-role=\"warehouseRows\"></tbody>\n          </table>\n        </div>\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Lot detail &amp; expiration</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"inventoryByLot\">Export CSV</button></div>\n          </div>\n          <table>\n            <thead><tr><th>Lot #</th><th>Location</th><th>Expiration</th><th class=\"num\">On Hand</th><th class=\"num\">Committed</th><th class=\"num\">Available</th></tr></thead>\n            <tbody data-role=\"lotRows\"></tbody>\n          </table>\n        </div>\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Committed against \u2014 open sales orders</h2></div>\n          <table>\n            <thead><tr><th>SO #</th><th>Customer</th><th>Date</th><th class=\"num\">Qty Ordered</th><th class=\"num\">Qty Committed</th></tr></thead>\n            <tbody data-role=\"committedRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <div class=\"tab-view\" data-tabview=\"vendors\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Preferred &amp; alternate vendors</h2></div>\n          <table>\n            <thead><tr><th>Vendor</th><th>Vendor code</th><th>Currency</th><th class=\"num\">Cost</th><th>Preferred</th></tr></thead>\n            <tbody data-role=\"vendorRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <div class=\"tab-view\" data-tabview=\"sales\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Sales history by customer</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"salesHistory\">Export CSV</button></div>\n          </div>\n          <div class=\"filter-row\" style=\"margin-bottom:12px;\">\n            <label>From</label><input type=\"date\" data-role=\"salesFrom\">\n            <label>To</label><input type=\"date\" data-role=\"salesTo\">\n            <button class=\"btn\" data-role=\"salesFilterBtn\">Apply</button>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Doc #</th><th>Type</th><th>Customer</th><th class=\"num\">Qty</th><th class=\"num\">Rate</th><th class=\"num\">Amount</th></tr></thead>\n            <tbody data-role=\"salesRows\"></tbody>\n          </table>\n        </div>\n      </div>\n\n      <div class=\"tab-view\" data-tabview=\"txns\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>Related transactions</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"itemTransactions\">Export CSV</button></div>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Type</th><th>Doc #</th><th>Entity</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody data-role=\"txnRows\"></tbody>\n          </table>\n        </div>\n      </div>\n    </template>\n\n    <!-- ============ SERIAL & LOT LOOKUP ============ -->\n    <section class=\"view\" id=\"view-serial\">\n      <h1 class=\"page-title\">Serial &amp; Lot Lookup</h1>\n      <div class=\"page-sub\">Find out which customer, sales order, and fulfillment a serial or lot number went to.</div>\n      <div class=\"card\">\n        <div class=\"filter-row\">\n          <input id=\"serialInput\" placeholder=\"Enter serial or lot number\u2026\" style=\"flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--line);\">\n          <button class=\"btn primary\" id=\"serialLookupBtn\">Look up</button>\n        </div>\n      </div>\n      <div class=\"card\" id=\"serialResultsCard\" style=\"display:none;\">\n        <div class=\"card-head\"><h2>Results</h2></div>\n        <table>\n          <thead><tr><th>Fulfillment #</th><th>Date</th><th>Customer</th><th>Item</th><th class=\"num\">Qty</th><th>Sales Order</th></tr></thead>\n          <tbody id=\"serialRows\"></tbody>\n        </table>\n      </div>\n    </section>\n\n    <!-- ============ CUSTOMER INQUIRY ============ -->\n    <section class=\"view\" id=\"view-customer\">\n      <h1 class=\"page-title\">Customer Inquiry</h1>\n      <div class=\"page-sub\">Search a customer to see everything they've purchased, invoice numbers, and open orders.</div>\n      <div class=\"card\">\n        <div class=\"filter-row\">\n          <input id=\"customerSearchInput\" placeholder=\"Search customer name\u2026\" style=\"flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--line);\">\n        </div>\n      </div>\n\n      <div id=\"customerDetailWrap\" style=\"display:none;\">\n        <div class=\"card\">\n          <div class=\"item-header\" style=\"grid-template-columns:1fr 1fr;\">\n            <div class=\"kv\">\n              <div class=\"kv-row\"><span class=\"k\">Customer</span><span class=\"v\" id=\"custName\">\u2014</span></div>\n              <div class=\"kv-row\"><span class=\"k\">Account #</span><span class=\"v\" id=\"custId\">\u2014</span></div>\n            </div>\n            <div class=\"kv\">\n              <div class=\"kv-row\"><span class=\"k\">Phone</span><span class=\"v\" id=\"custPhone\">\u2014</span></div>\n              <div class=\"kv-row\"><span class=\"k\">Email</span><span class=\"v\" id=\"custEmail\">\u2014</span></div>\n            </div>\n          </div>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\"><h2>Open orders</h2></div>\n          <table>\n            <thead><tr><th>SO #</th><th>Item</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody id=\"custOpenRows\"></tbody>\n          </table>\n        </div>\n\n        <div class=\"card\">\n          <div class=\"card-head\">\n            <h2>All transactions</h2>\n            <div class=\"actions\"><button class=\"btn\" data-export=\"customerTransactions\">Export CSV</button></div>\n          </div>\n          <table>\n            <thead><tr><th>Date</th><th>Type</th><th>Doc #</th><th>Item</th><th class=\"num\">Qty</th><th class=\"num\">Amount</th><th>Status</th></tr></thead>\n            <tbody id=\"custAllRows\"></tbody>\n          </table>\n        </div>\n      </div>\n    </section>\n\n  </main>\n</div>\n\n<script>\n(function(){\n  \"use strict\";\n  var SUITELET_URL = \"__SUITELET_URL__\";\n  var MOCK_MODE = (SUITELET_URL.indexOf(\"__SUITELET_URL__\") !== -1 || SUITELET_URL === \"\");\n  if (MOCK_MODE) document.getElementById('mockBanner').style.display = 'block';\n\n  var state = { customerId: null, openItemId: null, selected: {} };\n\n  // ---------------- Mock data (mirrors the legacy screen 1:1 for PL041C, plus a couple more items so the list/multi-select has something to show) ----------------\n  var ITEM_CATALOG = [\n    {id:'101', itemId:'PL041C', description:'Strep-Select Grouping \u2014 choice of 5 latex, controls, extraction reagents, sticks', type:'Lot Numbered Inventory Item', typeId:'LotNumberedInventoryItem', category:'1034', status:'Active', onHand:155, available:148},\n    {id:'102', itemId:'HB210', description:'HbA1c Rapid Test Kit, 25/box', type:'Lot Numbered Inventory Item', typeId:'LotNumberedInventoryItem', category:'1041', status:'Active', onHand:210, available:190},\n    {id:'103', itemId:'RSV-882', description:'RSV Antigen Panel, single-use cassette', type:'Serialized Inventory Item', typeId:'SerializedInventoryItem', category:'1052', status:'Active', onHand:64, available:58},\n    {id:'104', itemId:'CTL-004', description:'Multi-Analyte Control Set, level 1-3', type:'Inventory Item', typeId:'InvtPart', category:'1090', status:'Active', onHand:32, available:32}\n  ];\n\n  var MOCK = {\n    itemDetail: {\n      description:'Strep-Select Grouping \u2014 choice of 5 latex, controls, extraction reagents, sticks',\n      category:'1034', trackingMethod:'Lot Numbered', costingMethod:'Average', subsidiary:'Primary (US/CA)',\n      status:'Active', stockUnit:'EA', purchaseUnit:'EA', reorderPoint:40, preferredStockLevel:120, price:554.00\n    },\n    warehouses: [\n      {location:'01', onHand:155.0, committed:1.0, backOrdered:-6.0, onOrder:70.0, packed:0.0, picked:0.0, available:148.0},\n      {location:'02', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'03', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'04', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'05', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'07', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'13', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'ROCHE', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'RS02', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'RS03', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'RS04', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'RS05', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0},\n      {location:'RS07', onHand:0,committed:0,backOrdered:0,onOrder:0,packed:0,picked:0,available:0}\n    ],\n    lots: [\n      {lot:'LN-24118', location:'01', expirationDate:'2026-08-15', onHand:62, committed:1, available:61},\n      {lot:'LN-24142', location:'01', expirationDate:'2026-11-02', onHand:53, committed:0, available:53},\n      {lot:'LN-25009', location:'01', expirationDate:'2027-02-20', onHand:40, committed:0, available:40}\n    ],\n    committed: [\n      {docNum:'SO-10432', customer:'Meridian Diagnostics', date:'2026-06-24', qtyOrdered:1, qtyCommitted:1}\n    ],\n    vendors: [\n      {vendor:'Hycor Biomedical', vendorCode:'HYC-PL041', currency:'USD', purchasePrice:212.50, preferred:true},\n      {vendor:'Hycor Biomedical (CA)', vendorCode:'HYC-PL041-CA', currency:'CAD', purchasePrice:289.10, preferred:false},\n      {vendor:'Meridian Life Science', vendorCode:'MLS-7741', currency:'USD', purchasePrice:219.00, preferred:false}\n    ],\n    sales: [\n      {date:'2026-06-24', docNum:'SO-10432', type:'Sales Order', customer:'Meridian Diagnostics', qty:1, rate:554.00, amount:554.00},\n      {date:'2026-05-11', docNum:'INV-9981', type:'Invoice', customer:'Northshore Labs', qty:3, rate:554.00, amount:1662.00},\n      {date:'2026-04-02', docNum:'INV-9820', type:'Invoice', customer:'Valley Clinical Partners', qty:2, rate:554.00, amount:1108.00},\n      {date:'2026-02-18', docNum:'INV-9601', type:'Invoice', customer:'Meridian Diagnostics', qty:5, rate:540.00, amount:2700.00}\n    ],\n    txns: [\n      {date:'2026-06-24', type:'Sales Order', docNum:'SO-10432', entity:'Meridian Diagnostics', qty:1, amount:554.00, status:'Pending Fulfillment'},\n      {date:'2026-06-02', type:'Purchase Order', docNum:'PO-5521', entity:'Hycor Biomedical', qty:60, amount:12750.00, status:'Partially Received'},\n      {date:'2026-05-11', type:'Item Fulfillment', docNum:'IF-8834', entity:'Northshore Labs', qty:3, amount:0, status:'Shipped'},\n      {date:'2026-04-02', type:'Item Receipt', docNum:'IR-4410', entity:'Hycor Biomedical', qty:50, amount:10625.00, status:'Received'}\n    ],\n    serial: [\n      {fulfillmentNum:'IF-8834', date:'2026-05-11', customer:'Northshore Labs', item:'PL041C', qty:3, salesOrder:'SO-10299'}\n    ],\n    customers: {\n      'Meridian Diagnostics': {\n        profile:{entityId:'C-1042', companyName:'Meridian Diagnostics', phone:'(905) 555-0148', email:'orders@meridiandx.example'},\n        open:[{docNum:'SO-10432', item:'PL041C', qty:1, amount:554.00, status:'Pending Fulfillment'}],\n        all:[\n          {date:'2026-06-24', type:'Sales Order', docNum:'SO-10432', item:'PL041C', qty:1, amount:554.00, status:'Pending Fulfillment'},\n          {date:'2026-02-18', type:'Invoice', docNum:'INV-9601', item:'PL041C', qty:5, amount:2700.00, status:'Paid'}\n        ]\n      }\n    }\n  };\n\n  // ---------------- API layer (mock or live) ----------------\n  function api(action, params){\n    params = params || {};\n    if (MOCK_MODE) return mockApi(action, params);\n    var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');\n    return fetch(SUITELET_URL + '&action=' + action + (q ? '&'+q : '')).then(function(r){ return r.json(); });\n  }\n\n  function mockApi(action, params){\n    return new Promise(function(resolve){\n      setTimeout(function(){\n        switch(action){\n          case 'itemList':\n            var q = (params.q||'').toLowerCase();\n            var type = params.type||'';\n            resolve(ITEM_CATALOG.filter(function(it){\n              var matchesQ = !q || it.itemId.toLowerCase().indexOf(q)>-1 || it.description.toLowerCase().indexOf(q)>-1;\n              var matchesType = !type || it.typeId === type;\n              return matchesQ && matchesType;\n            }));\n            break;\n          case 'itemDetail': resolve(MOCK.itemDetail); break;\n          case 'inventoryDetail': resolve({ byLocation: MOCK.warehouses, byLot: MOCK.lots }); break;\n          case 'vendorDetail': resolve(MOCK.vendors); break;\n          case 'salesHistory': resolve(MOCK.sales); break;\n          case 'itemTransactions': resolve(MOCK.txns); break;\n          case 'committedDrilldown': resolve(MOCK.committed); break;\n          case 'serialLotLookup': resolve(MOCK.serial); break;\n          case 'customerSearch':\n            resolve(Object.keys(MOCK.customers).filter(function(n){return n.toLowerCase().indexOf((params.q||'').toLowerCase())>-1;})\n              .map(function(n){ return {id:n, entityId: MOCK.customers[n].profile.entityId, name:n}; }));\n            break;\n          case 'customerDetail':\n            var c = MOCK.customers[params.customerId] || MOCK.customers['Meridian Diagnostics'];\n            resolve({ profile:c.profile, transactions:c.all, openOrders:c.open });\n            break;\n          default: resolve({});\n        }\n      }, 120);\n    });\n  }\n\n  // ---------------- Formatting helpers ----------------\n  function fmtNum(n){ n = Number(n)||0; return n.toLocaleString('en-US', {minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}); }\n  function fmtMoney(n){ return '$' + (Number(n)||0).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }\n  function td(text, cls){ return '<td' + (cls?' class=\"'+cls+'\"':'') + '>' + text + '</td>'; }\n  function numCell(n){ var v = (typeof n === 'string') ? n : fmtNum(n); var c = Number(n) < 0 ? 'num neg' : 'num'; return td(v, c); }\n  function esc(s){ var d=document.createElement('div'); d.textContent = s==null?'':String(s); return d.innerHTML; }\n\n  function expiryPill(dateStr){\n    if(!dateStr) return '<span class=\"mono\">\u2014</span>';\n    var d = new Date(dateStr);\n    var days = Math.round((d - new Date()) / 86400000);\n    var cls = 'ok', pct = 100;\n    if (days <= 0){ cls='critical'; pct=100; }\n    else if (days < 90){ cls='soon'; pct = Math.max(15, 100 - (days/90*100)); }\n    else { cls='ok'; pct = 30; }\n    var color = cls==='critical' ? 'var(--danger)' : (cls==='soon' ? 'var(--amber)' : 'var(--good)');\n    var label = days <= 0 ? 'Expired' : (days + 'd');\n    return '<span class=\"expiry-pill\"><span class=\"expiry-dot '+cls+'\"></span>' + dateStr +\n      ' <span class=\"expiry-bar\"><span style=\"width:'+pct+'%;background:'+color+'\"></span></span> ' +\n      '<span style=\"color:'+color+'\">' + label + '</span></span>';\n  }\n\n  // ---------------- Item list ----------------\n  function renderItemList(items){\n    var tbody = document.getElementById('itemListRows');\n    tbody.innerHTML = items.map(function(it){\n      var checked = state.selected[it.itemId] ? 'checked' : '';\n      return '<tr class=\"clickable\" data-row-item=\"'+esc(it.itemId)+'\">' +\n        '<td><input type=\"checkbox\" class=\"item-select\" data-item=\"'+esc(it.itemId)+'\" '+checked+'></td>' +\n        td('<b>'+esc(it.itemId)+'</b>') +\n        td(esc(it.description)) +\n        td(esc(it.type)) +\n        td(esc(it.category)) +\n        td(it.status==='Active' ? '<span class=\"badge open\">Active</span>' : '<span class=\"badge closed\">Inactive</span>') +\n        numCell(it.onHand) + numCell(it.available) +\n      '</tr>';\n    }).join('') || '<tr><td colspan=\"8\" class=\"empty\">No items match that search.</td></tr>';\n\n    // Row click (anywhere except the checkbox) toggles the accordion\n    tbody.querySelectorAll('tr[data-row-item]').forEach(function(tr){\n      tr.addEventListener('click', function(e){\n        if (e.target.classList.contains('item-select')) return;\n        toggleAccordion(tr.dataset.rowItem, tr);\n      });\n    });\n    tbody.querySelectorAll('.item-select').forEach(function(cb){\n      cb.addEventListener('click', function(e){ e.stopPropagation(); });\n      cb.addEventListener('change', function(){\n        if (cb.checked) state.selected[cb.dataset.item] = true;\n        else delete state.selected[cb.dataset.item];\n        updateSelectionUi();\n      });\n    });\n  }\n\n  function updateSelectionUi(){\n    var ids = Object.keys(state.selected);\n    var pill = document.getElementById('selectedCountPill');\n    var btn = document.getElementById('exportSelectedBtn');\n    if (ids.length){\n      pill.style.display = 'inline-flex';\n      pill.textContent = ids.length + ' selected';\n      btn.disabled = false;\n    } else {\n      pill.style.display = 'none';\n      btn.disabled = true;\n    }\n  }\n\n  function searchItems(){\n    var q = document.getElementById('itemListSearchInput').value.trim();\n    var type = document.getElementById('itemTypeFilter').value;\n    api('itemList', {q:q, type:type}).then(renderItemList);\n  }\n\n  // ---------------- Accordion (full item record, inline) ----------------\n  function toggleAccordion(itemId, rowEl){\n    var existing = document.querySelector('tr.item-detail-row');\n    var wasOpenForThisRow = existing && existing.dataset.detailFor === itemId;\n    if (existing) existing.remove();\n    document.querySelectorAll('tr[data-row-item]').forEach(function(r){ r.classList.remove('open-row'); });\n    if (wasOpenForThisRow){ state.openItemId = null; return; }\n\n    state.openItemId = itemId;\n    rowEl.classList.add('open-row');\n\n    var tpl = document.getElementById('itemAccordionTemplate').content.cloneNode(true);\n    var tr = document.createElement('tr');\n    tr.className = 'item-detail-row';\n    tr.dataset.detailFor = itemId;\n    var tdWrap = document.createElement('td');\n    tdWrap.colSpan = 8;\n    tdWrap.style.padding = '14px 4px';\n    tdWrap.style.background = '#F7FAF9';\n    tdWrap.appendChild(tpl);\n    tr.appendChild(tdWrap);\n    rowEl.parentNode.insertBefore(tr, rowEl.nextSibling);\n\n    // Tabs, scoped to this accordion instance\n    var root = tr;\n    root.querySelectorAll('.tab').forEach(function(tab){\n      tab.addEventListener('click', function(){\n        root.querySelectorAll('.tab').forEach(function(t){ t.classList.toggle('active', t===tab); });\n        root.querySelectorAll('.tab-view').forEach(function(v){ v.style.display = (v.dataset.tabview===tab.dataset.tab) ? 'block' : 'none'; });\n      });\n    });\n    root.querySelectorAll('[data-export]').forEach(function(btn){\n      btn.addEventListener('click', function(){ runExport(btn.dataset.export, itemId); });\n    });\n    var salesBtn = root.querySelector('[data-role=\"salesFilterBtn\"]');\n    if (salesBtn){\n      salesBtn.addEventListener('click', function(){\n        var from = root.querySelector('[data-role=\"salesFrom\"]').value;\n        var to = root.querySelector('[data-role=\"salesTo\"]').value;\n        api('salesHistory', {itemId:itemId, from:from, to:to}).then(function(rows){ renderInto(root, 'salesRows', rows, salesRowHtml, 7); });\n      });\n    }\n\n    loadAccordionData(itemId, root);\n  }\n\n  function loadAccordionData(itemId, root){\n    api('itemDetail', {itemId:itemId}).then(function(d){\n      setField(root, 'description', d.description);\n      setField(root, 'category', d.category);\n      setField(root, 'trackingMethod', d.trackingMethod);\n      setField(root, 'costingMethod', d.costingMethod);\n      setField(root, 'subsidiary', d.subsidiary || '\u2014');\n      setField(root, 'status', d.status);\n      setField(root, 'stockUnit', d.stockUnit);\n      setField(root, 'purchaseUnit', d.purchaseUnit);\n      setField(root, 'reorderPoint', d.reorderPoint);\n      setField(root, 'preferredStockLevel', d.preferredStockLevel);\n      var priceEl = root.querySelector('[data-f=\"price\"]');\n      if (priceEl) priceEl.textContent = fmtMoney(d.price);\n    });\n    api('inventoryDetail', {itemId:itemId}).then(function(d){\n      renderInto(root, 'warehouseRows', d.byLocation||[], warehouseRowHtml, 8);\n      renderInto(root, 'lotRows', d.byLot||[], lotRowHtml, 6);\n    });\n    api('vendorDetail', {itemId:itemId}).then(function(rows){ renderInto(root, 'vendorRows', rows, vendorRowHtml, 5); });\n    api('salesHistory', {itemId:itemId}).then(function(rows){ renderInto(root, 'salesRows', rows, salesRowHtml, 7); });\n    api('itemTransactions', {itemId:itemId}).then(function(rows){ renderInto(root, 'txnRows', rows, txnRowHtml, 7); });\n    api('committedDrilldown', {itemId:itemId}).then(function(rows){ renderInto(root, 'committedRows', rows, committedRowHtml, 5); });\n  }\n\n  function setField(root, key, val){\n    var el = root.querySelector('[data-f=\"'+key+'\"]');\n    if (el) el.textContent = (val===undefined || val===null || val==='') ? '\u2014' : val;\n  }\n\n  function renderInto(root, role, rows, rowFn, colCount){\n    var tbody = root.querySelector('[data-role=\"'+role+'\"]');\n    if (!tbody) return;\n    tbody.innerHTML = rows.map(rowFn).join('') || '<tr><td colspan=\"'+colCount+'\" class=\"empty\">No records.</td></tr>';\n  }\n\n  function warehouseRowHtml(r){\n    return '<tr>' + td('<b>'+esc(r.location)+'</b>') + numCell(r.onHand) + numCell(r.committed) + numCell(r.backOrdered) +\n      numCell(r.onOrder) + numCell(r.packed) + numCell(r.picked) + numCell(r.available) + '</tr>';\n  }\n  function lotRowHtml(r){\n    return '<tr>' + td('<b class=\"mono\">'+esc(r.lot)+'</b>') + td(esc(r.location)) + td(expiryPill(r.expirationDate)) +\n      numCell(r.onHand) + numCell(r.committed) + numCell(r.available) + '</tr>';\n  }\n  function committedRowHtml(r){\n    return '<tr>' + td('<b>'+esc(r.docNum)+'</b>') + td(esc(r.customer)) + td(esc(r.date)) + numCell(r.qtyOrdered) + numCell(r.qtyCommitted) + '</tr>';\n  }\n  function vendorRowHtml(r){\n    return '<tr>' + td('<b>'+esc(r.vendor)+'</b>') + td('<span class=\"mono\">'+esc(r.vendorCode)+'</span>') + td(esc(r.currency)) +\n      numCell(fmtMoney(r.purchasePrice)) +\n      td(r.preferred ? '<span class=\"badge open\">Preferred</span>' : '<span class=\"badge closed\">Alternate</span>') + '</tr>';\n  }\n  function salesRowHtml(r){\n    return '<tr>' + td(esc(r.date)) + td('<b>'+esc(r.docNum)+'</b>') + td(esc(r.type)) + td(esc(r.customer)) +\n      numCell(r.qty) + numCell(fmtMoney(r.rate)) + numCell(fmtMoney(r.amount)) + '</tr>';\n  }\n  function txnRowHtml(r){\n    return '<tr>' + td(esc(r.date)) + td(esc(r.type)) + td('<b>'+esc(r.docNum)+'</b>') + td(esc(r.entity)) +\n      numCell(r.qty) + numCell(fmtMoney(r.amount)) + td(esc(r.status)) + '</tr>';\n  }\n\n  // ---------------- Export ----------------\n  function runExport(view, itemId){\n    if (MOCK_MODE){\n      alert('CSV export runs server-side once this is deployed as a Suitelet \u2014 this button downloads \"' + view + '.csv\" directly from NetSuite.');\n      return;\n    }\n    var params = {view:view, itemId:itemId};\n    var q = Object.keys(params).map(function(k){ return encodeURIComponent(k)+'='+encodeURIComponent(params[k]); }).join('&');\n    window.location = SUITELET_URL + '&action=export&' + q;\n  }\n\n  function exportSelected(){\n    var ids = Object.keys(state.selected);\n    if (!ids.length) return;\n    if (MOCK_MODE){\n      alert('This downloads a combined summary CSV for: ' + ids.join(', ') + ' once deployed as a Suitelet.');\n      return;\n    }\n    var q = 'view=multiItemSummary&itemIds=' + encodeURIComponent(ids.join(','));\n    window.location = SUITELET_URL + '&action=export&' + q;\n  }\n\n  // ---------------- Serial & Lot Lookup ----------------\n  function renderSerial(rows){\n    var card = document.getElementById('serialResultsCard');\n    card.style.display = 'block';\n    document.getElementById('serialRows').innerHTML = rows.map(function(r){\n      return '<tr>' + td('<b>'+esc(r.fulfillmentNum)+'</b>') + td(esc(r.date)) + td(esc(r.customer)) + td(esc(r.item)) + numCell(r.qty) + td(esc(r.salesOrder)) + '</tr>';\n    }).join('') || '<tr><td colspan=\"6\" class=\"empty\">No matches for that serial/lot number.</td></tr>';\n  }\n\n  // ---------------- Customer Inquiry ----------------\n  function renderCustomer(data){\n    document.getElementById('customerDetailWrap').style.display = 'block';\n    document.getElementById('custName').textContent = data.profile.companyName || '\u2014';\n    document.getElementById('custId').textContent = data.profile.entityId || '\u2014';\n    document.getElementById('custPhone').textContent = data.profile.phone || '\u2014';\n    document.getElementById('custEmail').textContent = data.profile.email || '\u2014';\n    document.getElementById('custOpenRows').innerHTML = (data.openOrders||[]).map(function(r){\n      return '<tr>' + td('<b>'+esc(r.docNum)+'</b>') + td(esc(r.item)) + numCell(r.qty) + numCell(fmtMoney(r.amount)) +\n        td('<span class=\"badge open\">'+esc(r.status)+'</span>') + '</tr>';\n    }).join('') || '<tr><td colspan=\"5\" class=\"empty\">No open orders.</td></tr>';\n    document.getElementById('custAllRows').innerHTML = (data.transactions||[]).map(function(r){\n      return '<tr>' + td(esc(r.date)) + td(esc(r.type)) + td('<b>'+esc(r.docNum)+'</b>') + td(esc(r.item)) + numCell(r.qty) + numCell(fmtMoney(r.amount)) + td(esc(r.status)) + '</tr>';\n    }).join('') || '<tr><td colspan=\"7\" class=\"empty\">No transactions.</td></tr>';\n  }\n\n  // ---------------- Nav ----------------\n  function switchView(name){\n    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });\n    document.getElementById('view-'+name).classList.add('active');\n    document.querySelectorAll('.nav-item').forEach(function(n){ n.classList.toggle('active', n.dataset.nav===name); });\n    var labels = {item:'Item Inquiry', serial:'Serial & Lot Lookup', customer:'Customer Inquiry'};\n    document.getElementById('contextPill').textContent = labels[name];\n  }\n\n  // ---------------- Events ----------------\n  document.querySelectorAll('.nav-item').forEach(function(n){\n    n.addEventListener('click', function(){ switchView(n.dataset.nav); });\n  });\n  document.querySelectorAll('.recent-item').forEach(function(n){\n    n.addEventListener('click', function(){\n      switchView('item');\n      document.getElementById('itemListSearchInput').value = n.dataset.recent;\n      searchItems();\n    });\n  });\n\n  document.getElementById('itemListSearchBtn').addEventListener('click', searchItems);\n  document.getElementById('itemListSearchInput').addEventListener('keydown', function(e){ if (e.key==='Enter') searchItems(); });\n  document.getElementById('itemTypeFilter').addEventListener('change', searchItems);\n\n  document.getElementById('selectAllItems').addEventListener('change', function(e){\n    document.querySelectorAll('#itemListRows .item-select').forEach(function(cb){\n      cb.checked = e.target.checked;\n      if (cb.checked) state.selected[cb.dataset.item] = true; else delete state.selected[cb.dataset.item];\n    });\n    updateSelectionUi();\n  });\n  document.getElementById('exportSelectedBtn').addEventListener('click', exportSelected);\n\n  document.getElementById('globalSearch').addEventListener('keydown', function(e){\n    if (e.key !== 'Enter') return;\n    var v = e.target.value.trim();\n    if (!v) return;\n    switchView('item');\n    document.getElementById('itemListSearchInput').value = v;\n    searchItems();\n  });\n\n  document.getElementById('serialLookupBtn').addEventListener('click', function(){\n    var v = document.getElementById('serialInput').value.trim();\n    if (!v) return;\n    api('serialLotLookup', {value:v}).then(renderSerial);\n  });\n\n  var custTimer;\n  document.getElementById('customerSearchInput').addEventListener('input', function(e){\n    var q = e.target.value;\n    clearTimeout(custTimer);\n    if (!q) return;\n    custTimer = setTimeout(function(){\n      api('customerSearch', {q:q}).then(function(list){\n        if (list.length){\n          state.customerId = list[0].id;\n          api('customerDetail', {customerId:list[0].id}).then(renderCustomer);\n        }\n      });\n    }, 250);\n  });\n\n  // ---------------- Init ----------------\n  searchItems();\n})();\n</script>\n</body>\n</html>\n";

    return { onRequest };
  });