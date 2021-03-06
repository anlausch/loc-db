"use strict";
const swbHelper = require('./../helpers/swbHelper.js').createSwbHelper();
const BibliographicResource = require('./../schema/bibliographicResource.js');
const Identifier = require('./../schema/identifier.js');
const ResourceEmbodiment = require('./../schema/resourceEmbodiment');
const Scan = require('./../schema/scan.js');
const enums = require('./../schema/enum.json');
const async = require('async');
const mongoBr = require('./../models/bibliographicResource.js').mongoBr;
const logger = require('./../util/logger.js');
const config = require('./../../config/config.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const databaseHelper = require('./../helpers/databaseHelper.js').createDatabaseHelper();
const crossrefHelper = require('./../helpers/crossrefHelper').createCrossrefHelper();
const ocrHelper = require('./../helpers/ocrHelper').createOcrHelper();
const agenda = require('./../jobs/jobs');

function saveResource(req, res) {
    var response = res;
    var identifier = {
        "scheme": req.swagger.params.identifierScheme.value,
        "literalValue": req.swagger.params.identifierLiteralValue.value
    };
    var resourceType = req.swagger.params.resourceType.value;
    var firstPage = req.swagger.params.firstPage.value;
    var lastPage = req.swagger.params.lastPage.value;
    var binaryFile = req.swagger.params.binaryFile.value;
    var textualPdf = req.swagger.params.textualPdf.value;
    var stringFile = req.swagger.params.stringFile.value;
    var embodimentType = req.swagger.params.embodimentType.value;

    // 1. Check whether resource already exists given it's identifier, resourceType and maybe first or lastPage
    databaseHelper.resourceExists(identifier, resourceType, firstPage, lastPage, function(err, resource) {
        if (err) {
            logger.error(err);
            return response.status(500).json(err);
        } else if (resource) {
            // 1a. resource already exists
            // 2. now we have to append the string file or textual pdf if given
            if (!binaryFile && !stringFile) {
                return response.status(400).json({"message": "The resource already exists."});
            }
            return databaseHelper.saveReferencesPageForResource(resource[0], binaryFile, textualPdf, stringFile, embodimentType, function (err, result) {
                if (err) {
                    logger.error(err);
                    return response.status(500).json(err);
                }
                // retrieve parent if necessary
                if(result[0].partOf && result[0].partOf !== ""){
                    mongoBr.findById(result[0].partOf, function(err, parent){
                        return response.json([result[0], parent, result[1]]);
                    });
                }else{
                    return response.json(result);
                }
            });
        } else if (!resource) {
            // 1b. resource does not exist; we will have to create it depending on the resourceType and identifier
            switch (resourceType) {
                case enums.resourceType.journal:
                    // The resource is a journal, the ZDB ID should be given and basically nothing else
                    if (identifier.scheme !== enums.identifier.zdbPpn || stringFile || binaryFile || firstPage || lastPage) {
                        return response.status(400).json({"message": "In order to create a journal resource in the db, provide the zdb ppn."})
                    } else {
                        return swbHelper.query(identifier.literalValue, resourceType, function (err, resource) {
                            if (err) {
                                logger.error(err);
                                return response.status(500).json(err);
                            }
                            // we retrieved the metadata; As it should not be possible to append a scan directly to a journal,
                            // we are done
                            //resource.type = resourceType;
                            mongoBr.create(resource, function (err, resource) {
                                if (err) {
                                    logger.error(err);
                                    return response.status(500).json(err);
                                }
                                return response.status(200).json(resource);
                            });
                        });
                    }
                case enums.resourceType.journalArticle:
                    if (identifier.scheme !== enums.identifier.olcPpn && identifier.scheme !== enums.identifier.doi) {
                        return response.status(400).json({"message": "Not the appropriate input data for creating a journal article."})
                    } else {
                        switch (identifier.scheme) {
                            case enums.identifier.doi:
                                // go to crossref and create article
                                return crossrefHelper.queryByDOI(identifier.literalValue, function (err, resources) {
                                    // wenn das issue nicht existiert, kann auch der article nicht existieren
                                    // hier muss hierarschich vorgegangen werden
                                    if(!resources){
                                        var child = new BibliographicResource({type: resourceType});
                                        child.setIdentifiersForType(resourceType, [new Identifier({identifierScheme: enums.identifier.doi, literalValue: identifier.literalValue})]);
                                        var parent = new BibliographicResource({type: enums.resourceType.journalIssue});
                                        resources = [child, parent];
                                    }
                                    resources[0].status = enums.status.external;
                                    databaseHelper.curateHierarchy(resources, function (err, resources) {
                                        if(err){
                                            logger.error(err);
                                            return response.status(400).json(err);
                                        }
                                        // jetzt müssen wir gucken, ob man noch einen Scan speichern muss oder nicht
                                        agenda.now('precalculate suggestions', {br: resources[0]});
                                        if (!binaryFile && !stringFile) {
                                            return response.json(resources);
                                        }
                                        for (var resource of resources) {
                                            if (resource.type === enums.resourceType.journalArticle) {
                                                databaseHelper.saveReferencesPageForResource(resource, binaryFile, textualPdf, stringFile, embodimentType, function (err, result) {
                                                    if (err) {
                                                        logger.error(err);
                                                        return response.status(500).json(err);
                                                    }
                                                    result = [result[0], resources[1], result[1]];
                                                    return response.json(result);
                                                });
                                            }
                                        }

                                    });
                                });
                            case enums.identifier.olcPpn:
                                // go to olc and create article
                                return response.status(400).json({"message": "Identifier type not implemented."});
                        }
                    }
                case enums.resourceType.bookChapter:
                case enums.resourceType.proceedingsArticle:
                    //return response.status(400).json({"message": "Resource type not implemented yet."});
                    switch (identifier.scheme) {
                        case enums.identifier.doi:
                            // go to crossref and create chapter
                            return crossrefHelper.queryByDOI(identifier.literalValue, function (err, resources) {
                                resources[0].status = enums.status.external;
                                databaseHelper.curateHierarchy(resources, function (err, resources) {
                                    if(err){
                                        logger.error(err);
                                        return response.status(400).json(err);
                                    }
                                    agenda.now('precalculate suggestions', {br: resources[0]});
                                    if (!binaryFile && !stringFile) {
                                        return response.json(resources);
                                    }
                                    for (var resource of resources) {
                                        if (resource.type === enums.resourceType.journalArticle) {
                                            databaseHelper.saveReferencesPageForResource(resource, binaryFile, textualPdf, stringFile, embodimentType, function (err, result) {
                                                if (err) {
                                                    logger.error(err);
                                                    return response.status(500).json(err);
                                                }
                                                return response.json(result);
                                            });
                                        }
                                    }

                                });
                            });
                        case enums.identifier.swbPpn:
                            return swbHelper.query(identifier.literalValue, resourceType, function (err, resources) {
                                if (err) {
                                    logger.error(err);
                                    return response.status(500).json(err);
                                }
                                // TODO: What if parent does not exist?
                                var parent = resources[0];
                                crossrefHelper.queryChapterMetaData(parent.getTitleForType(parent.type), firstPage, lastPage, function(err, res) {
                                    if (err) {
                                        logger.error(err);
                                        //return response.status(200).send(res);
                                    }
                                    if (res && res[0]) {
                                        var child = new BibliographicResource(res[0]);
                                    } else {
                                        var child = new BibliographicResource({
                                            type: enums.resourceType.bookChapter,
                                            bookChapter_embodiedAs: [new ResourceEmbodiment({
                                                firstPage: firstPage,
                                                lastPage: lastPage,
                                                type: embodimentType
                                            })]
                                        });
                                    }
                                    resources = [child, parent];
                                    databaseHelper.curateHierarchy(resources, function (err, resources) {
                                        if(err){
                                            logger.error(err);
                                            return response.status(400).json(err);
                                        }
                                        agenda.now('precalculate suggestions', {br: resources[0]});
                                        // jetzt müssen wir gucken, ob man noch einen Scan speichern muss oder nicht
                                        if (!binaryFile && !stringFile) {
                                            return response.json(resources);
                                        }else{
                                            child = resources[0];
                                            parent = resources[1];
                                            databaseHelper.saveReferencesPageForResource(child, binaryFile, textualPdf, stringFile, embodimentType, function (err, result) {
                                                if (err) {
                                                    logger.error(err);
                                                    return response.status(500).json(err);
                                                }
                                                result = [result[0], parent, result[1]];
                                                return response.json(result);
                                            });
                                        }
                                    });
                                });
                            });
                    }
                case enums.resourceType.monograph:
                case enums.resourceType.book:
                    return swbHelper.query(identifier.literalValue, resourceType, function (err, resource) {
                        if (err) {
                            logger.error(err);
                            return response.status(500).json(err);
                        }
                        if(!resource || !resource[0]){
                            logger.error(new Error("No resource retrieved from SWB"));
                            return response.status(500).json(err);
                        }
                        // we retrieved the metadata; but now lets check whether there are references in crossref
                        var doi = null;

                        for(var identifier of resource[0].getIdentifiersForType(resource[0].type)){
                            if(identifier.scheme === enums.identifier.doi){
                                doi = identifier.literalValue;
                            }
                        }
                        var queryString = null;
                        if(!doi){
                            queryString = resource[0].getTitleForType(resource[0].type);
                        }
                        return crossrefHelper.queryReferences(doi, queryString, function(err, result){
                            if(err){
                                logger.error(err);
                            }
                            if(result && result[0] && result[0].parts){
                                resource[0].parts = result[0].parts;
                            }else{
                                resource[0].parts = [];
                            }
                            // now we have to check whether we have to append something
                            return mongoBr.create(resource[0], function (err, resource) {
                                if (err) {
                                    logger.error(err);
                                    return response.status(500).json(err);
                                }

                                agenda.now('precalculate suggestions', {br: resource});
                                if (binaryFile || stringFile) {
                                    return databaseHelper.saveReferencesPageForResource(resource, binaryFile, textualPdf, stringFile, embodimentType, function (err, result) {
                                        if (err) {
                                            logger.error(err);
                                            return response.status(500).json(err);
                                        }
                                        return response.json(result);
                                    });
                                } else {
                                    return response.status(200).json(resource);
                                }
                            });
                        });
                    });
                default:
                    return response.status(400).json({"message": "Resource type not implemented."});
            }
        }
    });
}



function getToDo(req, res) {
    var response = res;
    var status = req.swagger.params.status.value;
    async.map(status, function(stat, callback){
        databaseHelper.retrieveToDos(stat, function(err,res){
           if(err){
               logger.error(err);
               return callback(err, null);
           }
           return callback(null, res);
        });
    }, function(err, result){
        if(err){
            logger.error(err);
            return response.status(500).json(err);
        }
        result = [].concat.apply([], result);
        return response.json(result);

    });
}


function get(req, res) {
    var response = res;
    var id = req.swagger.params.id.value;

    // check if id is valid
    if (!mongoose.Types.ObjectId.isValid(id)) {
        logger.error("Invalid value for parameter id.", {id: id});
        return response.status(400).json({"message": "Invalid parameter."});
    }

    // retrieve corresponding entry from the db
    return databaseHelper.getScanById(id, function(err, scan){
        if (err) {
            logger.error(err);
            return response.status(500).json(err);
        }
        if(!scan){
            return response.status(400).json({"message": "Scan cannot be found."});
        }
        // send file
        var filePath = config.PATHS.UPLOAD + scan.scanName;
        return response.sendFile(path.resolve(filePath), function (err) {
            if (err) return logger.error(err);
        });
    });
/*    return databaseHelper.createSimpleEqualsConditions('embodiedAs', id, '.scans._id', function(err,conditions) {
        if (err) {
            logger.error(err);
            return response.status(500).json({"message": "Something weird happened."});
        }
        return mongoBr.findOne({'$or': conditions}, function (err, br) {
            if (err) {
                logger.error(err);
                return response.status(500).json({"message": "DB query failed."});
            } else if (!br) {
                logger.error("No entry found for parameter id.", {id: id});
                return response.status(400).json({"message": "No entry found."});
            }
            for (var embodiment of new BibliographicResource(br).getResourceEmbodimentsForType(br.type)) {
                for (var scan of embodiment.scans) {
                    if (scan._id.toString() === id) {
                        // send file
                        var filePath = config.PATHS.UPLOAD + scan.scanName;
                        return response.sendFile(path.resolve(filePath), function (err) {
                            if (err) return logger.error(err);
                        });
                    }
                }
            }
        });
    });*/
};


function remove(req, res) {
    var response = res;
    var id = req.swagger.params.id.value;

    // check if id is valid
    if (!mongoose.Types.ObjectId.isValid(id)) {
        logger.error("Invalid value for parameter id.", {id: id});
        return response.status(400).json({"message": "Invalid parameter."});
    }

    return databaseHelper.createSimpleEqualsConditions('embodiedAs', id, '.scans._id', function(err,conditions) {
        if (err) {
            logger.error(err);
            return callback(new Error("Something weird happened."), null);
        }
        return mongoBr.findOne({'$or': conditions}, function (err, br) {
            // do error handling
            if (err) {
                logger.error(err);
                return callback(err, null);
            } else if (!br) {
                logger.error("No entry found for parameter id.", {id: id});
                return callback(null, null);
            }
            var helperBr = new BibliographicResource(br);
            var embodiments = helperBr.getResourceEmbodimentsForType(br.type);
            for (var embodiment of embodiments) {
                for (var scan of embodiment.scans) {
                    if (scan._id == id) {
                        // remove scan
                        var scanIndex = embodiment.scans.indexOf(scan);
                        var embodimentIndex = embodiments.indexOf(embodiment);
                        if (scanIndex > -1) {
                            var scans = embodiment.toObject().scans;
                            scans.splice(scanIndex, 1);
                            embodiment.scans = scans;//embodiment.toObject().scans.splice(scanIndex, 1);
                        }
                        embodiments[embodimentIndex] = embodiment;
                        helperBr.setResourceEmbodimentsForType(br.type, embodiments);
                        databaseHelper.convertSchemaResourceToMongoose(helperBr, function(err, br){
                            return br.save(function (err, br) {
                                if (err) {
                                    logger.error(err);
                                    return response.status(500).json({"message": "DB query failed."});
                                }
                                return response.status(200).json({"message": "Delete succeeded"})
                            });
                        });
                    }
                }
            }
        });
    });
}


function triggerOcrProcessing(req, res) {
    var id = req.swagger.params.id.value;
    var response = res;

    // check if id is valid
    if (!mongoose.Types.ObjectId.isValid(id)) {
        logger.error("Invalid value for parameter id.", {id: id});
        return response.status(400).json({"message": "Invalid parameter."});
    }
    return databaseHelper.setScanStatus(id, enums.status.ocrProcessing, null, function(err, result){
        if(err){
            logger.error(err);
            return response.status(400).json({"message": "Scan could not be found"});
        }
        if(!result || result.length < 2){
            return response.status(400).json({"message": "Scan could not be found"});
        }
        var br = result[0];
        var scan = result[1];
        agenda.now('extract references', {scan: scan.toObject(), id: id, br: br});
        return response.status(200).json({"message": "Reference extraction triggered."});
    });
};

function correctReferencePosition(req, res){
    var response = res;
    var scanId = req.swagger.params.scanId.value;
    var coordinates = req.swagger.params.coordinates.value;
    var bibliographicEntryId = req.swagger.params.bibliographicEntryId.value;

    // check if id is valid
    if (!mongoose.Types.ObjectId.isValid(scanId) || (bibliographicEntryId && !mongoose.Types.ObjectId.isValid(bibliographicEntryId))) {
        logger.error("Invalid value for parameter id.", {scanId: scanId, bibliographicEntryId: bibliographicEntryId});
        return response.status(400).json({"message": "Invalid parameter."});
    }

    databaseHelper.getScanById(scanId, function(err, scan){
        if(err){
            logger.error(err);
            return response.status(500).json(err);
        }

        if(!scan){
            return response.status(400).json({"message": "Scan cannot be found."});
        }
        ocrHelper.segmentReference(scan.scanName, coordinates, function(err, body){
            if(err){
                logger.error(err);
                return response.status(500).json(err);
            }
            ocrHelper.parseXMLSingleReference(body, function(err, result){
                if(err){
                   logger.error(err);
                   return response.status(500).json(err);
                }
                if(result.length === 0 || !result[0]){
                    // TODO: Is it okay to return null if the ocr returned nothing?
                    return response.status(200).json(null);
                }
                var be = result[0];
                be.scanId = scan._id;
                be.scanName = scan.scanName;
                be.status = enums.status.ocrProcessed;
                var id = mongoose.Types.ObjectId();
                be._id = id;
                databaseHelper.getBrByScanId(scan._id, function(err, br){
                    if(err){
                        logger.error(err);
                        return response.status(500).json(err);
                    }
                    if(bibliographicEntryId){
                        for(let part of br.parts){
                            if(part._id == bibliographicEntryId){
                                part.status = enums.status.obsolete;
                            }
                        }
                    }
                    br.parts.push(be);
                    br.save(function(err, br){
                        if(err){
                            logger.error(err);
                            return response.status(500).json(err);
                        }
                        for(let be of br.parts){
                            if(be._id == id){
                                return response.status(200).json(be);
                            }
                        }
                    });
                });
            });
        });
    });
}

module.exports = {
    saveResource: saveResource,
    getToDo: getToDo,
    triggerOcrProcessing: triggerOcrProcessing,
    get: get,
    remove: remove,
    correctReferencePosition: correctReferencePosition
};
