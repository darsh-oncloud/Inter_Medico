/**
 * IMG | IR Client Script Load Test
 *
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 * @NModuleScope SameAccount
 */
define([], function () {

    var PREFIX = '[IMG IR TEST]';

    function pageInit(context) {
        try {
            alert('IMG Client Script Loaded');

            console.log(PREFIX + ' pageInit fired', {
                recordType: context.currentRecord.type,
                recordId: context.currentRecord.id || 'New Record',
                mode: context.mode
            });
        } catch (e) {
            alert('pageInit error: ' + getError(e));
            console.error(PREFIX + ' pageInit error', e);
        }
    }

    function saveRecord(context) {
        try {
            alert('IMG saveRecord Fired');

            console.log(PREFIX + ' saveRecord fired', {
                recordType: context.currentRecord.type,
                recordId: context.currentRecord.id || 'New Record'
            });

            // Allow the Item Receipt to save during this test.
            return true;

        } catch (e) {
            alert('saveRecord error: ' + getError(e));
            console.error(PREFIX + ' saveRecord error', e);

            return false;
        }
    }

    function getError(e) {
        return e && e.message ? e.message : String(e || 'Unknown error');
    }

    return {
        pageInit: pageInit,
        saveRecord: saveRecord
    };
});