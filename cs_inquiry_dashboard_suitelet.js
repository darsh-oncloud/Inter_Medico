/**
 * CS Item Inquiry Suitelet
 *
 * For now:
 * - Searches are hardcoded in the script.
 * - Later you can move each search to saved search parameters.
 *
 * Page includes:
 * - Item filter
 * - Subsidiary filter
 * - Item Type filter
 * - Class filter
 * - Search text filter
 * - Result grid
 * - Item detail page with:
 *   1. Header
 *   2. Locations tab
 *   3. Vendors tab
 *   4. Bin Numbers tab
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'], function (search, url, runtime, log) {

    const DEFAULT_ITEM_ID = '9201';
    const MAX_ITEM_OPTIONS = 500;
    const MAX_GRID_ROWS = 300;
    const MAX_DETAIL_ROWS = 1000;

    function onRequest(context) {
        const request = context.request;
        const response = context.response;
        const action = request.parameters.action;

        if (request.method === 'GET' && !action) {
            response.write(renderPage());
            return;
        }

        try {
            if (action === 'filterOptions') {
                sendJson(response, getFilterOptions());
                return;
            }

            if (action === 'itemSearch') {
                sendJson(response, searchItemsFiltered(request.parameters));
                return;
            }

            if (action === 'itemDetail') {
                sendJson(response, getItemFullDetail(request.parameters.itemId));
                return;
            }

            sendJson(response, {
                error: 'Unknown action: ' + action
            });

        } catch (e) {
            log.error('CS Item Inquiry Error', {
                action: action,
                message: e.message,
                stack: e.stack
            });

            sendJson(response, {
                error: e.message || String(e)
            });
        }
    }

    function sendJson(response, obj) {
        response.setHeader({
            name: 'Content-Type',
            value: 'application/json'
        });
        response.write(JSON.stringify(obj || {}));
    }

    // =========================================================
    // FILTER OPTIONS
    // =========================================================

    function getFilterOptions() {
        return {
            items: getItemOptions(),
            itemTypes: getItemTypeOptions(),
            classes: getClassOptions(),
            subsidiaries: getSubsidiaryOptions()
        };
    }

    function getItemTypeOptions() {
        return [
            { value: 'InvtPart', text: 'Inventory Item' },
            { value: 'Assembly', text: 'Assembly Item' },
            { value: 'Kit', text: 'Kit / Package' },
            { value: 'NonInvtPart', text: 'Non-Inventory Item' },
            { value: 'Service', text: 'Service Item' },
            { value: 'OthCharge', text: 'Other Charge Item' },
            { value: 'Description', text: 'Description Item' },
            { value: 'Discount', text: 'Discount Item' },
            { value: 'Markup', text: 'Markup Item' },
            { value: 'Payment', text: 'Payment Item' },
            { value: 'Subtotal', text: 'Subtotal Item' }
        ];
    }

    function getItemOptions() {
        const rows = [];

        try {
            search.create({
                type: search.Type.ITEM,
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
                    'displayname',
                    'type'
                ]
            }).run().each(function (r) {
                const itemId = r.getValue('itemid') || '';
                const displayName = r.getValue('displayname') || '';
                const type = r.getText('type') || '';

                rows.push({
                    value: r.id,
                    text: itemId + (displayName ? ' - ' + displayName : '') + (type ? ' [' + type + ']' : '')
                });

                return rows.length < MAX_ITEM_OPTIONS;
            });

        } catch (e) {
            log.error('getItemOptions failed', e);
        }

        return rows;
    }

    function getClassOptions() {
        const rows = [];

        try {
            search.create({
                type: 'classification',
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            }).run().each(function (r) {
                rows.push({
                    value: r.id,
                    text: r.getValue('name')
                });
                return true;
            });

        } catch (e) {
            log.error('getClassOptions failed', e);
        }

        return rows;
    }

    function getSubsidiaryOptions() {
        const rows = [];

        try {
            search.create({
                type: 'subsidiary',
                filters: [
                    ['isinactive', 'is', 'F']
                ],
                columns: [
                    search.createColumn({ name: 'name', sort: search.Sort.ASC })
                ]
            }).run().each(function (r) {
                rows.push({
                    value: r.id,
                    text: r.getValue('name')
                });
                return true;
            });

        } catch (e) {
            log.error('getSubsidiaryOptions failed', e);
        }

        return rows;
    }

    // =========================================================
    // MAIN ITEM GRID SEARCH
    // =========================================================

    function searchItemsFiltered(params) {
        const filters = [
            ['isinactive', 'is', 'F']
        ];

        function addAnd() {
            if (filters.length) {
                filters.push('AND');
            }
        }

        if (params.itemId) {
            addAnd();
            filters.push(['internalid', 'anyof', params.itemId]);
        }

        if (params.itemType) {
            addAnd();
            filters.push(['type', 'anyof', params.itemType]);
        }

        if (params.classId) {
            addAnd();
            filters.push(['class', 'anyof', params.classId]);
        }

        if (params.subsidiaryId) {
            addAnd();
            filters.push(['subsidiary', 'anyof', params.subsidiaryId]);
        }

        if (params.q) {
            addAnd();
            filters.push([
                ['nameornumber', 'contains', params.q],
                'OR',
                ['displayname', 'contains', params.q],
                'OR',
                ['salesdescription', 'contains', params.q]
            ]);
        }

        const rows = [];

        const itemSearch = search.create({
            type: search.Type.ITEM,
            filters: filters,
            columns: [
                search.createColumn({ name: 'itemid', sort: search.Sort.ASC }),
                'displayname',
                'salesdescription',
                'type',
                'class',
                'subsidiary',
                'baseprice',
                'quantityonhand',
                'quantityavailable',
                'isinactive'
            ]
        });

        const total = itemSearch.runPaged().count;

        itemSearch.run().each(function (r) {
            rows.push({
                internalId: r.id,
                itemId: r.getValue('itemid'),
                displayName: r.getValue('displayname'),
                description: r.getValue('salesdescription'),
                type: r.getText('type'),
                className: r.getText('class'),
                subsidiary: r.getText('subsidiary'),
                basePrice: r.getValue('baseprice'),
                onHand: r.getValue('quantityonhand'),
                available: r.getValue('quantityavailable'),
                status: r.getValue('isinactive') ? 'Inactive' : 'Active'
            });

            return rows.length < MAX_GRID_ROWS;
        });

        return {
            total: total,
            rows: rows
        };
    }

    // =========================================================
    // ITEM DETAIL
    // =========================================================

    function getItemFullDetail(itemId) {
        itemId = itemId || DEFAULT_ITEM_ID;

        return {
            itemId: itemId,
            header: getItemHeader(itemId),
            locations: getItemLocations(itemId),
            vendors: getItemVendors(itemId),
            bins: getItemBins(itemId)
        };
    }

    function getItemHeader(itemId) {
        let data = {};

        search.create({
            type: search.Type.ITEM,
            filters: [
                ['internalid', 'anyof', itemId]
            ],
            columns: [
                'itemid',
                'displayname',
                'salesdescription',
                'type',
                'baseprice',
                'subsidiary',
                'class',
                'costingmethod',
                'stockunit',
                'purchaseunit',
                'saleunit',
                'isinactive'
            ]
        }).run().each(function (r) {
            data = {
                internalId: r.id,
                itemName: r.getValue('itemid'),
                displayName: r.getValue('displayname'),
                description: r.getValue('salesdescription'),
                type: r.getText('type'),
                basePrice: r.getValue('baseprice'),
                subsidiary: r.getText('subsidiary'),
                className: r.getText('class'),
                costingMethod: r.getText('costingmethod'),
                stockUnit: r.getText('stockunit'),
                purchaseUnit: r.getText('purchaseunit'),
                saleUnit: r.getText('saleunit'),
                status: r.getValue('isinactive') ? 'Inactive' : 'Active'
            };

            return false;
        });

        return data;
    }

    function getItemLocations(itemId) {
        const rows = [];
        const seen = {};

        try {
            search.create({
                type: search.Type.ITEM,
                filters: [
                    ['internalid', 'anyof', itemId],
                    'AND',
                    ['inventorylocation', 'noneof', '@NONE@']
                ],
                columns: [
                    search.createColumn({ name: 'inventorylocation', sort: search.Sort.ASC }),
                    'locationquantityonhand',
                    'locationquantityavailable',
                    'locationquantitycommitted',
                    'locationtoresvcommitted',
                    'locationquantitybackordered',
                    'locationquantityintransit',
                    'locationquantityonorder',
                    'locationaveragecost',
                    'locationtotalvalue',
                    'locationqtyintransitext'
                ]
            }).run().each(function (r) {
                const locationId = r.getValue('inventorylocation');

                if (!locationId || seen[locationId]) {
                    return true;
                }

                seen[locationId] = true;

                rows.push({
                    location: r.getText('inventorylocation'),
                    onHand: r.getValue('locationquantityonhand'),
                    available: r.getValue('locationquantityavailable'),
                    committed: r.getValue('locationquantitycommitted'),
                    committedToReservation: r.getValue('locationtoresvcommitted'),
                    backOrdered: r.getValue('locationquantitybackordered'),
                    inTransit: r.getValue('locationquantityintransit'),
                    onOrder: r.getValue('locationquantityonorder'),
                    averageCost: r.getValue('locationaveragecost'),
                    totalValue: r.getValue('locationtotalvalue'),
                    externalInTransit: r.getValue('locationqtyintransitext')
                });

                return rows.length < MAX_DETAIL_ROWS;
            });

        } catch (e) {
            log.error('getItemLocations failed', e);
        }

        return rows;
    }

    function getItemVendors(itemId) {
        const rows = [];
        const seen = {};

        try {
            search.create({
                type: search.Type.ITEM,
                filters: [
                    ['internalid', 'anyof', itemId]
                ],
                columns: [
                    'vendor',
                    'vendorcode',
                    'vendorname',
                    'vendorcost',
                    'vendorcostentered',
                    'vendorpricecurrency',
                    'vendreturnvarianceaccount',
                    'vendorschedule',
                    'othervendor'
                ]
            }).run().each(function (r) {
                const vendorKey =
                    r.getValue('othervendor') ||
                    r.getValue('vendor') ||
                    r.getValue('vendorname');

                if (!vendorKey || seen[vendorKey]) {
                    return true;
                }

                seen[vendorKey] = true;

                rows.push({
                    preferredVendor: r.getText('vendor'),
                    vendor: r.getText('othervendor'),
                    vendorCode: r.getValue('vendorcode'),
                    vendorName: r.getValue('vendorname'),
                    vendorCost: r.getValue('vendorcost'),
                    vendorCostEntered: r.getValue('vendorcostentered'),
                    currency: r.getText('vendorpricecurrency'),
                    returnVarianceAccount: r.getText('vendreturnvarianceaccount'),
                    vendorSchedule: r.getText('vendorschedule')
                });

                return rows.length < MAX_DETAIL_ROWS;
            });

        } catch (e) {
            log.error('getItemVendors failed', e);
        }

        return rows;
    }

    function getItemBins(itemId) {
        const rows = [];

        try {
            search.create({
                type: 'inventorybalance',
                filters: [
                    ['item', 'anyof', itemId]
                ],
                columns: [
                    search.createColumn({ name: 'location', sort: search.Sort.ASC }),
                    search.createColumn({ name: 'binnumber', sort: search.Sort.ASC }),
                    'inventorynumber',
                    'status',
                    'onhand',
                    'available'
                ]
            }).run().each(function (r) {
                rows.push({
                    location: r.getText('location'),
                    binNumber: r.getText('binnumber'),
                    lotSerialNumber: r.getText('inventorynumber'),
                    status: r.getText('status'),
                    onHand: r.getValue('onhand'),
                    available: r.getValue('available')
                });

                return rows.length < MAX_DETAIL_ROWS;
            });

        } catch (e) {
            log.error('getItemBins failed', e);
        }

        return rows;
    }

    // =========================================================
    // PAGE
    // =========================================================

    function renderPage() {
        const scriptObj = runtime.getCurrentScript();

        const suiteletUrl = url.resolveScript({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            returnExternalUrl: false
        });

        return buildHtml().replace('__SUITELET_URL_JSON__', JSON.stringify(suiteletUrl));
    }

    function buildHtml() {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>CS Item Inquiry</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
    :root {
        /* Paper + ink: quiet, cool-neutral working surface, not warm cream */
        --paper: #EFF1EC;
        --panel: #FFFFFF;
        --ink: #14171C;
        --muted: #667085;
        --faint: #8B93A1;
        --line: #DDE1DC;
        --line-soft: #EAEDE9;

        /* Signature accent: "specimen indigo" — a controlled instrument-panel blue,
           not the generic SaaS #1f5eff */
        --signal: #3D4A8A;
        --signal-dark: #2B3568;
        --signal-soft: #E8EAF5;

        /* Status colors: active/good, and a caution amber used sparingly */
        --good: #146C43;
        --good-soft: #E3F3EA;
        --warn: #96591A;
        --warn-soft: #FBF0DE;

        --shadow: 0 1px 2px rgba(20,23,28,.04), 0 8px 20px rgba(20,23,28,.06);
        --radius: 12px;
        --radius-sm: 8px;
    }

    * { box-sizing: border-box; }

    body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font-family: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
        font-size: 14px;
        -webkit-font-smoothing: antialiased;
    }

    .mono { font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
    .display { font-family: 'Space Grotesk', sans-serif; }

    .page {
        max-width: 1450px;
        margin: 0 auto;
        padding: 32px 28px 60px;
    }

    .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 22px;
    }

    .eyebrow {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 11px;
        letter-spacing: .09em;
        text-transform: uppercase;
        color: var(--signal);
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
    }

    .eyebrow .dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: var(--good);
        box-shadow: 0 0 0 3px var(--good-soft);
    }

    .title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 27px;
        font-weight: 700;
        margin: 0;
        letter-spacing: -.01em;
    }

    .subtitle {
        color: var(--muted);
        margin-top: 6px;
        font-size: 13px;
        max-width: 620px;
        line-height: 1.5;
    }

    .card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        padding: 20px;
        margin-bottom: 18px;
        position: relative;
    }

    .filters {
        display: grid;
        grid-template-columns: 2fr 1.3fr 1fr 1fr 1fr auto;
        gap: 12px;
        align-items: end;
    }

    label {
        display: block;
        font-size: 10.5px;
        text-transform: uppercase;
        color: var(--faint);
        letter-spacing: .07em;
        font-weight: 700;
        margin-bottom: 6px;
    }

    input, select {
        width: 100%;
        height: 38px;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 8px 11px;
        background: var(--panel);
        color: var(--ink);
        outline: none;
        font-family: 'Inter', sans-serif;
        font-size: 13.5px;
        transition: border-color .12s ease;
    }

    input::placeholder { color: var(--faint); }

    input:focus, select:focus {
        border-color: var(--signal);
        box-shadow: 0 0 0 3px var(--signal-soft);
    }

    .btn {
        height: 38px;
        border: 1px solid var(--line);
        background: var(--panel);
        border-radius: var(--radius-sm);
        padding: 0 15px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        color: var(--ink);
        transition: border-color .12s ease, color .12s ease;
    }

    .btn:hover {
        border-color: var(--signal);
        color: var(--signal-dark);
    }

    .btn-primary {
        background: var(--signal);
        border-color: var(--signal);
        color: #fff;
    }

    .btn-primary:hover {
        background: var(--signal-dark);
        border-color: var(--signal-dark);
        color: #fff;
    }

    .meta {
        display: flex;
        justify-content: space-between;
        color: var(--muted);
        font-size: 12px;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px dashed var(--line);
    }

    .meta b { color: var(--ink); font-family: 'IBM Plex Mono', monospace; }

    .table-wrap {
        width: 100%;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
    }

    table {
        width: 100%;
        border-collapse: collapse;
        min-width: 900px;
    }

    th {
        background: #F7F8F5;
        color: var(--muted);
        text-align: left;
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: .06em;
        font-weight: 700;
        padding: 11px 12px;
        border-bottom: 1px solid var(--line);
        white-space: nowrap;
    }

    td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--line-soft);
        vertical-align: top;
        font-size: 13px;
    }

    tbody tr:nth-child(even) td { background: #FBFBFA; }

    tr:last-child td { border-bottom: none; }

    tr.clickable { cursor: pointer; }
    tr.clickable:hover td { background: var(--signal-soft); }

    .num {
        text-align: right;
        font-family: 'IBM Plex Mono', monospace;
        font-variant-numeric: tabular-nums;
    }

    .badge {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 999px;
        background: var(--line-soft);
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .02em;
    }

    .badge.active {
        background: var(--good-soft);
        color: var(--good);
    }

    /* ---- Item detail: styled like a specimen / requisition label ---- */
    .detail-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
    }

    .detail-head::before {
        content: '';
        position: absolute;
        left: 0; top: 20px; bottom: 20px;
        width: 4px;
        border-radius: 0 3px 3px 0;
        background: var(--signal);
    }

    .item-title {
        font-family: 'Space Grotesk', sans-serif;
        font-size: 25px;
        font-weight: 700;
        margin: 10px 0 6px;
        letter-spacing: -.01em;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .item-title .badge { font-size: 11px; vertical-align: 2px; }

    .item-desc {
        color: var(--muted);
        max-width: 850px;
        line-height: 1.5;
        font-size: 13.5px;
    }

    .header-grid {
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 12px;
        margin-top: 18px;
    }

    .kv {
        background: #F8F9F6;
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        padding: 12px 13px;
        min-height: 72px;
    }

    .kv .k {
        font-size: 10.5px;
        text-transform: uppercase;
        color: var(--faint);
        letter-spacing: .06em;
        font-weight: 700;
        margin-bottom: 7px;
    }

    .kv .v {
        font-family: 'IBM Plex Mono', monospace;
        font-size: 13.5px;
        font-weight: 600;
        word-break: break-word;
        color: var(--ink);
    }

    /* Underlined tabs — precise, clinical, not pill-shaped */
    .tabs {
        display: flex;
        gap: 26px;
        margin-bottom: 16px;
        border-bottom: 1px solid var(--line);
    }

    .tab-btn {
        border: none;
        background: none;
        padding: 10px 2px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13.5px;
        color: var(--muted);
        border-bottom: 2px solid transparent;
        margin-bottom: -1px;
        font-family: 'Inter', sans-serif;
    }

    .tab-btn.active {
        color: var(--signal-dark);
        border-bottom-color: var(--signal);
    }

    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .empty {
        padding: 38px;
        text-align: center;
        color: var(--faint);
        font-size: 13px;
    }

    .loading {
        padding: 22px;
        color: var(--muted);
        text-align: center;
        font-size: 13px;
    }

    .error {
        background: var(--warn-soft);
        color: var(--warn);
        border: 1px solid #EBC994;
        padding: 12px 14px;
        border-radius: var(--radius-sm);
        margin-bottom: 14px;
        display: none;
        font-size: 13px;
        font-weight: 500;
    }

    @media (max-width: 1000px) {
        .filters { grid-template-columns: 1fr 1fr; }
        .header-grid { grid-template-columns: 1fr 1fr; }
    }
</style>
</head>
<body>
<div class="page">

    <div class="topbar">
        <div>
            <div class="eyebrow"><span class="dot"></span>Item &amp; Inventory Records</div>
            <h1 class="title">CS Item Inquiry</h1>
            <div class="subtitle">Search item records and view item header, location inventory, vendors, and bin balances.</div>
        </div>
    </div>

    <div id="errorBox" class="error"></div>

    <div id="gridSection" class="card">
        <div class="filters">
            <div>
                <label>Search</label>
                <input id="fQ" placeholder="Item name, display name, or description">
            </div>

            <div>
                <label>Item</label>
                <select id="fItem">
                    <option value="">All Items</option>
                </select>
            </div>

            <div>
                <label>Item Type</label>
                <select id="fType">
                    <option value="">All Types</option>
                </select>
            </div>

            <div>
                <label>Subsidiary</label>
                <select id="fSub">
                    <option value="">All Subsidiaries</option>
                </select>
            </div>

            <div>
                <label>Class</label>
                <select id="fClass">
                    <option value="">All Classes</option>
                </select>
            </div>

            <div>
                <label>&nbsp;</label>
                <button id="clearBtn" class="btn">Clear</button>
            </div>
        </div>

        <div class="meta">
            <span>Total Results: <b id="totalCount">0</b></span>
            <span>Click any item row to open full inquiry.</span>
        </div>

        <div class="table-wrap" style="margin-top:14px;">
            <table>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Display Name</th>
                        <th>Description</th>
                        <th>Type</th>
                        <th>Class</th>
                        <th>Subsidiary</th>
                        <th>Base Price</th>
                        <th class="num">On Hand</th>
                        <th class="num">Available</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody id="gridRows">
                    <tr>
                        <td colspan="10" class="loading">Loading items...</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>

    <div id="detailSection" style="display:none;">
        <div class="card">
            <div class="detail-head">
                <div>
                    <button id="backBtn" class="btn">&larr; Back to Results</button>
                    <div id="itemTitle" class="item-title"></div>
                    <div id="itemDesc" class="item-desc"></div>
                </div>
                <div>
                    <button id="refreshDetailBtn" class="btn btn-primary">Refresh Item</button>
                </div>
            </div>

            <div id="headerGrid" class="header-grid"></div>
        </div>

        <div class="card">
            <div class="tabs">
                <button class="tab-btn active" data-tab="locationsTab">Locations</button>
                <button class="tab-btn" data-tab="vendorsTab">Vendors</button>
                <button class="tab-btn" data-tab="binsTab">Bin Numbers</button>
            </div>

            <div id="locationsTab" class="tab-panel active">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Location</th>
                                <th class="num">On Hand</th>
                                <th class="num">Available</th>
                                <th class="num">Committed</th>
                                <th class="num">Committed To Reservation</th>
                                <th class="num">Back Ordered</th>
                                <th class="num">In Transit</th>
                                <th class="num">On Order</th>
                                <th class="num">Average Cost</th>
                                <th class="num">Total Value</th>
                                <th class="num">External In Transit</th>
                            </tr>
                        </thead>
                        <tbody id="locationRows"></tbody>
                    </table>
                </div>
            </div>

            <div id="vendorsTab" class="tab-panel">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Preferred Vendor</th>
                                <th>Vendor</th>
                                <th>Vendor Code</th>
                                <th>Vendor Name</th>
                                <th class="num">Vendor Cost</th>
                                <th class="num">Vendor Cost Entered</th>
                                <th>Currency</th>
                                <th>Return Variance Account</th>
                                <th>Vendor Schedule</th>
                            </tr>
                        </thead>
                        <tbody id="vendorRows"></tbody>
                    </table>
                </div>
            </div>

            <div id="binsTab" class="tab-panel">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Location</th>
                                <th>Bin Number</th>
                                <th>Lot / Serial Number</th>
                                <th>Status</th>
                                <th class="num">On Hand</th>
                                <th class="num">Available</th>
                            </tr>
                        </thead>
                        <tbody id="binRows"></tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>

</div>

<script>
(function () {
    var SUITELET_URL = __SUITELET_URL_JSON__;
    var currentItemId = '';

    function esc(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function num(value) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        var n = Number(String(value).replace(/,/g, ''));

        if (isNaN(n)) {
            return esc(value);
        }

        return n.toLocaleString('en-US', {
            minimumFractionDigits: n % 1 === 0 ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    function td(value, cls) {
        return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + (value || '') + '</td>';
    }

    function emptyRow(colspan, text) {
        return '<tr><td colspan="' + colspan + '" class="empty">' + esc(text) + '</td></tr>';
    }

    function showError(message) {
        var box = document.getElementById('errorBox');

        if (!message) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.innerHTML = esc(message);
        box.style.display = 'block';
    }

    function api(action, params) {
        params = params || {};

        var query = [];

        Object.keys(params).forEach(function (key) {
            if (params[key] !== null && params[key] !== undefined && params[key] !== '') {
                query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
            }
        });

        var joiner = SUITELET_URL.indexOf('?') === -1 ? '?' : '&';
        var finalUrl = SUITELET_URL + joiner + 'action=' + encodeURIComponent(action);

        if (query.length) {
            finalUrl += '&' + query.join('&');
        }

        return fetch(finalUrl, {
            credentials: 'same-origin'
        }).then(function (response) {
            return response.json();
        }).then(function (data) {
            if (data && data.error) {
                throw new Error(data.error);
            }

            return data;
        });
    }

    function optionHtml(row) {
        return '<option value="' + esc(row.value) + '">' + esc(row.text) + '</option>';
    }

    function loadFilterOptions() {
        api('filterOptions').then(function (data) {
            document.getElementById('fItem').innerHTML =
                '<option value="">All Items</option>' + (data.items || []).map(optionHtml).join('');

            document.getElementById('fType').innerHTML =
                '<option value="">All Types</option>' + (data.itemTypes || []).map(optionHtml).join('');

            document.getElementById('fSub').innerHTML =
                '<option value="">All Subsidiaries</option>' + (data.subsidiaries || []).map(optionHtml).join('');

            document.getElementById('fClass').innerHTML =
                '<option value="">All Classes</option>' + (data.classes || []).map(optionHtml).join('');

        }).catch(function (e) {
            showError(e.message);
        });
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

    function refreshGrid() {
        showError('');

        document.getElementById('gridRows').innerHTML =
            '<tr><td colspan="10" class="loading">Loading items...</td></tr>';

        api('itemSearch', currentFilters()).then(function (data) {
            document.getElementById('totalCount').innerHTML = esc(data.total || 0);

            var rows = data.rows || [];

            if (!rows.length) {
                document.getElementById('gridRows').innerHTML = emptyRow(10, 'No items found for selected filters.');
                return;
            }

            document.getElementById('gridRows').innerHTML = rows.map(function (r) {
                return '<tr class="clickable" data-item="' + esc(r.internalId) + '">' +
                    td('<b>' + esc(r.itemId) + '</b>') +
                    td(esc(r.displayName)) +
                    td(esc(r.description)) +
                    td(esc(r.type)) +
                    td(esc(r.className)) +
                    td(esc(r.subsidiary)) +
                    td(num(r.basePrice), 'num') +
                    td(num(r.onHand), 'num') +
                    td(num(r.available), 'num') +
                    td('<span class="badge ' + (r.status === 'Active' ? 'active' : '') + '">' + esc(r.status) + '</span>') +
                    '</tr>';
            }).join('');

            var clickableRows = document.querySelectorAll('#gridRows tr[data-item]');

            clickableRows.forEach(function (row) {
                row.addEventListener('click', function () {
                    openItem(row.getAttribute('data-item'));
                });
            });

        }).catch(function (e) {
            showError(e.message);
            document.getElementById('gridRows').innerHTML = emptyRow(10, 'Unable to load item results.');
        });
    }

    function openItem(itemId) {
        if (!itemId) {
            return;
        }

        currentItemId = itemId;
        showError('');

        document.getElementById('gridSection').style.display = 'none';
        document.getElementById('detailSection').style.display = 'block';

        document.getElementById('itemTitle').innerHTML = 'Loading item...';
        document.getElementById('itemDesc').innerHTML = '';
        document.getElementById('headerGrid').innerHTML = '<div class="loading">Loading item header...</div>';
        document.getElementById('locationRows').innerHTML = emptyRow(11, 'Loading locations...');
        document.getElementById('vendorRows').innerHTML = emptyRow(9, 'Loading vendors...');
        document.getElementById('binRows').innerHTML = emptyRow(6, 'Loading bins...');

        api('itemDetail', {
            itemId: itemId
        }).then(function (data) {
            renderItemDetail(data);
        }).catch(function (e) {
            showError(e.message);
            document.getElementById('itemTitle').innerHTML = 'Unable to load item';
        });
    }

    function renderItemDetail(data) {
        var header = data.header || {};

        document.getElementById('itemTitle').innerHTML =
            esc(header.itemName || '') + ' ' +
            '<span class="badge ' + (header.status === 'Active' ? 'active' : '') + '">' + esc(header.status || '') + '</span>';

        document.getElementById('itemDesc').innerHTML =
            '<b>' + esc(header.displayName || '') + '</b>' +
            (header.description ? '<br>' + esc(header.description) : '');

        var headerFields = [
            ['Display Name', header.displayName],
            ['Type', header.type],
            ['Base Price', num(header.basePrice)],
            ['Subsidiary', header.subsidiary],
            ['Class', header.className],
            ['Costing Method', header.costingMethod],
            ['Stock Unit', header.stockUnit],
            ['Purchase Unit', header.purchaseUnit],
            ['Sale Unit', header.saleUnit],
            ['Internal ID', header.internalId]
        ];

        document.getElementById('headerGrid').innerHTML = headerFields.map(function (f) {
            return '<div class="kv">' +
                '<div class="k">' + esc(f[0]) + '</div>' +
                '<div class="v">' + (f[1] || '') + '</div>' +
                '</div>';
        }).join('');

        renderLocations(data.locations || []);
        renderVendors(data.vendors || []);
        renderBins(data.bins || []);
    }

    function renderLocations(rows) {
        if (!rows.length) {
            document.getElementById('locationRows').innerHTML = emptyRow(11, 'No location inventory found for this item.');
            return;
        }

        document.getElementById('locationRows').innerHTML = rows.map(function (r) {
            return '<tr>' +
                td(esc(r.location)) +
                td(num(r.onHand), 'num') +
                td(num(r.available), 'num') +
                td(num(r.committed), 'num') +
                td(num(r.committedToReservation), 'num') +
                td(num(r.backOrdered), 'num') +
                td(num(r.inTransit), 'num') +
                td(num(r.onOrder), 'num') +
                td(num(r.averageCost), 'num') +
                td(num(r.totalValue), 'num') +
                td(num(r.externalInTransit), 'num') +
                '</tr>';
        }).join('');
    }

    function renderVendors(rows) {
        if (!rows.length) {
            document.getElementById('vendorRows').innerHTML = emptyRow(9, 'No vendor details found for this item.');
            return;
        }

        document.getElementById('vendorRows').innerHTML = rows.map(function (r) {
            return '<tr>' +
                td(esc(r.preferredVendor)) +
                td(esc(r.vendor)) +
                td(esc(r.vendorCode)) +
                td(esc(r.vendorName)) +
                td(num(r.vendorCost), 'num') +
                td(num(r.vendorCostEntered), 'num') +
                td(esc(r.currency)) +
                td(esc(r.returnVarianceAccount)) +
                td(esc(r.vendorSchedule)) +
                '</tr>';
        }).join('');
    }

    function renderBins(rows) {
        if (!rows.length) {
            document.getElementById('binRows').innerHTML = emptyRow(6, 'No bin balance found for this item.');
            return;
        }

        document.getElementById('binRows').innerHTML = rows.map(function (r) {
            return '<tr>' +
                td(esc(r.location)) +
                td(esc(r.binNumber)) +
                td(esc(r.lotSerialNumber)) +
                td(esc(r.status)) +
                td(num(r.onHand), 'num') +
                td(num(r.available), 'num') +
                '</tr>';
        }).join('');
    }

    function clearFilters() {
        document.getElementById('fQ').value = '';
        document.getElementById('fItem').value = '';
        document.getElementById('fType').value = '';
        document.getElementById('fSub').value = '';
        document.getElementById('fClass').value = '';
        refreshGrid();
    }

    document.getElementById('clearBtn').addEventListener('click', clearFilters);

    document.getElementById('backBtn').addEventListener('click', function () {
        document.getElementById('detailSection').style.display = 'none';
        document.getElementById('gridSection').style.display = 'block';
    });

    document.getElementById('refreshDetailBtn').addEventListener('click', function () {
        if (currentItemId) {
            openItem(currentItemId);
        }
    });

    document.getElementById('fItem').addEventListener('change', function () {
        refreshGrid();

        if (this.value) {
            openItem(this.value);
        }
    });

    document.getElementById('fType').addEventListener('change', refreshGrid);
    document.getElementById('fSub').addEventListener('change', refreshGrid);
    document.getElementById('fClass').addEventListener('change', refreshGrid);

    var qTimer;
    document.getElementById('fQ').addEventListener('input', function () {
        clearTimeout(qTimer);
        qTimer = setTimeout(refreshGrid, 300);
    });

    document.querySelectorAll('.tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var tabId = btn.getAttribute('data-tab');

            document.querySelectorAll('.tab-btn').forEach(function (b) {
                b.classList.remove('active');
            });

            document.querySelectorAll('.tab-panel').forEach(function (p) {
                p.classList.remove('active');
            });

            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });

    loadFilterOptions();
    refreshGrid();

})();
</script>
</body>
</html>`;
    }

    return {
        onRequest: onRequest
    };
});