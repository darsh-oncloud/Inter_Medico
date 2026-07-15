/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define([], function () {

    var LOG_PREFIX = '[InvDetailRequired]';

    var REQUIRED_FIELDS = [
        { id: 'binnumber', label: 'Bin' },
        { id: 'status', label: 'Status' },
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

                REQUIRED_FIELDS.forEach(function (field) {
                    var value = detail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: field.id,
                        line: j
                    });

                    values[field.label] = value;

                    if (!value) {
                        missing.push(field.label);
                    }
                });

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