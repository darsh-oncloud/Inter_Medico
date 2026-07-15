/**
 * IMG | IR Inventory Detail Validation
 *
 * Validates Inventory Detail on Item Receipts.
 * Required fields:
 *  - Bin
 *  - Inventory Status
 *  - Expiration Date
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define([], function () {

    var LOG_PREFIX = '[IMG IR Inventory Detail]';
    var DEBUG_ENABLED = true;

    var REQUIRED_FIELDS = [
        { id: 'binnumber', label: 'Bin' },
        { id: 'inventorystatus', label: 'Status' },
        { id: 'expirationdate', label: 'Expiration Date' }
    ];

    /**
     * Confirms that the Client Script loaded on the Item Receipt.
     */
    function pageInit(context) {
        var rec = context.currentRecord;

        debug('==================================================');
        debug('CLIENT SCRIPT LOADED');
        debug('Record Type', rec.type);
        debug('Record ID', rec.id || 'New Record');
        debug('Page Mode', context.mode);
        debug('==================================================');
    }

    /**
     * Runs when the user clicks Save.
     */
    function saveRecord(context) {
        var rec = context.currentRecord;
        var errors = [];

        debug('==================================================');
        debug('SAVE RECORD VALIDATION STARTED');
        debug('Record Type', rec.type);
        debug('Record ID', rec.id || 'New Record');

        try {
            var itemLineCount = rec.getLineCount({
                sublistId: 'item'
            });

            debug('Total Item Lines', itemLineCount);

            for (var i = 0; i < itemLineCount; i++) {
                validateItemLine(rec, i, errors);
            }

        } catch (e) {
            errorLog('Unexpected validation error', getErrorDetails(e));

            alert(
                'Inventory Detail validation could not be completed.\n\n' +
                'Error: ' + getErrorDetails(e) + '\n\n' +
                'Please contact your NetSuite administrator.'
            );

            return false;
        }

        if (errors.length > 0) {
            errorLog('SAVE BLOCKED - Validation Errors', errors);

            var message =
                'This Item Receipt cannot be saved because required ' +
                'Inventory Detail information is missing:\n\n';

            var maxErrors = Math.min(errors.length, 20);

            for (var x = 0; x < maxErrors; x++) {
                message += (x + 1) + '. ' + errors[x] + '\n';
            }

            if (errors.length > maxErrors) {
                message += '\nAdditional errors found: ' +
                    (errors.length - maxErrors);
            }

            message +=
                '\n\nPlease enter the missing Bin, Status, and ' +
                'Expiration Date before saving.';

            alert(message);

            debug('SAVE RECORD RETURNING FALSE');
            debug('==================================================');

            return false;
        }

        debug('ALL INVENTORY DETAIL VALIDATION PASSED');
        debug('SAVE RECORD RETURNING TRUE');
        debug('==================================================');

        return true;
    }

    /**
     * Validates one Item Receipt item line.
     */
    function validateItemLine(rec, itemLine, errors) {
        var uiLine = itemLine + 1;

        var itemId = getLineValue(
            rec,
            'item',
            'item',
            itemLine
        );

        var itemName = getLineText(
            rec,
            'item',
            'item',
            itemLine
        ) || String(itemId || '');

        var receiveValue = getLineValue(
            rec,
            'item',
            'itemreceive',
            itemLine
        );

        var itemQuantity = getLineValue(
            rec,
            'item',
            'quantity',
            itemLine
        );

        debug('--------------------------------------------------');
        debug('Checking Item Line', {
            line: uiLine,
            itemId: itemId,
            itemName: itemName,
            itemReceive: receiveValue,
            quantity: itemQuantity
        });

        if (!itemId) {
            debug('Line skipped because no item is selected', uiLine);
            return;
        }

        /*
         * Skip unchecked lines during PO receiving.
         * On an existing Item Receipt, itemreceive may not be available.
         */
        if (receiveValue === false || receiveValue === 'F') {
            debug('Line skipped because Item Receive is unchecked', uiLine);
            return;
        }

        var inventoryDetail = getInventoryDetailSubrecord(
            rec,
            itemLine
        );

        /*
         * Items that do not use bins, lots, serials, or inventory
         * status may not have an Inventory Detail subrecord.
         */
        if (!inventoryDetail) {
            debug('No Inventory Detail subrecord; line skipped', {
                line: uiLine,
                item: itemName
            });
            return;
        }

        var assignmentCount = inventoryDetail.getLineCount({
            sublistId: 'inventoryassignment'
        });

        debug('Inventory Detail Rows Found', {
            itemLine: uiLine,
            item: itemName,
            assignmentCount: assignmentCount
        });

        if (assignmentCount === 0) {
            errors.push(
                'Item line ' + uiLine +
                ' (' + itemName + '): Inventory Detail is empty.'
            );

            errorLog('Inventory Detail has no assignment rows', {
                itemLine: uiLine,
                item: itemName
            });

            return;
        }

        for (var j = 0; j < assignmentCount; j++) {
            validateAssignmentLine(
                inventoryDetail,
                itemLine,
                j,
                itemName,
                errors
            );
        }
    }

    /**
     * Validates one Inventory Assignment row.
     */
    function validateAssignmentLine(
        inventoryDetail,
        itemLine,
        assignmentLine,
        itemName,
        errors
    ) {
        var uiItemLine = itemLine + 1;
        var uiAssignmentLine = assignmentLine + 1;

        var assignmentQuantity = getAssignmentValue(
            inventoryDetail,
            'quantity',
            assignmentLine
        );

        debug('Checking Inventory Assignment Row', {
            itemLine: uiItemLine,
            inventoryDetailRow: uiAssignmentLine,
            item: itemName,
            quantity: assignmentQuantity
        });

        /*
         * Ignore a completely unused blank assignment row.
         */
        if (isBlank(assignmentQuantity)) {
            debug('Assignment row skipped because quantity is blank', {
                itemLine: uiItemLine,
                inventoryDetailRow: uiAssignmentLine
            });
            return;
        }

        var missing = [];
        var fieldResults = {};

        for (var k = 0; k < REQUIRED_FIELDS.length; k++) {
            var requiredField = REQUIRED_FIELDS[k];

            var fieldResult = readAssignmentField(
                inventoryDetail,
                requiredField.id,
                assignmentLine
            );

            fieldResults[requiredField.label] = fieldResult;

            /*
             * Only require the field when NetSuite makes the field
             * available for this item and assignment type.
             */
            if (
                fieldResult.applicable &&
                isBlank(fieldResult.value)
            ) {
                missing.push(requiredField.label);
            }
        }

        debug('Inventory Assignment Values', {
            itemLine: uiItemLine,
            inventoryDetailRow: uiAssignmentLine,
            item: itemName,
            fields: fieldResults,
            missing: missing
        });

        if (missing.length > 0) {
            var errorMessage =
                'Item line ' + uiItemLine +
                ' (' + itemName + ')' +
                ', Inventory Detail row ' + uiAssignmentLine +
                ': Missing ' + missing.join(', ') + '.';

            errors.push(errorMessage);

            errorLog('Missing Inventory Detail Fields', {
                itemLine: uiItemLine,
                inventoryDetailRow: uiAssignmentLine,
                item: itemName,
                quantity: assignmentQuantity,
                missing: missing,
                fields: fieldResults
            });
        }
    }

    /**
     * Attempts to retrieve the Inventory Detail subrecord.
     */
    function getInventoryDetailSubrecord(rec, line) {
        try {
            var detail = rec.getSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail',
                line: line
            });

            debug('Inventory Detail subrecord successfully opened', {
                itemLine: line + 1,
                found: !!detail
            });

            return detail;

        } catch (e) {
            debug('Inventory Detail subrecord is not available', {
                itemLine: line + 1,
                message: getErrorDetails(e)
            });

            return null;
        }
    }

    /**
     * Reads one Inventory Assignment field.
     *
     * applicable=false means NetSuite does not expose the field for
     * the current item or assignment type.
     */
    function readAssignmentField(
        inventoryDetail,
        fieldId,
        line
    ) {
        var result = {
            fieldId: fieldId,
            applicable: true,
            value: null,
            text: ''
        };

        /*
         * Check whether the field exists.
         */
        try {
            if (
                typeof inventoryDetail.getSublistField === 'function'
            ) {
                var fieldObject = inventoryDetail.getSublistField({
                    sublistId: 'inventoryassignment',
                    fieldId: fieldId,
                    line: line
                });

                if (!fieldObject) {
                    result.applicable = false;
                    return result;
                }
            }
        } catch (metadataError) {
            /*
             * Some client-side subrecords do not support field metadata.
             * Continue and try reading the field value directly.
             */
            debug('Field metadata check was unavailable', {
                fieldId: fieldId,
                line: line + 1,
                message: getErrorDetails(metadataError)
            });
        }

        try {
            result.value = inventoryDetail.getSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                line: line
            });
        } catch (valueError) {
            result.applicable = false;
            result.error = getErrorDetails(valueError);
            return result;
        }

        try {
            result.text = inventoryDetail.getSublistText({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                line: line
            }) || '';
        } catch (textError) {
            result.text = '';
        }

        return result;
    }

    function getAssignmentValue(
        inventoryDetail,
        fieldId,
        line
    ) {
        try {
            return inventoryDetail.getSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                line: line
            });
        } catch (e) {
            debug('Could not read assignment field', {
                fieldId: fieldId,
                line: line + 1,
                message: getErrorDetails(e)
            });

            return null;
        }
    }

    function getLineValue(
        rec,
        sublistId,
        fieldId,
        line
    ) {
        try {
            return rec.getSublistValue({
                sublistId: sublistId,
                fieldId: fieldId,
                line: line
            });
        } catch (e) {
            debug('Could not read transaction line value', {
                sublistId: sublistId,
                fieldId: fieldId,
                line: line + 1,
                message: getErrorDetails(e)
            });

            return null;
        }
    }

    function getLineText(
        rec,
        sublistId,
        fieldId,
        line
    ) {
        try {
            return rec.getSublistText({
                sublistId: sublistId,
                fieldId: fieldId,
                line: line
            }) || '';
        } catch (e) {
            return '';
        }
    }

    function isBlank(value) {
        return value === null ||
            value === undefined ||
            String(value).trim() === '';
    }

    function debug(title, details) {
        if (!DEBUG_ENABLED) {
            return;
        }

        try {
            if (details === undefined) {
                console.log(LOG_PREFIX + ' ' + title);
            } else {
                console.log(LOG_PREFIX + ' ' + title, details);
            }
        } catch (e) {
            // Do not interrupt validation because of console logging.
        }
    }

    function errorLog(title, details) {
        try {
            console.error(LOG_PREFIX + ' ' + title, details);
        } catch (e) {
            try {
                console.log(LOG_PREFIX + ' ERROR: ' + title, details);
            } catch (ignore) {}
        }
    }

    function getErrorDetails(e) {
        if (!e) {
            return 'Unknown error';
        }

        return e.message ||
            e.name ||
            String(e);
    }

    return {
        pageInit: pageInit,
        saveRecord: saveRecord
    };
});