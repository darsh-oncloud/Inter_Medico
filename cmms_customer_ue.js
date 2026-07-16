/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 * @NAmdConfig ./cmms_module_paths.json
 */
define([
    'N/search',
    'N/runtime',
    'N/file',
    'N/task',
    'N/ui/serverWidget',
    'N/url', 'N/record',
    './cmms_common_module',
    './cmms_customer_module',
    './cmms_equipment_server_module',
    './cmms_server_module'
],
    /**
     * 
     * @param {search} search 
     * @param {runtime} runtime 
     * @param {file} file 
     * @param {task} task 
     * @param {serverWidget} serverWidget 
     * @param {url} url
     * @param {record} record
     * @returns 
     */

    function (
        search,
        runtime,
        file,
        task,
        serverWidget,
        url,
        record,
        cmms,
        cmmsCustomer,
        equipmentServer,
        server
    ) {

        const PROJECT_STATUS = {
            CLOSED: '1'
        };

        const SCRIPTED_BUTTON_NAME_MAP = {
            SHEPHERD_BI: 'Shepherd BI',
            SERVICE_REQUESTER: 'Service Requester'
        };

        const SYSTEM_SETUP_FIELD_IDS = [
            'custrecord_cmms_restrict_customer_addr'
        ];

        let hiddenScriptedButtons = [];

        /**
         * Function definition to be triggered before record is loaded.
         *
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {string} context.type - Trigger type
         * @param {Form} context.form - Current form
         * @param {ServerRequest} context.request - Encapsulation of the incoming request
         * @Since 2015.2
         */
        function beforeLoad(context) {
            const form = context.form;
            const newRecord = context.newRecord;
            const newRecordType = newRecord.type;
            hiddenScriptedButtons = cmms.getHiddenScriptedButtonsForRecordType(newRecord.type);
            if (context.type === context.UserEventType.VIEW ||
                context.type === context.UserEventType.EDIT) {
                if (newRecordType !== cmmsCustomer.RECORD_TYPE.PROJECT) {
                    cmmsCustomer.addLaborRatesSubList(context);
                }
                const entityStatus = newRecord.getValue({
                    fieldId: 'entitystatus'
                });
                const createTripFromProjectTask = newRecordType === cmmsCustomer.RECORD_TYPE.PROJECT &&
                    cmms.getConfigValue('custrecord_create_trip_from_project_task');
                if (
                    entityStatus !== PROJECT_STATUS.CLOSED &&
                    cmms.isCMMSRole() &&
                    cmms.showScriptedButton(SCRIPTED_BUTTON_NAME_MAP.SERVICE_REQUESTER, hiddenScriptedButtons) &&
                    !createTripFromProjectTask
                ) {
                    addServiceRequesterButton(form, newRecord);
                }
            }
            if (context.type === context.UserEventType.VIEW) {
                if (cmms.showScriptedButton(SCRIPTED_BUTTON_NAME_MAP.SHEPHERD_BI, hiddenScriptedButtons) && cmms.isCMMSRole()) {
                    addProfitLossButton(form, newRecord);
                }
                const request = context.request;
                if (request && request.parameter) {
                    showRequestMessage(request, form);
                }
            }
            server.setDefaultSystemSetupValues(
                form,
                SYSTEM_SETUP_FIELD_IDS
            );
        }

        /**
         * @param {ServerRequest} request
         * @param {Form} form
         * @returns
         */
        function showRequestMessage(request, form) {
            const requestMessage = request.parameter.message;
            if (requestMessage) {
                const requesterMessageField = form.addField({
                    id: 'custpage_slsordmsg',
                    type: serverWidget.FieldType.INLINEHTML,
                    label: ''
                });
                requesterMessageField.defaultValue = `<span style="color:red;font-size:16px;">${requestMessage}</span>`;
                requesterMessageField.updateLayoutType({
                    layoutType: serverWidget.FieldLayoutType.OUTSIDEABOVE
                });
                requesterMessageField.updateLayoutType({
                    layoutType: serverWidget.FieldLayoutType.STARTROW
                });
            }
        }

        /**
         * @param {Form} form
         * @param {Record} newRecord
         * @returns
         */
        function addProfitLossButton(form, newRecord) {
            const newRecordId = newRecord.id;
            const entityid = newRecord.getValue({
                fieldId: 'entityid'
            });
            const profitLossReportUrl = url.resolveScript({
                scriptId: 'customscript_cmms_shepherd_bi_sl',
                deploymentId: 'customdeploy_cmms_shepherd_bi_sl'
            }) + `&customerIds=${newRecordId}&customerName=${entityid}`;
            form.addButton({
                id: 'custpage_profit_loss',
                label: cmms.replaceServiceOrderString(SCRIPTED_BUTTON_NAME_MAP.SHEPHERD_BI),
                functionName: `window.open('${profitLossReportUrl}')`
            });
        }

        /**
         * @param {Form} form
         * @param {Record} newRecord
         * @returns
         */
        function addServiceRequesterButton(form, newRecord) {
            const newRecordId = newRecord.id;
            const newRecordType = newRecord.type;

            let requesterUrl = url.resolveRecord({
                recordType: 'customrecord_cmms_service_call_assistant',
                recordId: null,
                isEditMode: true
            });
            if (newRecordType === cmmsCustomer.RECORD_TYPE.CUSTOMER) {
                requesterUrl += `&customerid=${newRecordId}&isfromCustomer=true`;
            } else if (newRecordType === cmmsCustomer.RECORD_TYPE.PROJECT) {
                const customerId = newRecord.getValue({
                    fieldId: 'customer'
                });
                if (customerId) {
                    requesterUrl += `&customerid=${customerId}`;
                }
                requesterUrl += `&projectid=${newRecordId}`;
            } else {
                requesterUrl = url.resolveRecord({
                    recordType: 'customrecord_cmms_slct_srvc_for_srvc_ord',
                    recordId: null,
                    isEditMode: true
                });
            }
            form.addButton({
                id: 'custpage_servicerequesterbtn',
                label: cmms.replaceServiceOrderString(SCRIPTED_BUTTON_NAME_MAP.SERVICE_REQUESTER),
                functionName: `window.open("${requesterUrl}", "_self");`
            });
        }

        /**
         * Function definition to be triggered before record is saved.
         *
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {Record} context.oldRecord - Old record
         * @param {string} context.type - Trigger type
         * @Since 2015.2
         */
        function beforeSubmit(context) {
            const oldRecord = context.oldRecord;
            const newRecord = context.newRecord;
            const newRecordType = newRecord.type;
            if (newRecordType === cmmsCustomer.RECORD_TYPE.CUSTOMER) {
                const isEdit = context.type === context.UserEventType.EDIT;
                if (context.type === context.UserEventType.CREATE || isEdit) {
                    sourcePartCacheBinLocation(newRecord, oldRecord, isEdit);
                }
            } else if (newRecordType === cmmsCustomer.RECORD_TYPE.PROJECT) {
                const newProjectCustomer = newRecord.getValue({
                    fieldId: 'custentity_cmms_project_customer'
                });
                if (context.type === context.UserEventType.CREATE) {
                    updateProjectCustomer(newRecord);
                } else if (
                    context.type === context.UserEventType.EDIT ||
                    context.type === context.UserEventType.COPY
                ) {
                    const oldProjectCustomer = oldRecord.getValue({
                        fieldId: 'custentity_cmms_project_customer'
                    });
                    const isCurrentProjectCustomerCorrect = isProjectCustomerCorrect(oldRecord);
                    if (!isCurrentProjectCustomerCorrect ||
                        oldProjectCustomer !== newProjectCustomer) {
                        updateProjectCustomer(newRecord);
                    }
                }
            }
        }

        /**
         * @param {Record} newRecord
         * @returns
         */
        function updateProjectCustomer(newRecord) {
            newRecord.setValue({
                fieldId: 'custentity_cmms_customer_zone',
                value: ''
            });
            const customerParentId = newRecord.getValue({
                fieldId: 'parent'
            });
            const rootCustomerId = cmmsCustomer.getProjectRootCustomer(customerParentId);
            if (rootCustomerId) {
                newRecord.setValue({
                    fieldId: 'custentity_cmms_project_customer',
                    value: rootCustomerId
                });
            }
        }

        /**
         * @param {Record} oldRecord
         * @returns {boolean}
         */
        function isProjectCustomerCorrect(oldRecord) {
            const currentProjectCustomerId = oldRecord.getValue({
                fieldId: 'custentity_cmms_project_customer'
            });
            if (!currentProjectCustomerId) {
                return false;
            }
            const currentParentCustomerId = oldRecord.getValue({
                fieldId: 'parent'
            });
            const rootCustomer = cmmsCustomer.getProjectRootCustomer(currentParentCustomerId);
            return currentProjectCustomerId === rootCustomer;
        }

        /**
         * @param {Record} newRecord
         * @param {Record} oldRecord
         * @param {boolean} isEdit
         * @returns
         */
        function sourcePartCacheBinLocation(newRecord, oldRecord, isEdit) {
            const binId = newRecord.getValue('custentity_cmms_parts_bin');
            if (isEdit) {
                const oldBinId = oldRecord.getValue('custentity_cmms_parts_bin');
                if (binId && oldBinId !== binId) {
                    const binLocationLookup = search.lookupFields({
                        type: search.Type.BIN,
                        id: binId,
                        columns: 'location'
                    });
                    const binLocationId = cmms.getLookupFieldsValue(binLocationLookup, 'location');
                    newRecord.setValue({
                        fieldId: 'custentity_cmms_parts_bin_location',
                        value: binLocationId
                    });
                }
            }
            if (!binId) {
                newRecord.setValue({
                    fieldId: 'custentity_cmms_parts_bin_location',
                    value: null
                });
            }
        }

        /**
         * Function definition to be triggered after record is saved.
         *
         * @param {Object} context
         * @param {Record} context.newRecord - New record
         * @param {Record} context.oldRecord - Old record
         * @param {string} context.type - Trigger type
         * @Since 2015.2
         */
        function afterSubmit(context) {
            const oldRecord = context.oldRecord;
            const newRecord = context.newRecord;
            const newRecordId = newRecord.id;
            const newRecordType = newRecord.type;
            const isSubsidiariesEnabled = runtime.isFeatureInEffect({
                feature: 'SUBSIDIARIES'
            });
            const subsidiaryId = isSubsidiariesEnabled ? newRecord.getValue('subsidiary') : null;
            const hasAttempttedCustomerEquipmentGeneration = newRecord.getValue('custentity_cmms_has_attempt_cust_eq_gen');
            if (
                newRecordType !== cmmsCustomer.RECORD_TYPE.CUSTOMER &&
                !hasAttempttedCustomerEquipmentGeneration &&
                isAlreadyInCustomerStage(newRecordId)
            ) {
                const equipmentNamingConvention = equipmentServer.getEquipmentNamingConvention();
                cmmsCustomer.generateNewCustomerEquipmentRecords({
                    subsidiaryId,
                    equipmentNamingConvention,
                    customerId: newRecordId
                });
            }

            if (newRecordType === cmmsCustomer.RECORD_TYPE.CUSTOMER) {
                const isAdvBins = runtime.isFeatureInEffect('advbinseriallotmgmt');
                const binId = newRecord.getValue('custentity_cmms_parts_bin');
                if (context.type === context.UserEventType.CREATE) {
                    const equipmentNamingConvention = equipmentServer.getEquipmentNamingConvention();
                    cmmsCustomer.generateNewCustomerEquipmentRecords({
                        subsidiaryId,
                        equipmentNamingConvention,
                        customerId: newRecordId
                    });
                    if (!isAdvBins && binId) {
                        scheduleAddBinsToParts(binId);
                    }
                }
                if (context.type === context.UserEventType.EDIT) {
                    cmmsCustomer.saveLaborRatesSubList(newRecord);
                    updateEquipmentAddresses(newRecord, oldRecord);
                    if (!isAdvBins) {
                        const oldBinId = oldRecord.getValue('custentity_cmms_parts_bin');
                        if (binId && binId !== oldBinId) {
                            scheduleAddBinsToParts(binId);
                        }
                    }
                }
            }

            if (context.type === context.UserEventType.CREATE || context.type === context.UserEventType.EDIT) {
                try {
                    const rentalPdfUrl = url.resolveScript({
                        scriptId: 'customscript_cmms_rental_pdf_sl',
                        deploymentId: 'customdeploy_cmms_rental_pdf_sl',
                        params: {
                            customerId: newRecordId
                        }
                    });
                    record.submitFields({
                        type: record.Type.CUSTOMER,
                        id: newRecordId,
                        values: {
                            custentity_cmms_print_rental_pdf_link: rentalPdfUrl
                        }
                    });
                } catch (e) {
                    log.error({
                        title: 'Customer/Project Set Rental PDF',
                        details: e
                    });
                    cmms.handleError(e, 'Customer/Project Set Rental PDF');
                }
            }
        }

        /**
         * @param {string} binId
         * @returns
         */
        function scheduleAddBinsToParts(binId) {
            try {
                const taskId = task.create({
                    taskType: task.TaskType.SCHEDULED_SCRIPT,
                    scriptId: 'customscript_cmms_add_bins2part_ss',
                    params: {
                        custscript_cmms_addbin2part_binids: JSON.stringify([binId])
                    }
                }).submit();
                const taskStatus = task.checkStatus({ taskId });
                if (taskStatus.status === task.TaskStatus.FAILED) {
                    cmms.createServerError(`Failed to schedule Add Bins to Part script in afterSubmit (Bin ID: ${binId})`);
                }
            } catch (e) {
                log.error({
                    title: 'Error scheduling Schedule script(id: customscript_cmms_add_bins2part_ss)',
                    details: e
                });
            }
        }

        /**
        * @param {Record} newRecord
        * @param {Record} oldRecord
        * @returns
        */
        function updateEquipmentAddresses(newRecord, oldRecord) {
            let scheduleMRScript = false;
            const updatedAddresses = {};
            const newAddresses = {};

            const newAddressesCount = newRecord.getLineCount({
                sublistId: 'addressbook'
            });
            for (let i = 0; i < newAddressesCount; i++) {
                const id = newRecord.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'internalid',
                    line: i
                });
                const newAddress = newRecord.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress_text',
                    line: i
                });
                newAddresses[id] = newAddress;
            }

            const oldAddressesCount = oldRecord.getLineCount({
                sublistId: 'addressbook'
            });
            for (let i = 0; i < oldAddressesCount; i++) {
                const oldAddressId = oldRecord.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'internalid',
                    line: i
                });
                const oldAddress = oldRecord.getSublistValue({
                    sublistId: 'addressbook',
                    fieldId: 'addressbookaddress_text',
                    line: i
                });
                if (!newAddresses[oldAddressId]) {
                    updatedAddresses[oldAddressId] = {
                        id: oldAddressId,
                        address: oldAddress,
                        isDeleted: true
                    };
                    scheduleMRScript = true;
                } else if (newAddresses[oldAddressId] !== oldAddress) {
                    updatedAddresses[oldAddressId] = {
                        id: oldAddressId,
                        address: newAddresses[oldAddressId]
                    };
                    scheduleMRScript = true;
                }
            }
            if (scheduleMRScript) {
                mapReduceUpdateEquipmentAddress(updatedAddresses);
            }
        }

        /**
         * @param {Object} updatedAddresses - [address ID]: string
         * @returns
         */
        function mapReduceUpdateEquipmentAddress(updatedAddresses) {
            try {
                const taskId = task.create({
                    taskType: task.TaskType.MAP_REDUCE,
                    scriptId: 'customscript_cmms_update_equipt_addr_mr',
                    params: {
                        custscript_cmms_equipt_address_json: updatedAddresses
                    }
                }).submit();
                const taskStatus = task.checkStatus({ taskId });
                if (taskStatus.status === task.TaskStatus.FAILED) {
                    cmms.createServerError('Update Equipment Address failed');
                }
            } catch (e) {
                log.error({
                    title: 'Error scheduling MR script(id: customscript_cmms_update_equipt_addr_mr)',
                    details: e
                });
            }
        }

        /**
         * @param {string} customerId
         * @returns {boolean}
         */
        function isAlreadyInCustomerStage(customerId) {
            const customerLookup = search.lookupFields({
                type: search.Type.CUSTOMER,
                id: customerId,
                columns: 'stage'
            });
            return cmms.getLookupFieldsValue(customerLookup, 'stage') === 'CUSTOMER';
        }

        return {
            beforeLoad,
            beforeSubmit,
            afterSubmit
        };
    });