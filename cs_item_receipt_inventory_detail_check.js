/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 *
 * PURPOSE
 * Fast on-screen warning if a received line's Inventory Detail is missing
 * Bin, Status, or Expiration Date. This is a convenience check only —
 * the beforeSubmit User Event script is the real enforcement (covers
 * CSV imports, integrations, etc). This script just saves the user a
 * round trip to the server.
 */
define([], function () {

    function saveRecord(context) {
        var rec = context.currentRecord;
        var lineCount = rec.getLineCount({ sublistId: 'item' });

        for (var i = 0; i < lineCount; i++) {
            var qty = rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i });
            if (!qty || Number(qty) <= 0) continue;

            var sub;
            try {
                sub = rec.getSublistSubrecord({ sublistId: 'item', fieldId: 'inventorydetail', line: i });
            } catch (e) {
                continue; // no inventory detail on this line - nothing to check
            }
            if (!sub) continue;

            var assignCount = sub.getLineCount({ sublistId: 'inventoryassignment' });

            if (assignCount === 0) {
                alert('Line ' + (i + 1) + ': Inventory Detail has no Bin/Status/Lot assigned yet.');
                return false;
            }

            for (var j = 0; j < assignCount; j++) {
                var bin = safeGet(sub, 'binnumber', j);
                var status = safeGet(sub, 'inventorystatus', j);
                var expiry = safeGet(sub, 'expirationdate', j);
                var lot = safeGet(sub, 'issueinventorynumber', j) || safeGet(sub, 'receiptinventorynumber', j);

                // bin field only exists if item uses bins - skip if not applicable (null)
                if (bin !== null && !bin) {
                    alert('Line ' + (i + 1) + ', row ' + (j + 1) + ': Bin Number is required.');
                    return false;
                }

                // status field only exists if inventory status feature applies - skip if not applicable
                if (status !== null && !status) {
                    alert('Line ' + (i + 1) + ', row ' + (j + 1) + ': Inventory Status is required.');
                    return false;
                }

                // expiration only required for lot-numbered lines
                if (lot && expiry !== null && !expiry) {
                    alert('Line ' + (i + 1) + ', row ' + (j + 1) + ': Expiration Date is required for lot-numbered items.');
                    return false;
                }
            }
        }

        return true;
    }

    // Returns the field value, or null if the field doesn't apply to this line
    function safeGet(subrecord, fieldId, line) {
        try {
            return subrecord.getSublistValue({ sublistId: 'inventoryassignment', fieldId: fieldId, line: line });
        } catch (e) {
            return null;
        }
    }

    return {
        saveRecord: saveRecord
    };
});
