'use strict';

const crossref = require('crossref');
const Identifier = require('./../schema/identifier.js');
const BibliographicResource = require('./../schema/bibliographicResource.js');
const AgentRole = require('./../schema/agentRole.js');
const BibliographicEntry = require('./../schema/bibliographicEntry.js');
const ResourceEmbodiment = require('./../schema/resourceEmbodiment.js');
const enums = require('./../schema/enum.json');
const logger = require('./../util/logger.js');
const stringSimilarity = require('string-similarity');
const removeDiacritics = require('diacritics').remove;
const utf8 = require('utf8');

var CrossrefHelper = function(){
};

/**
 * Places a fuzzy string query to Crossref and returns an array of matching BRs
 * @param query
 * @param callback
 */
CrossrefHelper.prototype.query = function(query, callback){
    var self = this;
    // TODO: remove this, when they have fixed the issue
    query = removeDiacritics(query);
    crossref.works({query: query, mailto:"anne@informatik.uni-mannheim.de"}, (err, objs, nextOpts, done) => {
        if (err) {
            logger.error(err);
            return callback(err, null);
        }
        self.parseObjects(objs, function(err, res){
            if (err) {
                logger.error(err);
                return callback(err, null);
            }
            return callback(null, res);
        });
    });
};


/**
 * Places a fuzzy string query to Crossref for searching for chapter metadata via the container-title and returns an array of matching BRs
 * @param query
 * @param callback
 */
CrossrefHelper.prototype.queryChapterMetaData = function(containerTitle, firstPage, lastPage, callback){
    var self = this;
    // TODO: remove this, when they have fixed the issue
    containerTitle = utf8.encode(containerTitle);
    containerTitle = removeDiacritics(containerTitle);
    crossref.works({"query.container-title": containerTitle, mailto:"anne@informatik.uni-mannheim.de"}, (err, objs, nextOpts, done) => {
        if (err) {
            logger.error(err);
            return callback(err, null);
        }
        var candidates = [];
        for(var obj of objs){
            if(stringSimilarity.compareTwoStrings(obj['container-title'][0], containerTitle) > 0.95
                && (obj['page'] == firstPage + "-" + lastPage || obj['page'] == firstPage + "--" + lastPage)){
                logger.info("Match on pages and title, similarity = " + stringSimilarity.compareTwoStrings(obj['container-title'][0], containerTitle));
                candidates.push(obj);
            }
        }
        self.parseObjects(candidates, function(err, res){
            if (err) {
                logger.error(err);
                return callback(err, null);
            }
            return callback(null, res);
        });
    });
};


/**
 * Retrieves references from Crossref given a DOI or a query string and returns an array of BRs
 * @param doi
 * @param query
 * @param callback
 */
CrossrefHelper.prototype.queryReferences = function(doi, query, callback){
    var self = this;
    if(doi != null){
        crossref.work(doi,(err, obj, nextOpts, done) => {
            if (err) {
                logger.error(err);
                return callback(err, null);
            }
            // check whether they really contain the 'reference' property
            var candidates = [];
            if(obj.reference){
                candidates.push(obj);
            }
            self.parseObjects(candidates, function(err, res){
                if (err) {
                    logger.error(err);
                    return callback(err, null);
                }
                return callback(null, res);
            });
        });
    }else if(query != null){
        // TODO: remove this, when they have fixed the issue
        query = removeDiacritics(query);
        crossref.works({query: query, filter:{"has-references" : true}, mailto: "anne@informatik.uni-mannheim.de"}, (err, objs, nextOpts, done) => {
            if (err) {
                logger.error(err);
                return callback(err, null);
            }
            // check whether they really contain the 'reference' property
            var candidates = [];
            for(var obj of objs){
                if(obj.reference){
                    candidates.push(obj);
                }
            }
            self.parseObjects(candidates, function(err, res){
                if (err) {
                    logger.error(err);
                    return callback(err, null);
                }
                return callback(null, res);
            });
        });
    }

};


/**
 * Retrieves meta data from Crossref given a DOI
 * @param doi
 * @param callback
 */
