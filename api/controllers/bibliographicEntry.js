'use strict';
const mongoBr = require('./../models/bibliographicResource.js');
const errorlog = require('./../util/logger.js').errorlog;
const accesslog = require('./../util/logger.js').accesslog;
const enums = require('./../schema/enum.json');
const biliographicEntry = require('./../schema/bibliographicEntry');
const mongoose = require('mongoose');
const extend = require('extend');
const async = require('async');

function getToDoBibliographicEntries(req, res){
    var response = res;
    var scanId = req.swagger.params.scanId.value;

    if(scanId){
        // check if id is valid
        if(! mongoose.Types.ObjectId.isValid(scanId)){
            errorlog.error("Invalid value for parameter id.", {scanId : scanId});
            return response.status(400).json({"message":"Invalid parameter."});
        }
        mongoBr.find({ 'cites.status': enums.status.ocrProcessed, 'cites.scanId' : scanId}, function (err, brs) {
            if(err){
                errorlog.error(err);
                return res.status(500).json({"message":"DB query failed."});
            }
            response.json(createBibliographicEntriesArray(brs));
        });
    }else{
        mongoBr.find({ 'cites.status': enums.status.ocrProcessed }, function (err, brs) {
            if(err){
                errorlog.error(err);
                return res.status(500).json({"message":"DB query failed."});
            }
            response.json(createBibliographicEntriesArray(brs));
        });
    }
}


function createBibliographicEntriesArray(brs){
    // Loop over BEs and take only the scans that are really OCR processed
    if(brs.length > 0){
        var result = [];
        for(var br of brs){
            for(var be of br.cites){
                if(be.status === enums.status.ocrProcessed){
                    result.push(be);
                }
            }
        }
        return result;
    }else{
        return [];
    }
}

function update(req, res){
    var response = res;
    var id = req.swagger.params.id.value;
    var update = req.swagger.params.bibliographicEntry.value;

    if(! mongoose.Types.ObjectId.isValid(id)){
        errorlog.error("Invalid value for parameter id.", {id : id});
        return response.status(400).json({"message":"Invalid parameter."});
    }

    mongoBr.findOne({ 'cites._id': id}, function (err, br) {
        if(err){
            errorlog.error(err);
            return res.status(500).json({"message":"DB query failed."});
        }
        if(!br){
            errorlog.error("No bibliographic entry found for id.", {id: id});
            return res.status(500).json({"message":"No bibliographic entry found for id."});
        }


        for(var be of br.cites){
            if(be._id.toString() === id){
                var index = br.cites.indexOf(be);
                console.log(be);
                extend(true, be, update);
                console.log(be);
                br.cites[index] = be;
                console.log(br);
                br.save().then(function(result){
                    for(var be of br.cites){
                        if(be._id.toString() === id){
                            return response.json(be);
                        }
                    }
                }, function(err){
                    return response.status(500).send(err);
                });
            }
        }
    });
}


function getInternalSuggestions(req, res){
    var response = res;
    var searchObject = req.swagger.params.bibliographicEntry.value;
    var title = searchObject.title;
    async.parallel([
        function(callback){
            mongoBr.find({'cites':{$elemMatch: {'title': title, 'status': enums.status.valid}}}, function (err, brs) {
                if(err) {
                    errorlog.error(err);
                    return callback(err, null);
                }
                if(brs.length == 0){
                    return callback(null, brs);
                }
                var bes = [];
                for(var br of brs){
                    for(var be of br.cites.toObject()){
                        if(be.title == title){
                            delete be.scanId;
                            delete be.marker;
                            delete be.coordinates;
                            delete be.status;
                            bes.push(be);
                        }
                    }
                }
                return callback(bes, null)
            });
        },
        function(callback){
            mongoBr.find({'title' : title}, function (err, brs) {
                if(err) {
                    errorlog.error(err);
                    return callback(err, null);
                }
                if(brs.length == 0){
                    return callback(null, brs);
                }
                var bes = [];
                for(br of brs){
                    var authors = [];
                    for(var contributor of br.contributors){
                        if(contributor.roleType = enums.roleType.author){
                            var author = contributor.heldBy.nameString;
                            authors.push(author);
                        }
                    }
                    var be = new biliographicEntry({title: br.title, date: br.year, authors: authors});
                    bes.push(be);
                }
                return callback(null, bes);
            });

        }
    ],
    function(err, res){
        if(err) {
            errorlog.error(err);
            return response.status(500).json(err);
        }
        var result = [];
        if(res[0].length > 0){
            for(var be of res[0]){
                result.push(be);
            }
        }
        if(res[1].length > 0){
            for(var be of res[1]){
                result.push(be);
            }
        }
        return response.json(result);
    });

}

function getExternalSuggestions(req, res){
    var response = res;
    var searchObject = req.swagger.params.bibliographicEntry.value;

    response.json([]);
}


module.exports = {
    getToDoBibliographicEntries : getToDoBibliographicEntries,
    update: update,
    getInternalSuggestions : getInternalSuggestions,
    getExternalSuggestions : getExternalSuggestions
};