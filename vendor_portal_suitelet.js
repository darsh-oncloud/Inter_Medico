/**
 * Vendor Portal Suitelet
 *
 * Internal rep-facing vendor lookup: search any vendor, then view
 * Open POs / PO History / Open Bills / Payments / In Transit /
 * Returns / Items Supplied for that vendor.
 *
 * All data comes from saved searches configured as script parameters —
 * no hardcoded record logic beyond wiring the per-vendor filter.
 *
 * Every section is OPTIONAL except the grid + header. If a parameter is
 * left blank, that filter / tab is simply not rendered. This lets you
 * deploy with 3 searches today and add the rest later without a code change.
 *
 * Parameter IDs:
 * custscript_vp_vendor_dropdown
 * custscript_vp_category_dropdown
 * custscript_vp_subsidiary_dropdown
 * custscript_vp_vendor_grid
 * custscript_vp_vendor_header
 * custscript_vp_open_pos
 * custscript_vp_po_history
 * custscript_vp_open_bills
 * custscript_vp_bill_payments
 * custscript_vp_in_transit
 * custscript_vp_vendor_returns
 * custscript_vp_vendor_items
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'], function (search, url, runtime, log) {

    const MAX_DROPDOWN_OPTIONS = 1000;
    const MAX_GRID_ROWS = 500;
    const MAX_DETAIL_ROWS = 1000;

    const PARAMS = {
        vendorDropdown: 'custscript_vp_vendor_dropdown',
        categoryDropdown: 'custscript_vp_category_dropdown',
        subsidiaryDropdown: 'custscript_vp_subsidiary_dropdown',
        vendorGrid: 'custscript_vp_vendor_grid',
        vendorHeader: 'custscript_vp_vendor_header',
        openPOs: 'custscript_vp_open_pos',
        poHistory: 'custscript_vp_po_history',
        openBills: 'custscript_vp_open_bills',
        billPayments: 'custscript_vp_bill_payments',
        inTransit: 'custscript_vp_in_transit',
        vendorReturns: 'custscript_vp_vendor_returns',
        vendorItems: 'custscript_vp_vendor_items'
    };

    // Grid filter dropdowns. Each one is skipped (and hidden in the UI)
    // when its parameter is blank.
    const FILTER_SOURCES = [
        {
            key: 'vendors',
            paramKey: 'vendorDropdown',
            gridFilterField: 'internalid'
        },
        {
            key: 'categories',
            paramKey: 'categoryDropdown',
            gridFilterField: 'category'
        },
        {
            key: 'subsidiaries',
            paramKey: 'subsidiaryDropdown',
            gridFilterField: 'subsidiary'
        }
    ];

    // The vendor header card strip. Always a single row.
    const HEADER_SECTION = {
        key: 'header',
        paramKey: 'vendorHeader',
        filterField: 'internalid',
        maxRows: 1,
        includeTotal: false
    };

    // One tab per section, rendered in this order.
    // filterField = the field on THAT saved search that points at the vendor.
    //   'entity' for transaction searches, 'vendor' for item searches.
    const DETAIL_SECTIONS = [
        {
            key: 'openPOs',
            paramKey: 'openPOs',
            label: 'Open Purchase Orders',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No open purchase orders for this vendor.'
        },
        {
            key: 'poHistory',
            paramKey: 'poHistory',
            label: 'PO History',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No purchase order history for this vendor.'
        },
        {
            key: 'openBills',
            paramKey: 'openBills',
            label: 'Open Bills',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No open bills for this vendor.'
        },
        {
            key: 'billPayments',
            paramKey: 'billPayments',
            label: 'Payments',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No payments recorded for this vendor.'
        },
        {
            key: 'inTransit',
            paramKey: 'inTransit',
            label: 'In Transit',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'Nothing currently in transit from this vendor.'
        },
        {
            key: 'vendorReturns',
            paramKey: 'vendorReturns',
            label: 'Returns',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No vendor returns for this vendor.'
        },
        {
            key: 'vendorItems',
            paramKey: 'vendorItems',
            label: 'Items Supplied',
            filterField: 'vendor',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false,
            empty: 'No items linked to this vendor.'
        }
    ];

    /* ------------------------------------------------------------------ */
    /* Entry point                                                         */
    /* ------------------------------------------------------------------ */

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

            if (action === 'vendorSearch') {
                sendJson(response, searchVendorsFiltered(request.parameters));
                return;
            }

            if (action === 'vendorDetail') {
                sendJson(
                    response,
                    getVendorFullDetail(request.parameters.vendorId)
                );
                return;
            }

            sendJson(response, {
                error: 'Unknown action: ' + action
            });

        } catch (e) {
            log.error('Vendor Portal Error', {
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

    /* ------------------------------------------------------------------ */
    /* Parameters                                                          */
    /* ------------------------------------------------------------------ */

    let paramCache = null;

    function getParam(paramKey) {
        if (!paramCache) {
            paramCache = {};

            const scriptObj = runtime.getCurrentScript();

            Object.keys(PARAMS).forEach(function (key) {
                let value = '';

                try {
                    value = scriptObj.getParameter({
                        name: PARAMS[key]
                    });
                } catch (e) {
                    log.debug('Parameter not found', PARAMS[key]);
                }

                paramCache[key] = value ? String(value).trim() : '';
            });
        }

        return paramCache[paramKey] || '';
    }

    function hasParam(paramKey) {
        return getParam(paramKey) !== '';
    }

    function loadConfiguredSearch(paramKey) {
        const searchId = getParam(paramKey);

        if (!searchId) {
            throw new Error(
                'Missing saved search parameter: ' + PARAMS[paramKey]
            );
        }

        return search.load({
            id: searchId
        });
    }

    /* ------------------------------------------------------------------ */
    /* Result helpers                                                      */
    /* ------------------------------------------------------------------ */

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
            // Formula / non-list fields do not support getText.
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
            // Ignore.
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

    // Builds a NetSuite record view URL via N/url.resolveRecord.
    // Returns '' on failure so callers fall back to "not clickable".
    function buildRecordUrl(recordType, internalId, isEditMode) {
        if (!recordType || !internalId) {
            return '';
        }

        try {
            return url.resolveRecord({
                recordType: recordType,
                recordId: internalId,
                isEditMode: !!isEditMode
            });
        } catch (e) {
            log.debug('buildRecordUrl failed', {
                recordType: recordType,
                internalId: internalId,
                message: e.message
            });

            return '';
        }
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
                /*
                 * NetSuite supplies the record internal ID through result.id.
                 * It does not have to be a saved-search Results column.
                 */
                internalId: result.id || '',
                recordType: result.recordType || ''
            };

            nsColumns.forEach(function (column, index) {
                row['c' + index] = getCellValue(result, column);
            });

            row.viewUrl = buildRecordUrl(row.recordType, row.internalId);

            rows.push(row);

            return rows.length < maxRows;
        });

        return {
            total: includeTotal ? total : rows.length,
            columns: columns,
            rows: rows
        };
    }

    function buildAndExpression(expressions) {
        const clean = (expressions || []).filter(function (expr) {
            return expr && expr.length;
        });

        if (!clean.length) {
            return null;
        }

        let finalExpression = clean[0];

        for (let i = 1; i < clean.length; i++) {
            finalExpression = [finalExpression, 'AND', clean[i]];
        }

        return finalExpression;
    }

    function addDynamicExpression(searchObj, expression) {
        if (!expression || !expression.length) {
            return searchObj;
        }

        const existing = searchObj.filterExpression || [];

        if (existing && existing.length) {
            searchObj.filterExpression = [existing, 'AND', expression];
        } else {
            searchObj.filterExpression = expression;
        }

        return searchObj;
    }

    function safeSection(sectionName, callback) {
        try {
            return callback();
        } catch (e) {
            log.error(sectionName + ' failed', e);

            return {
                total: 0,
                columns: [],
                rows: [],
                error: e.message || String(e)
            };
        }
    }

    function sortRowsByColumnDesc(dataSet, matchTerms) {
        const columns = dataSet.columns || [];
        let targetKey = null;

        for (let i = 0; i < columns.length; i++) {
            const haystack = (
                String(columns[i].name || '') +
                ' ' +
                String(columns[i].label || '')
            ).toLowerCase();

            for (let j = 0; j < matchTerms.length; j++) {
                if (haystack.indexOf(matchTerms[j]) !== -1) {
                    targetKey = columns[i].key;
                    break;
                }
            }

            if (targetKey) {
                break;
            }
        }

        if (!targetKey) {
            return dataSet;
        }

        dataSet.rows.sort(function (a, b) {
            const av = Number(String(a[targetKey] || 0).replace(/,/g, '')) || 0;
            const bv = Number(String(b[targetKey] || 0).replace(/,/g, '')) || 0;

            return bv - av;
        });

        return dataSet;
    }

    /* ------------------------------------------------------------------ */
    /* Dropdowns                                                           */
    /* ------------------------------------------------------------------ */

    function getFilterOptions() {
        const result = {};

        FILTER_SOURCES.forEach(function (source) {
            if (!hasParam(source.paramKey)) {
                result[source.key] = [];
                return;
            }

            result[source.key] = safeSection(source.key, function () {
                return getDropdownOptions(source.paramKey);
            }).rows || [];
        });

        return result;
    }

    /*
     * Generic dropdown builder.
     *
     * Value:  the first column named "internalid" (or labelled "Internal ID"
     *         / "Value") if one exists, otherwise result.id.
     *         This is what makes GROUPED searches usable as dropdowns —
     *         e.g. a Vendor search grouped by Category with a formula column
     *         {category.id} labelled "Internal ID".
     * Text:   the first column that is not the value column.
     */
    function getDropdownOptions(paramKey) {
        const searchObj = loadConfiguredSearch(paramKey);
        const columns = searchObj.columns || [];

        let valueIndex = -1;

        for (let i = 0; i < columns.length; i++) {
            const name = String(columns[i].name || '').toLowerCase();
            const label = String(columns[i].label || '').toLowerCase();

            if (
                name === 'internalid' ||
                label === 'internal id' ||
                label === 'internalid' ||
                label === 'value'
            ) {
                valueIndex = i;
                break;
            }
        }

        let labelIndex = 0;

        if (labelIndex === valueIndex) {
            labelIndex = columns.length > 1 ? 1 : -1;
        }

        const rows = [];
        const seen = {};

        searchObj.run().each(function (result) {
            let value = '';

            if (valueIndex >= 0) {
                value = safeGetValue(result, columns[valueIndex]);
            }

            if (value === '' || value === null || value === undefined) {
                value = result.id || '';
            }

            let text = '';

            if (labelIndex >= 0) {
                text = getCellValue(result, columns[labelIndex]);
            }

            value = String(value);

            if (value && !seen[value]) {
                seen[value] = true;

                rows.push({
                    value: value,
                    text: stripHierarchy(String(text || value))
                });
            }

            return rows.length < MAX_DROPDOWN_OPTIONS;
        });

        rows.sort(function (a, b) {
            return String(a.text).toLowerCase() < String(b.text).toLowerCase()
                ? -1
                : 1;
        });

        return {
            rows: rows
        };
    }

    /* ------------------------------------------------------------------ */
    /* Vendor grid                                                         */
    /* ------------------------------------------------------------------ */

    function searchVendorsFiltered(params) {
        const vendorSearch = loadConfiguredSearch('vendorGrid');
        const dynamicFilters = [];

        if (params.vendorId) {
            dynamicFilters.push(['internalid', 'anyof', params.vendorId]);
        }

        if (params.categoryId) {
            dynamicFilters.push(['category', 'anyof', params.categoryId]);
        }

        if (params.subsidiaryId) {
            dynamicFilters.push(['subsidiary', 'anyof', params.subsidiaryId]);
        }

        if (params.q) {
            dynamicFilters.push([
                ['companyname', 'contains', params.q],
                'OR',
                ['entityid', 'contains', params.q],
                'OR',
                ['email', 'contains', params.q],
                'OR',
                ['phone', 'contains', params.q]
            ]);
        }

        addDynamicExpression(vendorSearch, buildAndExpression(dynamicFilters));

        const result = runDynamicSearch(vendorSearch, MAX_GRID_ROWS, true);

        sortRowsByColumnDesc(result, [
            'balance',
            'unbilled orders',
            'unbilledorders',
            'amount'
        ]);

        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Vendor detail                                                       */
    /* ------------------------------------------------------------------ */

    function getEnabledSections() {
        return DETAIL_SECTIONS.filter(function (section) {
            return hasParam(section.paramKey);
        }).map(function (section) {
            return {
                key: section.key,
                label: section.label,
                empty: section.empty
            };
        });
    }

    function getEnabledFilters() {
        const enabled = {};

        FILTER_SOURCES.forEach(function (source) {
            enabled[source.key] = hasParam(source.paramKey);
        });

        return enabled;
    }

    function getDetailSection(sectionConfig, vendorId) {
        const sectionSearch = loadConfiguredSearch(sectionConfig.paramKey);

        const filters = [
            [sectionConfig.filterField, 'anyof', vendorId]
        ].concat(sectionConfig.extraFilters || []);

        addDynamicExpression(sectionSearch, buildAndExpression(filters));

        return runDynamicSearch(
            sectionSearch,
            sectionConfig.maxRows,
            sectionConfig.includeTotal
        );
    }

    function emptyDetailResult(vendorId) {
        const result = {
            vendorId: vendorId || '',
            header: {
                columns: [],
                rows: []
            }
        };

        DETAIL_SECTIONS.forEach(function (section) {
            result[section.key] = {
                columns: [],
                rows: []
            };
        });

        return result;
    }

    function getVendorFullDetail(vendorId) {
        if (!vendorId) {
            return emptyDetailResult('');
        }

        const result = {
            vendorId: vendorId
        };

        result.header = safeSection('header', function () {
            return getDetailSection(HEADER_SECTION, vendorId);
        });

        DETAIL_SECTIONS.forEach(function (section) {
            if (!hasParam(section.paramKey)) {
                return;
            }

            result[section.key] = safeSection(section.key, function () {
                return getDetailSection(section, vendorId);
            });
        });

        return result;
    }

    /* ------------------------------------------------------------------ */
    /* Page                                                                */
    /* ------------------------------------------------------------------ */

    function renderPage() {
        const scriptObj = runtime.getCurrentScript();

        const suiteletUrl = url.resolveScript({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            returnExternalUrl: false
        });

        return buildHtml()
            .replace('__SUITELET_URL_JSON__', JSON.stringify(suiteletUrl))
            .replace('__SECTIONS_JSON__', JSON.stringify(getEnabledSections()))
            .replace('__FILTERS_JSON__', JSON.stringify(getEnabledFilters()));
    }

    function buildHtml() {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vendor Portal</title>

<link rel="preconnect" href="https://fonts.googleapis.com">

<link
    href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
    rel="stylesheet"
>

<style>
:root { --paper: #EFF1EC; --panel: #FFFFFF; --ink: #14171C; --muted: #667085; --faint: #8B93A1; --line: #DDE1DC; --line-soft: #EAEDE9; --signal: #3D4A8A; --signal-dark: #2B3568; --signal-soft: #E8EAF5; --good: #146C43; --good-soft: #E3F3EA; --warn: #96591A; --warn-soft: #FBF0DE; --shadow: 0 1px 2px rgba(20,23,28,.04), 0 8px 20px rgba(20,23,28,.06); --radius: 12px; --radius-sm: 8px; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: 'Inter', system-ui, -apple-system, Segoe UI, sans-serif; font-size: 14px; -webkit-font-smoothing: antialiased; }
.page { max-width: 1450px; margin: 0 auto; padding: 32px 28px 60px; }
.topbar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 22px; }
.eyebrow { font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--signal); font-weight: 600; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 3px var(--good-soft); }
.title { font-family: 'Space Grotesk', sans-serif; font-size: 27px; font-weight: 700; margin: 0; letter-spacing: -.01em; }
.subtitle { color: var(--muted); margin-top: 6px; font-size: 13px; max-width: 620px; line-height: 1.5; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; margin-bottom: 18px; position: relative; }
.filters { display: grid; grid-template-columns: 2fr 1fr 1fr auto; gap: 12px; align-items: end; }
label { display: block; font-size: 10.5px; text-transform: uppercase; color: var(--faint); letter-spacing: .07em; font-weight: 700; margin-bottom: 6px; }
input, select { width: 100%; height: 38px; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 8px 11px; background: var(--panel); color: var(--ink); outline: none; font-family: 'Inter', sans-serif; font-size: 13.5px; transition: border-color .12s ease; }
input::placeholder { color: var(--faint); }
input:focus, select:focus { border-color: var(--signal); box-shadow: 0 0 0 3px var(--signal-soft); }
.btn { height: 38px; border: 1px solid var(--line); background: var(--panel); border-radius: var(--radius-sm); padding: 0 15px; cursor: pointer; font-weight: 600; font-size: 13px; color: var(--ink); transition: border-color .12s ease, color .12s ease; }
.btn:hover { border-color: var(--signal); color: var(--signal-dark); }
.btn:disabled { opacity: .45; cursor: not-allowed; }
.btn:disabled:hover { border-color: var(--line); color: var(--ink); }
.btn-primary { background: var(--signal); border-color: var(--signal); color: #fff; }
.btn-primary:hover { background: var(--signal-dark); border-color: var(--signal-dark); color: #fff; }
.btn-group { display: flex; gap: 8px; flex-wrap: wrap; }
.meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
.meta b { color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.table-wrap { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
table { width: 100%; border-collapse: collapse; min-width: 900px; }
th { background: #F7F8F5; color: var(--muted); text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; padding: 11px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
th.sortable { cursor: pointer; user-select: none; }
th.sortable:hover { color: var(--signal-dark); }
th .arrow { color: var(--signal); margin-left: 4px; }
td { padding: 10px 12px; border-bottom: 1px solid var(--line-soft); vertical-align: top; font-size: 13px; }
tbody tr:nth-child(even) td { background: #FBFBFA; }
tbody tr:last-child td { border-bottom: none; }
tfoot td { background: #F7F8F5; font-weight: 700; border-top: 1px solid var(--line); border-bottom: none; font-size: 12.5px; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: var(--signal-soft); }
.num { text-align: right; font-family: 'IBM Plex Mono', monospace; font-variant-numeric: tabular-nums; }
.badge { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--line-soft); color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .02em; }
.badge.active { background: var(--good-soft); color: var(--good); }
.badge.warn { background: var(--warn-soft); color: var(--warn); }
.row-link { color: var(--signal-dark); text-decoration: underline; text-decoration-color: var(--signal); text-underline-offset: 2px; }
.row-link:hover { color: var(--signal); }
.detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.detail-head::before { content: ''; position: absolute; left: 0; top: 20px; bottom: 20px; width: 4px; border-radius: 0 3px 3px 0; background: var(--signal); }
.item-title { font-family: 'Space Grotesk', sans-serif; font-size: 25px; font-weight: 700; margin: 10px 0 6px; letter-spacing: -.01em; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.item-desc { color: var(--muted); max-width: 850px; line-height: 1.5; font-size: 13.5px; }
.header-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
.kv { background: #F8F9F6; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 13px; min-height: 72px; }
.kv .k { font-size: 10.5px; text-transform: uppercase; color: var(--faint); letter-spacing: .06em; font-weight: 700; margin-bottom: 7px; }
.kv .v { font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; font-weight: 600; word-break: break-word; color: var(--ink); }
.tabs { display: flex; gap: 26px; margin-bottom: 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.tab-btn { border: none; background: none; padding: 10px 2px; cursor: pointer; font-weight: 600; font-size: 13.5px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: 'Inter', sans-serif; }
.tab-btn.active { color: var(--signal-dark); border-bottom-color: var(--signal); }
.tab-btn .tab-pill { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; color: var(--faint); margin-left: 6px; }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.tab-filter-bar { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-bottom: 14px; padding: 12px 14px; background: #F8F9F6; border: 1px solid var(--line); border-radius: var(--radius-sm); }
.tf-field { min-width: 130px; }
.tf-field label { margin-bottom: 4px; }
.tf-field input, .tf-field select { height: 34px; font-size: 12.5px; }
.tf-field.tf-q-field { min-width: 220px; flex: 1 1 220px; }
.tf-field.tf-actions { margin-left: auto; min-width: 0; display: flex; gap: 8px; align-items: center; }
.tf-field.tf-actions .btn { height: 34px; padding: 0 12px; font-size: 12px; }
.tf-count { font-size: 11.5px; color: var(--faint); white-space: nowrap; }
.empty { padding: 38px; text-align: center; color: var(--faint); font-size: 13px; }
.loading { padding: 22px; color: var(--muted); text-align: center; font-size: 13px; }
.error { background: var(--warn-soft); color: var(--warn); border: 1px solid #EBC994; padding: 12px 14px; border-radius: var(--radius-sm); margin-bottom: 14px; display: none; font-size: 13px; font-weight: 500; }
.section-error { background: var(--warn-soft); color: var(--warn); border: 1px solid #EBC994; padding: 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
.hidden { display: none !important; }
@media (max-width: 1000px) { .filters { grid-template-columns: 1fr 1fr; }
.header-grid { grid-template-columns: 1fr 1fr; }
.page { padding: 20px 14px 40px; }
}
</style></head><body><div class="page"><div class="topbar"><div><div class="eyebrow"><span class="dot"></span>
Vendor Records
</div><h1 class="title">Vendor Portal</h1><div class="subtitle">
Search any vendor, then review open purchase orders, PO history,
open bills, payments, in-transit receipts, returns and supplied items.
</div></div></div><div id="errorBox" class="error"></div><div id="gridSection" class="card"><div class="filters"><div><label>Search</label><input
id="fQ"
placeholder="Vendor name, ID, email, or phone"
></div><div id="fVendorField"><label>Vendor</label><select id="fVendor"><option value="">All Vendors</option></select></div><div id="fCategoryField"><label>Category</label><select id="fCategory"><option value="">All Categories</option></select></div><div id="fSubField"><label>Subsidiary</label><select id="fSub"><option value="">All Subsidiaries</option></select></div><div><label>&nbsp;</label><button id="clearBtn" class="btn">
Clear
</button></div></div><div class="meta"><span>
Total Results:
<b id="totalCount">0</b></span><span>
Sorted by highest balance first
</span></div><div
class="table-wrap"
style="margin-top:14px;"
><table><thead><tr id="gridHeadRow"></tr></thead><tbody id="gridRows"><tr><td
colspan="1"
class="loading"
>
Loading vendors...
</td></tr></tbody></table></div></div><div
id="detailSection"
style="display:none;"
><div class="card"><div class="detail-head"><div><button
id="backBtn"
class="btn"
>
&larr; Back to Results
</button><div
id="vendTitle"
class="item-title"
></div><div
id="vendDesc"
class="item-desc"
></div></div><div class="btn-group"><button
id="viewRecordBtn"
class="btn"
disabled
>
View Record &#8599;
</button><button
id="exportTabBtn"
class="btn"
>
Export Tab
</button><button
id="exportBtn"
class="btn"
>
Export All
</button><button
id="refreshDetailBtn"
class="btn btn-primary"
>
Refresh Vendor
</button></div></div><div id="headerError"></div><div
id="headerGrid"
class="header-grid"
></div></div><div class="card"><div class="tabs" id="detailTabs"></div><div id="detailPanels"></div></div></div></div><script>
(function () {
    var SUITELET_URL = __SUITELET_URL_JSON__;
    var SECTIONS = __SECTIONS_JSON__;
    var FILTERS = __FILTERS_JSON__;

    var currentVendorId = "";
    var currentVendorViewUrl = "";
    var currentDetailData = null;
    var activeTabKey = SECTIONS.length ? SECTIONS[0].key : "";
    var tabState = {};
    var gridState = { sortKey: null, sortDir: 0 };
    var gridColumns = [];
    var gridRows = [];

    /* ---------------- utilities ---------------- */

    function esc(value) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function isNumericLabel(label) {
        label = String(label || "").toLowerCase();
        return label.indexOf("quantity") !== -1 ||
            label.indexOf("qty") !== -1 ||
            label.indexOf("amount") !== -1 ||
            label.indexOf("balance") !== -1 ||
            label.indexOf("credit") !== -1 ||
            label.indexOf("cost") !== -1 ||
            label.indexOf("price") !== -1 ||
            label.indexOf("value") !== -1 ||
            label.indexOf("total") !== -1 ||
            label.indexOf("rate") !== -1;
    }

    function isTotalableLabel(label) {
        label = String(label || "").toLowerCase();
        if (label.indexOf("rate") !== -1 || label.indexOf("price") !== -1) {
            return false;
        }
        return isNumericLabel(label);
    }

    function toNumber(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        var n = Number(String(value).replace(/[$,]/g, "").trim());
        return isNaN(n) ? null : n;
    }

    function formatNumber(n) {
        return n.toLocaleString("en-US", {
            minimumFractionDigits: n % 1 === 0 ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    function formatValue(value, column) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (value === true || String(value) === "T") {
            return "Yes";
        }
        if (value === false || String(value) === "F") {
            return "No";
        }
        if (!isNumericLabel(column && column.label)) {
            return esc(value);
        }
        var n = toNumber(value);
        if (n === null) {
            return esc(value);
        }
        return formatNumber(n);
    }

    function td(value, cls) {
        return "<td" + (cls ? ' class="' + cls + '"' : "") + ">" +
            (value || "") + "</td>";
    }

    function emptyRow(colspan, text) {
        return "<tr><td colspan=\"" + colspan + "\" class=\"empty\">" +
            esc(text) + "</td></tr>";
    }

    function showError(message) {
        var box = document.getElementById("errorBox");
        if (!message) {
            box.style.display = "none";
            box.innerHTML = "";
            return;
        }
        box.innerHTML = esc(message);
        box.style.display = "block";
    }

    function showSectionError(id, message) {
        var el = document.getElementById(id);
        if (!el) {
            return;
        }
        if (!message) {
            el.innerHTML = "";
            return;
        }
        el.innerHTML = '<div class="section-error">' + esc(message) + "</div>";
    }

    function api(action, params) {
        params = params || {};
        var query = [];
        Object.keys(params).forEach(function (key) {
            if (params[key] !== null &&
                params[key] !== undefined &&
                params[key] !== "") {
                query.push(
                    encodeURIComponent(key) + "=" +
                    encodeURIComponent(params[key])
                );
            }
        });
        var joiner = SUITELET_URL.indexOf("?") === -1 ? "?" : "&";
        var finalUrl = SUITELET_URL + joiner + "action=" +
            encodeURIComponent(action);
        if (query.length) {
            finalUrl += "&" + query.join("&");
        }
        return fetch(finalUrl, { credentials: "same-origin" })
            .then(function (response) { return response.json(); })
            .then(function (data) {
                if (data && data.error) {
                    throw new Error(data.error);
                }
                return data;
            });
    }

    function getColumnKeyByKeywords(columns, keywords) {
        for (var i = 0; i < (columns || []).length; i++) {
            var haystack = String(
                (columns[i].name || "") + " " + (columns[i].label || "")
            ).toLowerCase();
            for (var j = 0; j < keywords.length; j++) {
                if (haystack.indexOf(keywords[j]) !== -1) {
                    return columns[i].key;
                }
            }
        }
        return null;
    }

    function findDocColumnKey(columns) {
        for (var i = 0; i < (columns || []).length; i++) {
            var nm = String(columns[i].name || "").toLowerCase();
            var lbl = String(columns[i].label || "").toLowerCase();
            if (nm === "tranid" ||
                nm === "documentnumber" ||
                nm === "itemid" ||
                nm === "entityid" ||
                lbl.indexOf("document number") !== -1) {
                return columns[i].key;
            }
        }
        return null;
    }

    function parseRowDate(value) {
        if (!value) {
            return null;
        }
        var d = new Date(value);
        if (isNaN(d.getTime())) {
            var parts = String(value).split("/");
            if (parts.length === 3) {
                d = new Date(
                    Number(parts[2]),
                    Number(parts[0]) - 1,
                    Number(parts[1])
                );
            }
        }
        return isNaN(d.getTime()) ? null : d;
    }

    /* ---------------- tab construction ---------------- */

    function filterBarHtml(key) {
        return '<div class="tab-filter-bar" data-tab-key="' + esc(key) + '">' +
            '<div class="tf-field tf-q-field"><label>Search</label>' +
            '<input type="text" class="tf-q" placeholder="Filter this tab..."></div>' +
            '<div class="tf-field"><label>Type</label>' +
            '<select class="tf-type"><option value="">All Types</option></select></div>' +
            '<div class="tf-field"><label>Status</label>' +
            '<select class="tf-status"><option value="">All Statuses</option></select></div>' +
            '<div class="tf-field"><label>Date From</label>' +
            '<input type="date" class="tf-date-from"></div>' +
            '<div class="tf-field"><label>Date To</label>' +
            '<input type="date" class="tf-date-to"></div>' +
            '<div class="tf-field tf-actions">' +
            '<span class="tf-count"></span>' +
            '<button class="btn tf-clear" type="button">Clear</button>' +
            "</div></div>";
    }

    function buildTabs() {
        var tabsEl = document.getElementById("detailTabs");
        var panelsEl = document.getElementById("detailPanels");

        if (!SECTIONS.length) {
            panelsEl.innerHTML = '<div class="empty">' +
                "No detail saved searches are configured on this deployment." +
                "</div>";
            return;
        }

        tabsEl.innerHTML = SECTIONS.map(function (section, index) {
            return '<button class="tab-btn' + (index === 0 ? " active" : "") +
                '" data-tab="' + esc(section.key) + '">' +
                esc(section.label) +
                '<span class="tab-pill" id="pill_' + esc(section.key) +
                '"></span></button>';
        }).join("");

        panelsEl.innerHTML = SECTIONS.map(function (section, index) {
            return '<div id="panel_' + esc(section.key) + '" class="tab-panel' +
                (index === 0 ? " active" : "") + '">' +
                filterBarHtml(section.key) +
                '<div id="err_' + esc(section.key) + '"></div>' +
                '<div class="table-wrap"><table>' +
                '<thead><tr id="head_' + esc(section.key) + '"></tr></thead>' +
                '<tbody id="rows_' + esc(section.key) + '"></tbody>' +
                '<tfoot id="foot_' + esc(section.key) + '"></tfoot>' +
                "</table></div></div>";
        }).join("");

        tabsEl.querySelectorAll(".tab-btn").forEach(function (btn) {
            btn.addEventListener("click", function () {
                var key = btn.getAttribute("data-tab");
                activeTabKey = key;
                tabsEl.querySelectorAll(".tab-btn").forEach(function (b) {
                    b.classList.remove("active");
                });
                panelsEl.querySelectorAll(".tab-panel").forEach(function (p) {
                    p.classList.remove("active");
                });
                btn.classList.add("active");
                document.getElementById("panel_" + key).classList.add("active");
            });
        });
    }

    function sectionByKey(key) {
        for (var i = 0; i < SECTIONS.length; i++) {
            if (SECTIONS[i].key === key) {
                return SECTIONS[i];
            }
        }
        return null;
    }

    function getTabState(key) {
        if (!tabState[key]) {
            tabState[key] = {
                q: "",
                type: "",
                status: "",
                dateFrom: "",
                dateTo: "",
                sortKey: null,
                sortDir: 0
            };
        }
        return tabState[key];
    }

    function resetTabState(key) {
        tabState[key] = {
            q: "",
            type: "",
            status: "",
            dateFrom: "",
            dateTo: "",
            sortKey: null,
            sortDir: 0
        };
    }

    /* ---------------- filtering + sorting ---------------- */

    function applyTabFilters(data, key) {
        data = data || { columns: [], rows: [] };
        var columns = data.columns || [];
        var rows = data.rows || [];
        var state = getTabState(key);

        var typeKey = getColumnKeyByKeywords(columns, ["type"]);
        var statusKey = getColumnKeyByKeywords(columns, ["status"]);
        var dateKey = getColumnKeyByKeywords(columns, ["date"]);

        var filtered = rows.filter(function (row) {
            if (state.type && typeKey &&
                String(row[typeKey] || "") !== state.type) {
                return false;
            }
            if (state.status && statusKey &&
                String(row[statusKey] || "") !== state.status) {
                return false;
            }
            if ((state.dateFrom || state.dateTo) && dateKey) {
                var rowDate = parseRowDate(row[dateKey]);
                if (!rowDate) {
                    return false;
                }
                if (state.dateFrom) {
                    if (rowDate < new Date(state.dateFrom)) {
                        return false;
                    }
                }
                if (state.dateTo) {
                    var toDate = new Date(state.dateTo);
                    toDate.setHours(23, 59, 59, 999);
                    if (rowDate > toDate) {
                        return false;
                    }
                }
            }
            if (state.q) {
                var q = state.q.toLowerCase();
                var matched = columns.some(function (col) {
                    var v = row[col.key];
                    return v !== null && v !== undefined &&
                        String(v).toLowerCase().indexOf(q) !== -1;
                });
                if (!matched) {
                    return false;
                }
            }
            return true;
        });

        return sortRows(filtered, state.sortKey, state.sortDir);
    }

    function sortRows(rows, sortKey, sortDir) {
        if (!sortKey || !sortDir) {
            return rows;
        }
        var copy = rows.slice();
        copy.sort(function (a, b) {
            var av = a[sortKey];
            var bv = b[sortKey];
            var an = toNumber(av);
            var bn = toNumber(bv);
            if (an !== null && bn !== null) {
                return (an - bn) * sortDir;
            }
            var ad = parseRowDate(av);
            var bd = parseRowDate(bv);
            if (ad && bd) {
                return (ad.getTime() - bd.getTime()) * sortDir;
            }
            var as = String(av === null || av === undefined ? "" : av).toLowerCase();
            var bs = String(bv === null || bv === undefined ? "" : bv).toLowerCase();
            if (as === bs) {
                return 0;
            }
            return (as < bs ? -1 : 1) * sortDir;
        });
        return copy;
    }

    function populateSelectOptions(key, columns, rows) {
        var bar = document.querySelector(
            '.tab-filter-bar[data-tab-key="' + key + '"]'
        );
        if (!bar) {
            return;
        }

        [
            { cls: ".tf-type", keywords: ["type"], all: "All Types", state: "type" },
            { cls: ".tf-status", keywords: ["status"], all: "All Statuses", state: "status" }
        ].forEach(function (cfg) {
            var selectEl = bar.querySelector(cfg.cls);
            if (!selectEl) {
                return;
            }
            var fieldEl = selectEl.parentNode;
            var colKey = getColumnKeyByKeywords(columns, cfg.keywords);
            if (!colKey) {
                fieldEl.classList.add("hidden");
                return;
            }
            fieldEl.classList.remove("hidden");

            var seen = {};
            var options = [];
            (rows || []).forEach(function (row) {
                var v = row[colKey];
                if (v !== null && v !== undefined && v !== "" && !seen[v]) {
                    seen[v] = true;
                    options.push(v);
                }
            });
            options.sort();

            var current = getTabState(key)[cfg.state];
            selectEl.innerHTML = '<option value="">' + cfg.all + "</option>" +
                options.map(function (o) {
                    return '<option value="' + esc(o) + '">' + esc(o) +
                        "</option>";
                }).join("");
            selectEl.value = current || "";
        });
    }

    function updateTabCount(key, shown, total) {
        var bar = document.querySelector(
            '.tab-filter-bar[data-tab-key="' + key + '"]'
        );
        if (bar) {
            var countEl = bar.querySelector(".tf-count");
            if (countEl) {
                countEl.innerHTML = shown === total
                    ? esc(total) + " rows"
                    : esc(shown) + " of " + esc(total) + " rows";
            }
        }
        var pill = document.getElementById("pill_" + key);
        if (pill) {
            pill.innerHTML = esc(total);
        }
    }

    /* ---------------- rendering ---------------- */

    function renderHead(headId, columns, sortTarget, state) {
        var el = document.getElementById(headId);
        if (!el) {
            return;
        }
        el.innerHTML = (columns || []).map(function (column) {
            var cls = isNumericLabel(column.label) ? "num sortable" : "sortable";
            var arrow = "";
            if (state && state.sortKey === column.key && state.sortDir) {
                arrow = '<span class="arrow">' +
                    (state.sortDir === 1 ? "&#9650;" : "&#9660;") + "</span>";
            }
            return '<th class="' + cls + '" data-sort-key="' + esc(column.key) +
                '">' + esc(column.label) + arrow + "</th>";
        }).join("");

        el.querySelectorAll("th[data-sort-key]").forEach(function (th) {
            th.addEventListener("click", function () {
                var key = th.getAttribute("data-sort-key");
                if (state.sortKey === key) {
                    state.sortDir = state.sortDir === 1 ? -1 : 1;
                } else {
                    state.sortKey = key;
                    state.sortDir = 1;
                }
                if (sortTarget === "__grid__") {
                    renderGrid();
                } else {
                    renderTab(sortTarget);
                }
            });
        });
    }

    function renderFoot(footId, columns, rows) {
        var el = document.getElementById(footId);
        if (!el) {
            return;
        }
        columns = columns || [];
        rows = rows || [];

        var anyTotal = false;
        var cells = columns.map(function (column, index) {
            if (!isTotalableLabel(column.label)) {
                return index === 0
                    ? '<td>Total (' + rows.length + ')</td>'
                    : "<td></td>";
            }
            var sum = 0;
            var found = false;
            rows.forEach(function (row) {
                var n = toNumber(row[column.key]);
                if (n !== null) {
                    sum += n;
                    found = true;
                }
            });
            if (!found) {
                return "<td></td>";
            }
            anyTotal = true;
            return '<td class="num">' + formatNumber(sum) + "</td>";
        });

        el.innerHTML = (anyTotal && rows.length)
            ? "<tr>" + cells.join("") + "</tr>"
            : "";
    }

    function linkCell(href, display) {
        return '<a href="' + esc(href) +
            '" target="_blank" rel="noopener" class="row-link">' +
            display + "</a>";
    }

    function renderRows(bodyId, columns, rows, emptyText, clickable) {
        var body = document.getElementById(bodyId);
        if (!body) {
            return;
        }
        columns = columns || [];
        rows = rows || [];

        if (!columns.length) {
            body.innerHTML = emptyRow(
                1,
                "No columns found. Please check the saved search Results tab."
            );
            return;
        }
        if (!rows.length) {
            body.innerHTML = emptyRow(columns.length, emptyText);
            return;
        }

        var docKey = findDocColumnKey(columns);

        body.innerHTML = rows.map(function (row) {
            var trClass = clickable ? ' class="clickable"' : "";
            var dataAttr = clickable
                ? ' data-vendor="' + esc(row.internalId) + '"'
                : "";
            return "<tr" + trClass + dataAttr + ">" + columns.map(function (column) {
                var value = row[column.key];
                var cls = isNumericLabel(column.label) ? "num" : "";
                var display = formatValue(value, column);
                if (!clickable && docKey && column.key === docKey &&
                    row.viewUrl && display) {
                    display = linkCell(row.viewUrl, display);
                }
                return td(display, cls);
            }).join("") + "</tr>";
        }).join("");
    }

    function renderTab(key) {
        var meta = sectionByKey(key);
        if (!meta) {
            return;
        }
        var data = (currentDetailData && currentDetailData[key]) ||
            { columns: [], rows: [] };
        var state = getTabState(key);
        var filtered = applyTabFilters(data, key);

        showSectionError("err_" + key, data.error || "");
        updateTabCount(key, filtered.length, (data.rows || []).length);
        renderHead("head_" + key, data.columns || [], key, state);
        renderRows("rows_" + key, data.columns || [], filtered, meta.empty, false);
        renderFoot("foot_" + key, data.columns || [], filtered);
    }

    function bindTabFilterBars() {
        document.querySelectorAll(".tab-filter-bar").forEach(function (bar) {
            var key = bar.getAttribute("data-tab-key");
            var qInput = bar.querySelector(".tf-q");
            var typeSelect = bar.querySelector(".tf-type");
            var statusSelect = bar.querySelector(".tf-status");
            var fromInput = bar.querySelector(".tf-date-from");
            var toInput = bar.querySelector(".tf-date-to");
            var clearBtn = bar.querySelector(".tf-clear");
            var timer;

            qInput.addEventListener("input", function () {
                clearTimeout(timer);
                timer = setTimeout(function () {
                    getTabState(key).q = qInput.value.trim();
                    renderTab(key);
                }, 250);
            });
            typeSelect.addEventListener("change", function () {
                getTabState(key).type = typeSelect.value;
                renderTab(key);
            });
            statusSelect.addEventListener("change", function () {
                getTabState(key).status = statusSelect.value;
                renderTab(key);
            });
            fromInput.addEventListener("change", function () {
                getTabState(key).dateFrom = fromInput.value;
                renderTab(key);
            });
            toInput.addEventListener("change", function () {
                getTabState(key).dateTo = toInput.value;
                renderTab(key);
            });
            clearBtn.addEventListener("click", function () {
                qInput.value = "";
                typeSelect.value = "";
                statusSelect.value = "";
                fromInput.value = "";
                toInput.value = "";
                var sortKey = getTabState(key).sortKey;
                var sortDir = getTabState(key).sortDir;
                resetTabState(key);
                getTabState(key).sortKey = sortKey;
                getTabState(key).sortDir = sortDir;
                renderTab(key);
            });
        });
    }

    /* ---------------- grid ---------------- */

    function currentFilters() {
        return {
            q: document.getElementById("fQ").value.trim(),
            vendorId: FILTERS.vendors
                ? document.getElementById("fVendor").value
                : "",
            categoryId: FILTERS.categories
                ? document.getElementById("fCategory").value
                : "",
            subsidiaryId: FILTERS.subsidiaries
                ? document.getElementById("fSub").value
                : ""
        };
    }

    function optionHtml(row) {
        return '<option value="' + esc(row.value) + '">' + esc(row.text) +
            "</option>";
    }

    function applyFilterVisibility() {
        if (!FILTERS.vendors) {
            document.getElementById("fVendorField").classList.add("hidden");
        }
        if (!FILTERS.categories) {
            document.getElementById("fCategoryField").classList.add("hidden");
        }
        if (!FILTERS.subsidiaries) {
            document.getElementById("fSubField").classList.add("hidden");
        }
    }

    function loadFilterOptions() {
        api("filterOptions").then(function (data) {
            if (FILTERS.vendors) {
                document.getElementById("fVendor").innerHTML =
                    '<option value="">All Vendors</option>' +
                    (data.vendors || []).map(optionHtml).join("");
            }
            if (FILTERS.categories) {
                document.getElementById("fCategory").innerHTML =
                    '<option value="">All Categories</option>' +
                    (data.categories || []).map(optionHtml).join("");
            }
            if (FILTERS.subsidiaries) {
                document.getElementById("fSub").innerHTML =
                    '<option value="">All Subsidiaries</option>' +
                    (data.subsidiaries || []).map(optionHtml).join("");
            }
        }).catch(function (e) {
            showError(e.message);
        });
    }

    function renderGrid() {
        renderHead("gridHeadRow", gridColumns, "__grid__", gridState);
        var rows = sortRows(gridRows, gridState.sortKey, gridState.sortDir);
        renderRows(
            "gridRows",
            gridColumns,
            rows,
            "No vendors found for the selected filters.",
            true
        );
        document.querySelectorAll("#gridRows tr[data-vendor]").forEach(function (row) {
            row.addEventListener("click", function () {
                openVendor(row.getAttribute("data-vendor"));
            });
        });
    }

    function refreshGrid() {
        showError("");
        document.getElementById("gridHeadRow").innerHTML = "<th>Loading</th>";
        document.getElementById("gridRows").innerHTML =
            '<tr><td colspan="1" class="loading">Loading vendors...</td></tr>';

        api("vendorSearch", currentFilters()).then(function (data) {
            gridColumns = data.columns || [];
            gridRows = data.rows || [];
            document.getElementById("totalCount").innerHTML =
                esc(data.total || 0);
            renderGrid();
        }).catch(function (e) {
            showError(e.message);
            document.getElementById("gridHeadRow").innerHTML = "<th>Error</th>";
            document.getElementById("gridRows").innerHTML =
                emptyRow(1, "Unable to load vendor results.");
        });
    }

    /* ---------------- detail ---------------- */

    function findColumnValue(dataSet, matchList) {
        var columns = dataSet.columns || [];
        var row = (dataSet.rows || [])[0] || {};
        for (var i = 0; i < columns.length; i++) {
            var haystack = String(
                (columns[i].name || "") + " " + (columns[i].label || "")
            ).toLowerCase();
            for (var j = 0; j < matchList.length; j++) {
                if (haystack.indexOf(matchList[j].toLowerCase()) !== -1) {
                    var value = row[columns[i].key];
                    if (value !== null && value !== undefined && value !== "") {
                        return value;
                    }
                }
            }
        }
        return "";
    }

    function firstNonEmptyValue(dataSet) {
        var columns = dataSet.columns || [];
        var row = (dataSet.rows || [])[0] || {};
        for (var i = 0; i < columns.length; i++) {
            var value = row[columns[i].key];
            if (value !== null && value !== undefined && value !== "") {
                return value;
            }
        }
        return "";
    }

    function openVendor(vendorId) {
        if (!vendorId) {
            return;
        }
        currentVendorId = vendorId;
        currentVendorViewUrl = "";
        currentDetailData = null;
        showError("");

        document.getElementById("gridSection").style.display = "none";
        document.getElementById("detailSection").style.display = "block";
        document.getElementById("vendTitle").innerHTML = "Loading vendor...";
        document.getElementById("vendDesc").innerHTML = "";
        document.getElementById("headerGrid").innerHTML =
            '<div class="loading">Loading vendor header...</div>';
        document.getElementById("viewRecordBtn").disabled = true;
        showSectionError("headerError", "");

        SECTIONS.forEach(function (section) {
            showSectionError("err_" + section.key, "");
            var head = document.getElementById("head_" + section.key);
            if (head) {
                head.innerHTML = "<th>Loading</th>";
            }
            var body = document.getElementById("rows_" + section.key);
            if (body) {
                body.innerHTML = emptyRow(1, "Loading " + section.label + "...");
            }
            var foot = document.getElementById("foot_" + section.key);
            if (foot) {
                foot.innerHTML = "";
            }
        });

        api("vendorDetail", { vendorId: vendorId }).then(function (data) {
            currentDetailData = data;
            renderVendorDetail(data);
        }).catch(function (e) {
            showError(e.message);
            document.getElementById("vendTitle").innerHTML =
                "Unable to load vendor";
        });
    }

    function renderVendorDetail(data) {
        var header = data.header || { columns: [], rows: [] };

        var vendorName = findColumnValue(header, ["companyname"]) ||
            findColumnValue(header, ["entityid"]) ||
            firstNonEmptyValue(header) ||
            "Vendor Detail";
        var email = findColumnValue(header, ["email"]) || "";
        var phone = findColumnValue(header, ["phone"]) || "";
        var balance = findColumnValue(header, ["balance"]) || "";
        var inactiveValue = findColumnValue(header, ["isinactive", "inactive"]) || "";
        var isInactive = inactiveValue === true ||
            inactiveValue === "T" ||
            String(inactiveValue).toLowerCase() === "true" ||
            String(inactiveValue).toLowerCase() === "yes";
        var hasBalance = (toNumber(balance) || 0) > 0;
        var onHold = String(
            findColumnValue(header, ["hold", "on hold"]) || ""
        ).toLowerCase();
        var isOnHold = onHold === "t" || onHold === "true" || onHold === "yes";

        document.getElementById("vendTitle").innerHTML =
            esc(vendorName) +
            ' <span class="badge ' + (!isInactive ? "active" : "") + '">' +
            esc(isInactive ? "Inactive" : "Active") + "</span>" +
            (hasBalance ? ' <span class="badge warn">Open Balance</span>' : "") +
            (isOnHold ? ' <span class="badge warn">On Hold</span>' : "");

        document.getElementById("vendDesc").innerHTML =
            (email ? "<b>" + esc(email) + "</b>" : "") +
            (phone ? (email ? " &middot; " : "") + esc(phone) : "");

        currentVendorViewUrl = ((header.rows || [])[0] || {}).viewUrl || "";
        document.getElementById("viewRecordBtn").disabled =
            !currentVendorViewUrl;

        showSectionError("headerError", header.error || "");
        renderHeaderCards(header);

        SECTIONS.forEach(function (section) {
            resetTabState(section.key);
            var bar = document.querySelector(
                '.tab-filter-bar[data-tab-key="' + section.key + '"]'
            );
            if (bar) {
                var q = bar.querySelector(".tf-q");
                var f = bar.querySelector(".tf-date-from");
                var t = bar.querySelector(".tf-date-to");
                if (q) { q.value = ""; }
                if (f) { f.value = ""; }
                if (t) { t.value = ""; }
            }
            var sectionData = data[section.key] || { columns: [], rows: [] };
            populateSelectOptions(
                section.key,
                sectionData.columns,
                sectionData.rows
            );
            renderTab(section.key);
        });
    }

    function renderHeaderCards(header) {
        var columns = header.columns || [];
        var row = (header.rows || [])[0] || {};
        if (!columns.length) {
            document.getElementById("headerGrid").innerHTML =
                '<div class="loading">No vendor header columns found.</div>';
            return;
        }
        document.getElementById("headerGrid").innerHTML =
            columns.map(function (column) {
                return '<div class="kv"><div class="k">' +
                    esc(column.label) + '</div><div class="v">' +
                    (formatValue(row[column.key], column) || "&mdash;") +
                    "</div></div>";
            }).join("");
    }

    /* ---------------- CSV ---------------- */

    function formatValueForCsv(value) {
        if (value === null || value === undefined || value === "") {
            return "";
        }
        if (value === true || String(value) === "T") {
            return "Yes";
        }
        if (value === false || String(value) === "F") {
            return "No";
        }
        return String(value);
    }

    function toCsvValue(value) {
        var display = formatValueForCsv(value);
        if (/["\\n\\r,]/.test(display)) {
            display = '"' + display.replace(/"/g, '""') + '"';
        }
        return display;
    }

    function sectionToCsvLines(title, section) {
        section = section || {};
        var columns = section.columns || [];
        var rows = section.rows || [];
        var lines = [title];
        if (!columns.length) {
            lines.push("(no data)");
            lines.push("");
            return lines;
        }
        lines.push(columns.map(function (c) {
            return toCsvValue(c.label);
        }).join(","));
        rows.forEach(function (row) {
            lines.push(columns.map(function (c) {
                return toCsvValue(row[c.key]);
            }).join(","));
        });
        lines.push("");
        return lines;
    }

    function downloadCsv(lines, suffix) {
        var csv = lines.join("\\r\\n");
        var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        var blobUrl = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = blobUrl;
        link.download = "vendor-" + (currentVendorId || "detail") +
            (suffix ? "-" + suffix : "") + ".csv";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(blobUrl);
    }

    function exportAll() {
        if (!currentDetailData) {
            return;
        }
        var lines = sectionToCsvLines("Vendor Header", currentDetailData.header);
        SECTIONS.forEach(function (section) {
            var data = currentDetailData[section.key] ||
                { columns: [], rows: [] };
            lines = lines.concat(sectionToCsvLines(section.label, {
                columns: data.columns,
                rows: applyTabFilters(data, section.key)
            }));
        });
        downloadCsv(lines, "all");
    }

    function exportActiveTab() {
        if (!currentDetailData || !activeTabKey) {
            return;
        }
        var meta = sectionByKey(activeTabKey);
        var data = currentDetailData[activeTabKey] || { columns: [], rows: [] };
        downloadCsv(
            sectionToCsvLines(meta ? meta.label : activeTabKey, {
                columns: data.columns,
                rows: applyTabFilters(data, activeTabKey)
            }),
            activeTabKey
        );
    }

    /* ---------------- wiring ---------------- */

    function clearFilters() {
        document.getElementById("fQ").value = "";
        if (FILTERS.vendors) { document.getElementById("fVendor").value = ""; }
        if (FILTERS.categories) { document.getElementById("fCategory").value = ""; }
        if (FILTERS.subsidiaries) { document.getElementById("fSub").value = ""; }
        refreshGrid();
    }

    document.getElementById("clearBtn")
        .addEventListener("click", clearFilters);

    document.getElementById("backBtn").addEventListener("click", function () {
        document.getElementById("detailSection").style.display = "none";
        document.getElementById("gridSection").style.display = "block";
    });

    document.getElementById("refreshDetailBtn")
        .addEventListener("click", function () {
            if (currentVendorId) {
                openVendor(currentVendorId);
            }
        });

    document.getElementById("viewRecordBtn")
        .addEventListener("click", function () {
            if (currentVendorViewUrl) {
                window.open(currentVendorViewUrl, "_blank", "noopener");
            }
        });

    document.getElementById("exportBtn").addEventListener("click", exportAll);
    document.getElementById("exportTabBtn")
        .addEventListener("click", exportActiveTab);

    if (FILTERS.vendors) {
        document.getElementById("fVendor")
            .addEventListener("change", refreshGrid);
    }
    if (FILTERS.categories) {
        document.getElementById("fCategory")
            .addEventListener("change", refreshGrid);
    }
    if (FILTERS.subsidiaries) {
        document.getElementById("fSub")
            .addEventListener("change", refreshGrid);
    }

    var qTimer;
    document.getElementById("fQ").addEventListener("input", function () {
        clearTimeout(qTimer);
        qTimer = setTimeout(refreshGrid, 300);
    });

    applyFilterVisibility();
    buildTabs();
    bindTabFilterBars();
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