CrossrefHelper.prototype.queryByDOI = function(doi, callback){
    var self = this;
    crossref.work(doi, (err, obj, nextOpts, done) => {
        if (err) {
            logger.error(err);
            return callback(err, null);
        }
        // check whether they really contain the 'reference' property
        var candidates = [];
        candidates.push(obj);
        var containerTitle = obj['container-title'] ? obj['container-title'] [0] : obj['container-title'];
        self.parseObjects(candidates, function(err, res){
            if (err) {
                logger.error(err);
                return callback(err, null);
            }
            if (res.length >0){
                var result = []
                result[0] = res[0];
                result[1] = containerTitle;
                return callback(null, result);
            }
            return callback(null, null);
        });
    });
};


/**
 * Parses an array of Crossref objects and returns an array of BRs
 * @param objects
 * @param callback
 */
CrossrefHelper.prototype.parseObjects = function(objects, callback){
    var res = [];
    for(var obj of objects){
        var type = obj.type;

        // Identifiers
        var identifiers = [];
        if(obj.DOI){
            var identifier = new Identifier({scheme: enums.identifier.doi, literalValue: obj.DOI});
            identifiers.push(identifier.toObject());
        }
        if(obj.URL){
            var identifier = new Identifier({scheme: enums.externalSources.crossref, literalValue: obj.URL});
            identifiers.push(identifier.toObject());
        }
        if(obj.ISSN){
            for(var issn of obj.ISSN){
                var identifier = new Identifier({scheme: enums.identifier.issn, literalValue: issn});
                identifiers.push(identifier.toObject())
            }
        }
        // Contributors
        var contributors = [];
        if(obj.author){
            for(var author of obj.author){
                var agentRole = new AgentRole({roleType: enums.roleType.author, heldBy: {nameString: (author.family + " " + author.given), givenName: author.given, familyName: author.family}});
                contributors.push(agentRole.toObject());
            }
        }
        if(obj.publisher){
            var agentRole = new AgentRole({roleType: enums.roleType.publisher, heldBy: {nameString: obj.publisher}});
            contributors.push(agentRole.toObject());
        }
        // Title
        var title = "";
        if(obj.title && obj.title[0]) {
            title = obj.title[0];
        }
        // Subtitle
        var subtitle = ""
        if(obj.subtitle && obj.subtitle[0]) {
            subtitle = obj.subtitle[0];
        }

        // Reference list
        if(obj.reference){
            var bes = [];
            for(var reference of obj.reference){
                var referenceTitle = reference['article-title'] ? reference['article-title'] : "";
                var referenceAuthor = reference.author ? reference.author : "";
                var referenceYear = reference.year ? reference.year : "";
                var referenceJournal = reference['journal-title'] ? reference['journal-title'] : "";
                var referenceVolume = reference.volume ? reference.volume : "";
                var referenceComments = reference['first-page']? "First page: " + reference['first-page'] : "";


                if(referenceTitle === ""){
                    referenceTitle = reference['volume-title'] ? reference['volume-title'] : "";
                }

                var bibliographicEntry = new BibliographicEntry({
                    identifiers:[new Identifier({scheme: enums.identifier.doi, literalValue: reference.DOI})],
                    bibliographicEntryText: reference.unstructured,
                    ocrData:{
                        title: referenceTitle,
                        date: referenceYear,
                        authors: [referenceAuthor],
                        journal: referenceJournal,
                        volume: referenceVolume,
                        comments: referenceComments
                    },
                    status: enums.status.external});
                bes.push(bibliographicEntry);
            }

        }
        var firstPage = obj.page && obj.page.split('-').length == 2  ? obj.page.split('-')[0] : obj.page ;
        var lastPage = obj.page && obj.page.split('-').length == 2 ? obj.page.split('-')[1] : "" ;
        var embodiedAs = [new ResourceEmbodiment({firstPage: firstPage, lastPage:lastPage})];
        var containerTitle = obj['container-title'] && obj['container-title'][0] ? obj['container-title'][0] : "";

        var publicationYear;
        if(obj['issued'] && obj['issued']['date-parts'] && obj['issued']['date-parts'][0] && obj['issued']['date-parts'][0][0]){
            publicationYear = obj['issued']['date-parts'][0][0];
        }else if (obj['published-print'] && obj['published-print']['date-parts'] && obj['published-print']['date-parts'][0] && obj['published-print']['date-parts'][0][0]){
            publicationYear = obj['published-print']['date-parts'][0][0];
        }else if(obj['published-online'] && obj['published-online']['date-parts'] && obj['published-online']['date-parts'][0] && obj['published-online']['date-parts'][0][0]){
            publicationYear = obj['published-online']['date-parts'][0][0];
        }

        // TODO: Parse type
        var bibliographicResource = new BibliographicResource({
            title: title,
            subtitle: subtitle,
            contributors: contributors,
            identifiers: identifiers,
            status: enums.status.external,
            parts: bes,
            embodiedAs: embodiedAs,
            containerTitle: containerTitle,
            publicationYear: publicationYear
        });


        res.push(bibliographicResource.toObject());
    }
    callback(null, res);
};


