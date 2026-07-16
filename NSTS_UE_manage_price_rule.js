/**
 *    Copyright (c) 2026, Oracle and/or its affiliates. All rights reserved.
 *
 *    TODO: - freight item will be optional on a customer level basis.
 */

/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope Public
 */
define(['N/record', 'N/search', '../library/NSTS_MD_CommonLibrary'],
    /**
     * @param {record} record
     */
    function (record, search, commonLibrary) {
        let strLogTitle;
        const idSublist = 'item';
        let objScriptParameters = {
            priceRuleSearch: 'custscript_ns_cs_mpr_price_rule_search',
            freight: 'custscript_ns_cs_mpr_freight',
            handling: 'custscript_ns_cs_mpr_handling',
            dangerousGoods: 'custscript_ns_cs_mpr_dangerous_goods',
            dryIce: 'custscript_ns_cs_mpr_dryice',
            minimumOrderCharge: 'custscript_ns_cs_mpr_min_order_charge',
            skippedDeliveryTerms: 'custscript_ns_cs_mpr_skipped_del_terms',
        };

        /**
         * Function definition to be triggered before record is loaded.
         *
         * @param {Object} scriptContext
         * @param {Record} scriptContext.newRecord - New record
         * @param {Record} scriptContext.oldRecord - Old record
         * @param {string} scriptContext.type - Trigger type
         * @Since 2015.2
         */
        function beforeSubmit(scriptContext) {
            try {
                strLogTitle = 'saveRecord';
                objScriptParameters = commonLibrary.getParameters(objScriptParameters, true);
                commonLibrary.addOtherChargesItems(objScriptParameters, scriptContext.newRecord, idSublist);
            } catch (e) {
                log.error(
                    `Error at [${strLogTitle}] function`,
                    `Message:<\/br>${e.message}<\/br><\/br>Stack:<\/br>${e.stack}`
                );
            }
        }

        return {
            beforeSubmit: beforeSubmit,
        };

    });
