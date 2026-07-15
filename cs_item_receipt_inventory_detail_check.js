/**
 * IMG | IR Inventory Detail Validation
 *
 * Blocks Item Receipt save when an applicable Inventory Detail row
 * is missing:
 *  - Bin
 *  - Inventory Status
 *  - Expiration Date
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define([], function () {

    var PREFIX = '[IMG IR Inventory Detail]';

    /*
     * Keep true during testing.
     * It displays an alert when the script loads and when saveRecord starts.
     *
     * After testing is complete, change this to false.
     */
    var TEST_MODE = true;

    var REQUIRED_FIELDS = [
        {
            id: 'binnumber',
            label: 'Bin'
        },
        {
            id: 'inventorystatus',
            label: 'Status'
        },
        {
            id: 'expirationdate',
            label: 'Expiration Date'
        }
    ];

    function pageInit(context) {
        try {
            console.log(PREFIX + ' CLIENT SCRIPT LOADED', {
                recordType: context.currentRecord.type,
                recordId: context.currentRecord.id || 'New Record',
                mode: context.mode
            });

            if (TEST_MODE) {
                alert('IMG Inventory Detail Validation Loaded');
            }

        } catch (e) {
            console.error(PREFIX + ' pageInit error', e);
        }
    }

    function saveRecord(context) {
        var rec = context.currentRecord;
        var validationErrors = [];
        var originalItemLine = -1;

        try {
            console.log(PREFIX + ' ========================================');
            console.log(PREFIX + ' saveRecord FIRED');
            console.log(PREFIX + ' Record information', {
                recordType: rec.type,
                recordId: rec.id || 'New Record'
            });

            if (TEST_MODE) {
                alert('IMG Inventory Detail saveRecord validation started');
            }

            /*
             * Remember the currently selected item line so it can be
             * restored after validation.
             */
            try {
                originalItemLine = rec.getCurrentSublistIndex({
                    sublistId: 'item'
                });
            } catch (currentLineError) {
                originalItemLine = -1;

                console.log(
                    PREFIX + ' Could not determine current item line',
                    getError(currentLineError)
                );
            }

            var itemLineCount = rec.getLineCount({
                sublistId: 'item'
            });

            console.log(
                PREFIX + ' Total item lines:',
                itemLineCount
            );

            for (var i = 0; i < itemLineCount; i++) {
                validateItemLine(
                    rec,
                    i,
                    validationErrors
                );
            }

            /*
             * Restore the line that was selected before validation.
             */
            if (
                originalItemLine !== null &&
                originalItemLine !== undefined &&
                originalItemLine >= 0 &&
                originalItemLine < itemLineCount
            ) {
                try {
                    rec.selectLine({
                        sublistId: 'item',
                        line: originalItemLine
                    });

                    console.log(
                        PREFIX + ' Restored original item line:',
                        originalItemLine + 1
                    );

                } catch (restoreError) {
                    console.log(
                        PREFIX + ' Could not restore original item line',
                        getError(restoreError)
                    );
                }
            }

        } catch (e) {
            console.error(
                PREFIX + ' UNEXPECTED VALIDATION ERROR',
                e
            );

            alert(
                'Inventory Detail validation could not be completed.\n\n' +
                'Error: ' + getError(e) + '\n\n' +
                'The Item Receipt has not been saved.'
            );

            return false;
        }

        if (validationErrors.length > 0) {
            console.error(
                PREFIX + ' SAVE BLOCKED',
                validationErrors
            );

            var message =
                'This Item Receipt cannot be saved because required ' +
                'Inventory Detail fields are missing:\n\n';

            for (
                var errorIndex = 0;
                errorIndex < validationErrors.length;
                errorIndex++
            ) {
                message +=
                    (errorIndex + 1) + '. ' +
                    validationErrors[errorIndex] +
                    '\n';
            }

            message +=
                '\nEnter the missing Bin, Status, and Expiration Date, ' +
                'then save the Item Receipt again.';

            alert(message);

            console.log(
                PREFIX + ' saveRecord returning FALSE'
            );

            return false;
        }

        console.log(
            PREFIX + ' ALL INVENTORY DETAIL VALIDATION PASSED'
        );

        console.log(
            PREFIX + ' saveRecord returning TRUE'
        );

        return true;
    }

    function validateItemLine(
        rec,
        itemLine,
        validationErrors
    ) {
        var displayLine = itemLine + 1;

        var itemId = getTransactionLineValue(
            rec,
            'item',
            'item',
            itemLine
        );

        var itemName = getTransactionLineText(
            rec,
            'item',
            'item',
            itemLine
        ) || String(itemId || '');

        var receiveValue = getTransactionLineValue(
            rec,
            'item',
            'itemreceive',
            itemLine
        );

        var quantity = getTransactionLineValue(
            rec,
            'item',
            'quantity',
            itemLine
        );

        console.log(
            PREFIX + ' Checking Item Receipt line ' + displayLine,
            {
                itemId: itemId,
                itemName: itemName,
                itemReceive: receiveValue,
                quantity: quantity
            }
        );

        if (isBlank(itemId)) {
            console.log(
                PREFIX + ' Line ' + displayLine +
                ' skipped because the item is blank.'
            );

            return;
        }

        /*
         * Skip lines that are explicitly unchecked.
         * Some existing Item Receipts may not expose itemreceive,
         * so null or blank is not treated as unchecked.
         */
        if (
            receiveValue === false ||
            receiveValue === 'F' ||
            receiveValue === 0 ||
            receiveValue === '0'
        ) {
            console.log(
                PREFIX + ' Line ' + displayLine +
                ' skipped because Receive is unchecked.'
            );

            return;
        }

        var hasInventoryDetail = false;

        try {
            hasInventoryDetail = rec.hasSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail',
                line: itemLine
            });

            console.log(
                PREFIX + ' Inventory Detail check for line ' +
                displayLine,
                {
                    hasInventoryDetail: hasInventoryDetail
                }
            );

        } catch (hasDetailError) {
            console.error(
                PREFIX + ' Error checking Inventory Detail on line ' +
                displayLine,
                hasDetailError
            );

            hasInventoryDetail = false;
        }

        /*
         * Non-bin, non-lot and non-serial items may not have an
         * Inventory Detail subrecord.
         */
        if (!hasInventoryDetail) {
            console.log(
                PREFIX + ' Line ' + displayLine +
                ' has no Inventory Detail and was skipped.'
            );

            return;
        }

        /*
         * Select the Item Receipt line so we can access its
         * current Inventory Detail subrecord.
         */
        try {
            rec.selectLine({
                sublistId: 'item',
                line: itemLine
            });

            console.log(
                PREFIX + ' Selected Item Receipt line:',
                displayLine
            );

        } catch (selectError) {
            console.error(
                PREFIX + ' Could not select Item Receipt line ' +
                displayLine,
                selectError
            );

            validationErrors.push(
                'Item line ' + displayLine +
                ' (' + itemName + '): Inventory Detail could not be opened.'
            );

            return;
        }

        var inventoryDetail;

        try {
            inventoryDetail = rec.getCurrentSublistSubrecord({
                sublistId: 'item',
                fieldId: 'inventorydetail'
            });

            console.log(
                PREFIX + ' Inventory Detail opened for line ' +
                displayLine,
                {
                    found: !!inventoryDetail
                }
            );

        } catch (detailError) {
            console.error(
                PREFIX + ' Error opening Inventory Detail on line ' +
                displayLine,
                detailError
            );

            validationErrors.push(
                'Item line ' + displayLine +
                ' (' + itemName + '): Inventory Detail could not be read.'
            );

            return;
        }

        if (!inventoryDetail) {
            validationErrors.push(
                'Item line ' + displayLine +
                ' (' + itemName + '): Inventory Detail is required.'
            );

            return;
        }

        var assignmentCount = inventoryDetail.getLineCount({
            sublistId: 'inventoryassignment'
        });

        console.log(
            PREFIX + ' Inventory Detail row count for item line ' +
            displayLine,
            assignmentCount
        );

        if (assignmentCount === 0) {
            validationErrors.push(
                'Item line ' + displayLine +
                ' (' + itemName + '): Inventory Detail has no assignment rows.'
            );

            return;
        }

        for (var j = 0; j < assignmentCount; j++) {
            validateInventoryAssignment(
                inventoryDetail,
                itemLine,
                j,
                itemName,
                validationErrors
            );
        }
    }

    function validateInventoryAssignment(
        inventoryDetail,
        itemLine,
        assignmentLine,
        itemName,
        validationErrors
    ) {
        var displayItemLine = itemLine + 1;
        var displayAssignmentLine = assignmentLine + 1;

        var quantity = getInventoryAssignmentValue(
            inventoryDetail,
            'quantity',
            assignmentLine
        );

        var receiptNumber = getInventoryAssignmentValue(
            inventoryDetail,
            'receiptinventorynumber',
            assignmentLine
        );

        var issueNumber = getInventoryAssignmentValue(
            inventoryDetail,
            'issueinventorynumber',
            assignmentLine
        );

        console.log(
            PREFIX + ' Checking Inventory Detail assignment',
            {
                itemLine: displayItemLine,
                inventoryDetailRow: displayAssignmentLine,
                item: itemName,
                quantity: quantity,
                receiptInventoryNumber: receiptNumber,
                issueInventoryNumber: issueNumber
            }
        );

        /*
         * Skip only a completely unused placeholder assignment row.
         */
        if (
            isBlank(quantity) &&
            isBlank(receiptNumber) &&
            isBlank(issueNumber)
        ) {
            console.log(
                PREFIX + ' Inventory Detail row skipped because it is unused',
                {
                    itemLine: displayItemLine,
                    inventoryDetailRow: displayAssignmentLine
                }
            );

            return;
        }

        var missingFields = [];
        var fieldResults = {};

        for (var k = 0; k < REQUIRED_FIELDS.length; k++) {
            var requiredField = REQUIRED_FIELDS[k];

            var result = readInventoryAssignmentField(
                inventoryDetail,
                requiredField.id,
                assignmentLine
            );

            fieldResults[requiredField.label] = result;

            /*
             * Require the field only when NetSuite exposes that field
             * for the current inventory assignment.
             */
            if (
                result.applicable &&
                isBlank(result.value)
            ) {
                missingFields.push(
                    requiredField.label
                );
            }
        }

        console.log(
            PREFIX + ' Inventory Detail field values',
            {
                itemLine: displayItemLine,
                inventoryDetailRow: displayAssignmentLine,
                fields: fieldResults,
                missingFields: missingFields
            }
        );

        if (missingFields.length > 0) {
            var errorMessage =
                'Item line ' + displayItemLine +
                ' (' + itemName + ')' +
                ', Inventory Detail row ' +
                displayAssignmentLine +
                ': Missing ' +
                missingFields.join(', ') +
                '.';

            validationErrors.push(
                errorMessage
            );

            console.error(
                PREFIX + ' REQUIRED FIELD MISSING',
                {
                    error: errorMessage,
                    itemLine: displayItemLine,
                    inventoryDetailRow: displayAssignmentLine,
                    fields: fieldResults
                }
            );
        }
    }

    function readInventoryAssignmentField(
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
         * First check whether the field exists for this inventory item.
         */
        try {
            var fieldObject = inventoryDetail.getSublistField({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                line: line
            });

            if (!fieldObject) {
                result.applicable = false;

                console.log(
                    PREFIX + ' Field is not applicable',
                    {
                        fieldId: fieldId,
                        inventoryDetailRow: line + 1
                    }
                );

                return result;
            }

        } catch (fieldObjectError) {
            /*
             * Continue to attempt reading the value. Some subrecords
             * may not return field metadata correctly in the browser.
             */
            console.log(
                PREFIX + ' Could not read field metadata',
                {
                    fieldId: fieldId,
                    inventoryDetailRow: line + 1,
                    error: getError(fieldObjectError)
                }
            );
        }

        try {
            result.value = inventoryDetail.getSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: fieldId,
                line: line
            });

        } catch (valueError) {
            result.applicable = false;
            result.error = getError(valueError);

            console.log(
                PREFIX + ' Field is not available on this assignment',
                {
                    fieldId: fieldId,
                    inventoryDetailRow: line + 1,
                    error: result.error
                }
            );

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

    function getInventoryAssignmentValue(
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
            console.log(
                PREFIX + ' Could not read Inventory Detail field',
                {
                    fieldId: fieldId,
                    inventoryDetailRow: line + 1,
                    error: getError(e)
                }
            );

            return null;
        }
    }

    function getTransactionLineValue(
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
            console.log(
                PREFIX + ' Could not read transaction line value',
                {
                    sublistId: sublistId,
                    fieldId: fieldId,
                    line: line + 1,
                    error: getError(e)
                }
            );

            return null;
        }
    }

    function getTransactionLineText(
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

    function getError(e) {
        return e && e.message ?
            e.message :
            String(e || 'Unknown error');
    }

    return {
        pageInit: pageInit,
        saveRecord: saveRecord
    };
});