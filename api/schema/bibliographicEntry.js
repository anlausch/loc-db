'use strict';

const SchemaObject = require('schema-object');
const status = require('./enum.json').status;
const externalSources = require('./enum.json').externalSources;

//Create bibliographicEntry schema 
var bibliographicEntry = new SchemaObject({
    bibliographicEntryText: String, // the literal text if a bibliographic entry, i.e. "the reference"
    references: String, // the corpus identifier of the br the bibliographic entry references
    coordinates: String, // coordinates on the respective scan --> extension to the OCC metadata model
    //xmlName: String, // IDEA: Save the path to the corresponding xml here?
    scanId: String, // IDEA: Save the path to the scan here?
    status: {type: String, enum: [status.ocrProcessed, status.valid, status.external]},
    externalURLs: [{
        url: String,
        source: {type: String, enum: [externalSources.gScholar]},
    }],
    authors: [String],
    title: String,
    date: String,
    marker: String
});

module.exports = bibliographicEntry;