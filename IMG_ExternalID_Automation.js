/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 */
define(['N/record', 'N/log'], function (record, log) {

    // Map each record type to the custom field that should sync into External ID.
    // Add more record types here later without touching any other logic.
    var FIELD_MAP = {
        'salesorder': 'custbody_your_so_field',
        'customer': 'custentity_external_id'
    };

    function afterSubmit(context) {
        if (context.type === context.UserEventType.DELETE ||
            context.type === context.UserEventType.XEDIT) {
            return;
        }

        var recType = context.newRecord.type;
        var fieldId = FIELD_MAP[recType];

        if (!fieldId) {
            // This record type isn't configured - nothing to do.
            return;
        }

        var customValue = context.newRecord.getValue({ fieldId: fieldId }) || '';
        var currentExternalId = context.newRecord.getValue({ fieldId: 'externalid' }) || '';

        if (!customValue || customValue === currentExternalId) {
            return; // nothing to sync, or already matches
        }

        record.submitFields({
            type: recType,
            id: context.newRecord.id,
            values: { externalid: customValue },
            options: { enablesourcing: false, ignoreMandatoryFields: true }
        });

        log.debug('External ID synced', {
            recordType: recType,
            fieldUsed: fieldId,
            valueSet: customValue
        });
    }

    return {
        afterSubmit: afterSubmit
    };
});
