/**
 * UE Item Receipt - Require Bin / Status / Expiration Date on Inventory Detail
 *
 * Deploy on record type: Item Receipt.
 * This is the server-side backstop for the matching Client Script - it
 * catches Item Receipts created via CSV import, SuiteScript, integrations,
 * or mobile receiving, where the client script never runs.
 *
 * NOTE ON FIELD IDS: see the Client Script header comment - confirm
 * 'binnumber' / 'status' / 'expirationdate' match your account's
 * Inventory Detail subrecord if it's been customized.
 *
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/error'], function (error) {

    var REQUIRED_FIELDS = [
        { id: 'binnumber', label: 'Bin' },
        { id: 'status', label: 'Status' },
        { id: 'expirationdate', label: 'Expiration Date' }
    ];

    function beforeSubmit(context) {
        if (context.type !== context.UserEventType.CREATE && context.type !== context.UserEventType.EDIT) {
            return;
        }

        var rec = context.newRecord;
        var lineCount = rec.getLineCount({ sublistId: 'item' });

        for (var i = 0; i < lineCount; i++) {
            var itemId = rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i });

            if (!itemId) {
                continue;
            }

            var detail;

            try {
                detail = rec.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: i });
            } catch (e) {
                detail = null;
            }

            if (!detail) {
                continue;
            }

            var detailLineCount = detail.getLineCount({ sublistId: 'inventoryassignment' });

            for (var j = 0; j < detailLineCount; j++) {
                var missing = [];

                REQUIRED_FIELDS.forEach(function (field) {
                    var value = detail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: field.id,
                        line: j
                    });

                    if (!value) {
                        missing.push(field.label);
                    }
                });

                if (missing.length) {
                    throw error.create({
                        name: 'INVENTORY_DETAIL_REQUIRED',
                        message: 'Item line ' + (i + 1) + ', inventory detail row ' + (j + 1) +
                            ': the following field(s) are required - ' + missing.join(', '),
                        notifyOff: false
                    });
                }
            }
        }
    }

    return {
        beforeSubmit: beforeSubmit
    };
});