/**
 * Given a crossref type, it returns the matching internal enum
 * @param type
 * @returns type
 */
CrossrefHelper.prototype.getType = function(type){
    switch(type){
        case 'journal-article':
            return enums.resourceType.journalArticle;
        case 'journal':
            return enums.resourceType.journal;
        case 'journal-issue':
            return enums.resourceType.journalIssue;
        case 'journal-volume':
            return enums.resourceType.journalVolume;
        case 'book':
            return enums.resourceType.book;
        case 'book-chapter':
            return enums.resourceType.bookChapter;
        case 'book-part':
            return enums.resourceType.bookPart;
        case 'book-section':
            return enums.resourceType.bookSection;
        case 'book-series':
            return enums.resourceType.bookSeries;
        case 'book-set':
            return enums.resourceType.bookSet;
        case 'book-track':
            return enums.resourceType.bookTrack;
        case 'edited-book':
            return enums.resourceType.editedBook;
        case 'component':
            return enums.resourceType.component;
        case 'dataset':
            return enums.resourceType.dataset;
        case 'dissertation':
            return enums.resourceType.dissertation;
        case 'proceedings':
            return enums.resourceType.proceedings;
        case 'proceedings-article':
            return enums.resourceType.proceedingsArticle;
        case 'monograph':
            return enums.resourceType.monograph;
        case 'reference-book':
            return enums.resourceType.referenceBook;
        case 'reference-entry':
            return enums.resourceType.referenceEntry;
        case 'report':
            return enums.resourceType.report;
        case 'report-series':
            return enums.resourceType.reportSeries;
        case 'standard':
            return enums.resourceType.standard;
        case 'standard-series':
            return enums.resourceType.standardSeries;
    }
};


/**
 * Extracts the references from a given crossref object
 * @param obj
 */
CrossrefHelper.prototype.parseReferences = function(obj, callback){
    // Reference list
    if(obj.reference){
        var bes = [];
        for(var reference of obj.reference){
            var referenceTitle = reference['article-title'] ? reference['article-title'] : "";
            var referenceAuthor = reference.author ? reference.author : "";
            var referenceYear = reference.year ? reference.year : "";
            var referenceJournal = reference['journal-title'] ? reference['journal-title'] : "";
            var referenceVolume = reference.volume ? reference.volume : "";
            var referenceComments = reference['first-page']? "First page: " + reference['first-page'] : "";


            if(referenceTitle === ""){
                referenceTitle = reference['volume-title'] ? reference['volume-title'] : "";
            }

            var bibliographicEntry = new BibliographicEntry({
                identifiers:[new Identifier({scheme: enums.identifier.doi, literalValue: reference.DOI})],
                bibliographicEntryText: reference.unstructured,
                ocrData:{
                    title: referenceTitle,
                    date: referenceYear,
                    authors: [referenceAuthor],
                    journal: referenceJournal,
                    volume: referenceVolume,
                    comments: referenceComments
                },
                status: enums.status.external});

            bes.push(bibliographicEntry);
        }
    }
    return callback(null, bes);
};


/**
 * Factory function
 *
 * @returns {CrossrefHelper}
*/
function createCrossrefHelper() {
    return new CrossrefHelper();
}


module.exports = {
        createCrossrefHelper : createCrossrefHelper
};