'use strict';
const BibliographicResource = require('./../schema/bibliographicResource');
const logger = require('./../util/logger');
const stringSimilarity = require('string-similarity');
const levenshtein = require('fast-levenshtein');
const googleScholarHelper = require('./googleScholarHelper.js').createGoogleScholarHelper();
const crossrefHelper = require('./crossrefHelper.js').createCrossrefHelper();
const swbHelper = require('./swbHelper.js').createSwbHelper();
const solrHelper = require('./solrHelper.js').createSolrHelper();
const enums = require('./../schema/enum.json');
const async = require('async');

var SuggestionHelper = function(){
};


SuggestionHelper.prototype.sort= function(query, suggestions, callback){
    var self = this;
    self.computeSimilarities(query, suggestions, function(err, suggestionsScored){
        if(err){
           logger.error(err);
           return callback(err, null);
        }
        var suggestionsSorted = suggestionsScored.sort(self.compare);
        var suggestionsFinal = [];
        for(var parentChild of suggestionsSorted){
            var parentChildFinal = [];
            for(var brScored of parentChild){
                parentChildFinal.push(brScored.br);
            }
            suggestionsFinal.push(parentChildFinal);
        }
        return callback(null, suggestionsFinal);
    });
};


SuggestionHelper.prototype.compare = function(parentChildA,parentChildB){

    function getMaxScore(parentChild){
        var scores = [];
        for(var brScore of parentChild){
            scores.push(brScore.score);
        }
        return Math.max.apply(Math, scores);;

    };

    var scoreA = getMaxScore(parentChildA);
    var scoreB = getMaxScore(parentChildB);

    if(scoreA == scoreB)
        return 0;
    if(scoreA > scoreB)
        return 1;
    else
        return -1;
};



SuggestionHelper.prototype.computeSimilarities = function(query, suggestions, callback){
    var suggestionsScored = [];
    for(var parentChild of suggestions) {
        var parentChildScored = [];
        for (var br of parentChild) {
            if(Object.keys(br).length !== 0) {
                var firstAuthor = br.getContributorsForType(br.type) &&  br.getContributorsForType(br.type)[0]
                && br.getContributorsForType(br.type)[0].heldBy && br.getContributorsForType(br.type)[0].heldBy.familyName ? br.getContributorsForType(br.type)[0].heldBy.familyName : '';

                var fullYear =  br.getPublicationDateForType(br.type) ?  br.getPublicationDateForType(br.type).getFullYear() : '';

                var stringRepresentation = [br.getTitleForType(br.type), br.getSubtitleForType(br.type),
                    firstAuthor, fullYear,
                    br.getNumberForType(br.type)].join(' ');

                parentChildScored.push({
                    score: levenshtein.get(stringRepresentation, query), //stringSimilarity.compareTwoStrings(stringRepresentation, query),
                    br: br
                });
            }
        }
        suggestionsScored.push(parentChildScored);

    }
    return callback(null, suggestionsScored);

};


/**Given a string s, this function checks whether there is a DOI present and extracts it
 https://www.crossref.org/blog/dois-and-matching-regular-expressions/**/
SuggestionHelper.prototype.extractDOI = function(s){
    // /^10.\d{4,9}/[-._;()/:A-Z0-9]+$/i
    // modified such that the pattern can also appear in the middle of the string
    return s.match(/10.\d{4,9}\/[-._;()\/:A-Z0-9]+/i);
};


SuggestionHelper.prototype.getExternalSuggestionsByDOI = function(doi, cb){
    async.parallel([
            function (callback) {
                crossrefHelper.queryByDOI(doi, function (err, res) {
                    if (err) {
                        return callback(err, null);
                    }
                    for(var br of res){
                        br.source = enums.externalSources.crossref;
                    }
                    var result = [res];
                    return callback(null, result);
                });
            }],
        function (err, res) {
            return cb(err, res);
        });
};


SuggestionHelper.prototype.getExternalSuggestionsByQueryString = function(query, cb){
    async.parallel([
            function (callback) {
                swbHelper.queryByQueryString(query, function (err, res) {
                    if (err) {
                        return callback(err, null);
                    }
                    for(var parentChild of res){
                        for(var br of parentChild){
                            br.source = enums.externalSources.swb;
                        }
                    }
                    return callback(null, res);
                });
            },
            function (callback) {
                solrHelper.queryGVIByQueryString(query, function (err, res) {
                    if (err) {
                        return callback(err, null);
                    }
                    for(var parentChild of res){
                        for(var br of parentChild){
                            br.source = enums.externalSources.gvi;
                        }
                    }
                    return callback(null, res);
                });
            },
            function (callback) {
                solrHelper.queryK10plusByQueryString(query, function (err, res) {
                    if (err) {
                        return callback(err, null);
                    }
                    for(var parentChild of res){
                        for(var br of parentChild){
                            br.source = enums.externalSources.k10plus;
                        }
                    }
                    return callback(null, res);
                });
            },
            function (callback) {
                crossrefHelper.query(query, function (err, res) {
                    if (err) {
                        return callback(err, null);
                    }
                    for(var parentChild of res){
                        for(var br of parentChild){
                            br.source = enums.externalSources.crossref;
                        }
                    }
                    return callback(null, res);
                });
            }],
        function (err, res) {
            return cb(err, res);
        });
};


SuggestionHelper.prototype.getExternalSuggestions = function(query, k, callback) {
    var self = this;
    var doi = self.extractDOI(query);

    if(!doi){
        self.getExternalSuggestionsByQueryString(query,
            function (err, res) {
                if (err) {
                    logger.error(err);
                    if(!res || (Array.isArray(res) && res.every(element => element === null))){
                        return callback(err, null);
                    }
                }

                var result= [].concat.apply([], res);

                self.sort(query, result, function(err,result){
                    result = result.slice(0, k);
                    for(var parentChild of result){
                        for(var br of parentChild){
                            br.status = enums.status.external;
                        }
                    }
                    return callback(null, result);
                });
            }
        );
    }else{
        self.getExternalSuggestionsByDOI(doi[0].trim(),
            function (err, res) {

                if (err) {
                    logger.error(err);
                    if(!res || (Array.isArray(res) && res.every(element => element === null))){
                        return callback(err, null);
                    }
                }
                var result = [];
                for(var sourceRes of res){
                    if (sourceRes && sourceRes.length > 0) {
                        for (var parentChild of sourceRes) {
                            for (var br of parentChild) {
                                br.status = enums.status.external;
                            }
                            result.push(parentChild);
                        }
                    }
                }

                return callback(null, result);
            });
    }
};


/**
 * Factory function
 *
 * @returns {SuggestionHelper}
 */
function createSuggestionHelper() {
    return new SuggestionHelper();
}


module.exports = {
    createSuggestionHelper : createSuggestionHelper
};