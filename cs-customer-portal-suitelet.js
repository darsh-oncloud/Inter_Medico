/**
 * CS Customer Portal Suitelet
 *
 * Internal rep-facing customer lookup: search any customer, then view
 * Open Orders / Order History / Open Balance / In Transit for that customer.
 * All data comes from saved searches configured as script parameters —
 * no hardcoded record logic beyond wiring the per-customer filter.
 *
 * Parameter IDs:
 * custscript_customer_dropdown
 * custscript_sales_rep
 * custscript_subsidiary_dropdown
 * custscript_customer_grid
 * custscript_customer_header
 * custscript_open_orders
 * custscript_order_history
 * custscript_open_balance
 * custscript_in_transit_shipments
 * custscript_in_transit_transfers
 *
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 */
define(['N/search', 'N/url', 'N/runtime', 'N/log'], function (search, url, runtime, log) {

    const MAX_CUSTOMER_OPTIONS = 500;
    const MAX_GRID_ROWS = 300;
    const MAX_DETAIL_ROWS = 1000;

    const PARAMS = {
        customerDropdown: 'custscript_customer_dropdown',
        salesRep: 'custscript_sales_rep',
        subsidiary: 'custscript_subsidiary_dropdown',
        customerGrid: 'custscript_customer_grid',
        customerHeader: 'custscript_customer_header',
        openOrders: 'custscript_open_orders',
        orderHistory: 'custscript_order_history',
        openBalance: 'custscript_open_balance',
        inTransitShipments: 'custscript_in_transit_shipments',
        inTransitTransfers: 'custscript_in_transit_transfers'
    };

    const DETAIL_SECTIONS = [
        {
            key: 'header',
            paramKey: 'customerHeader',
            filterField: 'internalid',
            maxRows: 1,
            includeTotal: false
        },
        {
            key: 'openOrders',
            paramKey: 'openOrders',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false
        },
        {
            key: 'orderHistory',
            paramKey: 'orderHistory',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false
        },
        {
            key: 'openBalance',
            paramKey: 'openBalance',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false
        },
        {
            key: 'inTransitShipments',
            paramKey: 'inTransitShipments',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false
        },
        {
            key: 'inTransitTransfers',
            paramKey: 'inTransitTransfers',
            filterField: 'entity',
            maxRows: MAX_DETAIL_ROWS,
            includeTotal: false
        }
    ];

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

            if (action === 'customerSearch') {
                sendJson(
                    response,
                    searchCustomersFiltered(request.parameters)
                );
                return;
            }

            if (action === 'customerDetail') {
                sendJson(
                    response,
                    getCustomerFullDetail(request.parameters.customerId)
                );
                return;
            }

            sendJson(response, {
                error: 'Unknown action: ' + action
            });

        } catch (e) {
            log.error('Customer Portal Error', {
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
            throw new Error(
                'Missing saved search parameter: ' + PARAMS[paramKey]
            );
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

            if (
                text !== null &&
                text !== undefined &&
                text !== ''
            ) {
                return text;
            }
        } catch (e) {
            // Formula/non-list fields may not support getText.
        }

        return '';
    }

    function safeGetValue(result, column) {
        try {
            const value = result.getValue(column);

            if (
                value !== null &&
                value !== undefined
            ) {
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

        if (
            value !== null &&
            value !== undefined
        ) {
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
    // Returns '' on failure so callers can fall back to "not clickable" instead of throwing.
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
                 * NetSuite automatically supplies the record internal ID
                 * through result.id. It does not have to be included as a
                 * saved-search Results column.
                 */
                internalId: result.id || '',
                recordType: result.recordType || ''
            };

            nsColumns.forEach(function (column, index) {
                row['c' + index] = getCellValue(result, column);
            });

            // Every row (customer, transaction, etc.) can usually be linked
            // directly using its own internal id + record type. This is the
            // only addition to this function - everything above is unchanged.
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
            const av = Number(
                String(a[targetKey] || 0).replace(/,/g, '')
            ) || 0;

            const bv = Number(
                String(b[targetKey] || 0).replace(/,/g, '')
            ) || 0;

            return bv - av;
        });

        return dataSet;
    }

    function getFilterOptions() {
        return {
            customers:
                safeSection(
                    'Customer Dropdown',
                    getCustomerOptions
                ).rows || [],

            salesReps:
                safeSection(
                    'Sales Rep Dropdown',
                    getSalesRepOptions
                ).rows || [],

            subsidiaries:
                safeSection(
                    'Subsidiary Dropdown',
                    getSubsidiaryOptions
                ).rows || []
        };
    }

    function getCustomerOptions() {
        const rows = [];
        const customerSearch =
            loadConfiguredSearch('customerDropdown');

        const columns = customerSearch.columns || [];

        customerSearch.run().each(function (result) {
            let label = '';

            if (columns.length) {
                label = getCellValue(result, columns[0]);
            }

            rows.push({
                value: result.id,
                text: label || result.id
            });

            return rows.length < MAX_CUSTOMER_OPTIONS;
        });

        return {
            rows: rows
        };
    }

    function getSalesRepOptions() {
        const rows = [];
        const repSearch = loadConfiguredSearch('salesRep');
        const columns = repSearch.columns || [];

        repSearch.run().each(function (result) {
            let text = '';

            if (columns.length) {
                text = getCellValue(result, columns[0]);
            }

            rows.push({
                value: result.id,
                text: text || result.id
            });

            return true;
        });

        return {
            rows: rows
        };
    }

    function getSubsidiaryOptions() {
        const rows = [];
        const subsidiarySearch =
            loadConfiguredSearch('subsidiary');

        const columns = subsidiarySearch.columns || [];

        subsidiarySearch.run().each(function (result) {
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

        return {
            rows: rows
        };
    }

    function searchCustomersFiltered(params) {
        const customerSearch =
            loadConfiguredSearch('customerGrid');

        const dynamicFilters = [];

        if (params.customerId) {
            dynamicFilters.push([
                'internalid',
                'anyof',
                params.customerId
            ]);
        }

        if (params.salesRepId) {
            dynamicFilters.push([
                'salesrep',
                'anyof',
                params.salesRepId
            ]);
        }

        if (params.subsidiaryId) {
            dynamicFilters.push([
                'subsidiary',
                'anyof',
                params.subsidiaryId
            ]);
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

        const expression =
            buildAndExpression(dynamicFilters);

        addDynamicExpression(
            customerSearch,
            expression
        );

        const result = runDynamicSearch(
            customerSearch,
            MAX_GRID_ROWS,
            true
        );

        sortRowsByColumnDesc(result, [
            'overdue balance',
            'overduebalance',
            'balance'
        ]);

        return result;
    }

    function getDetailSection(sectionConfig, customerId) {
        const sectionSearch =
            loadConfiguredSearch(sectionConfig.paramKey);

        const filters = [
            [
                sectionConfig.filterField,
                'anyof',
                customerId
            ]
        ].concat(sectionConfig.extraFilters || []);

        addDynamicExpression(
            sectionSearch,
            buildAndExpression(filters)
        );

        return runDynamicSearch(
            sectionSearch,
            sectionConfig.maxRows,
            sectionConfig.includeTotal
        );
    }

    function emptyDetailResult(customerId) {
        const result = {
            customerId: customerId || ''
        };

        DETAIL_SECTIONS.forEach(function (section) {
            result[section.key] = {
                columns: [],
                rows: []
            };
        });

        return result;
    }

    function getCustomerFullDetail(customerId) {
        if (!customerId) {
            return emptyDetailResult('');
        }

        const result = {
            customerId: customerId
        };

        DETAIL_SECTIONS.forEach(function (section) {
            result[section.key] = safeSection(
                section.key,
                function () {
                    return getDetailSection(
                        section,
                        customerId
                    );
                }
            );
        });

        return result;
    }

    function renderPage() {
        const scriptObj = runtime.getCurrentScript();

        const suiteletUrl = url.resolveScript({
            scriptId: scriptObj.id,
            deploymentId: scriptObj.deploymentId,
            returnExternalUrl: false
        });

        return buildHtml().replace(
            '__SUITELET_URL_JSON__',
            JSON.stringify(suiteletUrl)
        );
    }

    function buildHtml() {
        return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Customer Portal</title>

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
.btn-group { display: flex; gap: 8px; }
.meta { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--line); }
.meta b { color: var(--ink); font-family: 'IBM Plex Mono', monospace; }
.table-wrap { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: var(--radius-sm); }
table { width: 100%; border-collapse: collapse; min-width: 900px; }
th { background: #F7F8F5; color: var(--muted); text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; padding: 11px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
td { padding: 10px 12px; border-bottom: 1px solid var(--line-soft); vertical-align: top; font-size: 13px; }
tbody tr:nth-child(even) td { background: #FBFBFA; }
tr:last-child td { border-bottom: none; }
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
.item-title { font-family: 'Space Grotesk', sans-serif; font-size: 25px; font-weight: 700; margin: 10px 0 6px; letter-spacing: -.01em; display: flex; align-items: center; gap: 10px; }
.item-desc { color: var(--muted); max-width: 850px; line-height: 1.5; font-size: 13.5px; }
.header-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
.kv { background: #F8F9F6; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 13px; min-height: 72px; }
.kv .k { font-size: 10.5px; text-transform: uppercase; color: var(--faint); letter-spacing: .06em; font-weight: 700; margin-bottom: 7px; }
.kv .v { font-family: 'IBM Plex Mono', monospace; font-size: 13.5px; font-weight: 600; word-break: break-word; color: var(--ink); }
.tabs { display: flex; gap: 26px; margin-bottom: 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.tab-btn { border: none; background: none; padding: 10px 2px; cursor: pointer; font-weight: 600; font-size: 13.5px; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -1px; font-family: 'Inter', sans-serif; }
.tab-btn.active { color: var(--signal-dark); border-bottom-color: var(--signal); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.subsection-title { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 700; margin: 18px 0 10px; color: var(--ink); }
.subsection-title:first-child { margin-top: 0; }
.empty { padding: 38px; text-align: center; color: var(--faint); font-size: 13px; }
.loading { padding: 22px; color: var(--muted); text-align: center; font-size: 13px; }
.error { background: var(--warn-soft); color: var(--warn); border: 1px solid #EBC994; padding: 12px 14px; border-radius: var(--radius-sm); margin-bottom: 14px; display: none; font-size: 13px; font-weight: 500; }
.section-error { background: var(--warn-soft); color: var(--warn); border: 1px solid #EBC994; padding: 12px; border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; }
@media (max-width: 1000px) { .filters { grid-template-columns: 1fr 1fr; }
.header-grid { grid-template-columns: 1fr 1fr; }
}
</style></head><body><div class="page"><div class="topbar"><div><div class="eyebrow"><span class="dot"></span>
Customer Records
</div><h1 class="title">Customer Portal</h1><div class="subtitle">
Search any customer, then review open orders,
order history, open balance, and in-transit
shipments/transfers.
</div></div></div><div id="errorBox" class="error"></div><div id="gridSection" class="card"><div class="filters"><div><label>Search</label><input
id="fQ"
placeholder="Company name, ID, email, or phone"
></div><div><label>Sales Rep</label><select id="fRep"><option value="">All Reps</option></select></div><div><label>Subsidiary</label><select id="fSub"><option value="">All Subsidiaries</option></select></div><div><label>&nbsp;</label><button id="clearBtn" class="btn">
Clear
</button></div></div><div class="meta"><span>
Total Results:
<b id="totalCount">0</b></span><span>
Sorted by highest Overdue Balance first
</span></div><div
class="table-wrap"
style="margin-top:14px;"
><table><thead><tr id="gridHeadRow"></tr></thead><tbody id="gridRows"><tr><td
colspan="1"
class="loading"
>
Loading customers...
</td></tr></tbody></table></div></div><div
id="detailSection"
style="display:none;"
><div class="card"><div class="detail-head"><div><button
id="backBtn"
class="btn"
>
&larr; Back to Results
</button><div
id="custTitle"
class="item-title"
></div><div
id="custDesc"
class="item-desc"
></div></div><div class="btn-group"><button
id="viewRecordBtn"
class="btn"
disabled
>
View Record ↗
</button><button
id="exportBtn"
class="btn"
>
Export CSV
</button><button
id="refreshDetailBtn"
class="btn btn-primary"
>
Refresh Customer
</button></div></div><div id="headerError"></div><div
id="headerGrid"
class="header-grid"
></div></div><div class="card"><div class="tabs"><button
class="tab-btn active"
data-tab="openOrdersTab"
>
Open Orders
</button><button
class="tab-btn"
data-tab="orderHistoryTab"
>
Order History
</button><button
class="tab-btn"
data-tab="openBalanceTab"
>
Open Balance
</button><button
class="tab-btn"
data-tab="inTransitTab"
>
In Transit
</button></div><div
id="openOrdersTab"
class="tab-panel active"
><div id="openOrdersError"></div><div class="table-wrap"><table><thead><tr id="openOrdersHeadRow"></tr></thead><tbody id="openOrdersRows"></tbody></table></div></div><div
id="orderHistoryTab"
class="tab-panel"
><div id="orderHistoryError"></div><div class="table-wrap"><table><thead><tr id="orderHistoryHeadRow"></tr></thead><tbody id="orderHistoryRows"></tbody></table></div></div><div
id="openBalanceTab"
class="tab-panel"
><div id="openBalanceError"></div><div class="table-wrap"><table><thead><tr id="openBalanceHeadRow"></tr></thead><tbody id="openBalanceRows"></tbody></table></div></div><div
id="inTransitTab"
class="tab-panel"
><div class="subsection-title">
Shipments In Transit
</div><div id="inTransitShipmentsError"></div><div class="table-wrap"><table><thead><tr id="inTransitShipmentsHeadRow"></tr></thead><tbody id="inTransitShipmentsRows"></tbody></table></div><div class="subsection-title">
Transfer Orders In Transit
</div><div id="inTransitTransfersError"></div><div class="table-wrap"><table><thead><tr id="inTransitTransfersHeadRow"></tr></thead><tbody id="inTransitTransfersRows"></tbody></table></div></div></div></div></div><script>(function(){var SUITELET_URL=__SUITELET_URL_JSON__;var currentCustomerId="";var currentCustomerViewUrl="";var currentDetailData=null;var DETAIL_TABS=[{key:"openOrders",label:"Open Orders",head:"openOrdersHeadRow",rows:"openOrdersRows",err:"openOrdersError",empty:"No open orders found for this customer.",loading:"Loading open orders..."},{key:"orderHistory",label:"Order History",head:"orderHistoryHeadRow",rows:"orderHistoryRows",err:"orderHistoryError",empty:"No order history found for this customer.",loading:"Loading order history..."},{key:"openBalance",label:"Open Balance",head:"openBalanceHeadRow",rows:"openBalanceRows",err:"openBalanceError",empty:"No open balance found for this customer.",loading:"Loading open balance..."},{key:"inTransitShipments",label:"Shipments In Transit",head:"inTransitShipmentsHeadRow",rows:"inTransitShipmentsRows",err:"inTransitShipmentsError",empty:"No shipments currently in transit for this customer.",loading:"Loading shipments..."},{key:"inTransitTransfers",label:"Transfer Orders In Transit",head:"inTransitTransfersHeadRow",rows:"inTransitTransfersRows",err:"inTransitTransfersError",empty:"No transfer orders currently in transit for this customer.",loading:"Loading transfer orders..."}];function esc(value){if(value===null||value===undefined||value===""){return""}return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function isNumericLabel(label){label=String(label||"").toLowerCase();return label.indexOf("quantity")!==-1||label.indexOf("qty")!==-1||label.indexOf("amount")!==-1||label.indexOf("balance")!==-1||label.indexOf("credit")!==-1||label.indexOf("cost")!==-1||label.indexOf("price")!==-1||label.indexOf("value")!==-1||label.indexOf("rate")!==-1}function formatValue(value,column){if(value===null||value===undefined||value===""){return""}if(value===true||String(value)==="T"){return"Yes"}if(value===false||String(value)==="F"){return"No"}if(!isNumericLabel(column&&column.label)){return esc(value)}var n=Number(String(value).replace(/,/g,""));if(isNaN(n)){return esc(value)}return n.toLocaleString("en-US",{minimumFractionDigits:n%1===0?0:2,maximumFractionDigits:2})}function td(value,cls){return"<td"+(cls?' class="'+cls+'"':"")+">"+(value||"")+"</td>"}function emptyRow(colspan,text){return"<tr>"+'<td colspan="'+colspan+'" class="empty">'+esc(text)+"</td>"+"</tr>"}function showError(message){var box=document.getElementById("errorBox");if(!message){box.style.display="none";box.innerHTML="";return}box.innerHTML=esc(message);box.style.display="block"}function showSectionError(id,message){var el=document.getElementById(id);if(!message){el.innerHTML="";return}el.innerHTML='<div class="section-error">'+esc(message)+"</div>"}function api(action,params){params=params||{};var query=[];Object.keys(params).forEach(function(key){if(params[key]!==null&&params[key]!==undefined&&params[key]!==""){query.push(encodeURIComponent(key)+"="+encodeURIComponent(params[key]))}});var joiner=SUITELET_URL.indexOf("?")===-1?"?":"&";var finalUrl=SUITELET_URL+joiner+"action="+encodeURIComponent(action);if(query.length){finalUrl+="&"+query.join("&")}return fetch(finalUrl,{credentials:"same-origin"}).then(function(response){return response.json()}).then(function(data){if(data&&data.error){throw new Error(data.error)}return data})}function optionHtml(row){return'<option value="'+esc(row.value)+'">'+esc(row.text)+"</option>"}function loadFilterOptions(){api("filterOptions").then(function(data){document.getElementById("fRep").innerHTML='<option value="">All Reps</option>'+(data.salesReps||[]).map(optionHtml).join("");document.getElementById("fSub").innerHTML='<option value="">All Subsidiaries</option>'+(data.subsidiaries||[]).map(optionHtml).join("")}).catch(function(e){showError(e.message)})}function currentFilters(){return{q:document.getElementById("fQ").value.trim(),salesRepId:document.getElementById("fRep").value,subsidiaryId:document.getElementById("fSub").value}}function renderHead(headId,columns){document.getElementById(headId).innerHTML=(columns||[]).map(function(column){var cls=isNumericLabel(column.label)?' class="num"':"";return"<th"+cls+">"+esc(column.label)+"</th>"}).join("")}function findColumnKey(columns,requiredOption,predicate){if(!requiredOption){return null}for(var i=0;i<(columns||[]).length;i++){if(predicate(columns[i])){return columns[i].key}}return null}function linkCell(href,display){return'<a href="'+esc(href)+'" target="_blank" rel="noopener" class="row-link">'+display+"</a>"}function renderDynamicRows(bodyId,columns,rows,emptyText,clickable,linkOptions){linkOptions=linkOptions||{};var docColumnKey=findColumnKey(columns,linkOptions.docUrlKey,function(c){var nm=String(c.name||"").toLowerCase();var lbl=String(c.label||"").toLowerCase();return nm==="tranid"||nm==="documentnumber"||lbl.indexOf("document number")!==-1});var body=document.getElementById(bodyId);columns=columns||[];rows=rows||[];if(!columns.length){body.innerHTML=emptyRow(1,"No columns found. Please check saved search results.");return}if(!rows.length){body.innerHTML=emptyRow(columns.length,emptyText);return}body.innerHTML=rows.map(function(row){var trClass=clickable?' class="clickable"':"";var dataAttr=clickable?' data-customer="'+esc(row.internalId)+'"':"";return"<tr"+trClass+dataAttr+">"+columns.map(function(column){var value=row[column.key];var cls=isNumericLabel(column.label)?"num":"";var display=formatValue(value,column);if(docColumnKey&&column.key===docColumnKey&&row[linkOptions.docUrlKey]&&display){display=linkCell(row[linkOptions.docUrlKey],display)}return td(display,cls)}).join("")+"</tr>"}).join("")}function renderTabSection(tab,section){section=section||{};showSectionError(tab.err,section.error||"");renderHead(tab.head,section.columns||[]);renderDynamicRows(tab.rows,section.columns||[],section.rows||[],tab.empty,false,{docUrlKey:"viewUrl"})}function refreshGrid(){showError("");document.getElementById("gridHeadRow").innerHTML="<th>Loading</th>";document.getElementById("gridRows").innerHTML="<tr>"+'<td colspan="1" class="loading">'+"Loading customers..."+"</td>"+"</tr>";api("customerSearch",currentFilters()).then(function(data){var columns=data.columns||[];var rows=data.rows||[];document.getElementById("totalCount").innerHTML=esc(data.total||0);renderHead("gridHeadRow",columns);renderDynamicRows("gridRows",columns,rows,"No customers found for selected filters.",true);var clickableRows=document.querySelectorAll("#gridRows tr[data-customer]");clickableRows.forEach(function(row){row.addEventListener("click",function(){openCustomer(row.getAttribute("data-customer"))})})}).catch(function(e){showError(e.message);document.getElementById("gridHeadRow").innerHTML="<th>Error</th>";document.getElementById("gridRows").innerHTML=emptyRow(1,"Unable to load customer results.")})}function findColumnValue(dataSet,matchList){var columns=dataSet.columns||[];var row=(dataSet.rows||[])[0]||{};for(var i=0;i<columns.length;i++){var column=columns[i];var haystack=String((column.name||"")+" "+(column.label||"")).toLowerCase();for(var j=0;j<matchList.length;j++){if(haystack.indexOf(matchList[j].toLowerCase())!==-1){var value=row[column.key];if(value!==null&&value!==undefined&&value!==""){return value}}}}return""}function firstNonEmptyValue(dataSet){var columns=dataSet.columns||[];var row=(dataSet.rows||[])[0]||{};for(var i=0;i<columns.length;i++){var value=row[columns[i].key];if(value!==null&&value!==undefined&&value!==""){return value}}return""}function openCustomer(customerId){if(!customerId){return}currentCustomerId=customerId;currentCustomerViewUrl="";currentDetailData=null;showError("");document.getElementById("gridSection").style.display="none";document.getElementById("detailSection").style.display="block";document.getElementById("custTitle").innerHTML="Loading customer...";document.getElementById("custDesc").innerHTML="";document.getElementById("headerGrid").innerHTML='<div class="loading">'+"Loading customer header..."+"</div>";document.getElementById("viewRecordBtn").disabled=true;showSectionError("headerError","");DETAIL_TABS.forEach(function(tab){showSectionError(tab.err,"");document.getElementById(tab.head).innerHTML="<th>Loading</th>";document.getElementById(tab.rows).innerHTML=emptyRow(1,tab.loading)});api("customerDetail",{customerId:customerId}).then(function(data){currentDetailData=data;renderCustomerDetail(data)}).catch(function(e){showError(e.message);document.getElementById("custTitle").innerHTML="Unable to load customer"})}function renderCustomerDetail(data){var header=data.header||{columns:[],rows:[]};var custName=findColumnValue(header,["companyname"])||findColumnValue(header,["entityid"])||firstNonEmptyValue(header)||"Customer Detail";var email=findColumnValue(header,["email"])||"";var phone=findColumnValue(header,["phone"])||"";var overdueBalance=findColumnValue(header,["overdue balance","overduebalance"])||"";var inactiveValue=findColumnValue(header,["isinactive","inactive"])||"";var isInactive=inactiveValue===true||inactiveValue==="T"||String(inactiveValue).toLowerCase()==="true"||String(inactiveValue).toLowerCase()==="yes";var hasOverdue=Number(String(overdueBalance).replace(/,/g,""))>0;document.getElementById("custTitle").innerHTML=esc(custName)+' <span class="badge '+(!isInactive?"active":"")+'">'+esc(isInactive?"Inactive":"Active")+"</span>"+(hasOverdue?' <span class="badge warn">'+"Overdue Balance"+"</span>":"");document.getElementById("custDesc").innerHTML=(email?"<b>"+esc(email)+"</b>":"")+(phone?(email?" &middot; ":"")+esc(phone):"");currentCustomerViewUrl=((header.rows||[])[0]||{}).viewUrl||"";document.getElementById("viewRecordBtn").disabled=!currentCustomerViewUrl;showSectionError("headerError",header.error||"");renderHeaderCards(header);DETAIL_TABS.forEach(function(tab){renderTabSection(tab,data[tab.key])})}function renderHeaderCards(header){var columns=header.columns||[];var row=(header.rows||[])[0]||{};if(!columns.length){document.getElementById("headerGrid").innerHTML='<div class="loading">'+"No customer header columns found."+"</div>";return}document.getElementById("headerGrid").innerHTML=columns.map(function(column){var value=row[column.key];return'<div class="kv">'+'<div class="k">'+esc(column.label)+"</div>"+'<div class="v">'+formatValue(value,column)+"</div>"+"</div>"}).join("")}function formatValueForCsv(value){if(value===null||value===undefined||value===""){return""}if(value===true||String(value)==="T"){return"Yes"}if(value===false||String(value)==="F"){return"No"}return String(value)}function toCsvValue(value){var display=formatValueForCsv(value);if(/[",\\n\\r]/.test(display)){display='"'+display.replace(/"/g,'""')+'"'}return display}function sectionToCsvLines(title,section){section=section||{};var columns=section.columns||[];var rows=section.rows||[];var lines=[title];if(!columns.length){lines.push("(no data)");lines.push("");return lines}lines.push(columns.map(function(c){return toCsvValue(c.label)}).join(","));rows.forEach(function(row){lines.push(columns.map(function(c){return toCsvValue(row[c.key])}).join(","))});lines.push("");return lines}function exportCustomerDetailCsv(){if(!currentDetailData){return}var lines=sectionToCsvLines("Customer Header",currentDetailData.header);DETAIL_TABS.forEach(function(tab){lines=lines.concat(sectionToCsvLines(tab.label,currentDetailData[tab.key]))});var csv=lines.join("\\r\\n");var blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});var blobUrl=URL.createObjectURL(blob);var link=document.createElement("a");link.href=blobUrl;link.download="customer-"+(currentCustomerId||"detail")+".csv";document.body.appendChild(link);link.click();document.body.removeChild(link);URL.revokeObjectURL(blobUrl)}function clearFilters(){document.getElementById("fQ").value="";document.getElementById("fRep").value="";document.getElementById("fSub").value="";refreshGrid()}document.getElementById("clearBtn").addEventListener("click",clearFilters);document.getElementById("backBtn").addEventListener("click",function(){document.getElementById("detailSection").style.display="none";document.getElementById("gridSection").style.display="block"});document.getElementById("refreshDetailBtn").addEventListener("click",function(){if(currentCustomerId){openCustomer(currentCustomerId)}});document.getElementById("viewRecordBtn").addEventListener("click",function(){if(currentCustomerViewUrl){window.open(currentCustomerViewUrl,"_blank","noopener")}});document.getElementById("exportBtn").addEventListener("click",exportCustomerDetailCsv);document.getElementById("fRep").addEventListener("change",refreshGrid);document.getElementById("fSub").addEventListener("change",refreshGrid);var qTimer;document.getElementById("fQ").addEventListener("input",function(){clearTimeout(qTimer);qTimer=setTimeout(refreshGrid,300)});document.querySelectorAll(".tab-btn").forEach(function(btn){btn.addEventListener("click",function(){var tabId=btn.getAttribute("data-tab");document.querySelectorAll(".tab-btn").forEach(function(b){b.classList.remove("active")});document.querySelectorAll(".tab-panel").forEach(function(p){p.classList.remove("active")});btn.classList.add("active");document.getElementById(tabId).classList.add("active")})});loadFilterOptions();refreshGrid()})();</script>

</body>
</html>`;
    }

    return {
        onRequest: onRequest
    };
});