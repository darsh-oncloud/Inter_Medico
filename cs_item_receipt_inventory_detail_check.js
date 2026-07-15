/**
 * CS Item Receipt - Require Bin / Status / Expiration Date on Inventory Detail
 * (DEBUG VERSION - with console.log statements for testing)
 *
 * Deploy this Client Script on the Item Receipt record type via:
 * Customization > Scripting > Scripts > New (upload this file, it will
 * auto-detect as Client Script) > Deploy Script > Applies To: Item Receipt.
 *
 * Blocks Save if any inventory-detail line on any item line is missing
 * Bin, Status, or Expiration Date. Only checks lines where NetSuite has
 * actually created an Inventory Detail subrecord (items using bins/lots/
 * serials) - non-tracked items are skipped.
 *
 * HOW TO SEE THE LOGS WHILE TESTING:
 * Open the browser console before clicking Save:
 *   Chrome/Edge: F12 (or Ctrl+Shift+I), then the "Console" tab.
 * Every line printed here starts with "[InvDetailRequired]".
 *
 * FIELD IDS on the 'inventoryassignment' sublist of Inventory Detail:
 *   binnumber        - Bin
 *   inventorystatus  - Status   (NOT 'status' - that field id doesn't exist
 *                       on this sublist and will throw if you use it)
 *   expirationdate   - Expiration Date
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], function () {

    var LOG_PREFIX = '[InvDetailRequired]';

    var REQUIRED_FIELDS = [
        { id: 'binnumber', label: 'Bin' },
        { id: 'inventorystatus', label: 'Status' },
        { id: 'expirationdate', label: 'Expiration Date' }
    ];

    function saveRecord(context) {
        console.log(LOG_PREFIX, '=== saveRecord fired - starting validation ===');

        var rec = context.currentRecord;
        var lineCount = rec.getLineCount({ sublistId: 'item' });

        console.log(LOG_PREFIX, 'Total item lines on this Item Receipt:', lineCount);

        for (var i = 0; i < lineCount; i++) {
            var itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });

            console.log(LOG_PREFIX, 'Line ' + (i + 1) + ' - item internal id:', itemId);

            if (!itemId) {
                console.log(LOG_PREFIX, 'Line ' + (i + 1) + ' - no item selected, skipping.');
                continue;
            }

            var detail;

            try {
                detail = rec.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: i });
            } catch (e) {
                console.log(LOG_PREFIX, 'Line ' + (i + 1) + ' - error opening inventory detail subrecord:', e.message);
                detail = null;
            }

            if (!detail) {
                console.log(LOG_PREFIX, 'Line ' + (i + 1) + ' - no Inventory Detail subrecord (item does not use bins/lots/serials). Skipping.');
                continue;
            }

            var detailLineCount = detail.getLineCount({ sublistId: 'inventoryassignment' });

            console.log(LOG_PREFIX, 'Line ' + (i + 1) + ' - inventory detail rows found:', detailLineCount);

            for (var j = 0; j < detailLineCount; j++) {
                var missing = [];
                var values = {};

                for (var k = 0; k < REQUIRED_FIELDS.length; k++) {
                    var field = REQUIRED_FIELDS[k];
                    var value = null;

                    // Wrapped individually - if a field id doesn't exist for this item
                    // (e.g. status not applicable), it won't crash the whole check.
                    try {
                        value = detail.getSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: field.id,
                            line: j
                        });
                    } catch (fieldErr) {
                        console.log(LOG_PREFIX, 'Field "' + field.id + '" not applicable on this line:', fieldErr.message);
                        value = null; // treat as not-applicable, don't require it
                    }

                    values[field.label] = value;

                    if (value === '' ) {
                        // field exists but was left blank - this is the case we want to catch
                        missing.push(field.label);
                    }
                }

                console.log(
                    LOG_PREFIX,
                    'Line ' + (i + 1) + ', inventory detail row ' + (j + 1) + ' - values:',
                    values
                );

                if (missing.length) {
                    console.log(
                        LOG_PREFIX,
                        'Line ' + (i + 1) + ', inventory detail row ' + (j + 1) +
                        ' - BLOCKING save. Missing:', missing
                    );

                    alert(
                        'Item line ' + (i + 1) + ', inventory detail row ' + (j + 1) + ':\n' +
                        'The following field(s) are required before this Item Receipt can be saved:\n' +
                        missing.join(', ')
                    );

                    console.log(LOG_PREFIX, '=== saveRecord returning false (save blocked) ===');
                    return false;
                }
            }
        }

        console.log(LOG_PREFIX, '=== All inventory detail rows valid - saveRecord returning true (save allowed) ===');
        return true;
    }

    return {
        saveRecord: saveRecord
    };
});