/**
 * CS Item Inquiry Suitelet
 *
 * Updated version:
 * - Saved searches are loaded from deployment parameters.
 * - Item Grid, Item Header, Locations, Vendors, and Bin Balance columns are dynamic.
 * - Add a result column in the saved search and it will show on the page.
 * - Default item grid only shows items where Quantity On Hand > 0.
 *
 * Parameters used:
 * custscript_img_item_dropdown
 * custscript_img_subsidiary
 * custscript_img_category
 * custscript_img_item_grid
 * custscript_img_item_header
 * custscript_img_item_locations
 * custscript_img_item_vendors
 * custscript_img_bin_balance
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

    function getParam(paramKey) {
        const scriptObj = runtime.getCurrentScript();
        const paramId = PARAMS[paramKey];

        if (!paramId) {
            return '';
        }

        const value = scriptObj.getParameter({
            name: paramId
        });

        return value ? String(value).trim() : '';
    }

    function loadConfiguredSearch(paramKey) {
        const searchId = getParam(paramKey);

        if (!searchId) {
            throw new Error('Missing saved search parameter: ' + PARAMS[paramKey]);
        }

        return search.load({
            id: searchId
        });
    }

    function stripHierarchy(text) {
        if (!text) {
            return text;
        }

        const parts = String(text).split(':');
        return parts[parts.length - 1].trim();
    }

    function safeGetText(result, column) {
        try {
            const text = result.getText(column);
            if (text !== null && text !== undefined && text !== '') {
                return text;
            }
        } catch (e) {
            // Some formula or non-list columns do not support getText.
        }

        return '';
    }

    function safeGetValue(result, column) {
        try {
            const value = result.getValue(column);
            if (value !== null && value !== undefined) {
                return value;
            }
        } catch (e) {
            // Ignore and return blank.
        }

        return '';
    }

    function getCellValue(result, column) {
        const text = safeGetText(result, column);
        if (text !== '') {
            return stripHierarchy(text);
        }

        const value = safeGetValue(result, column);
        if (value !== null && value !== undefined) {
            return value;
        }

        return '';
    }

    function getColumnLabel(column, index) {
        if (column.label) {
            return column.label;
        }

        if (column.name) {
            return column.name;
        }

        return 'Column ' + (index + 1);
    }

    function getColumnMeta(columns) {
        return (columns || []).map(function (column, index) {
            return {
                key: 'c' + index,
                label: getColumnLabel(column, index),
                name: column.name || '',
                join: column.join || '',
                summary: column.summary || ''
            };
        });
    }

    function runDynamicSearch(searchObj, maxRows, includeTotal) {
        const nsColumns = searchObj.columns || [];
        const columns = getColumnMeta(nsColumns);
        const rows = [];
        let total = 0;

        if (includeTotal) {
            try {
                total = searchObj.runPaged().count;
            } catch (e) {
                log.error('runPaged count failed', e);
            }
        }

        searchObj.run().each(function (result) {
            const row = {
                internalId: result.id || '',
                recordType: result.recordType || ''
            };

            nsColumns.forEach(function (column, index) {
                row['c' + index] = getCellValue(result, column);
            });

            rows.push(row);

            return rows.length < maxRows;
        });

        return {
            total: includeTotal ? total : rows.length,
            columns: columns,
            rows: rows
        };
    }

    function joinWithAnd(expressions) {
        const clean = (expressions || []).filter(function (expr) {
            return expr && expr.length;
        });

        if (!clean.length) {
            return null;
        }

        let finalExpression = clean[0];

        for (let i = 1; i < clean.length; i++) {
            finalExpression = [
                finalExpression,
                'AND',
                clean[i]
            ];
        }

        return finalExpression;
    }

    function addDynamicExpression(searchObj, expression) {
        if (!expression || !expression.length) {
            return searchObj;
        }

        const existing = searchObj.filterExpression || [];

        if (existing && existing.length) {
            searchObj.filterExpression = [
                existing,
                'AND',
                expression
            ];
        } else {
            searchObj.filterExpression = expression;
        }

        return searchObj;
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
        const itemSearch = loadConfiguredSearch('itemDropdown');
        const columns = itemSearch.columns || [];

        itemSearch.run().each(function (result) {
            const labelParts = [];

            columns.forEach(function (column) {
                const value = getCellValue(result, column);
                if (value !== null && value !== undefined && value !== '') {
                    labelParts.push(value);
                }
            });

            rows.push({
                value: result.id,
                text: labelParts.length ? labelParts.join(' - ') : result.id
            });

            return rows.length < MAX_ITEM_OPTIONS;
        });

        return rows;
    }

    function getClassOptions() {
        const rows = [];
        const classSearch = loadConfiguredSearch('category');
        const columns = classSearch.columns || [];

        classSearch.run().each(function (result) {
            let text = '';

            if (columns.length) {
                text = getCellValue(result, columns[0]);
            }

            rows.push({
                value: result.id,
                text: stripHierarchy(text || result.id)
            });

            return true;
        });

        return rows;
    }

    function getSubsidiaryOptions() {
        const rows = [];
        const subSearch = loadConfiguredSearch('subsidiary');
        const columns = subSearch.columns || [];

        subSearch.run().each(function (result) {
            let text = '';

            if (columns.length) {
                text = getCellValue(result, columns[0]);
            }

            rows.push({
                value: result.id,
                text: stripHierarchy(text || result.id)
            });

            return true;
        });

        return rows;
    }

    // =========================================================
    // MAIN ITEM GRID SEARCH
    // =========================================================

    function searchItemsFiltered(params) {
        const itemSearch = loadConfiguredSearch('itemGrid');

        const dynamicFilters = [];

        // Default page load filter:
        // Only show items where Quantity On Hand is greater than 0.
        dynamicFilters.push(['quantityonhand', 'greaterthan', '0']);

        if (params.itemId) {
            dynamicFilters.push(['internalid', 'anyof', params.itemId]);
        }

        if (params.itemType) {
            dynamicFilters.push(['type', 'anyof', params.itemType]);
        }

        if (params.classId) {
            dynamicFilters.push(['class', 'anyof', params.classId]);
        }

        if (params.subsidiaryId) {
            dynamicFilters.push(['subsidiary', 'anyof', params.subsidiaryId]);
        }

        if (params.q) {
            dynamicFilters.push([
                ['nameornumber', 'contains', params.q],
                'OR',
                ['displayname', 'contains', params.q],
                'OR',
                ['salesdescription', 'contains', params.q]
            ]);
        }

        addDynamicExpression(itemSearch, joinWithAnd(dynamicFilters));

        return runDynamicSearch(itemSearch, MAX_GRID_ROWS, true);
    }

    // =========================================================
    // ITEM DETAIL
    // =========================================================

    function getItemFullDetail(itemId) {
        if (!itemId) {
            return {
                itemId: '',
                header: { columns: [], rows: [] },
                locations: { columns: [], rows: [] },
                vendors: { columns: [], rows: [] },
                bins: { columns: [], rows: [] }
            };
        }

        return {
            itemId: itemId,
            header: getItemHeader(itemId),
            locations: getItemLocations(itemId),
            vendors: getItemVendors(itemId),
            bins: getItemBins(itemId)
        };
    }

    function getItemHeader(itemId) {
        const headerSearch = loadConfiguredSearch('itemHeader');

        addDynamicExpression(headerSearch, [
            ['internalid', 'anyof', itemId]
        ]);

        return runDynamicSearch(headerSearch, 1, false);
    }

    function getItemLocations(itemId) {
        const locationSearch = loadConfiguredSearch('itemLocations');

        addDynamicExpression(locationSearch, [
            ['internalid', 'anyof', itemId]
        ]);

        return runDynamicSearch(locationSearch, MAX_DETAIL_ROWS, false);
    }

    function getItemVendors(itemId) {
        const vendorSearch = loadConfiguredSearch('itemVendors');

        addDynamicExpression(vendorSearch, [
            ['internalid', 'anyof', itemId]
        ]);

        return runDynamicSearch(vendorSearch, MAX_DETAIL_ROWS, false);
    }

    function getItemBins(itemId) {
        const binSearch = loadConfiguredSearch('binBalance');

        addDynamicExpression(binSearch, [
            ['item', 'anyof', itemId]
        ]);

        return runDynamicSearch(binSearch, MAX_DETAIL_ROWS, false);
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
        --paper: #EFF1EC;
        --panel: #FFFFFF;
        --ink: #14171C;
        --muted: #667085;
        --faint: #8B93A1;
        --line: #DDE1DC;
        --line-soft: #EAEDE9;
        --signal: #3D4A8A;
        --signal-dark: #2B3568;
        --signal-soft: #E8EAF5;
        --good: #146C43;
        --good-soft: #E3F3EA;
        --warn: #96591A;
        --warn-soft: #FBF0DE;
        --shadow: 0 1px 2px rgba(20,23,28,.04), 0 8px 20px rgba(20,23,28,.06);
        --radius: 12px;
        --radius-sm: 8px;
    }

    * {
        box-sizing: border-box;
    }

    body {
        margin: 0;
        background: var(--paper);
        color: var(--ink);
        font-family: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif;
        font-size: 14px;
        -webkit-font-smoothing: antialiased;
    }

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
        width: 6px;
        height: 6px;
        border-radius: 50%;
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

    input,
    select {
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

    input::placeholder {
        color: var(--faint);
    }

    input:focus,
    select:focus {
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

    .meta b {
        color: var(--ink);
        font-family: 'IBM Plex Mono', monospace;
    }

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

    tbody tr:nth-child(even) td {
        background: #FBFBFA;
    }

    tr:last-child td {
        border-bottom: none;
    }

    tr.clickable {
        cursor: pointer;
    }

    tr.clickable:hover td {
        background: var(--signal-soft);
    }

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

    .detail-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
    }

    .detail-head::before {
        content: '';
        position: absolute;
        left: 0;
        top: 20px;
        bottom: 20px;
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

    .tab-panel {
        display: none;
    }

    .tab-panel.active {
        display: block;
    }

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
        .filters {
            grid-template-columns: 1fr 1fr;
        }

        .header-grid {
            grid-template-columns: 1fr 1fr;
        }
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
                <label>Class / Category</label>
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
            <span>Default filter: Quantity On Hand &gt; 0</span>
        </div>

        <div class="table-wrap" style="margin-top:14px;">
            <table>
                <thead>
                    <tr id="gridHeadRow"></tr>
                </thead>
                <tbody id="gridRows">
                    <tr>
                        <td colspan="1" class="loading">Loading items...</td>
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
                            <tr id="locationHeadRow"></tr>
                        </thead>
                        <tbody id="locationRows"></tbody>
                    </table>
                </div>
            </div>

            <div id="vendorsTab" class="tab-panel">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr id="vendorHeadRow"></tr>
                        </thead>
                        <tbody id="vendorRows"></tbody>
                    </table>
                </div>
            </div>

            <div id="binsTab" class="tab-panel">
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr id="binHeadRow"></tr>
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

    function isNumericLabel(label) {
        label = String(label || '').toLowerCase();

        return (
            label.indexOf('quantity') !== -1 ||
            label.indexOf('qty') !== -1 ||
            label.indexOf('available') !== -1 ||
            label.indexOf('on hand') !== -1 ||
            label.indexOf('committed') !== -1 ||
            label.indexOf('back ordered') !== -1 ||
            label.indexOf('in transit') !== -1 ||
            label.indexOf('on order') !== -1 ||
            label.indexOf('cost') !== -1 ||
            label.indexOf('price') !== -1 ||
            label.indexOf('amount') !== -1 ||
            label.indexOf('value') !== -1 ||
            label.indexOf('rate') !== -1
        );
    }

    function formatValue(value, column) {
        if (value === null || value === undefined || value === '') {
            return '';
        }

        if (!isNumericLabel(column && column.label)) {
            return esc(value);
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

    function renderHead(headId, columns) {
        document.getElementById(headId).innerHTML = (columns || []).map(function (column) {
            var cls = isNumericLabel(column.label) ? ' class="num"' : '';
            return '<th' + cls + '>' + esc(column.label) + '</th>';
        }).join('');
    }

    function renderDynamicRows(bodyId, columns, rows, emptyText, clickable) {
        var body = document.getElementById(bodyId);
        columns = columns || [];
        rows = rows || [];

        if (!columns.length) {
            body.innerHTML = emptyRow(1, 'No columns found. Please check saved search results.');
            return;
        }

        if (!rows.length) {
            body.innerHTML = emptyRow(columns.length, emptyText);
            return;
        }

        body.innerHTML = rows.map(function (row) {
            var trClass = clickable ? ' class="clickable"' : '';
            var dataAttr = clickable ? ' data-item="' + esc(row.internalId) + '"' : '';

            return '<tr' + trClass + dataAttr + '>' + columns.map(function (column) {
                var value = row[column.key];
                var cls = isNumericLabel(column.label) ? 'num' : '';
                return td(formatValue(value, column), cls);
            }).join('') + '</tr>';
        }).join('');
    }

    function refreshGrid() {
        showError('');

        document.getElementById('gridHeadRow').innerHTML = '<th>Loading</th>';
        document.getElementById('gridRows').innerHTML =
            '<tr><td colspan="1" class="loading">Loading items...</td></tr>';

        api('itemSearch', currentFilters()).then(function (data) {
            var columns = data.columns || [];
            var rows = data.rows || [];

            document.getElementById('totalCount').innerHTML = esc(data.total || 0);

            renderHead('gridHeadRow', columns);
            renderDynamicRows('gridRows', columns, rows, 'No items found for selected filters.', true);

            var clickableRows = document.querySelectorAll('#gridRows tr[data-item]');

            clickableRows.forEach(function (row) {
                row.addEventListener('click', function () {
                    openItem(row.getAttribute('data-item'));
                });
            });

        }).catch(function (e) {
            showError(e.message);
            document.getElementById('gridHeadRow').innerHTML = '<th>Error</th>';
            document.getElementById('gridRows').innerHTML = emptyRow(1, 'Unable to load item results.');
        });
    }

    function findColumnValue(dataSet, matchList) {
        var columns = dataSet.columns || [];
        var row = (dataSet.rows || [])[0] || {};

        for (var i = 0; i < columns.length; i++) {
            var column = columns[i];
            var haystack = String((column.name || '') + ' ' + (column.label || '')).toLowerCase();

            for (var j = 0; j < matchList.length; j++) {
                if (haystack.indexOf(matchList[j].toLowerCase()) !== -1) {
                    return row[column.key] || '';
                }
            }
        }

        return '';
    }

    function firstNonEmptyValue(dataSet) {
        var columns = dataSet.columns || [];
        var row = (dataSet.rows || [])[0] || {};

        for (var i = 0; i < columns.length; i++) {
            var value = row[columns[i].key];

            if (value !== null && value !== undefined && value !== '') {
                return value;
            }
        }

        return '';
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

        document.getElementById('locationHeadRow').innerHTML = '<th>Loading</th>';
        document.getElementById('locationRows').innerHTML = emptyRow(1, 'Loading locations...');

        document.getElementById('vendorHeadRow').innerHTML = '<th>Loading</th>';
        document.getElementById('vendorRows').innerHTML = emptyRow(1, 'Loading vendors...');

        document.getElementById('binHeadRow').innerHTML = '<th>Loading</th>';
        document.getElementById('binRows').innerHTML = emptyRow(1, 'Loading bins...');

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
        var header = data.header || {
            columns: [],
            rows: []
        };

        var itemName =
            findColumnValue(header, ['itemid']) ||
            findColumnValue(header, ['name']) ||
            firstNonEmptyValue(header) ||
            'Item Detail';

        var displayName =
            findColumnValue(header, ['displayname', 'display name']) ||
            '';

        var description =
            findColumnValue(header, ['salesdescription', 'description']) ||
            '';

        var inactiveValue =
            findColumnValue(header, ['isinactive', 'inactive']) ||
            '';

        var isInactive =
            inactiveValue === true ||
            inactiveValue === 'T' ||
            String(inactiveValue).toLowerCase() === 'true' ||
            String(inactiveValue).toLowerCase() === 'yes';

        document.getElementById('itemTitle').innerHTML =
            esc(itemName) +
            ' <span class="badge ' + (!isInactive ? 'active' : '') + '">' +
            esc(isInactive ? 'Inactive' : 'Active') +
            '</span>';

        document.getElementById('itemDesc').innerHTML =
            (displayName ? '<b>' + esc(displayName) + '</b>' : '') +
            (description ? '<br>' + esc(description) : '');

        renderHeaderCards(header);

        renderHead('locationHeadRow', (data.locations || {}).columns || []);
        renderDynamicRows(
            'locationRows',
            (data.locations || {}).columns || [],
            (data.locations || {}).rows || [],
            'No location inventory found for this item.',
            false
        );

        renderHead('vendorHeadRow', (data.vendors || {}).columns || []);
        renderDynamicRows(
            'vendorRows',
            (data.vendors || {}).columns || [],
            (data.vendors || {}).rows || [],
            'No vendor details found for this item.',
            false
        );

        renderHead('binHeadRow', (data.bins || {}).columns || []);
        renderDynamicRows(
            'binRows',
            (data.bins || {}).columns || [],
            (data.bins || {}).rows || [],
            'No bin balance found for this item.',
            false
        );
    }

    function renderHeaderCards(header) {
        var columns = header.columns || [];
        var row = (header.rows || [])[0] || {};

        if (!columns.length) {
            document.getElementById('headerGrid').innerHTML =
                '<div class="loading">No item header columns found.</div>';
            return;
        }

        document.getElementById('headerGrid').innerHTML = columns.map(function (column) {
            var value = row[column.key];

            return '<div class="kv">' +
                '<div class="k">' + esc(column.label) + '</div>' +
                '<div class="v">' + formatValue(value, column) + '</div>' +
                '</div>';
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