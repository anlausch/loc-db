/**
 * Created by anlausch on 10/6/2017.
 */
const should = require('should');
const setup = require('./../setup.js').createSetup();
const solrHelper = require('./../../../api/helpers/solrHelper.js').createSolrHelper();
const fs = require('fs');
const enums = require('./../../../api/schema/enum.json');

describe('helpers', function() {
    describe('solrHelper', function() {
        before(function (done) {
            setup.dropDB(function (err) {
                setup.mockGVI();
                setup.mockK10Plus();
                done();
            });
        });

        after(function (done) {
            setup.dropDB(function (err) {
                done();
            });
        });

        describe('GVI queryByQueryString', function () {
            it('should return something', function (done) {
                this.timeout(1000000000);
                solrHelper.queryGVIByQueryString("test", function (err, result) {
                    result.should.be.Array().and.have.lengthOf(10);
                    result[0][0].should.have.property("type", "BOOK");
                    result[0][0].book_identifiers[0].should.have.property("scheme", enums.identifier.gviId);
                    should.not.exists(err);
                    done();
                });
            });
        });


        describe('K10Plus queryByQueryString', function () {
            it('should return something', function (done) {
                this.timeout(1000000000);
                solrHelper.queryK10plusByQueryString("test", function (err, result) {
                    result.should.be.Array().and.have.lengthOf(10);
                    result[0][0].should.have.property("type", "JOURNAL_ARTICLE");
                    result[0][0].journalArticle_identifiers[2].should.have.property("scheme", enums.identifier.k10plusId);
                    should.not.exists(err);
                    done();
                });
            });
        });

    });
});