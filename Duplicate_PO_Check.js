/**
 * @NApiVersion 2.1
 * @NScriptType ClientScript
 */
define(['N/log'], (log) => {

    const pageInit = (context) => {

        console.log('TEST - CLIENT SCRIPT LOADED');

        log.debug({
            title: 'TEST - PAGE INIT',
            details: 'Client Script loaded on Sales Order'
        });
    };

    const saveRecord = (context) => {

        console.log('TEST - SAVE RECORD FIRED');

        log.debug({
            title: 'TEST - SAVE RECORD',
            details: 'saveRecord function fired'
        });

        alert('Client Script saveRecord is running');

        return true;
    };

    return {
        pageInit,
        saveRecord
    };
});